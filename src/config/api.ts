/**
 * API 相关配置。
 *
 * 注意：这里永远不存放 API Key。
 * 用户 Key 由用户在「API 设置」中输入，仅存于浏览器（sessionStorage / 可选 localStorage）。
 */

/** 支持的模型服务（第一版仅 DeepSeek，架构上保留 OpenAI-Compatible 扩展位） */
export const apiProviders = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    /** 该服务商推荐的候选模型，用于设置页下拉提示 */
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
] as const

export type ApiProviderId = (typeof apiProviders)[number]['id']

/** Worker 转发端点：优先取环境变量，缺失时回退到同源 /api/chat */
export const apiEndpoint: string = import.meta.env.VITE_API_ENDPOINT?.trim() || '/api/chat'

export const apiConfig = {
  endpoint: apiEndpoint,
  /** 默认服务商 */
  defaultProvider: 'deepseek' as ApiProviderId,
  /** 默认 Base URL（不带结尾斜杠） */
  defaultBaseUrl: 'https://api.deepseek.com',
  /** 默认模型 */
  defaultModel: 'deepseek-chat',
  /** 单次请求最多携带的历史消息条数（不含 system prompt） */
  maxContextMessages: 20,
  /** 默认采样温度 */
  defaultTemperature: 0.7,
  /** 生成上限（0 表示不限制，交给服务端默认） */
  maxTokens: 0,
  /** 测试连接时的超时时间（毫秒） */
  testTimeoutMs: 20_000,
  /**
   * 流式输出空闲超时（毫秒）：超过该时间没有收到任何增量就中断本次生成，
   * 避免流挂死后用户一直看到「正在思考」。
   */
  streamIdleTimeoutMs: 60_000,
} as const
