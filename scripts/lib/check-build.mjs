// check-build.mjs - 跑 npm run build,断言退出码 + 关键产物存在。

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export function runBuild(item, ctx) {
  const expected = (item.expect?.outputs ?? []).map((p) => resolve(ctx.root, p))
  return new Promise((done) => {
    const child = spawn('npm', ['run', 'build'], {
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
      const out = stdout + stderr
      if (code !== 0) {
        const tail = out.split('\n').slice(-25).join('\n')
        return done({ ok: false, error: `build 退出码 ${code}\n${tail}` })
      }
      const missing = expected.filter((p) => !existsSync(p))
      if (missing.length) {
        return done({
          ok: false,
          error: '产物缺失',
          detail: missing.map((p) => `missing: ${p}`)
        })
      }
      done({
        ok: true,
        detail: [
          `exit ${code}`,
          ...expected.map((p) => `exists: ${p.replace(ctx.root + '/', '')}`)
        ]
      })
    })
  })
}
