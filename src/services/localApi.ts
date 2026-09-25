/**
 * 便携版本地服务接口（/api/local/*）。
 *
 * 只有在便携版（Windows 免安装 exe / macOS 应用包）里这些接口才存在：
 * 网页部署版访问 /api/local/info 会拿到 404，此时 detectLocal() 返回 null，
 * 前端自动回退到原来的浏览器存储行为。
 *
 * 安全约定：这里永远拿不到完整的 API Key，只能拿到 maskedApiKey。
 */

export interface LocalDatabaseInfo {
  path: string
  schemaVersion: number
  conversationCount: number
  migrationDone: boolean
}

export interface LocalInfo {
  local: true
  app: string
  version: string
  port: number
  pid: number
  /** 运行平台：'win32' | 'darwin' | …（用于显示正确的「如何再次启动」文案） */
  platform?: string
  /** 用户再次启动应用时需要双击/点击的对象名称 */
  relaunchHint?: string
  dataRoot: string
  database: LocalDatabaseInfo
  settings: { path: string; configured: boolean }
}

/** 本地服务返回的 API 配置（不含完整 Key） */
export interface ServerApiSettings {
  provider: string
  baseUrl: string
  model: string
  configured: boolean
  maskedApiKey: string
  keyUpdatedAt: number
  keyStorage: 'server'
}

export interface LocalTestResult {
  ok: boolean
  message: string
  detail?: string
  preview?: string
  model?: string
  totalTokens?: number
}

let infoPromise: Promise<LocalInfo | null> | null = null

/** 探测当前是否运行在便携版本地服务里（结果在页面生命周期内缓存） */
export function detectLocal(): Promise<LocalInfo | null> {
  if (!infoPromise) {
    infoPromise = fetch('/api/local/info', { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) return null
        const data: unknown = await response.json()
        if (data && typeof data === 'object' && (data as { local?: unknown }).local === true) {
          return data as LocalInfo
        }
        return null
      })
      .catch(() => null)
  }
  return infoPromise
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })

  const text = await response.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }

  if (!response.ok) {
    const error = body as { error?: { message?: string; detail?: string } } | null
    const message = error?.error?.message ?? `本地服务返回了异常响应（HTTP ${response.status}）。`
    throw new Error(message)
  }
  return body as T
}

// ---------------------------------------------------------------- 会话

export async function fetchConversations<T>(): Promise<T[]> {
  const body = await request<{ conversations: T[] }>('/api/local/conversations')
  return Array.isArray(body.conversations) ? body.conversations : []
}

export async function saveConversation<T>(conversation: T): Promise<void> {
  await request('/api/local/conversations', {
    method: 'POST',
    body: JSON.stringify({ conversation }),
  })
}

export async function deleteConversation(id: string): Promise<void> {
  await request(`/api/local/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function clearConversations(): Promise<void> {
  await request('/api/local/conversations', { method: 'DELETE' })
}

export async function importConversations<T>(conversations: T[]): Promise<{ imported: number; skipped: boolean }> {
  return request('/api/local/conversations/import', {
    method: 'POST',
    body: JSON.stringify({ conversations }),
  })
}

export async function completeMigration(): Promise<void> {
  await request('/api/local/migration/complete', { method: 'POST' })
}

// ---------------------------------------------------------------- 设置

export async function fetchServerSettings(): Promise<ServerApiSettings> {
  const body = await request<{ settings: ServerApiSettings }>('/api/local/settings')
  return body.settings
}

/**
 * 保存设置。
 * apiKey 省略表示「不改动已保存的 Key」；传空字符串表示清除。
 * verify 为 true 时，服务端会先用该 Key 试一次真实请求，失败则不保存。
 */
export async function saveServerSettings(patch: {
  apiKey?: string
  baseUrl?: string
  model?: string
  verify?: boolean
}): Promise<ServerApiSettings> {
  const body = await request<{ settings: ServerApiSettings }>('/api/local/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
  return body.settings
}

export async function clearServerKey(): Promise<ServerApiSettings> {
  const body = await request<{ settings: ServerApiSettings }>('/api/local/settings/key', {
    method: 'DELETE',
  })
  return body.settings
}

export async function resetServerSettings(): Promise<ServerApiSettings> {
  const body = await request<{ settings: ServerApiSettings }>('/api/local/settings', {
    method: 'DELETE',
  })
  return body.settings
}

export async function testServerConnection(patch: {
  apiKey?: string
  baseUrl?: string
  model?: string
}): Promise<LocalTestResult> {
  const body = await request<{ result: LocalTestResult }>('/api/local/settings/test', {
    method: 'POST',
    body: JSON.stringify(patch),
  })
  return body.result
}
