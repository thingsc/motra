// check-persistence.mjs - 直接用 esbuild 的 build API 把 src/main/persistence.ts + shared/types.ts
// 编译到一个临时 CJS 文件,用 stub 替换 'electron',然后 require + 跑一个 round-trip 测试。
//
// 这么做的好处:
//  - 不需要临时 tsconfig
//  - 不依赖 tsc 的 typeRoots / paths / 等一堆选项
//  - 输出天然是单个 .cjs 文件,test.cjs 直接 require 即可

import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import * as esbuild from 'esbuild'

const require = createRequire(import.meta.url)

export async function runPersistence(item, ctx) {
  const args = item.args ?? {}
  const userData = mkdtempSync(join(tmpdir(), 'motra-userdata-'))
  const seed = {
    id: args.session?.id ?? 'sess-test',
    title: args.session?.title ?? '验收用会话',
    cmd: args.session?.cmd ?? 'claude',
    args: args.session?.args ?? ['--print'],
    messages: Array.isArray(args.session?.messages) ? args.session.messages : [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'idle'
  }

  // 1) esbuild bundle 真实源码 + electron stub
  const buildDir = mkdtempSync(join(tmpdir(), 'motra-persist-bundle-'))
  const outJs = join(buildDir, 'persistence.cjs')
  const electronStub = `module.exports = { app: { getPath: () => process.env.MOTRA_FAKE_USERDATA } }\n`

  let result
  try {
    result = await esbuild.build({
      entryPoints: [resolve(ctx.root, 'src/main/persistence.ts')],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      outfile: outJs,
      plugins: [
        {
          name: 'electron-stub',
          setup(b) {
            b.onResolve({ filter: /^electron$/ }, () => ({
              path: 'electron-stub',
              namespace: 'stub'
            }))
            b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
              contents: electronStub,
              loader: 'js',
              resolveDir: buildDir
            }))
          }
        }
      ],
      logLevel: 'silent'
    })
  } catch (err) {
    return {
      ok: false,
      error: `esbuild 编译失败`,
      detail: [
        err && err.errors ? err.errors.map((e) => `${e.location?.file}:${e.location?.line} ${e.text}`).join('\n') : String(err),
        `日志: ${result?.warnings?.length ?? 0} 条警告`
      ]
    }
  }

  // 2) 跑持久化 round-trip 测试
  //    用一个独立的 Node 进程,把 COMPILED persistence.cjs require 进来并跑 save+load
  const testScript = join(buildDir, 'test.cjs')
  writeFileSync(testScript, TEST_RUNNER)
  const testResult = await runChild('node', [testScript], {
    env: {
      ...process.env,
      MOTRA_PERSISTENCE_JS: outJs,
      MOTRA_FAKE_USERDATA: userData,
      MOTRA_PERSIST_SEED: JSON.stringify(seed)
    }
  })
  if (testResult.code !== 0) {
    return { ok: false, error: `持久化测试退出 ${testResult.code}`, detail: [(testResult.stderr || testResult.stdout || '').trim().split('\n').slice(-30).join('\n')] }
  }

  // 3) 顺便 verify 一下 sessions.json 真实写到了 userData
  const jsonPath = join(userData, 'sessions.json')
  if (!fileExists(jsonPath)) {
    return { ok: false, error: `sessions.json 未写到 ${jsonPath}` }
  }
  const onDisk = JSON.parse(readFileSync(jsonPath, 'utf8'))
  const ok = onDisk.sessions?.some((s) => s.id === seed.id && s.title === seed.title)
  if (!ok) {
    return { ok: false, error: `sessions.json 内未找到种子 session` }
  }
  return {
    ok: true,
    detail: [
      `userData = ${userData}`,
      `bundle = ${outJs}`,
      `file = ${jsonPath} (${JSON.stringify(onDisk).length} bytes)`,
      `seed id ${seed.id} found with title '${seed.title}'`,
      `messages count: ${seed.messages.length}`
    ]
  }
}

const TEST_RUNNER = String.raw`
const persistence = require(process.env.MOTRA_PERSISTENCE_JS)
const seed = JSON.parse(process.env.MOTRA_PERSIST_SEED)
;(async () => {
  try {
    await persistence.saveSessions([seed])
    const list = await persistence.loadSessions()
    const got = list.find((s) => s.id === seed.id)
    if (!got) { console.error('not found after reload'); process.exit(3) }
    if (got.title !== seed.title) { console.error('title mismatch'); process.exit(4) }
    if (JSON.stringify(got.messages) !== JSON.stringify(seed.messages)) {
      console.error('messages mismatch:\n got=' + JSON.stringify(got.messages) + '\n exp=' + JSON.stringify(seed.messages))
      process.exit(5)
    }
    console.log('ROUNDTRIP_OK id=' + got.id + ' title=' + got.title + ' msgs=' + got.messages.length)
  } catch (err) {
    console.error('throw:', err && err.stack || err)
    process.exit(6)
  }
})()
`

function runChild(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: err.message }))
    child.on('exit', (code) => resolve({ code, stdout, stderr }))
  })
}

function fileExists(p) {
  try { return require('node:fs').existsSync(p) } catch { return false }
}
