// App 入口:三栏 + 顶栏 + composer + IPC 流式订阅。
// v2 (SDK 直连):不再有 cliCmd/cliArgs/cliCwd,改成 providerModel/providerSystem。

import { useCallback, useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatPane } from './components/ChatPane'
import { Composer } from './components/Composer'
import { Topbar } from './components/Topbar'
import { useSessionStore } from './store/sessionStore'
import type { CliEvent, Session } from '../../shared/types'

export default function App(): JSX.Element {
  const providerModel = useSessionStore((s) => s.providerModel)
  const providerSystem = useSessionStore((s) => s.providerSystem)
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
      const session: Session = await window.api.startCli({
        model: providerModel,
        system: providerSystem || undefined,
        title: `New ${new Date().toLocaleString('zh-CN')}`
      })
      upsert(session)
      select(session.id)
    } catch (err) {
      setBootError(String(err))
    } finally {
      setBusy(false)
    }
  }, [providerModel, providerSystem, upsert, select])

  const submitMessage = useCallback(
    async (text: string) => {
      if (!currentId) return
      // 立刻 push user 消息到 store(乐观更新,不等主进程)
      pushUserMessage(currentId, text)
      markInflight(currentId, true)
      try {
        await window.api.sendInput(currentId, text)
      } catch (err) {
        markInflight(currentId, false)
        pushSystemMessage(currentId, `发送失败: ${String(err)}`)
      }
    },
    [currentId, pushUserMessage, pushSystemMessage, markInflight]
  )

  const stopCurrent = useCallback(async () => {
    if (!currentId) return
    await window.api.killCli(currentId)
  }, [currentId])

  const restartCurrent = useCallback(async () => {
    if (!currentId) return
    const s = sessionsMap[currentId]
    if (!s) return
    // SDK 模式下没有进程可"重启"——kill 等同于 abort 当前流。
    // 想要"清空重开"可以删旧 session 再 new,这里只做 abort。
    await window.api.killCli(currentId)
  }, [currentId, sessionsMap])

  const deleteSession = useCallback(
    async (id: string) => {
      await window.api.killCli(id)
      await window.api.deleteSession(id)
      remove(id)
    },
    [remove]
  )

  const current = currentId ? sessionsMap[currentId] : undefined
  // SDK 模式下 SDK 流在 sendInput 后到 turn-end 之间为 inflight
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
            ? `回车到 ${current.model} · Ctrl+Enter 发送`
            : '先点左侧 New Session 开个会话'
        }
      />
    </div>
  )
}