import { ConversationItem } from '@/components/history/ConversationItem'
import type { Conversation } from '@/types/conversation'

export interface ConversationListProps {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onRename: (conversation: Conversation) => void
  onDelete: (conversation: Conversation) => void
}

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onRename,
  onDelete,
}: ConversationListProps) {
  if (conversations.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-ink-muted">
        还没有对话记录，点击上方「新建对话」开始。
      </p>
    )
  }

  return (
    <div className="space-y-0.5">
      {conversations.map((conversation) => (
        <ConversationItem
          key={conversation.id}
          conversation={conversation}
          active={conversation.id === activeId}
          onSelect={() => onSelect(conversation.id)}
          onRename={() => onRename(conversation)}
          onDelete={() => onDelete(conversation)}
        />
      ))}
    </div>
  )
}
