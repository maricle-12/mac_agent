import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  clearConversations as clearStoredConversations,
  deleteConversation as deleteStoredConversation,
  isIndexedDbAvailable,
  listConversations,
  putConversation,
  requestPersistentStorage,
} from '@/db/indexedDb'
import { loadPreferences, savePreferences } from '@/services/storage'
import type { ChatMessage } from '@/types/chat'
import type { AgentMode, Conversation } from '@/types/conversation'
import { createId } from '@/utils/id'

/**
 * 写库节流间隔：流式输出时增量会频繁触发状态更新，
 * 若每次都写 IndexedDB 会造成大量无谓的磁盘写入，因此同一会话在该间隔内只写一次。
 */
const PERSIST_INTERVAL_MS = 400

export interface ConversationStore {
  conversations: Conversation[]
  activeId: string | null
  active: Conversation | null
  /** 是否已完成本地记录读取（用于避免首屏闪一下空状态） */
  ready: boolean
  /** 本机浏览器是否支持 IndexedDB（不支持时只能存在内存中） */
  storageAvailable: boolean
  create: (mode: AgentMode, title?: string) => string
  select: (id: string) => void
  rename: (id: string, title: string) => void
  updateMode: (id: string, mode: AgentMode) => void
  remove: (id: string) => void
  clearAll: () => void
  appendMessage: (conversationId: string, message: ChatMessage) => void
  updateMessage: (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => void
  removeMessage: (conversationId: string, messageId: string) => void
  removeMessagesAfter: (conversationId: string, messageId: string) => void
}

/** 按 updatedAt 倒序排列，最近更新的会话在最上面 */
function sortByUpdatedAt(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 会话状态与增删改，数据持久化在浏览器 IndexedDB。
 *
 * 存储策略：
 * - 所有改动先更新 React 状态（界面即时响应），再按会话节流写入 IndexedDB；
 * - 删除与新建立即落库，避免「刚建好就刷新」导致丢失；
 * - 页面隐藏时把待写入的内容立刻落库（尽力而为）。
 *
 * 历史里只保存 user / assistant；System Prompt 在调用模型时动态拼接（见 src/prompts）。
 */
export function useConversations(initialMode: AgentMode = 'teacher'): ConversationStore {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const storageAvailable = useMemo(() => isIndexedDbAvailable(), [])

  /** 已经安排写入的最新快照 */
  const pendingRef = useRef(new Map<string, Conversation>())
  /** 定时器句柄 */
  const timersRef = useRef(new Map<string, number>())
  /** 初始模式只用于首屏选中会话，用 ref 固定，避免模式切换时重新加载 */
  const initialModeRef = useRef(initialMode)

  // ---------------------------------------------------------------- 首次加载

  useEffect(() => {
    let cancelled = false

    void (async () => {
      // 申请持久化存储，降低聊天记录被浏览器回收的概率（失败也无妨）
      void requestPersistentStorage()

      const loaded = sortByUpdatedAt(await listConversations())
      if (cancelled) return

      for (const conversation of loaded) pendingRef.current.set(conversation.id, conversation)
      setConversations(loaded)

      const preferred = loadPreferences().activeConversationId
      const preferredExists = preferred ? loaded.some((item) => item.id === preferred) : false
      const nextActiveId =
        (preferredExists ? preferred : null) ??
        loaded.find((item) => item.mode === initialModeRef.current)?.id ??
        loaded[0]?.id ??
        null

      setActiveId(nextActiveId)
      setReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  // ---------------------------------------------------------------- 写库调度

  const flush = useCallback((id: string) => {
    const snapshot = pendingRef.current.get(id)
    if (!snapshot) return
    void putConversation(snapshot)
  }, [])

  const cancelPending = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timersRef.current.delete(id)
    }
    pendingRef.current.delete(id)
  }, [])

  /** 把待写入的内容立刻落库（页面隐藏 / 卸载时调用） */
  const flushAll = useCallback(() => {
    for (const id of timersRef.current.keys()) {
      const timer = timersRef.current.get(id)
      if (timer !== undefined) window.clearTimeout(timer)
      flush(id)
    }
    timersRef.current.clear()
  }, [flush])

  // 状态变化后按会话安排写入：只处理引用发生变化的会话
  useEffect(() => {
    if (!ready) return

    for (const conversation of conversations) {
      if (pendingRef.current.get(conversation.id) === conversation) continue
      pendingRef.current.set(conversation.id, conversation)

      if (timersRef.current.has(conversation.id)) continue
      const timer = window.setTimeout(() => {
        timersRef.current.delete(conversation.id)
        flush(conversation.id)
      }, PERSIST_INTERVAL_MS)
      timersRef.current.set(conversation.id, timer)
    }
  }, [conversations, ready, flush])

  // 离开页面时尽力把最后的增量写入
  useEffect(() => {
    const onHide = () => flushAll()
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [flushAll])

  /** 当前选中会话持久化到 localStorage，便于刷新后回到同一个会话 */
  useEffect(() => {
    if (!ready) return
    savePreferences({ activeConversationId: activeId })
  }, [activeId, ready])

  const active = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  )

  // ---------------------------------------------------------------- 增删改

  const create = useCallback(
    (mode: AgentMode, title = '新对话') => {
      // 已经存在一个同模式的空白会话时直接复用：
      // 反复点「新建对话」不应该在历史里堆出一串空对话。
      const existingBlank = conversations.find(
        (item) => item.mode === mode && item.messages.length === 0 && item.title === '新对话',
      )
      if (existingBlank) {
        setActiveId(existingBlank.id)
        return existingBlank.id
      }

      const now = Date.now()
      const conversation: Conversation = {
        id: createId('c_'),
        title,
        mode,
        createdAt: now,
        updatedAt: now,
        messages: [],
      }
      pendingRef.current.set(conversation.id, conversation)
      // 新建立即落库：避免刚建好就刷新导致丢失
      void putConversation(conversation)
      setConversations((prev) => sortByUpdatedAt([conversation, ...prev]))
      setActiveId(conversation.id)
      return conversation.id
    },
    [conversations],
  )

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
      prev.map((conversation) => (conversation.id === id ? { ...conversation, mode } : conversation)),
    )
  }, [])

  const remove = useCallback(
    (id: string) => {
      cancelPending(id)
      void deleteStoredConversation(id)

      // 删除当前会话时自动选中相邻会话（优先下一条，其次上一条），
      // 避免用户删完当前会话后被丢进空白页。
      const index = conversations.findIndex((conversation) => conversation.id === id)
      const fallback =
        (index >= 0 ? conversations[index + 1] : undefined) ??
        (index >= 0 ? conversations[index - 1] : undefined) ??
        null

      setConversations((prev) => prev.filter((conversation) => conversation.id !== id))
      setActiveId((prev) => (prev === id ? (fallback?.id ?? null) : prev))
    },
    [cancelPending, conversations],
  )

  const clearAll = useCallback(() => {
    for (const id of [...pendingRef.current.keys()]) cancelPending(id)
    void clearStoredConversations()
    setConversations([])
    setActiveId(null)
  }, [cancelPending])

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

  const removeMessage = useCallback((conversationId: string, messageId: string) => {
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: conversation.messages.filter((message) => message.id !== messageId),
            }
          : conversation,
      ),
    )
  }, [])

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
      ready,
      storageAvailable,
      create,
      select,
      rename,
      updateMode,
      remove,
      clearAll,
      appendMessage,
      updateMessage,
      removeMessage,
      removeMessagesAfter,
    }),
    [
      conversations,
      activeId,
      active,
      ready,
      storageAvailable,
      create,
      select,
      rename,
      updateMode,
      remove,
      clearAll,
      appendMessage,
      updateMessage,
      removeMessage,
      removeMessagesAfter,
    ],
  )
}
