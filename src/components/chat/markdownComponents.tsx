import type { Components } from 'react-markdown'

import { CodeBlock } from '@/components/chat/CodeBlock'

/**
 * react-markdown 的自定义渲染组件。
 *
 * 抽出来给「基础渲染」与「含公式渲染」共用：
 * 两者唯一的区别是 remark/rehype 插件不同（数学插件体积很大，见 MarkdownRenderer）。
 */
export const markdownComponents: Components = {
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
      <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[0.88em] text-ink" {...rest}>
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
