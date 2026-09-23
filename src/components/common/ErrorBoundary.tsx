import { Component, type ErrorInfo, type ReactNode } from 'react'

import { appConfig } from '@/config/app'

interface ErrorBoundaryProps {
  children: ReactNode
  /** 自定义兜底 UI；不传则使用整页兜底 */
  fallback?: (error: Error, reset: () => void) => ReactNode
  /** 轻量模式：用在小范围（例如单条消息的 Markdown 渲染）出错时的内联兜底 */
  inline?: boolean
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * 错误边界：任何渲染期异常都不会让整页白屏。
 *
 * 注意：React 的错误边界只能捕获「渲染期」异常，
 * 事件回调与异步流程里的异常在 useChat / chatApi 中已各自处理。
 * 这里也刻意不打印任何内容（日志中可能含有用户数据）。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // 有意不写 console：日志中可能包含用户输入的内容
  }

  private readonly reset = () => {
    this.setState({ error: null })
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.fallback) return this.props.fallback(error, this.reset)

    if (this.props.inline) {
      return (
        <div className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-[13px] text-danger">
          这条消息渲染失败，内容可能含有不支持的格式。
        </div>
      )
    }

    return (
      <div className="h-full overflow-y-auto bg-canvas p-6">
        <div className="flex min-h-full items-center justify-center">
          <div className="w-full max-w-md rounded-card border border-line bg-surface p-6 text-center">
            <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-brand text-sm font-semibold text-white">
              {appConfig.logo}
            </span>
            <h1 className="mt-4 text-base font-semibold text-ink">页面出现了意外错误</h1>
            <p className="mt-1.5 text-[13px] leading-6 text-ink-soft">
              你的聊天记录仍然安全地保存在本机浏览器中，重新加载不会丢失。
            </p>

            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-lg bg-brand px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-hover"
            >
              重新加载页面
            </button>

            <details className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-left text-[12px] text-ink-soft">
              <summary className="cursor-pointer select-none">查看技术详情</summary>
              <pre className="mt-1.5 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all text-ink-muted">
                {error.message}
              </pre>
            </details>
          </div>
        </div>
      </div>
    )
  }
}
