import { useCallback, useMemo, useRef, useState } from 'react'

import type { ConversationStore } from '@/hooks/useConversations'
import { createMockReply } from '@/mocks/mockData'
import type { ChatStatus } from '@/types/chat'
import type { AgentMode } from '@/types/conversation'
import { createId } from '@/utils/id'
import { createConversationTitle } from '@/utils/title'

export interface UseChatOptions {
  store: ConversationStore
  mode: AgentMode
}

export interface UseChatResult {
  input: string
  setInput: (value: string) => void
  status: ChatStatus
  isGenerating: boolean
  send: (text?: string) => Promise<void>
  stop: () => void
  regenerate: () => Promise<void>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 聊天行为：发送、停止、重新生成。
 *
 * 阶段 2：使用模拟回答（延迟 650ms 后一次性出现），用于验证 UI。
 * 阶段 7：`runGeneration` 内部替换为真实 SSE 流式请求，对外接口不变。
 */
export function useChat({ store, mode }: UseChatOptions): UseChatResult {
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<ChatStatus>('idle')
  const abortTokenRef = useRef<{ aborted: boolean } | null>(null)

  /** 生成一条 assistant 回答（不负责添加 user 消息，避免重复） */
  const runGeneration = useCallback(
    async (conversationId: string, userContent: string) => {
      const token = { aborted: false }
      abortTokenRef.current = token
      setStatus('sending')

      await sleep(650)

      if (token.aborted) {
        setStatus('aborted')
        return
      }

      store.appendMessage(conversationId, {
        id: createId('m_'),
        role: 'assistant',
        content: createMockReply(mode, userContent),
        createdAt: Date.now(),
      })

      abortTokenRef.current = null
      setStatus('idle')
    },
    [mode, store],
  )

  const send = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim()
      if (!content || abortTokenRef.current) return

      const conversationId = store.activeId ?? store.create(mode)
      const conversation = store.conversations.find((item) => item.id === conversationId)

      store.appendMessage(conversationId, {
        id: createId('m_'),
        role: 'user',
        content,
        createdAt: Date.now(),
      })

      // 首条消息自动生成标题
      if (conversation && conversation.messages.length === 0 && conversation.title === '新对话') {
        store.rename(conversationId, createConversationTitle(content))
      }

      setInput('')
      await runGeneration(conversationId, content)
    },
    [input, mode, runGeneration, store],
  )

  const stop = useCallback(() => {
    const token = abortTokenRef.current
    if (!token) return
    token.aborted = true
    abortTokenRef.current = null
    setStatus('aborted')
  }, [])

  const regenerate = useCallback(async () => {
    const conversation = store.active
    if (!conversation || abortTokenRef.current) return

    const lastUserIndex = conversation.messages.findLastIndex(
      (message) => message.role === 'user',
    )
    if (lastUserIndex < 0) return

    const lastUserMessage = conversation.messages[lastUserIndex]
    // 删除该用户问题之后的所有回答，重新生成时不再重复添加用户消息
    const lastMessage = conversation.messages[conversation.messages.length - 1]
    if (lastMessage && lastMessage.id !== lastUserMessage.id) {
      store.removeMessagesAfter(conversation.id, lastUserMessage.id)
    }

    await runGeneration(conversation.id, lastUserMessage.content)
  }, [runGeneration, store])

  const isGenerating = status === 'sending' || status === 'streaming'

  return useMemo(
    () => ({ input, setInput, status, isGenerating, send, stop, regenerate }),
    [input, status, isGenerating, send, stop, regenerate],
  )
}
