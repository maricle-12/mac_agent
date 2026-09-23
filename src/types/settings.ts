import type { ApiProviderId } from '@/config/api'

/** 非敏感 API 设置，存 localStorage */
export interface ApiSettings {
  provider: ApiProviderId | string
  baseUrl: string
  model: string
  /** 用户是否主动勾选「在此设备记住 API Key」 */
  rememberApiKey: boolean
}

/** API Key 的存储位置 */
export type ApiKeyStorage = 'session' | 'local' | 'none'

/** 通用 UI 偏好，存 localStorage */
export interface UiPreferences {
  /** 当前模式 */
  mode: 'teacher' | 'student'
  /** 当前选中的会话 id */
  activeConversationId: string | null
}
