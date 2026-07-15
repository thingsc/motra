import { useEffect } from 'react'
import { useScopeStore, initSpanFromState } from './scopeStore'
import { ScopeControls } from './ScopeControls'
import { TxControls } from './TxControls'
import { ScopeChart } from './ScopeChart'
import { ChannelPanel } from './ChannelPanel'
import { HexView } from './HexView'
import { StatusBar } from './StatusBar'
import { SamplingControls } from './SamplingControls'
import { PauseToggle } from './PauseToggle'
import { HexToggle } from './HexToggle'
import type { SerialEvent } from '@shared/types'

/**
 * 虚拟示波器窗口顶层布局:
 *   ┌─ 控件栏(连接 + 采样 + TX + Pause + HEX) ─┐
 *   │                                          │
 *   │   波形 (ScopeChart)  │  通道面板(ChannelPanel)
 *   │                                          │
 *   ├─ 状态栏(port@baud | frames | ...) ──────┤
 */
export function ScopeWindow(): JSX.Element {
  // 初始化 span 与 channels
  useEffect(() => {
    const { span, unit } = initSpanFromState()
    useScopeStore.setState({ span, spanUnit: unit })
    // 从 localStorage 恢复 view 字段(enabled/bias/yRange/colorOverride/label)
    // 必须在 syncChannelsFromMain 之前执行,这样 main 推送的物理字段不会覆盖用户持久化的 view 状态
    useScopeStore.getState().hydrateFromStorage()
  }, [])

  // 订阅主进程 serial:event 推送
  useEffect(() => {
    const unsub = window.api.onSerialEvent((e: SerialEvent) => {
      const s = useScopeStore.getState()
      if (e.type === 'frame') {
        s.applyFrame(e.payload, e.nChannels)
      } else if (e.type === 'bytes') {
        s.appendHex(new Uint8Array(e.payload))
      } else if (e.type === 'status') {
        s.setStatus(e.status)
        s.setConnected(e.status.isOpen)
      } else if (e.type === 'cfg') {
        s.syncChannelsFromMain(e.channels)
      }
    })
    return unsub
  }, [])

  // 启动时拉一次端口列表 + 当前物理通道配置
  useEffect(() => {
    void window.api.serialList().then((ports) => {
      useScopeStore.getState().setPorts(ports)
    })
    void window.api.serialGetCfg().then((cfg) => {
      useScopeStore.getState().syncChannelsFromMain(cfg.channels)
    })
  }, [])

  // Smoke helper: ?demo=1 触发自动连 /tmp/scope-smoke-ptyB @ 115200
  // (这个 URL 参数只在测试时由 main 注入,不暴露给真实用户)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('demo') !== '1') return
    const port = params.get('port') ?? '/tmp/scope-smoke-ptyB'
    const baud = Number(params.get('baud') ?? 115200)
    const t = setTimeout(() => {
      void window.api
        .serialOpen({
          port,
          baud,
          bytesize: 8,
          parity: 'N',
          stopbits: 1,
          timeout: 0.05
        } as never)
        .catch((err: unknown) => console.error('[demo] serialOpen failed:', err))
    }, 600)
    return () => clearTimeout(t)
  }, [])

  const showHex = useScopeStore((s) => s.showHex)
  const connected = useScopeStore((s) => s.connected)

  return (
    <div className="h-full flex flex-col bg-bg-base text-fg-base">
      <header className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line bg-bg-panel">
        <ScopeControls />
        <span className="mx-1 h-5 w-px bg-line" />
        <SamplingControls />
        <span className="mx-1 h-5 w-px bg-line" />
        <TxControls disabled={!connected} />
        <div className="ml-auto flex items-center gap-2">
          <PauseToggle />
          <HexToggle />
        </div>
      </header>

      <main className="flex-1 min-h-0 flex">
        {showHex ? (
          <HexView />
        ) : (
          <>
            <ScopeChart />
            <ChannelPanel />
          </>
        )}
      </main>

      <StatusBar />
    </div>
  )
}