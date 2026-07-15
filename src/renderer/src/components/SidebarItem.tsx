import type { ReactNode } from 'react'

interface Props {
  /** 显示文案(中文,如「虚拟示波器」) */
  label: string
  onClick: () => void
  /** 选中态(浅灰底 + 白字,仿 Altior) */
  active?: boolean
  /** 可选 icon 槽位(后续接 lucide-react 时填) */
  icon?: ReactNode
  title?: string
}

/**
 * 侧栏单入口:icon + label,选中态高亮。
 * 用 button 保证键盘可达 + a11y;row 高度跟 Altior 一致约 28px。
 */
export function SidebarItem({ label, onClick, active, icon, title }: Props): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
        active
          ? 'bg-bg-hover text-fg-base'
          : 'text-fg-base hover:bg-bg-hover'
      }`}
    >
      <span className="w-4 h-4 inline-flex items-center justify-center text-fg-muted text-base shrink-0">
        {icon ?? '•'}
      </span>
      <span className="truncate">{label}</span>
    </button>
  )
}