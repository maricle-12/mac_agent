import { useCallback, useMemo, useRef, useState } from 'react'

import { apiConfig } from '@/config/api'
import type { ConversationStore } from '@/hooks/useConversations'
import { getSystemPrompt } from '@/prompts'
import {
  ApiRequestError,
  buildRequestMessages,
  isAbortError,
  requestChatCompletion,
} from '@/services/chatApi'
import { consumeSseStream } from '@/services/sseStream'
import type { ApiMessage, ChatMessage, ChatStatus } from '@/types/chat'
import type { AgentMode } from '@/types/conversation'
import type { ApiSettings } from '@/types/settings'
import { createId } from '@/utils/id'
import { createConversationTitle } from '@/utils/title'

export interface UseChatOptions {
  store: ConversationStore
  mode: AgentMode
  apiKey: string
  settings: ApiSettings
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

/**
 * 聊天行为：发送、流式接收、停止、重新生成。
 *
 * 流式要点：
 * - 先插入一条空的 assistant 消息占位，收到增量后逐块写入，实现「边生成边显示」；
 * - 增量先写进 ref，用 requestAnimationFrame 合并刷新，避免每个 token 都重渲染 Markdown；
 * - AbortController 支持「停止生成」，同时通过 request.signal 传导到 Worker 与上游，停止计费；
 * - 空闲超时（streamIdleTimeoutMs）避免流挂死后一直显示「正在思考」。
 */
export function useChat({ store, mode, apiKey, settings }: UseChatOptions): UseChatResult {
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<ChatStatus>('idle')
  const abortRef = useRef<AbortController | null>(null)

  const isGenerating = status === 'sending' || status === 'streaming'

  /** 用请求消息列表生成一次回答（不负责添加用户消息，避免重复） */
  const runGeneration = useCallback(
    async (conversationId: string, requestMessages: ApiMessage[]) => {
      const appendMessage = store.appendMessage
      const updateMessage = store.updateMessage
      const removeMessage = store.removeMessage

      const assistantId = createId('m_')
      const placeholder: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      }
      appendMessage(conversationId, placeholder)

      // 未配置 Key 时不必发起请求，直接给出可操作提示
      if (!apiKey.trim()) {
        updateMessage(conversationId, assistantId, {
          error: '尚未配置 API Key。请点击右上角「设置」填写你自己的 DeepSeek API Key。',
        })
        setStatus('error')
        return
      }

      const controller = new AbortController()
      abortRef.current = controller
      setStatus('sending')

      /** 累积的完整回答 */
      let full = ''
      let frame: number | null = null
      let idleTimedOut = false
      let idleTimer: number | null = null

      const flush = () => {
        frame = null
        updateMessage(conversationId, assistantId, { content: full })
      }
      const scheduleFlush = () => {
        if (frame !== null) return
        frame = window.requestAnimationFrame(flush)
      }
      const stopFlush = () => {
        if (frame !== null) {
          window.cancelAnimationFrame(frame)
          frame = null
        }
      }
      const clearIdleTimer = () => {
        if (idleTimer !== null) {
          window.clearTimeout(idleTimer)
          idleTimer = null
        }
      }
      const resetIdleTimer = () => {
        clearIdleTimer()
        idleTimer = window.setTimeout(() => {
          idleTimedOut = true
          controller.abort()
        }, apiConfig.streamIdleTimeoutMs)
      }

      try {
        const response = await requestChatCompletion(
          {
            apiKey,
            baseUrl: settings.baseUrl,
            model: settings.model,
            messages: requestMessages,
            temperature: apiConfig.defaultTemperature,
            stream: true,
          },
          controller.signal,
        )

        const body = response.body
        if (!body) {
          throw new Error('响应没有可读的流内容')
        }

        resetIdleTimer()

        await consumeSseStream(body, {
          onContent: (text) => {
            // 首个增量到达：从「正在思考」切换为「流式输出中」
            if (status !== 'streaming') setStatus('streaming')
            full += text
            scheduleFlush()
            resetIdleTimer()
          },
          onDone: () => {
            clearIdleTimer()
          },
        })

        clearIdleTimer()
        stopFlush()
        updateMessage(conversationId, assistantId, { content: full })
        setStatus('idle')
      } catch (error) {
        clearIdleTimer()
        stopFlush()

        if (isAbortError(error)) {
          if (full.length > 0) {
            // 保留已经生成的内容
            updateMessage(conversationId, assistantId, { content: full })
          } else {
            // 一个字都没生成，删掉占位气泡
            removeMessage(conversationId, assistantId)
          }

          if (idleTimedOut) {
            updateMessage(conversationId, assistantId, {
              error: '模型服务长时间没有返回内容，已自动中断。请稍后重试。',
            })
            setStatus('error')
          } else {
            setStatus('aborted')
          }
          return
        }

        const message =
          error instanceof ApiRequestError
            ? error.message
            : full.length > 0
              ? '生成过程中连接中断，已保留已生成的内容。可点击「重新生成」重试。'
              : '网络连接中断，请检查网络后重试。'

        updateMessage(conversationId, assistantId, {
          content: full,
          error: message,
        })
        setStatus('error')
      } finally {
        if (abortRef.current === controller) abortRef.current = null
      }
    },
    [apiKey, settings.baseUrl, settings.model, status, store],
  )

  const send = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim()
      if (!content || abortRef.current) return

      const conversationId = store.activeId ?? store.create(mode)
      const conversation = store.conversations.find((item) => item.id === conversationId)
      const history = conversation?.messages ?? []

      const userMessage: ChatMessage = {
        id: createId('m_'),
        role: 'user',
        content,
        createdAt: Date.now(),
      }

      // 先把用户消息写入本地历史（历史上只存 user / assistant）
      store.appendMessage(conversationId, userMessage)

      // 首条消息自动生成标题
      if (conversation && history.length === 0 && conversation.title === '新对话') {
        store.rename(conversationId, createConversationTitle(content))
      }

      setInput('')

      // 当前用户消息已在 history 中，这里不要重复添加；
      // System Prompt 按当前模式动态插入，不写入本地历史（改 Prompt 后新请求立即生效）
      await runGeneration(
        conversationId,
        buildRequestMessages([...history, userMessage], {
          systemPrompt: getSystemPrompt(mode),
          maxContextMessages: apiConfig.maxContextMessages,
        }),
      )
    },
    [input, mode, runGeneration, store],
  )

  const stop = useCallback(() => {
    const controller = abortRef.current
    if (controller) {
      controller.abort()
      abortRef.current = null
    }
  }, [])

  const regenerate = useCallback(async () => {
    const conversation = store.active
    if (!conversation || abortRef.current) return

    const lastUserIndex = conversation.messages.findLastIndex((message) => message.role === 'user')
    if (lastUserIndex < 0) return

    const kept = conversation.messages.slice(0, lastUserIndex + 1)
    const lastMessage = conversation.messages[conversation.messages.length - 1]
    const lastKept = kept[kept.length - 1]

    // 删除该问题之后的回答，重新生成时不再重复添加用户消息
    if (lastMessage && lastKept && lastMessage.id !== lastKept.id) {
      store.removeMessagesAfter(conversation.id, lastKept.id)
    }

    await runGeneration(
      conversation.id,
      buildRequestMessages(kept, {
        systemPrompt: getSystemPrompt(mode),
        maxContextMessages: apiConfig.maxContextMessages,
      }),
    )
  }, [mode, runGeneration, store])

  return useMemo(
    () => ({ input, setInput, status, isGenerating, send, stop, regenerate }),
    [input, status, isGenerating, send, stop, regenerate],
  )
}
