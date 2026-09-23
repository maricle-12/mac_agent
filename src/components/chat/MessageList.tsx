import { useCallback, useEffect, useRef, useState } from 'react'

import { ArrowDownIcon } from '@/components/common/icons'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { cn } from '@/utils/cn'
import type { ChatMessage, ChatStatus } from '@/types/chat'

export interface MessageListProps {
  messages: ChatMessage[]
  status: ChatStatus
  logo: string
  onRegenerate: () => void
}

/** 距离底部小于该值即视为「用户停留在底部」，此时才自动跟随滚动 */
const STICK_THRESHOLD = 80

export function MessageList({ messages, status, logo, onRegenerate }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [stickToBottom, setStickToBottom] = useState(true)

  const handleScroll = useCallback(() => {
    const element = containerRef.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    setStickToBottom(distance < STICK_THRESHOLD)
  }, [])

  // 仅在用户停留在底部时自动跟随；用户主动上滑则不强制拉回
  useEffect(() => {
    if (!stickToBottom) return
    const element = containerRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [messages, status, stickToBottom])

  const scrollToBottom = () => {
    const element = containerRef.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
    setStickToBottom(true)
  }

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id
  const waitingFirstToken = status === 'sending'

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        data-testid="message-scroll"
        onScroll={handleScroll}
        className="h-full overflow-y-auto overscroll-contain"
      >
        <div
          data-testid="message-content"
          className="mx-auto w-full max-w-[860px] space-y-6 px-4 py-6 sm:px-6"
        >
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              logo={logo}
              streaming={status === 'streaming' && message.id === lastAssistantId}
              canRegenerate={
                message.role === 'assistant' &&
                message.id === lastAssistantId &&
                status === 'idle'
              }
              onRegenerate={onRegenerate}
            />
          ))}

          {waitingFirstToken ? (
            <div className="flex items-center gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand text-[11px] font-semibold text-white">
                {logo}
              </span>
              <span className="flex items-center gap-2 text-sm text-ink-muted">
                AI 正在思考
                <span className="flex gap-1">
                  <span className="size-1 animate-bounce rounded-full bg-ink-muted [animation-delay:-0.3s]" />
                  <span className="size-1 animate-bounce rounded-full bg-ink-muted [animation-delay:-0.15s]" />
                  <span className="size-1 animate-bounce rounded-full bg-ink-muted" />
                </span>
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={scrollToBottom}
        className={cn(
          'absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] text-ink-soft shadow-sm transition-opacity hover:text-ink',
          stickToBottom ? 'pointer-events-none opacity-0' : 'opacity-100',
        )}
      >
        <ArrowDownIcon className="size-3.5" />
        回到底部
      </button>
    </div>
  )
}
