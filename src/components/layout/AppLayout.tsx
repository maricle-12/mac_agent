import type { ReactNode } from 'react'

/**
 * 应用外壳：桌面端左侧固定 Sidebar，移动端为可折叠抽屉。
 * 布局约束：Sidebar 高度撑满视口，主区域独立滚动，Header 与输入区固定。
 */
export interface AppLayoutProps {
  sidebar: ReactNode
  header: ReactNode
  children: ReactNode
  sidebarOpen: boolean
  onCloseSidebar: () => void
}

export function AppLayout({
  sidebar,
  header,
  children,
  sidebarOpen,
  onCloseSidebar,
}: AppLayoutProps) {
  return (
    <div className="flex h-full w-full overflow-hidden bg-canvas">
      {/* 桌面端固定侧边栏 */}
      <div
        data-testid="sidebar-desktop"
        className="hidden h-full w-64 shrink-0 border-r border-line md:flex lg:w-[272px]"
      >
        {sidebar}
      </div>

      {/* 移动端抽屉 */}
      {sidebarOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-ink/30"
            onClick={onCloseSidebar}
            aria-hidden="true"
          />
          <div className="drawer-safe absolute inset-y-0 left-0 flex w-72 max-w-[86%] border-r border-line bg-sidebar shadow-2xl">
            {sidebar}
          </div>
        </div>
      ) : null}

      <div className="flex h-full min-w-0 flex-1 flex-col">
        {header}
        {children}
      </div>
    </div>
  )
}
