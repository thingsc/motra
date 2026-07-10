// check-typecheck.mjs - 跑 npm run typecheck,断言退出码 0。

import { spawn } from 'node:child_process'

export function runTypecheck(item, ctx) {
  return new Promise((done) => {
    const child = spawn('npm', ['run', 'typecheck'], {
      cwd: ctx.root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stderr = ''
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('error', (err) => done({ ok: false, error: err.message }))
    child.on('exit', (code) => {
      if (code !== 0) {
        const lines = stderr
          .split('\n')
          .filter((l) => l.includes('error TS') || l.startsWith('>'))
          .slice(0, 30)
          .join('\n')
        return done({ ok: false, error: `typecheck exit ${code}\n${lines}` })
      }
      done({ ok: true, detail: ['exit 0'] })
    })
  })
}
