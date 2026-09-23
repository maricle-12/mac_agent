import type { ChatMessage } from './chat'

/** 智能体模式：教师 / 学生（未来可扩展更多 Agent） */
export type AgentMode = 'teacher' | 'student'

/** 一个完整会话（消息内联存储，便于 IndexedDB 单事务读写） */
export interface Conversation {
  id: string
  title: string
  mode: AgentMode
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

/** 侧边栏列表使用的轻量会话摘要（不含 messages，避免大对象读取） */
export interface ConversationSummary {
  id: string
  title: string
  mode: AgentMode
  createdAt: number
  updatedAt: number
  messageCount: number
}
