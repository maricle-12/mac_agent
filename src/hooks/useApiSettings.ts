import { useCallback, useMemo, useState } from 'react'

import { testConnection, type TestConnectionResult } from '@/services/chatApi'
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
import type { ApiConnectionStatus } from '@/types/chat'
import type { ApiKeyStorage, ApiSettings } from '@/types/settings'

export interface UseApiSettingsResult {
  settings: ApiSettings
  apiKey: string
  /** API Key 当前存在哪里（none / session / local） */
  keyStorage: ApiKeyStorage
  /** 是否已配置 API Key */
  configured: boolean
  /** 连接状态：unconfigured / unknown / testing / connected / failed */
  status: ApiConnectionStatus
  /** 最近一次测试连接的结果 */
  lastTestResult: TestConnectionResult | null
  /** 保存设置与 Key（remember 决定 Key 写入哪个存储） */
  save: (settings: ApiSettings, apiKey: string) => void
  /**
   * 测试连接。传入当前表单值，因此用户可以在保存之前先验证。
   * 返回结果供弹窗直接展示，同时更新全局连接状态。
   */
  test: (settings: ApiSettings, apiKey: string) => Promise<TestConnectionResult>
  /** 仅清除 API Key，保留 Base URL / Model */
  clearKey: () => void
  /** 清除 API 配置：Key 与自定义 Base URL / Model 一并恢复默认 */
  clearAll: () => void
}

/**
 * API 设置的读写、持久化与连接状态。
 *
 * 读取来源：localStorage（非敏感设置 + 用户主动记住的 Key）与 sessionStorage（本次会话的 Key）。
 */
export function useApiSettings(): UseApiSettingsResult {
  const [settings, setSettings] = useState<ApiSettings>(() => loadApiSettings())
  const [apiKey, setApiKey] = useState<string>(() => loadApiKey())
  const [keyStorage, setKeyStorage] = useState<ApiKeyStorage>(() => loadApiKeyStorage())
  const [status, setStatus] = useState<ApiConnectionStatus>(() =>
    loadApiKey().trim() ? 'unknown' : 'unconfigured',
  )
  const [lastTestResult, setLastTestResult] = useState<TestConnectionResult | null>(null)

  /** 从存储重新同步状态，保证 UI 与真实存储一致 */
  const sync = useCallback(() => {
    const nextKey = loadApiKey()
    setSettings(loadApiSettings())
    setApiKey(nextKey)
    setKeyStorage(loadApiKeyStorage())
    setStatus(nextKey.trim() ? 'unknown' : 'unconfigured')
    setLastTestResult(null)
  }, [])

  const save = useCallback(
    (nextSettings: ApiSettings, nextApiKey: string) => {
      saveApiSettings(nextSettings)
      saveApiKey(nextApiKey, nextSettings.rememberApiKey)
      // 配置变了，之前的测试结论不再适用
      sync()
    },
    [sync],
  )

  const test = useCallback(
    async (nextSettings: ApiSettings, nextApiKey: string) => {
      setStatus('testing')
      const result = await testConnection(nextSettings, nextApiKey)
      setLastTestResult(result)
      setStatus(result.ok ? 'connected' : 'failed')
      return result
    },
    [],
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
    setStatus('unconfigured')
    setLastTestResult(null)
  }, [])

  return useMemo(
    () => ({
      settings,
      apiKey,
      keyStorage,
      configured: apiKey.trim().length > 0,
      status,
      lastTestResult,
      save,
      test,
      clearKey,
      clearAll,
    }),
    [
      settings,
      apiKey,
      keyStorage,
      status,
      lastTestResult,
      save,
      test,
      clearKey,
      clearAll,
    ],
  )
}
