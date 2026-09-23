import { apiConfig } from '@/config/api'
import type { ApiMessage, ChatMessage } from '@/types/chat'
import type { ApiSettings } from '@/types/settings'

/**
 * 与 Worker（/api/chat）的唯一调用入口。
 *
 * 约定：
 * - 所有请求都带上用户自己的 API Key；Key 只作为本次请求的一部分，不落地。
 * - Worker 返回的结构化错误统一转成 ApiRequestError，前端只展示 message，
 *   原始信息放进 detail 供「查看技术详情」使用。
 * - 网络层失败（离线、CORS、地址未配置）在本地映射成友好文案，不暴露技术堆栈。
 */

/** 浏览器 → Worker 的请求体 */
export interface ChatCompletionPayload {
  apiKey: string
  baseUrl: string
  model: string
  messages: ApiMessage[]
  temperature?: number
  maxTokens?: number
  stream?: boolean
}

/** 本地错误码（非 Worker 返回）对应的提示文案 */
const LOCAL_ERROR_MESSAGES: Record<string, string> = {
  endpoint_missing: '尚未配置模型转发地址，请参考 README 完成 Worker 部署后再试。',
  network_error: '网络连接失败，请检查网络后重试。',
  invalid_response: '模型服务返回了无法解析的内容。',
  unknown_error: '请求失败，请稍后重试。',
}

export class ApiRequestError extends Error {
  readonly code: string
  readonly status: number
  readonly detail?: string

  constructor(options: { code: string; message: string; status?: number; detail?: string }) {
    super(options.message)
    this.name = 'ApiRequestError'
    this.code = options.code
    this.status = options.status ?? 0
    this.detail = options.detail
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** 转发端点是否还是占位符（部署前常见） */
function isEndpointPlaceholder(): boolean {
  return apiConfig.endpoint.includes('REPLACE-WITH-YOUR-WORKER')
}

function localError(code: string, detail?: string): ApiRequestError {
  return new ApiRequestError({ code, message: LOCAL_ERROR_MESSAGES[code] ?? LOCAL_ERROR_MESSAGES.unknown_error, detail })
}

/** 解析 Worker 返回的结构化错误体 */
function parseErrorBody(body: unknown): { code: string; message: string; status?: number; detail?: string } | null {
  if (typeof body !== 'object' || body === null) return null
  const error = (body as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return null

  const record = error as Record<string, unknown>
  const { code, message, status, detail } = record
  if (typeof message !== 'string' || message.length === 0) return null

  return {
    code: typeof code === 'string' ? code : 'unknown_error',
    message,
    status: typeof status === 'number' ? status : undefined,
    detail: typeof detail === 'string' ? detail : undefined,
  }
}

async function toApiError(response: Response): Promise<ApiRequestError> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // 响应不是 JSON，走下面的兜底
  }

  const parsed = parseErrorBody(body)
  if (parsed) {
    return new ApiRequestError({ ...parsed, status: parsed.status ?? response.status })
  }

  return new ApiRequestError({
    code: 'unknown_error',
    message: `转发服务返回了异常响应（HTTP ${response.status}）。`,
    status: response.status,
    detail: `HTTP ${response.status} ${response.statusText}`,
  })
}

/**
 * 发起一次聊天请求，返回原始 Response（流式与非流式都走这里）。
 * 非 2xx 会抛出 ApiRequestError；用户主动取消会抛出 AbortError。
 */
export async function requestChatCompletion(
  payload: ChatCompletionPayload,
  signal?: AbortSignal,
): Promise<Response> {
  if (isEndpointPlaceholder()) {
    throw localError('endpoint_missing', `VITE_API_ENDPOINT = ${apiConfig.endpoint}`)
  }

  let response: Response
  try {
    response = await fetch(apiConfig.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw localError(
      'network_error',
      `无法访问 ${apiConfig.endpoint}（${error instanceof Error ? error.message : '未知原因'}）。
请确认：1) Worker 已启动或已部署；2) 当前网页域名在 Worker 的 ALLOWED_ORIGINS 中。`,
    )
  }

  if (!response.ok) {
    throw await toApiError(response)
  }

  return response
}

// ---------------------------------------------------------------- 上下文构造

export interface BuildMessagesOptions {
  /** System Prompt（阶段 8 由 src/prompts 提供；为空时不插入 system 消息） */
  systemPrompt?: string
  /** 最多携带多少条历史消息（不含 system） */
  maxContextMessages: number
}

/**
 * 把本地会话历史整理成发给模型的 messages。
 *
 * 要点：
 * - 历史上只存了 user / assistant；system 在每次请求时动态插入，
 *   因此修改 Prompt 后新请求立即生效，也不会在历史里留下旧 Prompt。
 * - 只取最近 maxContextMessages 条，避免上下文无限增长。
 * - 过滤掉空内容与出错的消息（例如被中断的空回答）。
 * - **不再单独添加当前用户消息**：调用方传入的历史里已经包含它，
 *   重复添加会导致模型看到两遍同一个问题。
 */
export function buildRequestMessages(
  history: ChatMessage[],
  options: BuildMessagesOptions,
): ApiMessage[] {
  const usable: ApiMessage[] = history
    .filter((message) => {
      if (message.role !== 'user' && message.role !== 'assistant') return false
      if (message.error) return false
      return message.content.trim().length > 0
    })
    .map((message) => ({ role: message.role, content: message.content }))

  const trimmed = usable.slice(-options.maxContextMessages)

  if (options.systemPrompt && options.systemPrompt.trim()) {
    return [{ role: 'system', content: options.systemPrompt }, ...trimmed]
  }
  return trimmed
}

// ---------------------------------------------------------------- 非流式响应

export interface CompletionResult {
  content: string
  model?: string
  totalTokens?: number
}

/** 从 OpenAI 兼容的非流式响应中取出回答内容 */
export function readCompletion(data: unknown): CompletionResult {
  if (typeof data !== 'object' || data === null) {
    throw new ApiRequestError({
      code: 'invalid_response',
      message: LOCAL_ERROR_MESSAGES.invalid_response,
    })
  }

  const record = data as {
    choices?: Array<{ message?: { content?: unknown } }>
    model?: unknown
    usage?: { total_tokens?: unknown }
  }

  const content = record.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new ApiRequestError({
      code: 'invalid_response',
      message: LOCAL_ERROR_MESSAGES.invalid_response,
      detail: JSON.stringify(data).slice(0, 500),
    })
  }

  return {
    content,
    model: typeof record.model === 'string' ? record.model : undefined,
    totalTokens:
      typeof record.usage?.total_tokens === 'number' ? record.usage.total_tokens : undefined,
  }
}

// ---------------------------------------------------------------- 测试连接

export interface TestConnectionResult {
  ok: boolean
  /** 面向用户的结论文案 */
  message: string
  /** 已脱敏的技术详情，折叠展示 */
  detail?: string
  /** 成功时模型的实际回复，用于让用户直观看到「真的通了」 */
  preview?: string
  model?: string
  totalTokens?: number
}

/**
 * 用一次极小的非流式请求验证 API Key 是否可用。
 * 失败时返回错误码对应的友好文案，绝不抛出。
 */
export async function testConnection(
  settings: ApiSettings,
  apiKey: string,
): Promise<TestConnectionResult> {
  try {
    const response = await requestChatCompletion({
      apiKey,
      baseUrl: settings.baseUrl,
      model: settings.model,
      messages: [{ role: 'user', content: '你好' }],
      temperature: 0.1,
      stream: false,
    })

    const data: unknown = await response.json()
    const completion = readCompletion(data)
    const preview = completion.content.trim().slice(0, 60)

    return {
      ok: true,
      message: '连接成功',
      preview: preview || '（模型返回了空内容）',
      model: completion.model ?? settings.model,
      totalTokens: completion.totalTokens,
      detail: `HTTP 200 · 模型 ${completion.model ?? settings.model}${
        completion.totalTokens !== undefined ? ` · 消耗 ${completion.totalTokens} tokens` : ''
      }`,
    }
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return { ok: false, message: error.message, detail: error.detail }
    }
    if (isAbortError(error)) {
      return { ok: false, message: '测试已取消。' }
    }
    return {
      ok: false,
      message: LOCAL_ERROR_MESSAGES.unknown_error,
      detail: error instanceof Error ? error.message : undefined,
    }
  }
}
