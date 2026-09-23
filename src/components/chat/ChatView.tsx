import { ChatInput } from '@/components/chat/ChatInput'
import { EmptyState } from '@/components/chat/EmptyState'
import { MessageList } from '@/components/chat/MessageList'
import { appConfig } from '@/config/app'
import type { ChatStatus } from '@/types/chat'
import type { AgentMode, Conversation } from '@/types/conversation'

export interface ChatViewProps {
  conversation: Conversation | null
  mode: AgentMode
  status: ChatStatus
  input: string
  isGenerating: boolean
  /** 尚未配置 API Key，空状态显示首次使用引导 */
  needsApiKey: boolean
  onInputChange: (value: string) => void
  onSend: (text?: string) => void
  onStop: () => void
  onRegenerate: () => void
  onOpenSettings: () => void
}

export function ChatView({
  conversation,
  mode,
  status,
  input,
  isGenerating,
  needsApiKey,
  onInputChange,
  onSend,
  onStop,
  onRegenerate,
  onOpenSettings,
}: ChatViewProps) {
  const messages = conversation?.messages ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex min-h-0 flex-1 flex-col">
        {messages.length === 0 ? (
          <EmptyState
            mode={mode}
            needsApiKey={needsApiKey}
            onPickPrompt={onInputChange}
            onOpenSettings={onOpenSettings}
          />
        ) : (
          <MessageList
            messages={messages}
            status={status}
            logo={appConfig.logo}
            onRegenerate={onRegenerate}
          />
        )}
      </div>

      <ChatInput
        mode={mode}
        value={input}
        onChange={onInputChange}
        onSend={() => onSend()}
        onStop={onStop}
        isGenerating={isGenerating}
      />
    </div>
  )
}
