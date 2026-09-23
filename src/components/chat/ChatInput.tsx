import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { PaperclipIcon, SendIcon, StopIcon } from '@/components/common/icons'
import { inputPlaceholder } from '@/config/quickPrompts'
import { cn } from '@/utils/cn'
import type { AgentMode } from '@/types/conversation'

export interface ChatInputProps {
  mode: AgentMode
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  isGenerating: boolean
}

const MAX_TEXTAREA_HEIGHT = 200

export function ChatInput({
  mode,
  value,
  onChange,
  onSend,
  onStop,
  isGenerating,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [composing, setComposing] = useState(false)

  // 随内容自动增高，超过上限后内部滚动
  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [value])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法候选未确认时，Enter 不应触发发送
    if (event.key === 'Enter' && !event.shiftKey) {
      if (composing || event.nativeEvent.isComposing) return
      event.preventDefault()
      onSend()
    }
  }

  const canSend = value.trim().length > 0 && !isGenerating

  return (
    <div
      data-testid="composer"
      className="composer-safe shrink-0 border-t border-line bg-surface px-3 pt-3 sm:px-6"
    >
      <div className="mx-auto w-full max-w-[860px]">
        <div className="rounded-2xl border border-line bg-surface shadow-sm transition-colors focus-within:border-brand/50">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            rows={1}
            placeholder={inputPlaceholder[mode]}
            className="block max-h-[200px] w-full resize-none bg-transparent px-4 pt-3 pb-2 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-muted"
          />

          <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
            <div className="group relative">
              <button
                type="button"
                disabled
                aria-label="上传文件（即将支持）"
                title="文件上传即将支持"
                className="flex min-h-9 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-ink-muted disabled:cursor-not-allowed"
              >
                <PaperclipIcon className="size-4" />
                <span className="hidden sm:inline">上传文件</span>
              </button>
              <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 hidden whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:block group-hover:opacity-100">
                文件上传即将支持
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden text-[11px] text-ink-muted sm:inline">
                Enter 发送，Shift + Enter 换行
              </span>
              {isGenerating ? (
                <button
                  type="button"
                  onClick={onStop}
                  className="flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
                >
                  <StopIcon className="size-3.5" />
                  停止生成
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSend}
                  disabled={!canSend}
                  aria-label="发送"
                  className={cn(
                    'flex size-9 items-center justify-center rounded-lg transition-colors',
                    canSend
                      ? 'bg-brand text-white hover:bg-brand-hover'
                      : 'bg-canvas text-ink-muted',
                  )}
                >
                  <SendIcon className="size-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-2 text-center text-[11px] text-ink-muted">
          AI 生成内容仅供参考，请结合实际情况核实。
        </p>
      </div>
    </div>
  )
}
