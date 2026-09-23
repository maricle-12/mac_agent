import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

import { MoreHorizontalIcon, PencilIcon, TrashIcon } from '@/components/common/icons'
import { cn } from '@/utils/cn'
import { formatRelativeTime } from '@/utils/time'
import type { Conversation } from '@/types/conversation'

export interface ConversationItemProps {
  conversation: Conversation
  active: boolean
  onSelect: () => void
  onRename: () => void
  onDelete: () => void
}

const modeBadge: Record<Conversation['mode'], string> = {
  teacher: '师',
  student: '生',
}

export function ConversationItem({
  conversation,
  active,
  onSelect,
  onRename,
  onDelete,
}: ConversationItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // 菜单使用 fixed 定位，避免被侧边栏滚动容器裁剪
  const openMenu = (event: ReactMouseEvent) => {
    event.stopPropagation()
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    setMenuPosition({ top: rect.bottom + 4, left: Math.max(8, rect.right - 140) })
    setMenuOpen(true)
  }

  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menuOpen])

  return (
    <div
      className={cn(
        'conversation-item group relative flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm transition-colors',
        active ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft hover:bg-white/70 hover:text-ink',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-medium',
            conversation.mode === 'teacher'
              ? 'bg-brand-soft text-brand'
              : 'bg-success/10 text-success',
          )}
          title={conversation.mode === 'teacher' ? '教师模式' : '学生模式'}
        >
          {modeBadge[conversation.mode]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate leading-5">{conversation.title}</span>
          <span className="block truncate text-[11px] text-ink-muted">
            {formatRelativeTime(conversation.updatedAt)}
          </span>
        </span>
      </button>

      <button
        ref={buttonRef}
        type="button"
        onClick={openMenu}
        aria-label="更多操作"
        className={cn(
          'conversation-more flex size-9 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-canvas hover:text-ink',
          menuOpen && 'bg-canvas text-ink',
        )}
      >
        <MoreHorizontalIcon className="size-4" />
      </button>

      {menuOpen && menuPosition ? (
        <div
          onMouseDown={(event) => event.stopPropagation()}
          style={{ top: menuPosition.top, left: menuPosition.left }}
          className="fixed z-50 w-[140px] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg"
        >
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false)
              onRename()
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink-soft hover:bg-canvas hover:text-ink"
          >
            <PencilIcon className="size-3.5" />
            重命名
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false)
              onDelete()
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-danger hover:bg-danger/5"
          >
            <TrashIcon className="size-3.5" />
            删除
          </button>
        </div>
      ) : null}
    </div>
  )
}
