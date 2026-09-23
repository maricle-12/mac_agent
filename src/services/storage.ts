import { apiConfig } from '@/config/api'
import type { ApiKeyStorage, ApiSettings, UiPreferences } from '@/types/settings'

/**
 * 浏览器本地存储封装。
 *
 * 安全原则（务必保持）：
 * - API Key 默认只写 sessionStorage，关闭浏览器即失效；
 *   只有用户主动勾选「在此设备记住 API Key」才写入 localStorage。
 * - localStorage 只放非敏感项（provider / baseUrl / model / 模式偏好）。
 * - 任何 API Key 都不进入源码、不进日志、不上传服务器。
 */

const PREFIX = 'ai-edu-agent'

export const storageKeys = {
  /** 非敏感 API 设置（localStorage） */
  apiSettings: `${PREFIX}:api-settings`,
  /** 仅本次会话的 API Key（sessionStorage） */
  apiKeySession: `${PREFIX}:api-key:session`,
  /** 用户主动选择记住的 API Key（localStorage） */
  apiKeyLocal: `${PREFIX}:api-key:local`,
  /** UI 偏好（localStorage） */
  preferences: `${PREFIX}:preferences`,
} as const

export const defaultApiSettings: ApiSettings = {
  provider: apiConfig.defaultProvider,
  baseUrl: apiConfig.defaultBaseUrl,
  model: apiConfig.defaultModel,
  rememberApiKey: false,
}

export const defaultPreferences: UiPreferences = {
  mode: 'teacher',
  activeConversationId: null,
}

/** 取存储对象；隐私模式或被禁用时返回 null，绝不抛异常 */
function getStorage(kind: 'local' | 'session'): Storage | null {
  try {
    const storage = kind === 'local' ? window.localStorage : window.sessionStorage
    const probe = `${PREFIX}:probe`
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

function readJson<T>(storage: Storage | null, key: string): T | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(storage: Storage | null, key: string, value: unknown): void {
  if (!storage) return
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // 存储不可用或超限时静默失败，不影响主流程
  }
}

// ---------------------------------------------------------------- API Key

/** 读取 API Key：优先「已记住」的 localStorage，其次当前会话的 sessionStorage */
export function loadApiKey(): string {
  const remembered = getStorage('local')?.getItem(storageKeys.apiKeyLocal) ?? ''
  if (remembered) return remembered
  return getStorage('session')?.getItem(storageKeys.apiKeySession) ?? ''
}

/** 当前 Key 存在哪里，用于在设置界面如实告知用户 */
export function loadApiKeyStorage(): ApiKeyStorage {
  if (getStorage('local')?.getItem(storageKeys.apiKeyLocal)) return 'local'
  if (getStorage('session')?.getItem(storageKeys.apiKeySession)) return 'session'
  return 'none'
}

/**
 * 保存 API Key。
 * 同一个 Key 只会存在于一个位置：勾选记住 → localStorage，否则 → sessionStorage。
 */
export function saveApiKey(apiKey: string, remember: boolean): void {
  const local = getStorage('local')
  const session = getStorage('session')

  local?.removeItem(storageKeys.apiKeyLocal)
  session?.removeItem(storageKeys.apiKeySession)

  const trimmed = apiKey.trim()
  if (!trimmed) return

  if (remember) local?.setItem(storageKeys.apiKeyLocal, trimmed)
  else session?.setItem(storageKeys.apiKeySession, trimmed)
}

/** 清除两个存储位置中的 API Key */
export function clearApiKey(): void {
  getStorage('local')?.removeItem(storageKeys.apiKeyLocal)
  getStorage('session')?.removeItem(storageKeys.apiKeySession)
}

// ---------------------------------------------------------------- 非敏感设置

/** 读取 API 设置；rememberApiKey 始终按 Key 的真实存储位置推导，避免出现「勾了但没记住」的假象 */
export function loadApiSettings(): ApiSettings {
  const stored = readJson<Partial<ApiSettings>>(getStorage('local'), storageKeys.apiSettings)
  return {
    provider: stored?.provider ?? defaultApiSettings.provider,
    baseUrl: stored?.baseUrl ?? defaultApiSettings.baseUrl,
    model: stored?.model ?? defaultApiSettings.model,
    rememberApiKey: loadApiKeyStorage() === 'local',
  }
}

export function saveApiSettings(settings: ApiSettings): void {
  writeJson(getStorage('local'), storageKeys.apiSettings, {
    provider: settings.provider,
    baseUrl: settings.baseUrl.trim().replace(/\/+$/, ''),
    model: settings.model.trim(),
  })
}

export function clearApiSettings(): void {
  getStorage('local')?.removeItem(storageKeys.apiSettings)
}

// ---------------------------------------------------------------- UI 偏好

export function loadPreferences(): UiPreferences {
  const stored = readJson<Partial<UiPreferences>>(getStorage('local'), storageKeys.preferences)
  return {
    mode: stored?.mode === 'student' ? 'student' : defaultPreferences.mode,
    activeConversationId: stored?.activeConversationId ?? null,
  }
}

export function savePreferences(patch: Partial<UiPreferences>): void {
  const next: UiPreferences = { ...loadPreferences(), ...patch }
  writeJson(getStorage('local'), storageKeys.preferences, next)
}
