import { useEffect, type ReactNode } from 'react'

import { CloseIcon } from '@/components/common/icons'
import { cn } from '@/utils/cn'

export interface ModalProps {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** 面板宽度类名，默认 480px 级别 */
  panelClassName?: string
}

/** 通用弹窗：ESC 关闭、点击遮罩关闭、内容区可滚动 */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  panelClassName,
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-ink/25 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-xl sm:max-h-[86vh] sm:rounded-2xl',
          panelClassName ?? 'sm:max-w-[480px]',
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-ink-soft">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="-mt-1 -mr-1 flex size-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
          >
            <CloseIcon className="size-4.5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-line-soft bg-canvas/60 px-5 py-3.5">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
