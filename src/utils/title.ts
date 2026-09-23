/**
 * 从用户第一条消息生成简短会话标题（不额外调用模型）。
 * 策略：去掉礼貌用语与「设计/生成 + 量词」开头，再按长度截断。
 */
const LEADING_NOISE = /^(?:请|请你|帮我|帮忙|麻烦|我想|我要|你能|你能不能|能不能|可以帮我|可以|给我)+/g

/** 「设计一节 / 生成一套 / 出两道」这类动词 + 量词开头 */
const LEADING_ACTION =
  /^(?:设计|生成|写|编写|出|做|准备|来)(?:一节|一堂|一份|一套|一个|一道|两张|两篇|个|节|套|份)?/g

const QUOTE_CHARS = /[《》「」『』“”‘’"'`]/g

export function createConversationTitle(text: string, maxLength = 20): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return '新对话'

  let base = normalized.replace(LEADING_NOISE, '').trim()
  base = base.replace(LEADING_ACTION, '').replace(QUOTE_CHARS, '').trim()

  // 全部被裁掉时退回原文，避免出现空标题
  if (!base) base = normalized.replace(QUOTE_CHARS, '').trim()
  if (!base) return '新对话'

  return base.length <= maxLength ? base : `${base.slice(0, maxLength)}…`
}
