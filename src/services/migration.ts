import { listConversations } from '@/db/indexedDb'
import type { Conversation } from '@/types/conversation'
import {
  completeMigration,
  detectLocal,
  fetchServerSettings,
  importConversations,
  saveServerSettings,
  type LocalInfo,
} from '@/services/localApi'
import { clearApiKey, loadApiKey, storageKeys } from '@/services/storage'

/**
 * v1.0.1 一次性迁移：浏览器 IndexedDB → 本地 SQLite。
 *
 * 规则（务必遵守）：
 * - 只在便携版（本地服务存在）里执行；
 * - 只在本地数据库为空、且浏览器里确实有旧数据时才导入；
 * - **绝不删除 IndexedDB 里的旧数据**，导入失败也不影响应用启动；
 * - 成功后把 API Key 也搬到本地配置，并从浏览器存储中清除（浏览器不再保存完整 Key）；
 * - 迁移完成标记写在数据库 meta 表里，之后不再重复执行。
 */

const MIGRATION_FLAG = 'indexeddb_migration_v1'

export interface MigrationReport {
  ran: boolean
  conversations: number
  imported: number
  skipped: boolean
  apiKeyMigrated: boolean
  error?: string
}

function log(message: string): void {
  // 迁移过程只在控制台留痕，方便排查；不涉及任何密钥内容
  console.info(`[本地数据迁移] ${message}`)
}

/** 读取旧版可能存在于 localStorage / sessionStorage 的完整 API Key（迁移用，只读取一次） */
function readLegacyApiKey(): string {
  try {
    return loadApiKey().trim()
  } catch {
    return ''
  }
}

/** 确认浏览器里的旧 Key 已被清除 */
function purgeLegacyApiKey(): void {
  try {
    clearApiKey()
    window.localStorage.removeItem(storageKeys.apiKeyLocal)
    window.sessionStorage.removeItem(storageKeys.apiKeySession)
    log('已从浏览器存储中清除 API Key（localStorage / sessionStorage）')
  } catch {
    /* 隐私模式下可能不可用，忽略 */
  }
}

export async function runOneTimeMigration(info: LocalInfo): Promise<MigrationReport> {
  const report: MigrationReport = {
    ran: false,
    conversations: 0,
    imported: 0,
    skipped: false,
    apiKeyMigrated: false,
  }

  if (info.database.migrationDone) {
    // 已经迁移过：只做一次「浏览器里不该再有完整 Key」的兜底清理
    if (readLegacyApiKey()) purgeLegacyApiKey()
    return report
  }

  report.ran = true
  log(`开始一次性迁移（本地会话数 ${info.database.conversationCount}，数据库 ${info.database.path}）`)

  // ---------------------------------------------------------------- 1. 聊天记录
  let legacy: Conversation[] = []
  try {
    legacy = await listConversations()
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
    log(`读取旧 IndexedDB 失败，跳过导入：${report.error}`)
  }
  report.conversations = legacy.length

  if (legacy.length > 0 && info.database.conversationCount === 0) {
    try {
      const result = await importConversations(legacy)
      report.imported = result.imported
      report.skipped = result.skipped
      log(`导入完成：收到 ${legacy.length} 个会话，写入 ${result.imported} 个`)
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error)
      log(`导入失败（旧数据保留在浏览器中，未删除）：${report.error}`)
    }
  } else if (legacy.length > 0) {
    report.skipped = true
    log('本地数据库已有数据，跳过导入（避免重复）')
  } else {
    log('浏览器中没有旧聊天记录，无需导入')
  }

  // ---------------------------------------------------------------- 2. API Key
  const legacyKey = readLegacyApiKey()
  if (legacyKey) {
    try {
      const serverSettings = await fetchServerSettings()
      if (!serverSettings.configured) {
        // 迁移不重复验证：旧 Key 用户已经用过，直接落库
        await saveServerSettings({ apiKey: legacyKey, verify: false })
        report.apiKeyMigrated = true
        log('API Key 已迁移到本地配置（config/settings.json）')
      } else {
        log('本地已配置 API Key，跳过迁移')
      }
      purgeLegacyApiKey()
    } catch (error) {
      // 迁移失败：绝不清除浏览器里的 Key，用户仍可用旧方式继续
      report.error = error instanceof Error ? error.message : String(error)
      log(`API Key 迁移失败（浏览器中的 Key 未删除）：${report.error}`)
    }
  }

  // ---------------------------------------------------------------- 3. 标记完成
  if (!report.error) {
    try {
      await completeMigration()
      log(`迁移已标记完成（${MIGRATION_FLAG} = true）`)
    } catch (error) {
      log(`写入迁移标记失败：${error instanceof Error ? error.message : String(error)}`)
    }
  } else {
    log('迁移过程中出现错误，本次不写入完成标记，下次启动会重试')
  }

  return report
}

let bootstrapPromise: Promise<LocalInfo | null> | null = null

/**
 * 应用启动时的本地模式初始化：探测本地服务 + 执行一次性迁移。
 * 页面生命周期内只执行一次（多处调用共享同一个 Promise）。
 */
export function ensureLocalBootstrap(): Promise<LocalInfo | null> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const info = await detectLocal()
      if (!info) return null
      try {
        await runOneTimeMigration(info)
      } catch (error) {
        log(`迁移过程异常，应用继续启动：${error instanceof Error ? error.message : String(error)}`)
      }
      return info
    })()
  }
  return bootstrapPromise
}
