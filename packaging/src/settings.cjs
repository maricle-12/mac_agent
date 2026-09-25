'use strict'

/**
 * 本地 API 配置（含 DeepSeek API Key）。
 *
 * 位置：config/settings.json（纯本地文件，随程序目录走，便携）
 *
 * 安全约定（务必保持）：
 *   - API Key 只存在这个文件里，**绝不回传给浏览器**；
 *   - 浏览器只能拿到 { configured, maskedApiKey } 这类信息；
 *   - 日志里只允许出现 sk-****abcd 形式；
 *   - 不写进前端 bundle、不写进 HTML、不写进任何构建产物。
 *
 * 关于加密：本版本按需求采用「简单可靠优先」，不引入 DPAPI / 账号体系。
 * 目标是减少前端暴露面，而不是构造复杂 DRM。
 */

const fs = require('node:fs')
const path = require('node:path')

const SETTINGS_SCHEMA_VERSION = 1
const DEFAULT_PROVIDER = 'deepseek'
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-chat'

/** 只保留头尾，中间一律打码，例如 sk-****abcd */
function maskApiKey(apiKey) {
  const value = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (!value) return ''
  if (value.length <= 8) return '****'
  const head = value.slice(0, 3)
  const tail = value.slice(-4)
  return `${head}****${tail}`
}

function isUsableKey(apiKey) {
  const value = typeof apiKey === 'string' ? apiKey.trim() : ''
  return value.length >= 8 && !/[\u0000-\u001f\u007f]/.test(value)
}

function normalizeBaseUrl(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return DEFAULT_BASE_URL
  return text.replace(/\/+$/, '')
}

function normalizeModel(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || DEFAULT_MODEL
}

/**
 * @param {{ configDir: string, logger: any }} options
 */
function openSettings(options) {
  const { configDir, logger } = options
  const file = path.join(configDir, 'settings.json')

  fs.mkdirSync(configDir, { recursive: true })

  const emptyState = () => ({
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    activeProvider: DEFAULT_PROVIDER,
    providers: {
      [DEFAULT_PROVIDER]: {
        apiKey: '',
        baseUrl: DEFAULT_BASE_URL,
        model: DEFAULT_MODEL,
        apiKeyUpdatedAt: 0,
      },
    },
  })

  let state = emptyState()

  function readFromDisk() {
    if (!fs.existsSync(file)) return null
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') throw new Error('配置文件结构不正确')
    return parsed
  }

  let existed = fs.existsSync(file)
  try {
    const parsed = readFromDisk()
    if (parsed) {
      const provider = parsed.providers && parsed.providers[DEFAULT_PROVIDER]
      state = {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        activeProvider:
          typeof parsed.activeProvider === 'string' ? parsed.activeProvider : DEFAULT_PROVIDER,
        providers: {
          [DEFAULT_PROVIDER]: {
            apiKey: typeof provider?.apiKey === 'string' ? provider.apiKey : '',
            baseUrl: normalizeBaseUrl(provider?.baseUrl),
            model: normalizeModel(provider?.model),
            apiKeyUpdatedAt: Number.isFinite(provider?.apiKeyUpdatedAt)
              ? provider.apiKeyUpdatedAt
              : 0,
          },
        },
      }
    }
  } catch (error) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = `${file}.corrupt.${stamp}`
    try {
      fs.renameSync(file, backup)
      logger.error(
        `配置文件无法解析（${error && error.message ? error.message : error}），已备份为 ${backup}，并使用默认配置`,
      )
    } catch (renameError) {
      logger.error(
        `配置文件无法解析且备份失败：${renameError && renameError.message ? renameError.message : renameError}`,
      )
    }
    state = emptyState()
  }

  if (!existed) {
    // 首次启动就把默认配置落盘，让 config/settings.json 从一开始就存在（便于用户备份/迁移）
    try {
      fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
      logger.info(`已创建默认配置文件：${file}`)
    } catch (error) {
      logger.warn(`创建默认配置文件失败：${error && error.message ? error.message : error}`)
    }
  }

  function persist() {
    const temp = `${file}.tmp`
    // 原子写：先写临时文件再改名，避免断电/崩溃留下半个 JSON
    fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    fs.renameSync(temp, file)
  }

  function provider() {
    return state.providers[DEFAULT_PROVIDER]
  }

  /** 面向浏览器的公开信息：永远不含完整 Key */
  function getPublicSettings() {
    const current = provider()
    return {
      provider: DEFAULT_PROVIDER,
      baseUrl: current.baseUrl,
      model: current.model,
      configured: isUsableKey(current.apiKey),
      maskedApiKey: maskApiKey(current.apiKey),
      keyUpdatedAt: current.apiKeyUpdatedAt || 0,
      /** 本地版固定为 server：Key 由本地服务保存，浏览器不保存 */
      keyStorage: 'server',
    }
  }

  /** 仅本地服务内部使用，绝不进入任何 HTTP 响应 */
  function getApiKey() {
    return provider().apiKey
  }

  /**
   * 更新配置。
   * apiKey 传 undefined 表示「不改动现有 Key」；传空字符串表示「清除 Key」。
   */
  function update(patch = {}) {
    const current = provider()
    const next = {
      apiKey: current.apiKey,
      baseUrl: current.baseUrl,
      model: current.model,
      apiKeyUpdatedAt: current.apiKeyUpdatedAt,
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'apiKey')) {
      const incoming = typeof patch.apiKey === 'string' ? patch.apiKey.trim() : ''
      if (incoming) {
        if (!isUsableKey(incoming)) {
          const error = new Error('API Key 格式不正确。')
          error.code = 'invalid_api_key'
          throw error
        }
        next.apiKey = incoming
        next.apiKeyUpdatedAt = Date.now()
      } else {
        next.apiKey = ''
        next.apiKeyUpdatedAt = 0
      }
    }

    if (typeof patch.baseUrl === 'string' && patch.baseUrl.trim()) {
      next.baseUrl = normalizeBaseUrl(patch.baseUrl)
    }
    if (typeof patch.model === 'string' && patch.model.trim()) {
      next.model = normalizeModel(patch.model)
    }

    state.providers[DEFAULT_PROVIDER] = next
    persist()

    // 只记录是否配置，绝不记录 Key 本身
    logger.info(
      `API 配置已更新：provider=${DEFAULT_PROVIDER} model=${next.model} baseUrl=${next.baseUrl} apiKey=${next.apiKey ? maskApiKey(next.apiKey) : '(未配置)'}`,
    )
    return getPublicSettings()
  }

  function clearKey() {
    const current = provider()
    state.providers[DEFAULT_PROVIDER] = { ...current, apiKey: '', apiKeyUpdatedAt: 0 }
    persist()
    logger.info('API Key 已从本机配置中清除')
    return getPublicSettings()
  }

  function clearAll() {
    state = emptyState()
    persist()
    logger.info('API 配置已重置为默认值')
    return getPublicSettings()
  }

  return {
    file,
    getPublicSettings,
    getApiKey,
    update,
    clearKey,
    clearAll,
    defaults: {
      provider: DEFAULT_PROVIDER,
      baseUrl: DEFAULT_BASE_URL,
      model: DEFAULT_MODEL,
    },
  }
}

module.exports = { openSettings, maskApiKey, isUsableKey, DEFAULT_BASE_URL, DEFAULT_MODEL }
