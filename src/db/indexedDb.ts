import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import type { Conversation } from '@/types/conversation'

/**
 * IndexedDB 封装（会话与消息）。
 *
 * 设计要点：
 * - 一个会话（含其 messages 数组）作为一条记录整体存取，读写都在一个事务里，简单可靠；
 * - 数据库名与会话存储统一使用 ai-edu-agent 前缀；
 * - 隐私模式下 IndexedDB 可能不可用，所有操作都做降级处理，绝不抛异常影响页面。
 */

const DB_NAME = 'ai-edu-agent'
const DB_VERSION = 1
const STORE_NAME = 'conversations'

interface AgentDatabase extends DBSchema {
  conversations: {
    key: string
    value: Conversation
    indexes: { updatedAt: number }
  }
}

let dbPromise: Promise<IDBPDatabase<AgentDatabase>> | null = null

/** 当前环境是否支持 IndexedDB */
export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

function getDb(): Promise<IDBPDatabase<AgentDatabase>> {
  if (!dbPromise) {
    dbPromise = openDB<AgentDatabase>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('updatedAt', 'updatedAt')
        }
      },
    })
  }
  return dbPromise
}

/** 读取全部会话，按 updatedAt 倒序 */
export async function listConversations(): Promise<Conversation[]> {
  if (!isIndexedDbAvailable()) return []
  try {
    const db = await getDb()
    const all = await db.getAllFromIndex(STORE_NAME, 'updatedAt')
    return all.reverse()
  } catch {
    return []
  }
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  if (!isIndexedDbAvailable()) return undefined
  try {
    const db = await getDb()
    return await db.get(STORE_NAME, id)
  } catch {
    return undefined
  }
}

export async function putConversation(conversation: Conversation): Promise<void> {
  if (!isIndexedDbAvailable()) return
  try {
    const db = await getDb()
    await db.put(STORE_NAME, conversation)
  } catch {
    // 写入失败（配额超限 / 隐私模式）时静默降级，页面仍可继续使用
  }
}

export async function deleteConversation(id: string): Promise<void> {
  if (!isIndexedDbAvailable()) return
  try {
    const db = await getDb()
    await db.delete(STORE_NAME, id)
  } catch {
    // 忽略
  }
}

/** 清空全部本地聊天记录（隐私功能「清除本地聊天记录」使用） */
export async function clearConversations(): Promise<void> {
  if (!isIndexedDbAvailable()) return
  try {
    const db = await getDb()
    await db.clear(STORE_NAME)
  } catch {
    // 忽略
  }
}

/** 估算已占用的存储空间，用于设置页展示（不支持时返回 null） */
export async function estimateStorageUsage(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const estimate = await navigator.storage.estimate()
    if (typeof estimate.usage !== 'number' || typeof estimate.quota !== 'number') return null
    return { usage: estimate.usage, quota: estimate.quota }
  } catch {
    return null
  }
}

/**
 * 请求「持久化存储」权限。
 *
 * 聊天记录是这个应用唯一的本地数据，浏览器在磁盘紧张时可能清除普通来源数据；
 * 申请持久化可以降低被清除的概率。属于尽力而为：被拒绝也不影响使用。
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
