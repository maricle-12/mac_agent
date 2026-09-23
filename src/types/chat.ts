/** 对话角色。system 只用于调用模型时动态插入，不写入本地历史。 */
export type ChatRole = 'system' | 'user' | 'assistant'

/** 本地存储与 UI 使用的消息结构 */
export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: number
  /** 出错时标记，便于 UI 展示错误样式并支持重新生成 */
  error?: string
}

/** 发给模型 API 的最小消息结构 */
export interface ApiMessage {
  role: ChatRole
  content: string
}

/** 浏览器 -> Worker 的请求体 */
export interface ChatRequest {
  apiKey: string
  baseUrl: string
  model: string
  messages: ApiMessage[]
  temperature?: number
  maxTokens?: number
}

/** 会话运行状态机 */
export type ChatStatus = 'idle' | 'sending' | 'streaming' | 'error' | 'aborted'

/** API 连接状态 */
export type ApiConnectionStatus = 'unconfigured' | 'unknown' | 'testing' | 'connected' | 'failed'
