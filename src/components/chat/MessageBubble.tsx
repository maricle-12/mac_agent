import { useEffect, useRef, useState } from 'react'

import { CheckIcon, CopyIcon, RefreshIcon } from '@/components/common/icons'
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer'
import { cn } from '@/utils/cn'
import { copyText } from '@/utils/clipboard'
import type { ChatMessage } from '@/types/chat'

export interface MessageBubbleProps {
  message: ChatMessage
  logo: string
  /** 是否显示「重新生成」 */
  canRegenerate?: boolean
  onRegenerate?: () => void
  /** 该消息是否正在流式输出中 */
  streaming?: boolean
}

export function MessageBubble({
  message,
  logo,
  canRegenerate = false,
  onRegenerate,
  streaming = false,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const handleCopy = async () => {
    const ok = await copyText(message.content)
    if (!ok) return
    setCopied(true)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setCopied(false), 1600)
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3.5 py-2.5 text-[15px] leading-7 whitespace-pre-wrap text-white">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand text-[11px] font-semibold text-white">
        {logo}
      </span>
      <div className="min-w-0 flex-1">
        {message.error ? (
          <div className="rounded-lg border border-danger/25 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">
            {message.error}
          </div>
        ) : (
          <div className={cn(streaming && 'md-streaming')}>
            <MarkdownRenderer content={message.content} />
          </div>
        )}

        {!streaming ? (
          <div className="mt-2 flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
            >
              {copied ? <CheckIcon className="size-3.5 text-success" /> : <CopyIcon className="size-3.5" />}
              {copied ? '已复制' : '复制'}
            </button>
            {canRegenerate && onRegenerate ? (
              <button
                type="button"
                onClick={onRegenerate}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
              >
                <RefreshIcon className="size-3.5" />
                重新生成
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
