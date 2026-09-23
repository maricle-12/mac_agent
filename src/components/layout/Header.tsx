import { SettingsIcon } from '@/components/common/icons'
import { cn } from '@/utils/cn'
import type { ApiConnectionStatus } from '@/types/chat'
import type { AgentMode } from '@/types/conversation'

export interface HeaderProps {
  mode: AgentMode
  modelName: string
  apiStatus: ApiConnectionStatus
  onOpenSidebar: () => void
  onOpenSettings: () => void
}

const modeLabel: Record<AgentMode, string> = {
  teacher: '教师模式',
  student: '学生模式',
}

const statusStyle: Record<ApiConnectionStatus, { dot: string; text: string; label: string }> = {
  unconfigured: { dot: 'bg-transparent ring-1 ring-ink-muted', text: 'text-ink-muted', label: '未配置' },
  unknown: { dot: 'bg-warning', text: 'text-ink-soft', label: '待验证' },
  testing: { dot: 'bg-warning animate-pulse', text: 'text-ink-soft', label: '检测中' },
  connected: { dot: 'bg-success', text: 'text-success', label: '已连接' },
  failed: { dot: 'bg-danger', text: 'text-danger', label: '连接失败' },
}

export function Header({
  mode,
  modelName,
  apiStatus,
  onOpenSidebar,
  onOpenSettings,
}: HeaderProps) {
  const status = statusStyle[apiStatus]

  return (
    <header
      data-testid="header"
      className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-3 sm:px-5"
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="打开菜单"
          className="rounded-lg p-2 text-ink-soft transition-colors hover:bg-canvas hover:text-ink md:hidden"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="size-5" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <h1 className="truncate text-sm font-semibold text-ink">{modeLabel[mode]}</h1>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div className="hidden items-center gap-2 text-xs text-ink-soft sm:flex">
          <span className="max-w-[160px] truncate font-medium text-ink">{modelName}</span>
          <span className={cn('flex items-center gap-1.5', status.text)}>
            <span className={cn('size-1.5 rounded-full', status.dot)} />
            {status.label}
          </span>
        </div>

        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="API 设置"
          title="API 设置"
          className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
        >
          <SettingsIcon className="size-4" />
          <span className="hidden sm:inline">设置</span>
        </button>
      </div>
    </header>
  )
}
