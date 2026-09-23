import Markdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import { markdownComponents } from '@/components/chat/markdownComponents'

// KaTeX 的样式只在这个（懒加载的）分块里引入，
// 因此没有公式的对话根本不会下载 KaTeX 的 CSS 与字体。
import 'katex/dist/katex.min.css'

export interface MathMarkdownProps {
  content: string
}

/**
 * 含数学公式的 Markdown 渲染（remark-math + rehype-katex）。
 *
 * 这个模块会被 `React.lazy` 动态加载：KaTeX 体积很大（约 270 kB JS + 字体），
 * 只有回答里真的出现 `$` 时才需要它。
 */
export default function MathMarkdown({ content }: MathMarkdownProps) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={markdownComponents}
    >
      {content}
    </Markdown>
  )
}
