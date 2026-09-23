import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from '@/App'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import '@/index.css'
import 'katex/dist/katex.min.css'

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
