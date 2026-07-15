import { useScopeStore } from './scopeStore'

export function HexToggle(): JSX.Element {
  const showHex = useScopeStore((s) => s.showHex)
  const setShowHex = useScopeStore((s) => s.setShowHex)
  return (
    <button
      onClick={() => setShowHex(!showHex)}
      className={showHex ? 'btn-primary' : 'btn-ghost'}
      title="切换 波形 / HEX 字节流 视图"
    >
      {showHex ? '📈 波形' : '🔣 HEX'}
    </button>
  )
}