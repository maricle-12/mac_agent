import { appConfig } from '@/config/app'
import { emptyStateGreeting, quickPrompts } from '@/config/quickPrompts'
import type { AgentMode } from '@/types/conversation'

export interface EmptyStateProps {
  mode: AgentMode
  /** 尚未配置 API Key 时展示首次使用引导 */
  needsApiKey: boolean
  onPickPrompt: (prompt: string) => void
  onOpenSettings: () => void
}

export function EmptyState({ mode, needsApiKey, onPickPrompt, onOpenSettings }: EmptyStateProps) {
  const prompts = quickPrompts[mode]

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[860px] flex-col justify-center px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-sm font-semibold text-white">
            {appConfig.logo}
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink">{appConfig.appName}</h2>
            <p className="text-[13px] text-ink-soft">{appConfig.appSubtitle}</p>
          </div>
        </div>

        {needsApiKey ? (
          <section className="mt-7 rounded-card border border-brand/25 bg-brand-soft/50 p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-ink">
              欢迎使用 {appConfig.appName}
            </h3>
            <p className="mt-1 text-[13px] leading-6 text-ink-soft">
              使用本应用需要您自己的模型 API，当前支持：
              <span className="font-medium text-ink"> DeepSeek</span>。
            </p>
            <button
              type="button"
              onClick={onOpenSettings}
              className="mt-3.5 rounded-lg bg-brand px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-hover"
            >
              配置 DeepSeek API
            </button>
            <p className="mt-2.5 text-[12px] text-ink-muted">
              您的 API Key 不会保存到本应用的云端数据库。
            </p>
          </section>
        ) : null}

        <h3 className="mt-8 text-xl font-semibold text-ink sm:text-2xl">
          {emptyStateGreeting[mode]}
        </h3>

        <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
          {prompts.map((prompt) => (
            <button
              key={prompt.id}
              type="button"
              onClick={() => onPickPrompt(prompt.prompt)}
              className="rounded-card border border-line bg-surface p-3.5 text-left transition-colors hover:border-brand/40 hover:bg-brand-soft/40"
            >
              <span className="block text-sm font-medium text-ink">{prompt.title}</span>
              <span className="mt-0.5 block text-[12px] leading-5 text-ink-soft">
                {prompt.description}
              </span>
            </button>
          ))}
        </div>

        <p className="mt-6 text-[12px] text-ink-muted">
          点击卡片会把对应需求填入输入框，你可以再补充学段、年级、学科后发送。
        </p>
      </div>
    </div>
  )
}
