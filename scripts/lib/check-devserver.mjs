// check-devserver.mjs - 启 electron-vite dev,等关键字符串命中后立刻杀掉。
// 不真的开 GUI(GUI 在 headless 沙箱可能拿不到焦点),只看 vite + electron 链路打通。

import { spawn } from 'node:child_process'

export function runDevServer(item, ctx) {
  const contains = Array.isArray(item.expect?.outputContains) ? item.expect.outputContains : []
  const timeoutMs = Number(item.expect?.timeoutMs ?? item.timeoutMs ?? 30_000)

  return new Promise((done) => {
    const child = spawn('npx', ['electron-vite', 'dev'], {
      cwd: ctx.root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdoutBuf = ''
    let stderrBuf = ''
    const found = new Set()
    const started = Date.now()
    let settled = false

    const settle = (result) => {
      if (settled) return
      settled = true
      try { child.kill('SIGTERM') } catch {}
      setTimeout(() => {
        try { child.kill('SIGKILL') } catch {}
        done(result)
      }, 200)
    }

    const timer = setTimeout(() => {
      const detail = [
        `运行了 ${Date.now() - started}ms`,
        `匹配 ${found.size}/${contains.length}`,
        `stdout tail:\n${tail(stdoutBuf)}`,
        `stderr tail:\n${tail(stderrBuf)}`
      ]
      if (found.size === contains.length) settle({ ok: true, detail })
      else settle({ ok: false, error: `超时 ${timeoutMs}ms`, detail })
    }, timeoutMs)

    child.stdout.on('data', (b) => {
      stdoutBuf += b.toString()
      checkContains(stdoutBuf, found, contains)
      if (contains.length && found.size === contains.length) {
        clearTimeout(timer)
        settle({
          ok: true,
          detail: [
            `命中 ${contains.length}/${contains.length} in ${Date.now() - started}ms`,
            ...[...found].map((s) => `✓ ${s}`)
          ]
        })
      }
    })
    child.stderr.on('data', (b) => {
      stderrBuf += b.toString()
      // stderr 也参与匹配,例如 vite 把部分进度写到 stderr
      checkContains(stderrBuf, found, contains)
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      settle({ ok: false, error: `spawn 失败: ${err.message}` })
    })
  })
}

function checkContains(buf, found, needles) {
  for (const n of needles) {
    if (!found.has(n) && buf.includes(n)) found.add(n)
  }
}

function tail(s, n = 12) {
  const lines = s.split('\n').filter(Boolean)
  return lines.slice(-n).join('\n')
}
