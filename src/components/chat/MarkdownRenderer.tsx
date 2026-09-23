import { lazy, Suspense } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { markdownComponents } from '@/components/chat/markdownComponents'
import { normalizeMarkdown } from '@/utils/markdown'

/**
 * Markdown 渲染器。
 *
 * 支持：标题 / 粗体 / 列表 / 表格 / 引用 / 代码块（含复制）/ 链接，
 * 以及数学公式（行内 `$...$`、块级 `$$` 独占一行）。
 *
 * 体积处理：公式相关的依赖（remark-math + rehype-katex + KaTeX）体积很大，
 * 因此拆成独立分块并**只在内容里真的出现 `$` 时**才按需加载；
 * 加载期间先用基础渲染兜底，用户不会看到空白。
 *
 * 正文排版样式集中在 index.css 的 .md-body 中。
 */
const loadMathMarkdown = () => import('@/components/chat/MathMarkdown')
const MathMarkdown = lazy(loadMathMarkdown)

/**
 * 空闲时预取公式分块。
 *
 * 懒加载保证了首屏体积（443 kB / gzip 137 kB，不含 KaTeX 的 274 kB），
 * 但代价是：如果刷新后第一眼就要渲染带公式的历史消息，
 * 用户会先看到一瞬间的原始 `$$...$$` 再变成公式。
 * 因此在浏览器空闲时后台预取一次 —— 首屏不受影响，
 * 真出现公式时（尤其是在线部署、网络较慢时）就已经在缓存里了。
 */
function prefetchMathChunk(): void {
  const idle = window.requestIdleCallback
  if (typeof idle === 'function') {
    idle(() => void loadMathMarkdown(), { timeout: 4000 })
    return
  }
  window.setTimeout(() => void loadMathMarkdown(), 3000)
}

prefetchMathChunk()

function BaseMarkdown({ content }: { content: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </Markdown>
  )
}

export interface MarkdownRendererProps {
  content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const normalized = normalizeMarkdown(content)

  if (!normalized.includes('$')) {
    return (
      <div className="md-body">
        <BaseMarkdown content={normalized} />
      </div>
    )
  }

  return (
    <div className="md-body">
      <Suspense fallback={<BaseMarkdown content={normalized} />}>
        <MathMarkdown content={normalized} />
      </Suspense>
    </div>
  )
}
