import {
  clearConversations as clearIndexedDbConversations,
  deleteConversation as deleteIndexedDbConversation,
  isIndexedDbAvailable,
  listConversations as listIndexedDbConversations,
  putConversation as putIndexedDbConversation,
} from '@/db/indexedDb'
import {
  clearConversations as clearServerConversations,
  deleteConversation as deleteServerConversation,
  fetchConversations,
  saveConversation,
} from '@/services/localApi'
import { ensureLocalBootstrap } from '@/services/migration'
import type { Conversation } from '@/types/conversation'

/**
 * 会话存储仓库。
 *
 * - 便携版：数据存在本地 Node 服务的 SQLite（data/app.db）→ 与浏览器端口无关；
 * - 网页部署版：保持原来的 IndexedDB 行为不变。
 *
 * 这样「正式聊天数据」在任何一种部署下都只有一份真实来源，不会出现两套并行的历史系统。
 */
export interface ConversationRepository {
  kind: 'indexeddb' | 'server'
  /** 存储是否可用（不可用时只能在内存里维持本次会话） */
  available: boolean
  listConversations(): Promise<Conversation[]>
  putConversation(conversation: Conversation): Promise<void>
  deleteConversation(id: string): Promise<void>
  clearConversations(): Promise<void>
}

const indexedDbRepository: ConversationRepository = {
  kind: 'indexeddb',
  available: isIndexedDbAvailable(),
  listConversations: () => listIndexedDbConversations(),
  putConversation: (conversation) => putIndexedDbConversation(conversation),
  deleteConversation: (id) => deleteIndexedDbConversation(id),
  clearConversations: () => clearIndexedDbConversations(),
}

/** 写库失败只记录，不影响界面（与原有 IndexedDB 行为一致）；服务端也会留下日志 */
function reportWriteError(action: string, error: unknown): void {
  console.error(`[本地数据] ${action}失败：`, error instanceof Error ? error.message : error)
}

const serverRepository: ConversationRepository = {
  kind: 'server',
  available: true,
  listConversations: async () => {
    try {
      return (await fetchConversations<Conversation>()) as Conversation[]
    } catch (error) {
      reportWriteError('读取会话', error)
      return []
    }
  },
  putConversation: async (conversation) => {
    try {
      await saveConversation(conversation)
    } catch (error) {
      reportWriteError('保存会话', error)
    }
  },
  deleteConversation: async (id) => {
    try {
      await deleteServerConversation(id)
    } catch (error) {
      reportWriteError('删除会话', error)
    }
  },
  clearConversations: async () => {
    try {
      await clearServerConversations()
    } catch (error) {
      reportWriteError('清空会话', error)
    }
  },
}

let resolved: ConversationRepository = indexedDbRepository
let resolving: Promise<ConversationRepository> | null = null

/** 同步获取当前仓库（初始化完成前返回 IndexedDB 版本，不会写坏数据） */
export function currentRepository(): ConversationRepository {
  return resolved
}

/** 解析出真正要使用的仓库：等待本地模式探测与一次性迁移完成 */
export function conversationRepository(): Promise<ConversationRepository> {
  if (!resolving) {
    resolving = (async () => {
      const info = await ensureLocalBootstrap()
      resolved = info ? serverRepository : indexedDbRepository
      return resolved
    })()
  }
  return resolving
}
