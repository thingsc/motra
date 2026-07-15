import { useScopeStore } from './scopeStore'

export function PauseToggle(): JSX.Element {
  const paused = useScopeStore((s) => s.paused)
  const setPaused = useScopeStore((s) => s.setPaused)
  return (
    <button
      onClick={() => setPaused(!paused)}
      className={paused ? 'btn-primary' : 'btn-ghost'}
      title={paused ? '已暂停 — 点击继续' : '暂停/继续(不清缓冲)'}
    >
      {paused ? '▶ Resume' : '⏸ Pause'}
    </button>
  )
}