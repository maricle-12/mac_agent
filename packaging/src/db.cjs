'use strict'

/**
 * 本地聊天数据库（SQLite）。
 *
 * 使用 Node 内置的 `node:sqlite`（Node 22.5+ 内置，已实测在 Node SEA 打包后可用）：
 *   - 不需要任何 native 模块、不需要 WASM、不需要额外 DLL，exe 依然完全自包含；
 *   - 数据库就是普通 SQLite 文件，位于 data/app.db；
 *   - 不做 WAL（避免产生 -wal / -shm 附属文件），保证「一个数据文件」。
 *
 * 这里是聊天历史的唯一真实数据源（Source of Truth）。
 * 浏览器 IndexedDB 只在一次性迁移时作为来源被读取，之后不再参与正式数据。
 */

const fs = require('node:fs')
const path = require('node:path')

const SCHEMA_VERSION = 1

/** 允许的消息角色（与前端一致） */
const ALLOWED_ROLES = new Set(['system', 'user', 'assistant'])

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  mode       TEXT NOT NULL,
  model      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata   TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  status          TEXT,
  metadata        TEXT,
  seq             INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, seq);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations (updated_at DESC);
`

// ---------------------------------------------------------------- 数据整形

function toSafeInteger(value, fallback) {
  return Number.isFinite(value) && Number.isInteger(value) ? value : fallback
}

function normalizeMode(value) {
  return value === 'student' ? 'student' : 'teacher'
}

function normalizeRole(value) {
  return ALLOWED_ROLES.has(value) ? value : 'user'
}

/** 数据库行 → 前端使用的 Conversation 结构（保持与 v1.0.0 完全一致，前端无需改数据结构） */
function rowToConversation(row, messages) {
  return {
    id: String(row.id),
    title: String(row.title ?? '新对话'),
    mode: normalizeMode(row.mode),
    createdAt: toSafeInteger(row.created_at, Date.now()),
    updatedAt: toSafeInteger(row.updated_at, Date.now()),
    messages,
  }
}

function rowToMessage(row) {
  const message = {
    id: String(row.id),
    role: normalizeRole(row.role),
    content: String(row.content ?? ''),
    createdAt: toSafeInteger(row.created_at, Date.now()),
  }
  // error 字段沿用 v1.0.0 的前端结构，存放在 metadata 里
  if (row.metadata) {
    try {
      const metadata = JSON.parse(String(row.metadata))
      if (metadata && typeof metadata.error === 'string' && metadata.error) {
        message.error = metadata.error
      }
    } catch {
      /* 元数据损坏不影响正文 */
    }
  }
  return message
}

function messageMetadata(message) {
  return message && typeof message.error === 'string' && message.error
    ? JSON.stringify({ error: message.error })
    : null
}

// ---------------------------------------------------------------- 存储

/**
 * @param {{ dataDir: string, logger: any }} options
 */
function openDatabase(options) {
  const { dataDir, logger } = options
  const dbFile = path.join(dataDir, 'app.db')

  fs.mkdirSync(dataDir, { recursive: true })

  let db = null
  let corruptedBackup = null

  function tryOpen() {
    // eslint-disable-next-line global-require
    const { DatabaseSync } = require('node:sqlite')
    const instance = new DatabaseSync(dbFile)
    instance.exec('PRAGMA foreign_keys = ON')
    // 快速自检：能读出表结构才算健康，损坏文件会在这一步抛错
    instance.prepare('SELECT count(*) AS n FROM sqlite_master').get()
    return instance
  }

  try {
    db = tryOpen()
  } catch (error) {
    // 数据库损坏：绝不静默销毁用户数据 —— 先备份，再新建
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    corruptedBackup = `${dbFile}.corrupt.${stamp}`
    logger.error(`数据库无法打开（${error && error.message ? error.message : error}），已备份为 ${corruptedBackup}`)
    try {
      fs.renameSync(dbFile, corruptedBackup)
    } catch (renameError) {
      logger.error(`备份损坏数据库失败：${renameError && renameError.message ? renameError.message : renameError}`)
      throw error
    }
    db = tryOpen()
  }

  db.exec(SCHEMA_SQL)

  const currentVersion = Number.parseInt(
    (() => {
      try {
        const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version')
        return row ? row.value : '0'
      } catch {
        return '0'
      }
    })(),
    10,
  )

  if (!Number.isInteger(currentVersion) || currentVersion < SCHEMA_VERSION) {
    // v1 是初始结构；后续版本在这里追加迁移步骤
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      'schema_version',
      String(SCHEMA_VERSION),
    )
    logger.info(`数据库结构版本：${currentVersion || 0} → ${SCHEMA_VERSION}`)
  }

  // ---------------------------------------------------------------- meta

  function getMeta(key, fallback = null) {
    try {
      const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
      return row ? String(row.value) : fallback
    } catch (error) {
      logger.error(`读取 meta(${key}) 失败：${error && error.message ? error.message : error}`)
      return fallback
    }
  }

  function setMeta(key, value) {
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, String(value))
  }

  // ---------------------------------------------------------------- 事务

  function transaction(fn) {
    db.exec('BEGIN')
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* ignore */
      }
      throw error
    }
  }

  // ---------------------------------------------------------------- 会话

  function countConversations() {
    return Number(db.prepare('SELECT count(*) AS n FROM conversations').get().n ?? 0)
  }

  function readMessages(conversationId) {
    return db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq ASC')
      .all(conversationId)
      .map(rowToMessage)
  }

  function listConversations() {
    return db
      .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
      .all()
      .map((row) => rowToConversation(row, readMessages(row.id)))
  }

  function getConversation(id) {
    const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id)
    return row ? rowToConversation(row, readMessages(row.id)) : null
  }

  function listSummaries() {
    return db
      .prepare(
        `SELECT c.id, c.title, c.mode, c.created_at, c.updated_at,
                (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c ORDER BY c.updated_at DESC`,
      )
      .all()
      .map((row) => ({
        id: String(row.id),
        title: String(row.title ?? '新对话'),
        mode: normalizeMode(row.mode),
        createdAt: toSafeInteger(row.created_at, Date.now()),
        updatedAt: toSafeInteger(row.updated_at, Date.now()),
        messageCount: Number(row.message_count ?? 0),
      }))
  }

  /** 写入（或整体覆盖）一个会话及其全部消息；消息整体替换，保证顺序与前端一致 */
  function upsertConversation(conversation, options = {}) {
    if (!conversation || typeof conversation.id !== 'string' || !conversation.id) {
      throw new Error('conversation.id 缺失')
    }
    const now = Date.now()
    const createdAt = toSafeInteger(conversation.createdAt, now)
    const updatedAt = toSafeInteger(conversation.updatedAt, now)
    const messages = Array.isArray(conversation.messages) ? conversation.messages : []

    return transaction(() => {
      const existing = db.prepare('SELECT created_at, model FROM conversations WHERE id = ?').get(conversation.id)

      db.prepare(
        `INSERT INTO conversations (id, title, mode, model, created_at, updated_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           mode = excluded.mode,
           updated_at = excluded.updated_at`,
      ).run(
        conversation.id,
        String(conversation.title ?? '新对话').slice(0, 200),
        normalizeMode(conversation.mode),
        typeof options.model === 'string' && options.model ? options.model : (existing?.model ?? null),
        existing ? toSafeInteger(existing.created_at, createdAt) : createdAt,
        updatedAt,
        null,
      )

      if (options.replaceMessages !== false) {
        db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversation.id)
        const insert = db.prepare(
          `INSERT INTO messages (id, conversation_id, role, content, created_at, status, metadata, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        messages.forEach((message, index) => {
          if (!message || typeof message.id !== 'string' || !message.id) return
          insert.run(
            message.id,
            conversation.id,
            normalizeRole(message.role),
            String(message.content ?? ''),
            toSafeInteger(message.createdAt, now),
            message.error ? 'error' : 'ok',
            messageMetadata(message),
            index,
          )
        })
      }

      return getConversation(conversation.id)
    })
  }

  function deleteConversation(id) {
    return transaction(() => {
      db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id)
      const result = db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
      return Number(result.changes ?? 0)
    })
  }

  function clearConversations() {
    return transaction(() => {
      db.prepare('DELETE FROM messages').run()
      const result = db.prepare('DELETE FROM conversations').run()
      return Number(result.changes ?? 0)
    })
  }

  /**
   * 批量导入（一次性迁移用）。
   * 只在数据库为空时执行，避免重复导入产生重复历史。
   */
  function importConversations(list) {
    if (countConversations() > 0) {
      return { imported: 0, skipped: true }
    }
    let imported = 0
    for (const conversation of Array.isArray(list) ? list : []) {
      try {
        upsertConversation(conversation)
        imported += 1
      } catch (error) {
        logger.warn(
          `导入会话失败（${conversation && conversation.id}）：${error && error.message ? error.message : error}`,
        )
      }
    }
    return { imported, skipped: false }
  }

  // ---------------------------------------------------------------- 消息

  function insertMessage(conversationId, message, seq) {
    return transaction(() => {
      const nextSeq =
        typeof seq === 'number'
          ? seq
          : Number(
              db
                .prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM messages WHERE conversation_id = ?')
                .get(conversationId).n ?? 0,
            )
      db.prepare(
        `INSERT INTO messages (id, conversation_id, role, content, created_at, status, metadata, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           content = excluded.content,
           status = excluded.status,
           metadata = excluded.metadata`,
      ).run(
        message.id,
        conversationId,
        normalizeRole(message.role),
        String(message.content ?? ''),
        toSafeInteger(message.createdAt, Date.now()),
        message.error ? 'error' : 'ok',
        messageMetadata(message),
        nextSeq,
      )
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), conversationId)
      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(message.id)
      return row ? rowToMessage(row) : null
    })
  }

  function updateMessage(id, patch) {
    return transaction(() => {
      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id)
      if (!row) return null
      const next = { ...rowToMessage(row), ...patch }
      db.prepare(
        'UPDATE messages SET content = ?, status = ?, metadata = ?, role = ? WHERE id = ?',
      ).run(
        String(next.content ?? ''),
        next.error ? 'error' : 'ok',
        messageMetadata(next),
        normalizeRole(next.role),
        id,
      )
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), row.conversation_id)
      return rowToMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(id))
    })
  }

  function deleteMessage(id) {
    return transaction(() => {
      const result = db.prepare('DELETE FROM messages WHERE id = ?').run(id)
      return Number(result.changes ?? 0)
    })
  }

  // ---------------------------------------------------------------- 生命周期

  function checkpoint() {
    // 非 WAL 模式下没有额外日志文件，这里只是给调用方一个「已落盘」的语义
    try {
      db.exec('PRAGMA optimize')
    } catch {
      /* 忽略 */
    }
  }

  function close() {
    try {
      db.close()
    } catch {
      /* ignore */
    }
  }

  function stats() {
    return {
      path: dbFile,
      schemaVersion: SCHEMA_VERSION,
      conversationCount: countConversations(),
      corruptedBackup,
    }
  }

  return {
    file: dbFile,
    schemaVersion: SCHEMA_VERSION,
    corruptedBackup,
    getMeta,
    setMeta,
    listConversations,
    listSummaries,
    getConversation,
    countConversations,
    upsertConversation,
    deleteConversation,
    clearConversations,
    importConversations,
    insertMessage,
    updateMessage,
    deleteMessage,
    checkpoint,
    close,
    stats,
  }
}

module.exports = { openDatabase, SCHEMA_VERSION }
