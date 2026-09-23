import { useCallback, useMemo, useState } from 'react'

import {
  clearApiKey as clearStoredApiKey,
  clearApiSettings,
  defaultApiSettings,
  loadApiKey,
  loadApiKeyStorage,
  loadApiSettings,
  saveApiKey,
  saveApiSettings,
} from '@/services/storage'
import type { ApiKeyStorage, ApiSettings } from '@/types/settings'

export interface UseApiSettingsResult {
  settings: ApiSettings
  apiKey: string
  /** API Key 当前存在哪里（none / session / local） */
  keyStorage: ApiKeyStorage
  /** 是否已配置 API Key */
  configured: boolean
  /** 保存设置与 Key（remember 决定 Key 写入哪个存储） */
  save: (settings: ApiSettings, apiKey: string) => void
  /** 仅清除 API Key，保留 Base URL / Model */
  clearKey: () => void
  /** 清除 API 配置：Key 与自定义 Base URL / Model 一并恢复默认 */
  clearAll: () => void
}

/**
 * API 设置的读写与持久化。
 *
 * 读取来源：localStorage（非敏感设置 + 用户主动记住的 Key）与 sessionStorage（本次会话的 Key）。
 * 阶段 5 之后会在此基础上补充「测试连接」能力。
 */
export function useApiSettings(): UseApiSettingsResult {
  const [settings, setSettings] = useState<ApiSettings>(() => loadApiSettings())
  const [apiKey, setApiKey] = useState<string>(() => loadApiKey())
  const [keyStorage, setKeyStorage] = useState<ApiKeyStorage>(() => loadApiKeyStorage())

  /** 从存储重新同步状态，保证 UI 与真实存储一致 */
  const sync = useCallback(() => {
    setSettings(loadApiSettings())
    setApiKey(loadApiKey())
    setKeyStorage(loadApiKeyStorage())
  }, [])

  const save = useCallback(
    (nextSettings: ApiSettings, nextApiKey: string) => {
      saveApiSettings(nextSettings)
      saveApiKey(nextApiKey, nextSettings.rememberApiKey)
      sync()
    },
    [sync],
  )

  const clearKey = useCallback(() => {
    clearStoredApiKey()
    sync()
  }, [sync])

  const clearAll = useCallback(() => {
    clearStoredApiKey()
    clearApiSettings()
    setSettings({ ...defaultApiSettings })
    setApiKey('')
    setKeyStorage('none')
  }, [])

  return useMemo(
    () => ({
      settings,
      apiKey,
      keyStorage,
      configured: apiKey.trim().length > 0,
      save,
      clearKey,
      clearAll,
    }),
    [settings, apiKey, keyStorage, save, clearKey, clearAll],
  )
}
