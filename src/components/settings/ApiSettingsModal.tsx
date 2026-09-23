import { useEffect, useState } from 'react'

import { Button } from '@/components/common/Button'
import { EyeIcon, EyeOffIcon, InfoIcon } from '@/components/common/icons'
import { Modal } from '@/components/common/Modal'
import { apiConfig, apiProviders } from '@/config/api'
import type { TestConnectionResult } from '@/services/chatApi'
import { cn } from '@/utils/cn'
import type { ApiKeyStorage, ApiSettings } from '@/types/settings'

export interface ApiSettingsModalProps {
  open: boolean
  settings: ApiSettings
  apiKey: string
  /** API Key 当前的存储位置，用于如实告知用户 */
  keyStorage: ApiKeyStorage
  onClose: () => void
  onSave: (settings: ApiSettings, apiKey: string) => void
  /** 测试连接：用当前表单值发一次极小请求，返回结果供本弹窗展示 */
  onTest: (settings: ApiSettings, apiKey: string) => Promise<TestConnectionResult>
  onClearApiKey: () => void
}

const labelClass = 'block text-[13px] font-medium text-ink'
const inputClass =
  'mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-brand/60'

const storageHint: Record<ApiKeyStorage, { dot: string; text: string; tone: string }> = {
  none: { dot: 'bg-ink-muted', text: '当前未保存 API Key。', tone: 'text-ink-soft' },
  session: {
    dot: 'bg-warning',
    text: '当前仅保存在本次会话中，关闭浏览器后需要重新输入。',
    tone: 'text-ink-soft',
  },
  local: {
    dot: 'bg-success',
    text: '当前已保存在此设备上，下次打开无需重新输入。',
    tone: 'text-success',
  },
}

export function ApiSettingsModal({
  open,
  settings,
  apiKey,
  keyStorage,
  onClose,
  onSave,
  onTest,
  onClearApiKey,
}: ApiSettingsModalProps) {
  const [form, setForm] = useState<ApiSettings>(settings)
  const [key, setKey] = useState(apiKey)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null)

  // 每次打开时用最新的外部设置重置表单
  useEffect(() => {
    if (!open) return
    setForm(settings)
    setKey(apiKey)
    setShowKey(false)
    setTestResult(null)
  }, [open, settings, apiKey])

  // 表单被改动后，之前的测试结论不再可信
  useEffect(() => {
    setTestResult(null)
  }, [form, key])

  const provider = apiProviders.find((item) => item.id === form.provider) ?? apiProviders[0]

  const normalizedForm = (): ApiSettings => ({
    ...form,
    baseUrl: form.baseUrl.trim().replace(/\/+$/, ''),
    model: form.model.trim(),
  })

  const canTest =
    key.trim().length > 0 &&
    form.baseUrl.trim().length > 0 &&
    form.model.trim().length > 0 &&
    !testing

  const handleTest = async () => {
    setTesting(true)
    try {
      setTestResult(await onTest(normalizedForm(), key.trim()))
    } finally {
      setTesting(false)
    }
  }

  const handleProviderChange = (providerId: string) => {
    const next = apiProviders.find((item) => item.id === providerId)
    if (!next) return
    setForm((prev) => ({ ...prev, provider: next.id, baseUrl: next.baseUrl, model: next.model }))
  }

  const handleSave = () => {
    onSave(normalizedForm(), key.trim())
    onClose()
  }

  return (
    <Modal
      open={open}
      title="API 设置"
      description="使用本应用需要你自己的模型 API Key"
      onClose={onClose}
      panelClassName="sm:max-w-[520px]"
      footer={
        <>
          {apiKey ? (
            <Button
              variant="ghost"
              className="mr-auto text-danger hover:bg-danger/5"
              onClick={onClearApiKey}
            >
              清除 API 配置
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={handleSave}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={labelClass} htmlFor="api-provider">
            模型服务
          </label>
          <select
            id="api-provider"
            value={form.provider}
            onChange={(event) => handleProviderChange(event.target.value)}
            className={inputClass}
          >
            {apiProviders.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="api-key">
            API Key
          </label>
          <div className="relative">
            <input
              id="api-key"
              type={showKey ? 'text' : 'password'}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="sk-xxxxxxxxxxxxxxxx"
              autoComplete="off"
              spellCheck={false}
              className={`${inputClass} pr-10 font-mono`}
            />
            <button
              type="button"
              onClick={() => setShowKey((prev) => !prev)}
              aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-ink-muted transition-colors hover:text-ink"
            >
              {showKey ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="api-base-url">
            Base URL
          </label>
          <input
            id="api-base-url"
            type="text"
            value={form.baseUrl}
            onChange={(event) => setForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
            placeholder={apiConfig.defaultBaseUrl}
            spellCheck={false}
            className={`${inputClass} font-mono text-[13px]`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="api-model">
            Model
          </label>
          <input
            id="api-model"
            type="text"
            value={form.model}
            onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
            placeholder={apiConfig.defaultModel}
            spellCheck={false}
            list="api-model-options"
            className={`${inputClass} font-mono text-[13px]`}
          />
          <datalist id="api-model-options">
            {provider.models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-canvas/60 p-3">
          <input
            type="checkbox"
            checked={form.rememberApiKey}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, rememberApiKey: event.target.checked }))
            }
            className="mt-0.5 size-4 accent-brand"
          />
          <span>
            <span className="block text-[13px] font-medium text-ink">在此设备记住 API Key</span>
            <span className="mt-0.5 block text-[12px] leading-5 text-ink-soft">
              不勾选时，API Key 仅保存在当前会话（sessionStorage），关闭浏览器后自动失效。
              勾选后才会保存到本机浏览器（localStorage），方便下次打开无需重新输入。
            </span>
          </span>
        </label>

        <div className="flex items-start gap-2 rounded-lg bg-brand-soft p-3 text-[12px] leading-5 text-ink-soft">
          <InfoIcon className="mt-px size-4 shrink-0 text-brand" />
          <p>
            API Key 仅用于调用您选择的模型服务。本应用不会将 API Key 保存到云端数据库，
            也不会写入源码或日志。所有聊天记录只保存在你自己的浏览器中。
          </p>
        </div>

        <p className="flex items-center gap-2 text-[12px]">
          <span className={cn('size-1.5 shrink-0 rounded-full', storageHint[keyStorage].dot)} />
          <span className={storageHint[keyStorage].tone}>{storageHint[keyStorage].text}</span>
        </p>

        <div className="border-t border-line-soft pt-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" disabled={!canTest} onClick={() => void handleTest()}>
              {testing ? '测试中…' : '测试连接'}
            </Button>

            {!key.trim() ? (
              <span className="text-[12px] text-ink-muted">请先填写 API Key</span>
            ) : null}

            {testResult ? (
              <span
                className={cn(
                  'flex items-center gap-1.5 text-[12px]',
                  testResult.ok ? 'text-success' : 'text-danger',
                )}
              >
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    testResult.ok ? 'bg-success' : 'bg-danger',
                  )}
                />
                {testResult.message}
              </span>
            ) : null}
          </div>

          {testResult?.ok && testResult.preview ? (
            <p className="mt-2 rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-[12px] leading-5 text-ink-soft">
              模型回复：{testResult.preview}
            </p>
          ) : null}

          {testResult?.detail ? (
            <details className="mt-2 rounded-lg border border-line bg-canvas px-3 py-2 text-[12px] text-ink-soft">
              <summary className="cursor-pointer select-none">查看技术详情</summary>
              <pre className="mt-1.5 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all text-ink-muted">
                {testResult.detail}
              </pre>
            </details>
          ) : null}

          {testResult && !testResult.ok ? (
            <p className="mt-2 text-[12px] leading-5 text-ink-muted">
              常见原因：API Key 填错或已失效、账户余额不足、模型名称不存在、Base URL 填错、
              网络无法访问模型服务，或 Worker 未启动。
            </p>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
