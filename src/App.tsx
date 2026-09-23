import { appConfig } from '@/config/app'
import { apiConfig } from '@/config/api'

/**
 * 阶段 1：项目骨架占位页。
 * 仅用于验证 React + TypeScript + Tailwind + Vite 全链路可用，
 * 完整聊天界面将在阶段 2 实现。
 */
export default function App() {
  return (
    <div className="flex h-full bg-canvas text-ink">
      <aside className="hidden w-64 shrink-0 flex-col gap-4 border-r border-line bg-sidebar p-4 md:flex">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-xs font-semibold text-white">
            {appConfig.logo}
          </span>
          <span className="text-sm font-semibold">{appConfig.appName}</span>
        </div>
        <div className="rounded-lg border border-line bg-surface p-3 text-xs text-ink-soft">
          侧边栏占位（阶段 2 实现完整结构）
        </div>
      </aside>

      <main className="flex flex-1 items-center justify-center overflow-auto p-6">
        <section className="w-full max-w-lg rounded-card border border-line bg-surface p-6 shadow-sm">
          <h1 className="text-lg font-semibold">阶段 1 骨架已就绪</h1>
          <p className="mt-1 text-sm text-ink-soft">{appConfig.appSubtitle}</p>

          <dl className="mt-5 space-y-2 text-sm">
            <div className="flex justify-between gap-4 border-b border-line-soft pb-2">
              <dt className="text-ink-muted">前端框架</dt>
              <dd>React 19 + Vite + TypeScript</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-line-soft pb-2">
              <dt className="text-ink-muted">样式方案</dt>
              <dd>Tailwind CSS v4</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-line-soft pb-2">
              <dt className="text-ink-muted">默认模型</dt>
              <dd>
                {apiConfig.defaultProvider} / {apiConfig.defaultModel}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">转发端点</dt>
              <dd className="truncate font-mono text-xs">{apiConfig.endpoint}</dd>
            </div>
          </dl>

          <p className="mt-5 rounded-lg bg-brand-soft p-3 text-xs text-ink-soft">
            API Key 仅由用户在「API 设置」中输入，仅保存在本机浏览器，不写入源码、不上传云端。
          </p>
        </section>
      </main>
    </div>
  )
}
