// check-scope-protocol.mjs — 跑 FrameAssembler TS 自测脚本。
//
// 跑法:spawn node 24 + --experimental-strip-types 执行 scripts/scope-protocol-self-test.ts。
// 自测脚本内部会跑 8 个 case,包括:
//   1) encodeCommand 与 mcb_host Python 端字节级一致
//   2) FrameAssembler.feed 解出完整帧
//   3) 分块喂入
//   4) 在垃圾字节中 resync
//   5) signed 重解释
//   6) 非法长度校验
//   7) 非法 payload 计数
//   8) buildFrame 字节序
//
// 退出码 0 = 全过,非 0 = 有 fail。

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export function runScopeProtocol(item, ctx) {
  const scriptRel = item.script ?? 'scripts/scope-protocol-self-test.ts'
  const scriptAbs = resolve(ctx.root, scriptRel)
  if (!existsSync(scriptAbs)) {
    return Promise.resolve({ ok: false, error: `自测脚本不存在: ${scriptRel}` })
  }
  return new Promise((done) => {
    const child = spawn('node', ['--experimental-strip-types', '--no-warnings', scriptAbs], {
      cwd: ctx.root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('error', (err) => done({ ok: false, error: `spawn fail: ${err.message}` }))
    child.on('exit', (code) => {
      if (code === 0) {
        const passLines = stdout
          .split('\n')
          .filter((l) => l.trim().startsWith('✓'))
          .length
        done({
          ok: true,
          detail: [
            `exit ${code}`,
            `node ${process.versions.node} --experimental-strip-types`,
            `${passLines} 个断言通过`
          ]
        })
      } else {
        const tail = (stdout + stderr).split('\n').slice(-25).join('\n')
        done({ ok: false, error: `自测退出码 ${code}\n${tail}` })
      }
    })
  })
}