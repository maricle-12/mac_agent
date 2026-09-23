import { Modal } from '@/components/common/Modal'
import { Button } from '@/components/common/Button'
import { appConfig } from '@/config/app'

export interface AboutModalProps {
  open: boolean
  onClose: () => void
}

const points = [
  '无需安装、无需注册、无需登录，打开网页即可使用。',
  '模型由你自己提供的 API Key 调用，费用由你的账户承担。',
  '聊天记录只保存在本机浏览器（IndexedDB），不会上传到任何服务器。',
  'API Key 默认仅保存在当前会话，只有你主动勾选「在此设备记住」才会持久保存。',
  '本应用不建立账号系统，也不保存任何云端聊天记录。',
]

export function AboutModal({ open, onClose }: AboutModalProps) {
  return (
    <Modal
      open={open}
      title={`关于 ${appConfig.appName}`}
      onClose={onClose}
      panelClassName="sm:max-w-[460px]"
      footer={
        <Button variant="secondary" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-sm font-semibold text-white">
          {appConfig.logo}
        </span>
        <div>
          <p className="text-sm font-medium text-ink">{appConfig.appName}</p>
          <p className="text-[12px] text-ink-muted">
            {appConfig.appSubtitle} · v{appConfig.version}
          </p>
        </div>
      </div>

      <p className="mt-4 text-[13px] leading-6 text-ink-soft">{appConfig.description}</p>

      <ul className="mt-4 space-y-2">
        {points.map((point) => (
          <li key={point} className="flex gap-2 text-[13px] leading-6 text-ink-soft">
            <span className="mt-2.5 size-1 shrink-0 rounded-full bg-ink-muted" />
            {point}
          </li>
        ))}
      </ul>
    </Modal>
  )
}
