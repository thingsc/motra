import type { ReactNode } from 'react'

interface Props {
  title: string
  children: ReactNode
}

/**
 * 侧栏通用分组容器:title + children。
 * title 用 uppercase + tracking-wider 小字,跟 Altior 风格一致。
 * 不可折叠(本期不实现,后续可加 useState + chevron)。
 */
export function SidebarSection({ title, children }: Props): JSX.Element {
  return (
    <section className="border-b border-line">
      <header className="px-3 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-fg-muted">
        {title}
      </header>
      <div className="px-1 pb-2">{children}</div>
    </section>
  )
}