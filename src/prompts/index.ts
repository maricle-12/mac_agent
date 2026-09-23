import { OUTPUT_FORMAT_RULES } from './shared'
import { STUDENT_SYSTEM_PROMPT } from './student'
import { TEACHER_SYSTEM_PROMPT } from './teacher'

import type { AgentMode } from '@/types/conversation'

/**
 * Prompt 统一出口。
 *
 * 约定：前端组件不直接引用 Prompt 内容，一律通过 getSystemPrompt(mode) 获取，
 * 这样调整 Prompt 时不需要改动任何 UI 代码，新请求也会自动使用新版 Prompt。
 *
 * 未来扩展新 Agent（lessonPlan / examGenerator / errorAnalysis / research）时，
 * 在此处把 mode 放宽为联合类型并补上对应的 basePrompt 即可。
 */
export const basePrompts: Record<AgentMode, string> = {
  teacher: TEACHER_SYSTEM_PROMPT,
  student: STUDENT_SYSTEM_PROMPT,
}

/** 取得指定模式的完整 System Prompt（角色设定 + 通用输出格式规则） */
export function getSystemPrompt(mode: AgentMode): string {
  const base = basePrompts[mode] ?? TEACHER_SYSTEM_PROMPT
  return `${base.trim()}\n\n${OUTPUT_FORMAT_RULES}`
}

export { OUTPUT_FORMAT_RULES, STUDENT_SYSTEM_PROMPT, TEACHER_SYSTEM_PROMPT }
