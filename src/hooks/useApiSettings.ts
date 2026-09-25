import { useCallback, useEffect, useMemo, useState } from 'react'

import { testConnection, type TestConnectionResult } from '@/services/chatApi'
import {
  clearServerKey,
  fetchServerSettings,
  resetServerSettings,
  saveServerSettings,
  testServerConnection,
  type ServerApiSettings,
} from '@/services/localApi'
import { ensureLocalBootstrap } from '@/services/migration'
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
  /**
   * 浏览器模式下已保存的 API Key。
   * 便携版恒为空字符串 —— 完整 Key 只保存在本地服务里，不会进入浏览器状态。
   */
  apiKey: string
  /** 便携版：脱敏后的 Key（sk-****abcd）；网页版为空 */
  maskedApiKey: string
  keyStorage: ApiKeyStorage
  /** 是否已配置可用的 API Key */
  configured: boolean
  /** 是否运行在便携版本地服务中 */
  serverMode: boolean
  /** 设置是否已经加载完成 */
  ready: boolean
  status: ApiConnectionStatus
  lastTestResult: TestConnectionResult | null
  save: (settings: ApiSettings, apiKey: string) => Promise<void>
  test: (settings: ApiSettings, apiKey: string) => Promise<TestConnectionResult>
  clearKey: () => Promise<void>
  clearAll: () => Promise<void>
}

/**
 * API 设置的读写、持久化与连接状态。
 *
 * 两种模式：
 * - 便携版（serverMode）：Key 与 Base URL / Model 都存在本机 config/settings.json，
 *   由本地 Node 服务在转发时注入，浏览器只拿到 maskedApiKey；
 * - 网页版：保持原来的 localStorage / sessionStorage 行为不变。
 */
export function useApiSettings(): UseApiSettingsResult {
  const [serverMode, setServerMode] = useState(false)
  const [ready, setReady] = useState(false)
  const [settings, setSettings] = useState<ApiSettings>(() => loadApiSettings())
  const [apiKey, setApiKey] = useState<string>(() => loadApiKey())
  const [maskedApiKey, setMaskedApiKey] = useState('')
  const [keyStorage, setKeyStorage] = useState<ApiKeyStorage>(() => loadApiKeyStorage())
  const [configured, setConfigured] = useState(() => loadApiKey().trim().length > 0)
  const [status, setStatus] = useState<ApiConnectionStatus>(() =>
    loadApiKey().trim() ? 'unknown' : 'unconfigured',
  )
  const [lastTestResult, setLastTestResult] = useState<TestConnectionResult | null>(null)

  /** 把服务端返回的公开设置映射到界面状态（永远不含完整 Key） */
  const applyServerSettings = useCallback((server: ServerApiSettings) => {
    setSettings((prev) => ({
      ...prev,
      provider: server.provider,
      baseUrl: server.baseUrl,
      model: server.model,
      // 便携版 Key 一定保存在本机，等价于「已记住」
      rememberApiKey: true,
    }))
    setMaskedApiKey(server.maskedApiKey)
    setKeyStorage('server')
    setConfigured(server.configured)
    setStatus(server.configured ? 'unknown' : 'unconfigured')
    // 便携版绝不把完整 Key 放进浏览器内存状态
    setApiKey('')
  }, [])

  // 启动时探测本地模式；便携版从本地服务读取配置
  useEffect(() => {
    let cancelled = false

    void (async () => {
      const info = await ensureLocalBootstrap()
      if (cancelled) return
      if (!info) {
        setReady(true)
        return
      }
      setServerMode(true)
      try {
        const server = await fetchServerSettings()
        if (cancelled) return
        applyServerSettings(server)
      } catch (error) {
        console.warn(
          '[本地配置] 读取失败：',
          error instanceof Error ? error.message : error,
        )
      }
      setReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [applyServerSettings])

  /** 网页模式：从浏览器存储重新同步 */
  const syncBrowser = useCallback(() => {
    const nextKey = loadApiKey()
    setSettings(loadApiSettings())
    setApiKey(nextKey)
    setKeyStorage(loadApiKeyStorage())
    setConfigured(nextKey.trim().length > 0)
    setStatus(nextKey.trim() ? 'unknown' : 'unconfigured')
    setLastTestResult(null)
  }, [])

  const save = useCallback(
    async (nextSettings: ApiSettings, nextApiKey: string) => {
      if (serverMode) {
        const patch: { baseUrl: string; model: string; apiKey?: string; verify: boolean } = {
          baseUrl: nextSettings.baseUrl,
          model: nextSettings.model,
          verify: true,
        }
        // 空字符串 = 用户没有输入新 Key，保持本机已保存的 Key 不变
        if (nextApiKey.trim()) patch.apiKey = nextApiKey.trim()
        const server = await saveServerSettings(patch)
        applyServerSettings(server)
        setLastTestResult(null)
        return
      }

      saveApiSettings(nextSettings)
      saveApiKey(nextApiKey, nextSettings.rememberApiKey)
      syncBrowser()
    },
    [applyServerSettings, serverMode, syncBrowser],
  )

  const test = useCallback(
    async (nextSettings: ApiSettings, nextApiKey: string) => {
      setStatus('testing')

      let result: TestConnectionResult
      if (serverMode) {
        try {
          result = await testServerConnection({
            apiKey: nextApiKey.trim() || undefined,
            baseUrl: nextSettings.baseUrl,
            model: nextSettings.model,
          })
        } catch (error) {
          result = {
            ok: false,
            message: error instanceof Error ? error.message : '测试失败，请稍后重试。',
          }
        }
      } else {
        result = await testConnection(nextSettings, nextApiKey)
      }

      setLastTestResult(result)
      setStatus(result.ok ? 'connected' : 'failed')
      return result
    },
    [serverMode],
  )

  const clearKey = useCallback(async () => {
    if (serverMode) {
      applyServerSettings(await clearServerKey())
      setLastTestResult(null)
      return
    }
    clearStoredApiKey()
    syncBrowser()
  }, [applyServerSettings, serverMode, syncBrowser])

  const clearAll = useCallback(async () => {
    if (serverMode) {
      applyServerSettings(await resetServerSettings())
      setLastTestResult(null)
      return
    }
    clearStoredApiKey()
    clearApiSettings()
    setSettings({ ...defaultApiSettings })
    setApiKey('')
    setKeyStorage('none')
    setConfigured(false)
    setStatus('unconfigured')
    setLastTestResult(null)
  }, [applyServerSettings, serverMode])

  return useMemo(
    () => ({
      settings,
      apiKey,
      maskedApiKey,
      keyStorage,
      configured,
      serverMode,
      ready,
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
      maskedApiKey,
      keyStorage,
      configured,
      serverMode,
      ready,
      status,
      lastTestResult,
      save,
      test,
      clearKey,
      clearAll,
    ],
  )
}
