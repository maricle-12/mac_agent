import {
  ALLOWED_BASE_URL_ORIGINS,
  ALLOWED_ROLES,
  DEFAULT_BASE_URL,
  DEFAULT_STREAM,
  MAX_API_KEY_CHARS,
  MAX_BODY_BYTES,
  MAX_MESSAGES,
  MAX_MESSAGE_CHARS,
  MAX_MODEL_CHARS,
  SERVICE_NAME,
  SERVICE_VERSION,
  UPSTREAM_TIMEOUT_MS,
} from './config'

/**
 * AI 教育智能体 · 无状态转发 Worker
 *
 * 职责：
 *   - 接收浏览器 POST /api/chat，携带用户临时传入的 API Key
 *   - 校验来源、正文大小、字段与 Base URL 白名单（防 SSRF）
 *   - 转发到上游（默认 DeepSeek）并原样透传流式响应
 *
 * 安全承诺（不可违反）：
 *   - 不保存 API Key、不保存聊天内容、不使用 KV / D1 / 缓存
 *   - 不调用 console 打印请求内容（尤其不打印 Authorization）
 *   - 响应与错误信息中不出现完整 API Key
 *   - 所有响应带 Cache-Control: no-store
 */

interface Env {
  /** 逗号分隔的允许来源列表，例如 "https://xxx.pages.dev,https://*.xxx.pages.dev" */
  ALLOWED_ORIGINS?: string
}

interface IncomingMessage {
  role: string
  content: string
}

interface ChatPayload {
  apiKey: string
  baseUrl: string
  model: string
  messages: IncomingMessage[]
  temperature?: number
  maxTokens?: number
  stream: boolean
}

type ValidationResult =
  | { ok: true; value: ChatPayload }
  | { ok: false; message: string }

// ---------------------------------------------------------------- 错误映射

/** 错误码 → 面向普通用户的中文说明（前端直接展示这句话） */
const ERROR_TEXT: Record<string, string> = {
  origin_not_allowed: '当前网页来源未被允许访问模型服务，请检查 Worker 的 ALLOWED_ORIGINS 配置。',
  method_not_allowed: '该接口只接受 POST 请求。',
  not_found: '接口不存在。',
  payload_too_large: `请求内容过大，请减少携带的历史消息（上限 ${Math.round(MAX_BODY_BYTES / 1024)} KB）。`,
  invalid_json: '请求格式有误，请重试。',
  invalid_request: '请求参数不完整或有误。',
  base_url_not_allowed: '不允许的 API 地址。当前仅支持 DeepSeek（https://api.deepseek.com）。',
  invalid_api_key: 'API Key 不正确或已失效，请在「API 设置」中检查后重新填写。',
  insufficient_balance: '账户余额不足或账户状态异常，请到模型服务商控制台检查。',
  rate_limited: '请求过于频繁，请稍后再试。',
  model_not_found: '模型不存在或没有访问权限，请检查模型名称。',
  forbidden: '该 API Key 没有访问该模型的权限。',
  bad_request: '请求参数有误，请检查模型名称与消息内容。',
  upstream_timeout: '模型服务响应超时，请稍后重试。',
  upstream_unreachable: '无法连接模型服务，请检查网络或 API 地址。',
  upstream_error: '模型服务异常，请稍后重试。',
  worker_error: '转发服务出现异常，请稍后重试。',
}

/** 上游 HTTP 状态码 → 内部错误码 */
function statusToCode(status: number): string {
  if (status === 400 || status === 422) return 'bad_request'
  if (status === 401) return 'invalid_api_key'
  if (status === 402) return 'insufficient_balance'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'model_not_found'
  if (status === 408) return 'upstream_timeout'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'upstream_error'
  return 'upstream_error'
}

/**
 * 脱敏：确保 API Key 与 Bearer Token 不会出现在返回给浏览器的内容中。
 * 同时截断过长的上游错误信息。
 */
function scrub(text: string, apiKey: string): string {
  let output = text
  if (apiKey) output = output.split(apiKey).join('[已隐藏]')
  output = output.replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
  output = output.replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer ***')
  return output.slice(0, 500)
}

// ---------------------------------------------------------------- CORS

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/** 校验请求来源是否在白名单内；支持 *.example.com 形式匹配子域 */
function isOriginAllowed(origin: string, env: Env): boolean {
  if (!origin) return false

  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  // 必须是纯 origin（不带路径、查询串），避免绕过
  if (parsed.origin !== origin) return false

  return allowedOrigins(env).some((entry) => {
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1)
      return parsed.protocol === 'https:' && parsed.hostname.endsWith(suffix)
    }
    return entry === origin
  })
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

// ---------------------------------------------------------------- 响应工具

const BASE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

function jsonResponse(
  body: unknown,
  status: number,
  origin: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      ...(origin ? corsHeaders(origin) : {}),
      ...extraHeaders,
    },
  })
}

function jsonError(
  status: number,
  code: string,
  message: string,
  origin: string,
  detail?: string,
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
        status,
        ...(detail ? { detail } : {}),
      },
    },
    status,
    origin,
  )
}

function errorFor(status: number, code: string, origin: string, detail?: string): Response {
  return jsonError(status, code, ERROR_TEXT[code] ?? ERROR_TEXT.worker_error, origin, detail)
}

// ---------------------------------------------------------------- 请求校验

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 校验 Base URL 并拼出 /chat/completions 地址。
 * 只允许 https、只允许白名单 origin、禁止 URL 内携带凭据 / 查询串 / 路径穿越。
 */
function buildUpstreamUrl(rawBaseUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(rawBaseUrl)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:') return null
  if (parsed.username || parsed.password) return null
  if (parsed.search || parsed.hash) return null
  if (!ALLOWED_BASE_URL_ORIGINS.includes(parsed.origin)) return null

  const path = parsed.pathname.replace(/\/+$/, '')
  if (path.includes('..')) return null

  return `${parsed.origin}${path}/chat/completions`
}

function validatePayload(input: unknown): ValidationResult {
  if (!isRecord(input)) {
    return { ok: false, message: '请求体必须是 JSON 对象。' }
  }

  const { apiKey, model, messages, temperature, maxTokens, stream, baseUrl } = input

  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    return { ok: false, message: '缺少 apiKey。' }
  }
  if (apiKey.length > MAX_API_KEY_CHARS) {
    return { ok: false, message: 'apiKey 长度异常。' }
  }
  // 拒绝控制字符，避免请求头注入
  if (/[\u0000-\u001f\u007f]/.test(apiKey)) {
    return { ok: false, message: 'apiKey 含有非法字符。' }
  }

  if (typeof model !== 'string' || model.trim().length === 0) {
    return { ok: false, message: '缺少 model。' }
  }
  if (model.length > MAX_MODEL_CHARS || /[\u0000-\u001f\u007f]/.test(model)) {
    return { ok: false, message: 'model 不合法。' }
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, message: 'messages 不能为空。' }
  }
  if (messages.length > MAX_MESSAGES) {
    return { ok: false, message: `messages 最多 ${MAX_MESSAGES} 条。` }
  }

  const normalized: IncomingMessage[] = []
  for (const item of messages) {
    if (!isRecord(item)) return { ok: false, message: 'messages 中存在非法项。' }
    const { role, content } = item
    if (typeof role !== 'string' || !ALLOWED_ROLES.includes(role)) {
      return { ok: false, message: 'messages 中存在不支持的 role。' }
    }
    if (typeof content !== 'string' || content.length === 0) {
      return { ok: false, message: 'messages 中存在空内容。' }
    }
    if (content.length > MAX_MESSAGE_CHARS) {
      return { ok: false, message: '单条消息内容过长。' }
    }
    normalized.push({ role, content })
  }

  let normalizedTemperature: number | undefined
  if (temperature !== undefined) {
    if (typeof temperature !== 'number' || !Number.isFinite(temperature)) {
      return { ok: false, message: 'temperature 必须是数字。' }
    }
    if (temperature < 0 || temperature > 2) {
      return { ok: false, message: 'temperature 需要在 0~2 之间。' }
    }
    normalizedTemperature = temperature
  }

  let normalizedMaxTokens: number | undefined
  if (maxTokens !== undefined) {
    if (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens <= 0) {
      return { ok: false, message: 'maxTokens 必须是正整数。' }
    }
    if (maxTokens > 32_000) {
      return { ok: false, message: 'maxTokens 过大。' }
    }
    normalizedMaxTokens = maxTokens
  }

  if (baseUrl !== undefined && typeof baseUrl !== 'string') {
    return { ok: false, message: 'baseUrl 必须是字符串。' }
  }

  return {
    ok: true,
    value: {
      apiKey: apiKey.trim(),
      baseUrl: typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : DEFAULT_BASE_URL,
      model: model.trim(),
      messages: normalized,
      temperature: normalizedTemperature,
      maxTokens: normalizedMaxTokens,
      stream: typeof stream === 'boolean' ? stream : DEFAULT_STREAM,
    },
  }
}

/** 从上一次上游错误响应中提取可读信息（不包含 Key） */
function extractUpstreamMessage(rawBody: string): string {
  try {
    const parsed: unknown = JSON.parse(rawBody)
    if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string') {
      return parsed.error.message
    }
    if (isRecord(parsed) && typeof parsed.message === 'string') {
      return parsed.message
    }
  } catch {
    // 非 JSON，按纯文本处理
  }
  return rawBody.slice(0, 300)
}

// ---------------------------------------------------------------- 主流程

async function handleChat(request: Request, origin: string): Promise<Response> {
  // 1) 正文大小限制（先看 Content-Length，再按实际字节数复核）
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return errorFor(413, 'payload_too_large', origin)
  }

  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return errorFor(413, 'payload_too_large', origin)
  }

  // 2) JSON 解析与字段校验
  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(rawBody)
  } catch {
    return errorFor(400, 'invalid_json', origin)
  }

  const validation = validatePayload(parsedBody)
  if (!validation.ok) {
    return jsonError(400, 'invalid_request', ERROR_TEXT.invalid_request, origin, validation.message)
  }

  const payload = validation.value

  // 3) Base URL 白名单（SSRF 防护：只允许白名单 origin）
  const upstreamUrl = buildUpstreamUrl(payload.baseUrl)
  if (!upstreamUrl) {
    return errorFor(400, 'base_url_not_allowed', origin)
  }

  // 4) 转发（流式请求透传 ReadableStream，不缓冲）
  const upstreamBody: Record<string, unknown> = {
    model: payload.model,
    messages: payload.messages,
    stream: payload.stream,
  }
  if (payload.temperature !== undefined) upstreamBody.temperature = payload.temperature
  if (payload.maxTokens !== undefined) upstreamBody.max_tokens = payload.maxTokens

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)

  // 客户端断开（关闭页面、点击「停止生成」）时同步中断上游请求，
  // 避免为已经不需要的回答继续消耗用户的 token。
  const abortOnClientDisconnect = () => controller.abort()
  request.signal.addEventListener('abort', abortOnClientDisconnect, { once: true })

  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: payload.stream ? 'text/event-stream' : 'application/json',
        Authorization: `Bearer ${payload.apiKey}`,
      },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timer)
    const aborted = error instanceof Error && error.name === 'AbortError'
    return errorFor(
      aborted ? 504 : 502,
      aborted ? 'upstream_timeout' : 'upstream_unreachable',
      origin,
    )
  }

  // 5) 上游返回错误：统一转成友好错误结构（detail 已脱敏）
  if (!upstream.ok) {
    clearTimeout(timer)
    request.signal.removeEventListener('abort', abortOnClientDisconnect)
    const errorText = await upstream.text().catch(() => '')
    const code = statusToCode(upstream.status)
    return errorFor(upstream.status, code, origin, scrub(extractUpstreamMessage(errorText), payload.apiKey))
  }

  // 6) 非流式：回传上游 JSON
  if (!payload.stream) {
    try {
      const text = await upstream.text()
      clearTimeout(timer)
      request.signal.removeEventListener('abort', abortOnClientDisconnect)
      return new Response(text, {
        status: 200,
        headers: {
          ...BASE_HEADERS,
          'Content-Type': 'application/json; charset=utf-8',
          ...(origin ? corsHeaders(origin) : {}),
        },
      })
    } catch {
      clearTimeout(timer)
      request.signal.removeEventListener('abort', abortOnClientDisconnect)
      return errorFor(502, 'upstream_unreachable', origin)
    }
  }

  // 7) 流式：直接把上游 body 交给浏览器，边生成边下发，不做整体缓冲。
  //    连接已建立，超时定时器在此清理；客户端断开由 request.signal → controller.abort()
  //    传导到上游 fetch，运行时也会取消上游 body 的读取。
  //    注意：只透传 Content-Type，不能透传 Content-Encoding（body 已被 fetch 解压）。
  clearTimeout(timer)
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      'Content-Type': upstream.headers.get('Content-Type') ?? 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
      ...(origin ? corsHeaders(origin) : {}),
    },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') ?? ''
    const originAllowed = isOriginAllowed(origin, env)

    // CORS 预检：只对允许的来源返回放行头
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...BASE_HEADERS,
          ...(originAllowed ? corsHeaders(origin) : {}),
        },
      })
    }

    // 健康检查（便于部署后确认 Worker 是否可用）
    if (url.pathname === '/api/health') {
      if (request.method !== 'GET') return errorFor(405, 'method_not_allowed', origin)
      return jsonResponse(
        {
          ok: true,
          service: SERVICE_NAME,
          version: SERVICE_VERSION,
          allowedOrigins: allowedOrigins(env).length,
          upstreams: ALLOWED_BASE_URL_ORIGINS,
        },
        200,
        origin,
      )
    }

    if (url.pathname !== '/api/chat') {
      return errorFor(404, 'not_found', origin)
    }

    if (request.method !== 'POST') {
      return errorFor(405, 'method_not_allowed', origin)
    }

    // 来源校验：浏览器请求一定带 Origin；命中黑名单时仍然回显 CORS 头，
    // 让前端能读到这条可操作的错误提示（而不是一个无法定位的 CORS 报错）。
    // 这里不涉及任何数据外泄：仅返回错误说明。
    if (origin && !originAllowed) {
      return errorFor(403, 'origin_not_allowed', origin)
    }

    try {
      return await handleChat(request, origin)
    } catch {
      // 兜底：不向客户端暴露内部细节，也不打印任何请求内容
      return errorFor(500, 'worker_error', origin)
    }
  },
} satisfies ExportedHandler<Env>
