/**
 * Worker 侧配置与安全边界。
 * 修改白名单后需要重新部署 Worker。
 */

/**
 * 允许作为上游的 API 服务 origin 白名单（SSRF 防护）。
 * Worker 只会向这些 origin 发起请求，客户端无法让它访问任意地址。
 * 未来接入其他 OpenAI-Compatible 服务时在这里追加。
 */
export const ALLOWED_BASE_URL_ORIGINS: readonly string[] = ['https://api.deepseek.com']

/** 未传 baseUrl 时使用的默认值 */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com'

/** 请求正文大小上限（字节） */
export const MAX_BODY_BYTES = 512 * 1024

/** 单次请求最多携带的消息条数 */
export const MAX_MESSAGES = 60

/** 单条消息的最大字符数 */
export const MAX_MESSAGE_CHARS = 24_000

/** API Key 最大长度（异常超长输入直接拒绝） */
export const MAX_API_KEY_CHARS = 256

/** 模型名最大长度 */
export const MAX_MODEL_CHARS = 120

/** 上游请求超时（毫秒）；流式响应建立连接后即由客户端断开来取消 */
export const UPSTREAM_TIMEOUT_MS = 300_000

/** 未显式指定时是否使用流式返回 */
export const DEFAULT_STREAM = true

/** 允许的消息角色 */
export const ALLOWED_ROLES: readonly string[] = ['system', 'user', 'assistant']

/** 服务标识，用于 /api/health */
export const SERVICE_NAME = 'ai-edu-agent-api'
export const SERVICE_VERSION = '0.1.0'
