import Markdown, { type Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import { CodeBlock } from '@/components/chat/CodeBlock'
import { normalizeMarkdown } from '@/utils/markdown'

/**
 * Markdown 渲染器。
 * - 支持标题 / 粗体 / 列表 / 表格 / 引用 / 代码块 / 链接
 * - 数学公式：remark-math + rehype-katex（行内 $...$，块级 $$...$$）
 * - 正文排版样式集中在 index.css 的 .md-body 中
 */
const components: Components = {
  // 代码块容器由 CodeBlock 自己提供，这里去掉默认的 <pre> 包裹
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children, ...rest }) => {
    const match = /language-(\w+)/.exec(className ?? '')
    const raw = String(children)
    const isBlock = Boolean(match) || raw.includes('\n')

    if (isBlock) {
      return <CodeBlock language={match?.[1]} code={raw.replace(/\n$/, '')} />
    }

    return (
      <code
        className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[0.88em] text-ink"
        {...rest}
      >
        {children}
      </code>
    )
  },
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-line bg-canvas px-3 py-2 text-left text-[13px] font-medium text-ink">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-line-soft px-3 py-2 align-top text-[13px]">{children}</td>
  ),
}

export interface MarkdownRendererProps {
  content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="md-body">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {normalizeMarkdown(content)}
      </Markdown>
    </div>
  )
}
