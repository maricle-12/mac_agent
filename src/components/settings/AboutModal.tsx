import { useEffect, useState } from 'react'

import { Modal } from '@/components/common/Modal'
import { Button } from '@/components/common/Button'
import { appConfig } from '@/config/app'

export interface AboutModalProps {
  open: boolean
  onClose: () => void
}

const points = [
  '无需安装、无需注册、无需登录，打开即可使用。',
  '模型由你自己提供的 API Key 调用，费用由你的账户承担。',
  '聊天记录只保存在本机浏览器（IndexedDB），不会上传到任何服务器。',
  'API Key 默认仅保存在当前会话，只有你主动勾选「在此设备记住」才会持久保存。',
  '本应用不建立账号系统，也不保存任何云端聊天记录。',
]

/** 便携版（本地服务）信息；非便携版（例如网页部署）探测不到，不显示退出按钮 */
interface LocalInfo {
  port?: number
  portableVersion?: string
  platform?: string
  relaunchHint?: string
}

export function AboutModal({ open, onClose }: AboutModalProps) {
  const [local, setLocal] = useState<LocalInfo | null>(null)
  const [quitting, setQuitting] = useState(false)
  const [quit, setQuit] = useState(false)

  // 只在便携版（Windows 免安装版 / macOS 应用包）里显示「退出智能体」：
  // 探测本地启动器提供的接口。网页部署环境下这个接口不存在（404），界面与原来完全一致。
  useEffect(() => {
    if (!open || local) return
    let cancelled = false
    fetch('/api/local/info', { headers: { Accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        if (cancelled) return
        if (data && typeof data === 'object' && (data as { local?: unknown }).local === true) {
          setLocal(data as LocalInfo)
        }
      })
      .catch(() => {
        /* 不是便携版，忽略 */
      })
    return () => {
      cancelled = true
    }
  }, [open, local])

  const handleQuit = async () => {
    setQuitting(true)
    try {
      await fetch('/api/local/shutdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    } catch {
      // 本地服务关闭时连接会被断开，属于正常现象
    }
    setQuitting(false)
    setQuit(true)
  }

  return (
    <Modal
      open={open}
      title={`关于 ${appConfig.appName}`}
      onClose={onClose}
      panelClassName="sm:max-w-[460px]"
      footer={
        <>
          {local && !quit ? (
            <Button
              variant="ghost"
              className="mr-auto text-danger hover:bg-danger/5"
              disabled={quitting}
              onClick={() => void handleQuit()}
            >
              {quitting ? '正在退出…' : '退出智能体'}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </>
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

      {local ? (
        <div className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2.5">
          <p className="text-[12px] font-medium text-ink">本机数据</p>
          <p className="mt-1 text-[12px] leading-5 text-ink-soft">
            聊天记录保存在本机数据库（不随浏览器清理而丢失），API Key 保存在本机配置中，
            都不会上传到任何服务器。可以导出一份聊天数据备份（不含 API Key）。
          </p>
          <a
            href="/api/local/export"
            download
            className="mt-2 inline-flex items-center rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
          >
            导出本地数据
          </a>
        </div>
      ) : null}

      {quit ? (
        <p className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-[12px] leading-5 text-ink-soft">
          {local?.platform === 'darwin'
            ? '本地服务已关闭，现在可以关闭此页面了。下次使用请在「启动台」或「应用程序」里再次打开「AI 教育智能体」。'
            : `本地服务已关闭，现在可以关闭此页面了。下次使用请再次双击「${local?.relaunchHint ?? '启动智能体.exe'}」。`}
        </p>
      ) : null}
    </Modal>
  )
}
