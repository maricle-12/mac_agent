/**
 * 把模型输出的单行块级公式规范化为 remark-math 认可的多行形式。
 *
 * remark-math 只有在 `$$` 独占一行时才生成块级公式（display math），
 * 同行写法 `$$...$$` 会被解析成行内公式。DeepSeek 等模型经常输出同行写法，
 * 因此这里统一转换，避免公式被渲染成行内样式。
 */
const SINGLE_LINE_DISPLAY_MATH = /^[ \t]*\$\$[ \t]*(\S(?:[^\n]*\S)?)[ \t]*\$\$[ \t]*$/gm

export function normalizeMarkdown(markdown: string): string {
  if (!markdown.includes('$$')) return markdown
  return markdown.replace(SINGLE_LINE_DISPLAY_MATH, (_match, body: string) => `$$\n${body}\n$$`)
}
