import { useCallback, useEffect, useState } from 'react'

import { ChatView } from '@/components/chat/ChatView'
import { Button } from '@/components/common/Button'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Modal } from '@/components/common/Modal'
import { AppLayout } from '@/components/layout/AppLayout'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { AboutModal } from '@/components/settings/AboutModal'
import { ApiSettingsModal } from '@/components/settings/ApiSettingsModal'
import { useApiSettings } from '@/hooks/useApiSettings'
import { useChat } from '@/hooks/useChat'
import { useConversations } from '@/hooks/useConversations'
import { loadPreferences, savePreferences } from '@/services/storage'
import type { ApiConnectionStatus } from '@/types/chat'
import type { AgentMode, Conversation } from '@/types/conversation'
import type { ApiSettings } from '@/types/settings'

const modeLabel: Record<AgentMode, string> = { teacher: '教师模式', student: '学生模式' }

/**
 * 组装层：只负责状态编排与弹窗调度，具体 UI 与业务逻辑在各自的组件 / Hook 中。
 *
 * 阶段 3：API 设置与 Key 已接入浏览器本地存储（sessionStorage / localStorage 分离）。
 * 阶段 7 接入真实流式回答，阶段 9 / 10 接入 IndexedDB 会话持久化。
 */
export default function App() {
  const [mode, setMode] = useState<AgentMode>(() => loadPreferences().mode)
  const store = useConversations(mode)
  const api = useApiSettings()
  const chat = useChat({ store, mode })

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [clearApiOpen, setClearApiOpen] = useState(false)

  const [pendingMode, setPendingMode] = useState<AgentMode | null>(null)
  const [renaming, setRenaming] = useState<Conversation | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<Conversation | null>(null)

  // 模式偏好写入 localStorage（非敏感项）
  useEffect(() => {
    savePreferences({ mode })
  }, [mode])

  const apiStatus: ApiConnectionStatus = api.configured ? 'unknown' : 'unconfigured'

  const switchMode = useCallback(
    (next: AgentMode) => {
      setMode(next)
      const active = store.active
      if (!active) return
      // 空会话直接改模式，避免历史记录里堆一堆空对话
      if (active.messages.length === 0) {
        store.updateMode(active.id, next)
        return
      }
      store.create(next)
    },
    [store],
  )

  const handleModeChange = (next: AgentMode) => {
    if (next === mode) return
    const active = store.active
    if (active && active.messages.length > 0) {
      setPendingMode(next)
      return
    }
    switchMode(next)
  }

  const handleSelectConversation = (id: string) => {
    store.select(id)
    const target = store.conversations.find((item) => item.id === id)
    if (target && target.mode !== mode) setMode(target.mode)
    setSidebarOpen(false)
  }

  const handleNewConversation = () => {
    store.create(mode)
    setSidebarOpen(false)
  }

  const handleOpenRename = (conversation: Conversation) => {
    setRenaming(conversation)
    setRenameValue(conversation.title)
  }

  const handleSaveSettings = (next: ApiSettings, nextApiKey: string) => {
    api.save(next, nextApiKey)
  }

  return (
    <>
      <AppLayout
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
        sidebar={
          <Sidebar
            mode={mode}
            conversations={store.conversations}
            activeId={store.activeId}
            onModeChange={handleModeChange}
            onNewConversation={handleNewConversation}
            onSelectConversation={handleSelectConversation}
            onRenameConversation={handleOpenRename}
            onDeleteConversation={setDeleting}
            onOpenSettings={() => {
              setSettingsOpen(true)
              setSidebarOpen(false)
            }}
            onOpenAbout={() => {
              setAboutOpen(true)
              setSidebarOpen(false)
            }}
          />
        }
        header={
          <Header
            mode={mode}
            modelName={api.settings.model}
            apiStatus={apiStatus}
            onOpenSidebar={() => setSidebarOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        }
      >
        <ChatView
          conversation={store.active}
          mode={mode}
          status={chat.status}
          input={chat.input}
          isGenerating={chat.isGenerating}
          needsApiKey={!api.configured}
          onInputChange={chat.setInput}
          onSend={() => void chat.send()}
          onStop={chat.stop}
          onRegenerate={() => void chat.regenerate()}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </AppLayout>

      <ApiSettingsModal
        open={settingsOpen}
        settings={api.settings}
        apiKey={api.apiKey}
        keyStorage={api.keyStorage}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
        onClearApiKey={() => setClearApiOpen(true)}
      />

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />

      <ConfirmDialog
        open={clearApiOpen}
        title="确定清除 API 配置吗？"
        description="将从本机浏览器（sessionStorage 与 localStorage）中删除已保存的 API Key，并把 Base URL 与模型恢复为默认值。"
        confirmText="清除"
        cancelText="取消"
        danger
        onConfirm={() => {
          api.clearAll()
          setClearApiOpen(false)
        }}
        onCancel={() => setClearApiOpen(false)}
      />

      <ConfirmDialog
        open={pendingMode !== null}
        title="切换模式将创建一个新对话"
        description={
          pendingMode
            ? `当前对话已有内容。切换后会新建一个${modeLabel[pendingMode]}对话，原对话仍保留在历史记录中。`
            : undefined
        }
        confirmText={pendingMode ? `新建${modeLabel[pendingMode]}对话` : '确定'}
        cancelText="取消"
        onConfirm={() => {
          if (pendingMode) switchMode(pendingMode)
          setPendingMode(null)
        }}
        onCancel={() => setPendingMode(null)}
      />

      <Modal
        open={renaming !== null}
        title="重命名对话"
        onClose={() => setRenaming(null)}
        panelClassName="sm:max-w-[400px]"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (renaming) store.rename(renaming.id, renameValue)
                setRenaming(null)
              }}
            >
              保存
            </Button>
          </>
        }
      >
        <input
          type="text"
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          maxLength={40}
          autoFocus
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand/60"
        />
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="确定删除此对话吗？"
        description={deleting ? `「${deleting.title}」将被永久删除，且无法恢复。` : undefined}
        confirmText="删除"
        cancelText="取消"
        danger
        onConfirm={() => {
          if (deleting) store.remove(deleting.id)
          setDeleting(null)
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}
