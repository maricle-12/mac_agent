import { useEffect, useRef, useState } from 'react'

import { CheckIcon, CopyIcon } from '@/components/common/icons'
import { copyText } from '@/utils/clipboard'

export interface CodeBlockProps {
  language?: string
  code: string
}

/** 代码块：语言标签 + 复制按钮 */
export function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const handleCopy = async () => {
    const ok = await copyText(code)
    if (!ok) return
    setCopied(true)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-line bg-[#fbfbfd]">
      <div className="flex items-center justify-between border-b border-line-soft px-3 py-1">
        <span className="font-mono text-[11px] tracking-wide text-ink-muted">
          {language ?? 'text'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex min-h-8 items-center gap-1 rounded px-2 py-1 text-[11px] text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
        >
          {copied ? <CheckIcon className="size-3.5 text-success" /> : <CopyIcon className="size-3.5" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5">
        <code className="font-mono text-[13px] leading-6 text-ink">{code}</code>
      </pre>
    </div>
  )
}
