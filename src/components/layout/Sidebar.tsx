import { ChevronRightIcon, PlusIcon } from '@/components/common/icons'
import { ConversationList } from '@/components/history/ConversationList'
import { appConfig } from '@/config/app'
import { cn } from '@/utils/cn'
import type { AgentMode, Conversation } from '@/types/conversation'

export interface SidebarProps {
  mode: AgentMode
  conversations: Conversation[]
  activeId: string | null
  onModeChange: (mode: AgentMode) => void
  onNewConversation: () => void
  onSelectConversation: (id: string) => void
  onRenameConversation: (conversation: Conversation) => void
  onDeleteConversation: (conversation: Conversation) => void
  onOpenSettings: () => void
  onOpenAbout: () => void
}

const modes: Array<{ id: AgentMode; label: string; hint: string }> = [
  { id: 'teacher', label: '教师模式', hint: '教学设计 / 教案 / 练习' },
  { id: 'student', label: '学生模式', hint: '讲解 / 分析 / 错题' },
]

/** 预留功能入口：第一版明确标注「即将支持」，不做成无效按钮 */
function PlaceholderNavItem({ label }: { label: string }) {
  return (
    <div className="flex cursor-not-allowed items-center justify-between rounded-lg px-2 py-1.5 text-[13px] text-ink-muted">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] text-ink-muted">
          即将支持
        </span>
        <ChevronRightIcon className="size-3.5" />
      </span>
    </div>
  )
}

export function Sidebar({
  mode,
  conversations,
  activeId,
  onModeChange,
  onNewConversation,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
  onOpenSettings,
  onOpenAbout,
}: SidebarProps) {
  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      {/* 品牌区 */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-xs font-semibold text-white">
          {appConfig.logo}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink">{appConfig.appName}</span>
          <span className="block truncate text-[11px] text-ink-muted">
            教师 · 学生双模式
          </span>
        </span>
      </div>

      {/* 模式切换 */}
      <div className="space-y-1 px-3">
        {modes.map((item) => {
          const active = item.id === mode
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onModeChange(item.id)}
              className={cn(
                'flex w-full flex-col items-start rounded-lg px-2.5 py-2 text-left transition-colors',
                active
                  ? 'bg-surface text-ink shadow-sm ring-1 ring-line'
                  : 'text-ink-soft hover:bg-white/70 hover:text-ink',
              )}
            >
              <span className="text-[13px] font-medium">{item.label}</span>
              <span className="text-[11px] text-ink-muted">{item.hint}</span>
            </button>
          )
        })}
      </div>

      {/* 新建对话 */}
      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={onNewConversation}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:border-brand/40 hover:text-brand"
        >
          <PlusIcon className="size-4" />
          新建对话
        </button>
      </div>

      {/* 预留入口 */}
      <div className="space-y-0.5 px-3 pt-3">
        <PlaceholderNavItem label="学科工具" />
        <PlaceholderNavItem label="教学资源" />
      </div>

      {/* 历史记录 */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-5 pb-1.5">
          <span className="text-[11px] font-medium tracking-wide text-ink-muted">历史记录</span>
          <span className="text-[11px] text-ink-muted">{conversations.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          <ConversationList
            conversations={conversations}
            activeId={activeId}
            onSelect={onSelectConversation}
            onRename={onRenameConversation}
            onDelete={onDeleteConversation}
          />
        </div>
      </div>

      {/* 底部 */}
      <div className="border-t border-line px-3 py-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-ink-soft transition-colors hover:bg-white/70 hover:text-ink"
        >
          API 设置
        </button>
        <button
          type="button"
          onClick={onOpenAbout}
          className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-ink-soft transition-colors hover:bg-white/70 hover:text-ink"
        >
          关于
        </button>
      </div>
    </div>
  )
}
