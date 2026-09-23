import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from '@/App'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import '@/index.css'

// KaTeX 的样式在 MathMarkdown（懒加载分块）里引入：
// 没有公式的对话不需要下载它，见 MarkdownRenderer 的说明。

const container = document.getElementById('root')

if (!container) {
  throw new Error('未找到 #root 挂载节点，请检查 index.html')
}

createRoot(container).render(
  <StrictMode>
    {/* 兜底：任何渲染异常都不应该让用户看到整页白屏 */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
