// 第一步的 App 入口:三栏 + 顶栏 + composer + IPC 流式订阅。

import { useCallback, useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatPane } from './components/ChatPane'
import { Composer } from './components/Composer'
import { Topbar } from './components/Topbar'
import { useSessionStore } from './store/sessionStore'
import type { CliEvent, Session } from '../../shared/types'

export default function App(): JSX.Element {
  const cliCmd = useSessionStore((s) => s.cliCmd)
  const cliArgs = useSessionStore((s) => s.cliArgs)
  const cliCwd = useSessionStore((s) => s.cliCwd)
  const currentId = useSessionStore((s) => s.currentId)
  const sessionsMap = useSessionStore((s) => s.sessions)
  const inflight = useSessionStore((s) => s.inflight)
  const upsert = useSessionStore((s) => s.upsert)
  const remove = useSessionStore((s) => s.remove)
  const hydrate = useSessionStore((s) => s.hydrate)
  const select = useSessionStore((s) => s.select)
  const applyEvent = useSessionStore((s) => s.applyEvent)
  const pushUserMessage = useSessionStore((s) => s.pushUserMessage)
  const pushSystemMessage = useSessionStore((s) => s.pushSystemMessage)
  const markInflight = useSessionStore((s) => s.markInflight)

  const [busy, setBusy] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)

  // 首次加载:拉历史 + 订阅事件流
  useEffect(() => {
    void window.api.listSessions().then(hydrate).catch((err) => {
      setBootError(String(err))
    })
    const unsub = window.api.onCliEvent((e: CliEvent) => applyEvent(e))
    return () => unsub()
  }, [hydrate, applyEvent])

  const newSession = useCallback(async () => {
    if (!window.api) return
    setBusy(true)
    try {
      const args = cliArgs.split(/\s+/).filter(Boolean)
      const session: Session = await window.api.startCli({
        cmd: cliCmd,
        args,
        cwd: cliCwd || undefined,
        title: `New ${new Date().toLocaleString('zh-CN')}`
      })
      upsert(session)
      select(session.id)
    } catch (err) {
      setBootError(String(err))
    } finally {
      setBusy(false)
    }
  }, [cliCmd, cliArgs, cliCwd, upsert, select])

  const submitMessage = useCallback(
    async (text: string) => {
      if (!currentId) return
      // 立刻把 user 消息 push 进 store,UI 不需要等主进程回包
      pushUserMessage(currentId, text)
      // 标记 in-flight:Composer 会立刻切到 Stop 按钮,避免重复点 Send
      markInflight(currentId, true)
      try {
        try {
          await window.api.sendInput(currentId, text)
        } catch (err) {
          // 老 session(Electron 重启后没 spawn 进程)会自动走到这里。
          // 尝试自动 Restart(同 sessionId)然后重试;ipc.ts 会保留 messages 历史,
          // 所以用户感觉就是"等了一下又能聊了"。claude 端不记得之前的对话(stream-json
          // 协议没接 --resume),后续可以接。
          const msg = String(err)
          const s = sessionsMap[currentId]
          if (s && msg.includes('not running')) {
            await window.api.killCli(currentId)
            // 自动 Restart 时带上 claudeSessionId,让 claude 端 --resume 续接上下文
            await window.api.startCli({
              sessionId: currentId,
              cmd: s.cmd,
              args: s.args,
              cwd: s.cwd,
              resumeSessionId: s.claudeSessionId
            })
            await window.api.sendInput(currentId, text)
          } else {
            throw err
          }
        }
      } catch (err) {
        markInflight(currentId, false)
        pushSystemMessage(currentId, `发送失败: ${String(err)}`)
      }
    },
    [currentId, sessionsMap, pushUserMessage, pushSystemMessage, markInflight]
  )

  const stopCurrent = useCallback(async () => {
    if (!currentId) return
    await window.api.killCli(currentId)
  }, [currentId])

  const restartCurrent = useCallback(async () => {
    if (!currentId) return
    const s = sessionsMap[currentId]
    if (!s) return
    await window.api.killCli(currentId)
    await new Promise((r) => setTimeout(r, 100))
    const fresh = await window.api.startCli({
      cmd: s.cmd,
      args: s.args,
      cwd: s.cwd
    })
    upsert(fresh)
    select(fresh.id)
  }, [currentId, sessionsMap, upsert, select])

  const deleteSession = useCallback(
    async (id: string) => {
      await window.api.killCli(id)
      await window.api.deleteSession(id)
      remove(id)
    },
    [remove]
  )

  const current = currentId ? sessionsMap[currentId] : undefined
  // stream-json 模式下进程一直在,但 UI 只在等回复时显示 Stop,
  // 用 store.inflight 跟踪"是否在等这一轮 assistant 回复",而不是 session.status
  const running = currentId ? inflight.has(currentId) : false

  return (
    <div className="h-full flex flex-col">
      {bootError && (
        <div className="bg-danger/15 text-danger text-xs px-3 py-1 border-b border-danger">
          {bootError}
        </div>
      )}
      <Topbar busy={busy} onRestart={restartCurrent} />
      <div className="flex-1 flex min-h-0">
        <Sidebar busy={busy} onNewSession={newSession} onDelete={deleteSession} />
        <ChatPane />
      </div>
      <Composer
        disabled={!current || busy}
        running={running}
        onSubmit={submitMessage}
        onStop={stopCurrent}
        placeholder={
          current
            ? `回车到 ${current.cmd} · Ctrl+Enter 发送`
            : '先点左侧 New Session 开个会话'
        }
      />
    </div>
  )
}
