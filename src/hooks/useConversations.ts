import { useCallback, useMemo, useState } from 'react'

import { seedConversations } from '@/mocks/mockData'
import type { ChatMessage } from '@/types/chat'
import type { AgentMode, Conversation } from '@/types/conversation'
import { createId } from '@/utils/id'

export interface ConversationStore {
  conversations: Conversation[]
  activeId: string | null
  active: Conversation | null
  create: (mode: AgentMode, title?: string) => string
  select: (id: string) => void
  rename: (id: string, title: string) => void
  updateMode: (id: string, mode: AgentMode) => void
  remove: (id: string) => void
  clearAll: () => void
  appendMessage: (conversationId: string, message: ChatMessage) => void
  updateMessage: (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => void
  removeMessagesAfter: (conversationId: string, messageId: string) => void
}

/** 按 updatedAt 倒序排列，最近更新的会话在最上面 */
function sortByUpdatedAt(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 会话状态与增删改。
 *
 * 阶段 2：数据保存在内存中（含模拟种子数据）。
 * 阶段 9 / 10：替换为 IndexedDB 持久化 + 完整的新建 / 删除 / 重命名交互，
 * 本 Hook 对外暴露的接口保持不变，因此 UI 层无需改动。
 */
export function useConversations(initialMode: AgentMode = 'teacher'): ConversationStore {
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    sortByUpdatedAt(seedConversations),
  )
  // 默认打开最近更新、且与上次使用模式一致的会话，避免刷新后模式与内容不一致
  const [activeId, setActiveId] = useState<string | null>(() => {
    const sorted = sortByUpdatedAt(seedConversations)
    return (sorted.find((item) => item.mode === initialMode) ?? sorted[0])?.id ?? null
  })

  const active = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  )

  const create = useCallback((mode: AgentMode, title = '新对话') => {
    const now = Date.now()
    const conversation: Conversation = {
      id: createId('c_'),
      title,
      mode,
      createdAt: now,
      updatedAt: now,
      messages: [],
    }
    setConversations((prev) => sortByUpdatedAt([conversation, ...prev]))
    setActiveId(conversation.id)
    return conversation.id
  }, [])

  const select = useCallback((id: string) => {
    setActiveId(id)
  }, [])

  const rename = useCallback((id: string, title: string) => {
    const nextTitle = title.trim()
    if (!nextTitle) return
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === id ? { ...conversation, title: nextTitle } : conversation,
      ),
    )
  }, [])

  const updateMode = useCallback((id: string, mode: AgentMode) => {
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === id ? { ...conversation, mode } : conversation,
      ),
    )
  }, [])

  const remove = useCallback((id: string) => {
    setConversations((prev) => prev.filter((conversation) => conversation.id !== id))
    setActiveId((prev) => (prev === id ? null : prev))
  }, [])

  const clearAll = useCallback(() => {
    setConversations([])
    setActiveId(null)
  }, [])

  const appendMessage = useCallback((conversationId: string, message: ChatMessage) => {
    setConversations((prev) =>
      sortByUpdatedAt(
        prev.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                messages: [...conversation.messages, message],
                updatedAt: Date.now(),
              }
            : conversation,
        ),
      ),
    )
  }, [])

  const updateMessage = useCallback(
    (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => {
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                messages: conversation.messages.map((message) =>
                  message.id === messageId ? { ...message, ...patch } : message,
                ),
              }
            : conversation,
        ),
      )
    },
    [],
  )

  const removeMessagesAfter = useCallback((conversationId: string, messageId: string) => {
    setConversations((prev) =>
      prev.map((conversation) => {
        if (conversation.id !== conversationId) return conversation
        const index = conversation.messages.findIndex((message) => message.id === messageId)
        if (index < 0) return conversation
        return { ...conversation, messages: conversation.messages.slice(0, index + 1) }
      }),
    )
  }, [])

  return useMemo(
    () => ({
      conversations,
      activeId,
      active,
      create,
      select,
      rename,
      updateMode,
      remove,
      clearAll,
      appendMessage,
      updateMessage,
      removeMessagesAfter,
    }),
    [
      conversations,
      activeId,
      active,
      create,
      select,
      rename,
      updateMode,
      remove,
      clearAll,
      appendMessage,
      updateMessage,
      removeMessagesAfter,
    ],
  )
}
