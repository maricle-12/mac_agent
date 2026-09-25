'use strict'

/**
 * 便携版本地服务。
 *
 * 它做三件事：
 *   1. 把已经构建好的前端静态资源（resources/web）按原样提供给浏览器；
 *   2. 把 /api/* 请求交给「原封不动的现有 Worker 代码」处理
 *      （worker/src/index.ts 未做任何修改，这里只做 Node http ↔ Fetch API 的适配）；
 *   3. 提供本地数据接口 /api/local/*：
 *      聊天历史（SQLite，data/app.db）、API 配置（config/settings.json）、
 *      一次性迁移、数据导出、退出。
 *
 * 与 v1.0.0 的关键区别：
 *   - 聊天历史不再依赖浏览器 IndexedDB，改由本地 SQLite 持久化 → 与端口无关；
 *   - API Key 由本地服务保存，浏览器不再长期保存完整 Key；
 *   - /api/chat 在转发前由本层补齐 apiKey / baseUrl / model（最薄的适配，Worker 逻辑不变）。
 *
 * 安全：只监听 127.0.0.1；所有 /api/local/* 拒绝非本页面来源；不记录请求正文与 API Key。
 */

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { once } = require('node:events')
const { Readable } = require('node:stream')

// 已编译的 Worker（构建期由 esbuild 从 worker/src/index.ts 打包而来，源码零改动）
const workerModule = require('../build/worker.cjs')
const worker = workerModule && workerModule.default ? workerModule.default : workerModule

const HOST = '127.0.0.1'
const MAX_JSON_BODY = 8 * 1024 * 1024

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml; charset=utf-8',
}

/** 逐跳首部，不参与转发 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
])

function contentTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.length),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  })
  res.end(payload)
}

function sendError(res, status, code, message, detail) {
  sendJson(res, status, { error: { code, message, status, ...(detail ? { detail } : {}) } })
}

async function readBody(req, limit = MAX_JSON_BODY) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) {
      const error = new Error('请求内容过大')
      error.code = 'payload_too_large'
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJsonBody(req, limit) {
  const raw = await readBody(req, limit)
  if (raw.length === 0) return {}
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    const error = new Error('请求体不是合法 JSON')
    error.code = 'invalid_json'
    throw error
  }
}

/**
 * 创建本地服务。
 * @param {{
 *   port: number, webRoot: string, logger: any, version: string,
 *   onShutdown: (reason: string) => void,
 *   db: any, settings: any, appRoot: string,
 * }} options
 */
function createLocalServer(options) {
  const { port, webRoot, logger, version, onShutdown, db, settings, appRoot } = options
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`])

  /** 非本页面来源的请求一律拒绝（防跨站请求伪造） */
  function originAllowed(req) {
    const origin = req.headers.origin
    if (!origin) return true // 本页面同源 GET / 本地命令行工具不带 Origin
    return allowedOrigins.has(origin)
  }

  // ------------------------------------------------------------ 静态资源

  async function serveStatic(req, res, pathname) {
    let decoded
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      decoded = pathname
    }

    const relative = decoded.replace(/^\/+/, '')
    let target = path.resolve(webRoot, relative)
    if (!isInside(webRoot, target)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('403 Forbidden')
      return
    }

    let stat = await fs.promises.stat(target).catch(() => null)

    if (stat && stat.isDirectory()) {
      target = path.join(target, 'index.html')
      stat = await fs.promises.stat(target).catch(() => null)
    }

    if (!stat && !path.extname(relative)) {
      target = path.join(webRoot, 'index.html')
      stat = await fs.promises.stat(target).catch(() => null)
    }

    if (!stat || !stat.isFile()) {
      logger.debug(`静态资源未找到：${decoded}`)
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('404 Not Found')
      return
    }

    const headers = {
      'Content-Type': contentTypeFor(target),
      'Content-Length': String(stat.size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': /[.-][A-Za-z0-9_-]{8,}\.(js|css|woff2?|ttf|svg|png)$/.test(relative)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    }

    if (req.method === 'HEAD') {
      res.writeHead(200, headers)
      res.end()
      return
    }

    res.writeHead(200, headers)
    await new Promise((resolve) => {
      const stream = fs.createReadStream(target)
      stream.on('error', () => {
        res.destroy()
        resolve()
      })
      stream.on('end', resolve)
      stream.pipe(res)
    })
  }

  // ------------------------------------------------------------ Fetch 适配

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {{ body?: Buffer, path?: string, method?: string }} [override]
   */
  function buildFetchRequest(req, res, override) {
    const url = `http://${HOST}:${port}${override?.path ?? req.url}`
    const method = override?.method ?? req.method
    const headers = new Headers()
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i]
      const value = req.rawHeaders[i + 1]
      if (HOP_BY_HOP.has(name.toLowerCase())) continue
      try {
        headers.append(name, value)
      } catch {
        /* 非法首部直接忽略 */
      }
    }

    const controller = new AbortController()
    const abort = () => {
      if (!controller.signal.aborted) controller.abort()
    }
    req.on('aborted', abort)
    res.on('close', () => {
      if (!res.writableEnded) abort()
    })

    const init = { method, headers, signal: controller.signal }
    const body = override?.body
    if (body !== undefined) {
      headers.set('content-length', String(body.length))
      if (method !== 'GET' && method !== 'HEAD') {
        init.body = body
        init.duplex = 'half'
      }
    } else if (method !== 'GET' && method !== 'HEAD') {
      init.body = Readable.toWeb(req)
      init.duplex = 'half'
    }
    return new Request(url, init)
  }

  async function writeFetchResponse(req, res, response, extraHeaders) {
    const headers = { ...(extraHeaders || {}) }
    response.headers.forEach((value, name) => {
      if (HOP_BY_HOP.has(name.toLowerCase())) return
      if (name.toLowerCase() === 'content-encoding') return
      if (name.toLowerCase() === 'content-length') return
      headers[name] = value
    })

    res.writeHead(response.status, headers)

    if (req.method === 'HEAD' || !response.body) {
      res.end()
      return
    }

    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value && value.byteLength > 0) {
          if (!res.write(Buffer.from(value.buffer, value.byteOffset, value.byteLength))) {
            await once(res, 'drain')
          }
        }
      }
    } catch (error) {
      logger.warn(`响应传输中断：${error && error.message ? error.message : error}`)
    } finally {
      try {
        reader.releaseLock()
      } catch {
        /* ignore */
      }
      res.end()
    }
  }

  function workerEnv() {
    return { ALLOWED_ORIGINS: Array.from(allowedOrigins).join(',') }
  }

  // ------------------------------------------------------------ /api/chat

  /**
   * 转发前补齐 apiKey / baseUrl / model。
   * 这是「让 Node 从配置读取 Key」的唯一改动点，Worker 本身的校验与转发逻辑不变。
   */
  async function handleChat(req, res) {
    let raw
    try {
      raw = await readBody(req, 1024 * 1024)
    } catch (error) {
      sendError(res, 413, 'payload_too_large', '请求内容过大，请减少携带的历史消息。')
      return
    }

    let payload
    try {
      payload = JSON.parse(raw.toString('utf8'))
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('bad')
    } catch {
      sendError(res, 400, 'invalid_json', '请求格式有误，请重试。')
      return
    }

    const publicSettings = settings.getPublicSettings()
    const providedKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : ''

    if (!providedKey) {
      const storedKey = settings.getApiKey()
      if (!storedKey) {
        sendError(
          res,
          400,
          'api_key_not_configured',
          '尚未配置 DeepSeek API Key。请点击右上角「设置」填写你自己的 API Key。',
        )
        return
      }
      payload.apiKey = storedKey
    }

    if (typeof payload.baseUrl !== 'string' || !payload.baseUrl.trim()) {
      payload.baseUrl = publicSettings.baseUrl
    }
    if (typeof payload.model !== 'string' || !payload.model.trim()) {
      payload.model = publicSettings.model
    }

    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    let response
    try {
      response = await worker.fetch(buildFetchRequest(req, res, { body }), workerEnv())
    } catch (error) {
      logger.exception(`转发服务异常：${req.method} ${req.url}`, error)
      sendError(res, 500, 'worker_error', '转发服务出现异常，请稍后重试。')
      return
    }

    await writeFetchResponse(req, res, response)
  }

  // ------------------------------------------------------------ 其他 /api/*

  async function forwardToWorker(req, res, url) {
    let response
    try {
      response = await worker.fetch(buildFetchRequest(req, res), workerEnv())
    } catch (error) {
      logger.exception(`转发服务异常：${req.method} ${url.pathname}`, error)
      sendError(res, 500, 'worker_error', '转发服务出现异常，请稍后重试。')
      return
    }

    if (url.pathname === '/api/health') {
      try {
        const body = await response.clone().json()
        const merged = {
          ...body,
          local: true,
          app: 'ai-edu-agent-portable',
          portableVersion: version,
          port,
        }
        await writeFetchResponse(
          req,
          res,
          new Response(JSON.stringify(merged), {
            status: response.status,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          }),
          { 'Cache-Control': 'no-store' },
        )
        return
      } catch {
        /* 解析失败时按原样返回 */
      }
    }

    await writeFetchResponse(req, res, response)
  }

  // ------------------------------------------------------------ 本地设置

  /** 用临时（或已保存的）Key 走一次极小请求，验证 Key 是否可用；不落库 */
  async function verifyCredentials({ apiKey, baseUrl, model }, req, res) {
    const publicSettings = settings.getPublicSettings()
    const payload = {
      apiKey,
      baseUrl: baseUrl || publicSettings.baseUrl,
      model: model || publicSettings.model,
      messages: [{ role: 'user', content: '你好' }],
      temperature: 0.1,
      stream: false,
    }

    let response
    try {
      // 复用同一个 Worker 转发端点做验证：路径重写为 /api/chat，方法固定 POST
      response = await worker.fetch(
        buildFetchRequest(req, res, {
          body: Buffer.from(JSON.stringify(payload), 'utf8'),
          path: '/api/chat',
          method: 'POST',
        }),
        workerEnv(),
      )
    } catch (error) {
      logger.exception('测试连接失败（网络层）', error)
      return { ok: false, message: '网络连接失败，请检查网络后重试。', detail: String(error && error.message) }
    }

    const text = await response.text().catch(() => '')

    if (!response.ok) {
      let message = `转发服务返回了异常响应（HTTP ${response.status}）。`
      let detail = `HTTP ${response.status}`
      try {
        const parsed = JSON.parse(text)
        if (parsed && parsed.error) {
          if (typeof parsed.error.message === 'string') message = parsed.error.message
          if (typeof parsed.error.detail === 'string') detail = parsed.error.detail
        }
      } catch {
        /* 非 JSON，用兜底文案 */
      }
      return { ok: false, message, detail }
    }

    try {
      const data = JSON.parse(text)
      const content = data?.choices?.[0]?.message?.content
      const usedModel = typeof data?.model === 'string' ? data.model : payload.model
      const totalTokens = typeof data?.usage?.total_tokens === 'number' ? data.usage.total_tokens : undefined
      if (typeof content !== 'string') {
        return { ok: false, message: '模型服务返回了无法解析的内容。', detail: text.slice(0, 300) }
      }
      return {
        ok: true,
        message: '连接成功',
        preview: content.trim().slice(0, 60) || '（模型返回了空内容）',
        model: usedModel,
        totalTokens,
        detail: `HTTP 200 · 模型 ${usedModel}${totalTokens !== undefined ? ` · 消耗 ${totalTokens} tokens` : ''}`,
      }
    } catch {
      return { ok: false, message: '模型服务返回了无法解析的内容。', detail: text.slice(0, 300) }
    }
  }

  async function handleLocalSettings(req, res, url) {
    const method = req.method
    const segments = url.pathname.split('/').filter(Boolean) // api, local, settings, ...

    // GET /api/local/settings
    if (segments.length === 3 && method === 'GET') {
      sendJson(res, 200, { settings: settings.getPublicSettings() })
      return
    }

    // PUT /api/local/settings
    if (segments.length === 3 && method === 'PUT') {
      let body
      try {
        body = await readJsonBody(req, 64 * 1024)
      } catch (error) {
        sendError(res, 400, error.code || 'invalid_json', '请求格式有误，请重试。')
        return
      }

      const incomingKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
      const verify = body.verify !== false

      // 只在「确实要写入一个新 Key」时才校验，避免无意义的网络请求
      if (incomingKey && verify && incomingKey !== settings.getApiKey()) {
        const result = await verifyCredentials(
          { apiKey: incomingKey, baseUrl: body.baseUrl, model: body.model },
          req,
          res,
        )
        if (!result.ok) {
          logger.warn(`拒绝保存未通过验证的 API Key（${result.message}）`)
          sendError(res, 400, 'api_key_not_verified', result.message, result.detail)
          return
        }
      }

      try {
        const patch = { baseUrl: body.baseUrl, model: body.model }
        if (Object.prototype.hasOwnProperty.call(body, 'apiKey')) patch.apiKey = incomingKey
        const next = settings.update(patch)
        sendJson(res, 200, { settings: next, saved: true })
      } catch (error) {
        sendError(res, 400, error.code || 'invalid_request', error.message || '保存失败。')
      }
      return
    }

    // DELETE /api/local/settings/key  → 只清 Key
    if (segments.length === 4 && segments[3] === 'key' && method === 'DELETE') {
      sendJson(res, 200, { settings: settings.clearKey() })
      return
    }

    // DELETE /api/local/settings  → 全部重置
    if (segments.length === 3 && method === 'DELETE') {
      sendJson(res, 200, { settings: settings.clearAll() })
      return
    }

    // POST /api/local/settings/test  → 只测试，不保存
    if (segments.length === 4 && segments[3] === 'test' && method === 'POST') {
      let body
      try {
        body = await readJsonBody(req, 64 * 1024)
      } catch (error) {
        sendError(res, 400, error.code || 'invalid_json', '请求格式有误，请重试。')
        return
      }
      const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : settings.getApiKey()
      if (!apiKey) {
        sendJson(res, 200, {
          result: {
            ok: false,
            message: '尚未配置 API Key，请先填写 DeepSeek API Key。',
          },
        })
        return
      }
      const result = await verifyCredentials(
        { apiKey, baseUrl: body.baseUrl, model: body.model },
        req,
        res,
      )
      sendJson(res, 200, { result })
      return
    }

    sendError(res, 404, 'not_found', '接口不存在。')
  }

  // ------------------------------------------------------------ 本地历史

  async function handleLocalConversations(req, res, url) {
    const method = req.method
    const segments = url.pathname.split('/').filter(Boolean) // api, local, conversations, ...

    // /api/local/conversations
    if (segments.length === 3) {
      if (method === 'GET') {
        sendJson(res, 200, { conversations: db.listConversations() })
        return
      }
      if (method === 'POST') {
        let body
        try {
          body = await readJsonBody(req)
        } catch (error) {
          sendError(res, 400, error.code || 'invalid_json', '请求格式有误，请重试。')
          return
        }
        const conversation = body.conversation ?? body
        try {
          const saved = db.upsertConversation(conversation, { model: settings.getPublicSettings().model })
          sendJson(res, 200, { conversation: saved })
        } catch (error) {
          sendError(res, 400, 'invalid_request', error.message || '保存会话失败。')
        }
        return
      }
      if (method === 'DELETE') {
        const removed = db.clearConversations()
        logger.info(`已清除本地聊天记录（${removed} 个会话）`)
        sendJson(res, 200, { removed })
        return
      }
    }

    // /api/local/conversations/import
    if (segments.length === 4 && segments[3] === 'import' && method === 'POST') {
      let body
      try {
        body = await readJsonBody(req)
      } catch (error) {
        sendError(res, 400, error.code || 'invalid_json', '请求格式有误，请重试。')
        return
      }
      const list = Array.isArray(body.conversations) ? body.conversations : []
      const result = db.importConversations(list)
      logger.info(`导入历史会话：收到 ${list.length} 个，实际写入 ${result.imported} 个${result.skipped ? '（数据库非空，已跳过）' : ''}`)
      sendJson(res, 200, { ...result, conversationCount: db.countConversations() })
      return
    }

    // /api/local/conversations/:id
    if (segments.length === 4) {
      const id = decodeURIComponent(segments[3])
      if (method === 'GET') {
        const conversation = db.getConversation(id)
        if (!conversation) {
          sendError(res, 404, 'not_found', '会话不存在。')
          return
        }
        sendJson(res, 200, { conversation })
        return
      }
      if (method === 'PUT' || method === 'PATCH') {
        let body
        try {
          body = await readJsonBody(req)
        } catch (error) {
          sendError(res, 400, error.code || 'invalid_json', '请求格式有误，请重试。')
          return
        }
        const existing = db.getConversation(id)
        if (!existing) {
          sendError(res, 404, 'not_found', '会话不存在。')
          return
        }
        const patch = body.conversation ?? body
        const merged = {
          ...existing,
          ...patch,
          id,
          messages: Array.isArray(patch.messages) ? patch.messages : existing.messages,
          updatedAt: Number.isFinite(patch.updatedAt) ? patch.updatedAt : Date.now(),
        }
        try {
          const saved = db.upsertConversation(merged, { model: settings.getPublicSettings().model })
          sendJson(res, 200, { conversation: saved })
        } catch (error) {
          sendError(res, 400, 'invalid_request', error.message || '保存会话失败。')
        }
        return
      }
      if (method === 'DELETE') {
        const removed = db.deleteConversation(id)
        sendJson(res, 200, { removed })
        return
      }
    }

    sendError(res, 404, 'not_found', '接口不存在。')
  }

  async function handleLocalMessages(req, res, url) {
    const method = req.method
    const segments = url.pathname.split('/').filter(Boolean) // api, local, messages, ...

    if (segments.length === 3 && method === 'POST') {
      let body
      try {
        body = await readJsonBody(req)
      } catch (error) {
        sendError(res, 400, error.code || 'invalid_json', '请求格式有误，请重试。')
        return
      }
      const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
      if (!conversationId || !db.getConversation(conversationId)) {
        sendError(res, 404, 'not_found', '会话不存在。')
        return
      }
      try {
        const saved = db.insertMessage(conversationId, body.message ?? body, body.seq)
        sendJson(res, 200, { message: saved })
      } catch (error) {
        sendError(res, 400, 'invalid_request', error.message || '保存消息失败。')
      }
      return
    }

    if (segments.length === 4) {
      const id = decodeURIComponent(segments[3])
      if (method === 'PUT' || method === 'PATCH') {
        let body
        try {
          body = await readJsonBody(req)
        } catch (error) {
          sendError(res, 400, error.code || 'invalid_json', '请求格式有误，请重试。')
          return
        }
        const saved = db.updateMessage(id, body.message ?? body)
        if (!saved) {
          sendError(res, 404, 'not_found', '消息不存在。')
          return
        }
        sendJson(res, 200, { message: saved })
        return
      }
      if (method === 'DELETE') {
        sendJson(res, 200, { removed: db.deleteMessage(id) })
        return
      }
    }

    sendError(res, 404, 'not_found', '接口不存在。')
  }

  async function handleLocal(req, res, url) {
    if (!originAllowed(req)) {
      logger.warn(`拒绝来自 ${req.headers.origin} 的本地接口请求：${req.method} ${url.pathname}`)
      sendError(res, 403, 'origin_not_allowed', '不允许的来源。')
      return
    }

    // GET /api/local/info
    if (url.pathname === '/api/local/info') {
      if (req.method !== 'GET') {
        sendError(res, 405, 'method_not_allowed', '该接口只接受 GET 请求。')
        return
      }
      const stats = db.stats()
      sendJson(res, 200, {
        local: true,
        app: 'ai-edu-agent-portable',
        version,
        port,
        pid: process.pid,
        canShutdown: true,
        /** 运行平台（win32 / darwin），前端据此显示正确的「如何再次启动」文案 */
        platform: process.platform,
        /** 用户再次启动本应用时要双击的东西（Windows 是可执行文件，macOS 是应用） */
        relaunchHint: process.platform === 'darwin' ? 'AI 教育智能体' : '启动智能体.exe',
        dataRoot: appRoot,
        database: {
          path: stats.path,
          schemaVersion: stats.schemaVersion,
          conversationCount: stats.conversationCount,
          migrationDone: db.getMeta('indexeddb_migration_v1') === 'true',
        },
        settings: {
          path: settings.file,
          configured: settings.getPublicSettings().configured,
        },
      })
      return
    }

    // POST /api/local/shutdown
    if (url.pathname === '/api/local/shutdown') {
      if (req.method !== 'POST') {
        sendError(res, 405, 'method_not_allowed', '该接口只接受 POST 请求。')
        return
      }
      sendJson(res, 200, { ok: true, message: '本地服务正在关闭。' })
      logger.info('收到「退出智能体」请求，正在关闭本地服务')
      setTimeout(() => onShutdown('user-request'), 150)
      return
    }

    // POST /api/local/migration/complete
    if (url.pathname === '/api/local/migration/complete') {
      if (req.method !== 'POST') {
        sendError(res, 405, 'method_not_allowed', '该接口只接受 POST 请求。')
        return
      }
      db.setMeta('indexeddb_migration_v1', 'true')
      db.setMeta('indexeddb_migration_v1_at', new Date().toISOString())
      logger.info('浏览器历史记录迁移已标记完成（indexeddb_migration_v1 = true）')
      sendJson(res, 200, { ok: true, migrationDone: true })
      return
    }

    // GET /api/local/export  → 导出聊天数据（不含 API Key）
    if (url.pathname === '/api/local/export') {
      if (req.method !== 'GET') {
        sendError(res, 405, 'method_not_allowed', '该接口只接受 GET 请求。')
        return
      }
      const stamp = new Date().toISOString().slice(0, 10)
      const payload = {
        app: 'ai-edu-agent-portable',
        version,
        exportedAt: new Date().toISOString(),
        // 明确不含 API Key：导出只覆盖聊天数据
        includesApiKey: false,
        conversations: db.listConversations(),
      }
      const buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf8')
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(buffer.length),
        'Content-Disposition': `attachment; filename="ai-edu-agent-chat-backup-${stamp}.json"`,
        'Cache-Control': 'no-store',
      })
      res.end(buffer)
      logger.info(`已导出聊天数据（${payload.conversations.length} 个会话，不含 API Key）`)
      return
    }

    if (url.pathname.startsWith('/api/local/settings')) {
      await handleLocalSettings(req, res, url)
      return
    }

    if (url.pathname.startsWith('/api/local/conversations')) {
      await handleLocalConversations(req, res, url)
      return
    }

    if (url.pathname.startsWith('/api/local/messages')) {
      await handleLocalMessages(req, res, url)
      return
    }

    sendError(res, 404, 'not_found', '接口不存在。')
  }

  // ------------------------------------------------------------ 路由

  async function handleApi(req, res, url) {
    if (url.pathname.startsWith('/api/local/')) {
      await handleLocal(req, res, url)
      return
    }
    if (url.pathname === '/api/chat') {
      if (req.method !== 'POST') {
        await forwardToWorker(req, res, url)
        return
      }
      await handleChat(req, res)
      return
    }
    await forwardToWorker(req, res, url)
  }

  const server = http.createServer((req, res) => {
    const startedAt = Date.now()

    try {
      req.socket.setNoDelay(true)
    } catch {
      /* ignore */
    }

    let url
    try {
      url = new URL(req.url, `http://${HOST}:${port}`)
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('400 Bad Request')
      return
    }

    res.on('finish', () => {
      // 只记录方法 / 路径 / 状态 / 耗时，绝不记录请求体与 API Key
      logger.info(`${req.method} ${url.pathname} → ${res.statusCode} (${Date.now() - startedAt}ms)`)
    })

    const handle = url.pathname.startsWith('/api/')
      ? handleApi(req, res, url)
      : serveStatic(req, res, url.pathname)

    Promise.resolve(handle).catch((error) => {
      logger.exception(`请求处理失败：${req.method} ${url.pathname}`, error)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      }
      res.end('500 Internal Server Error')
    })
  })

  server.on('clientError', (error, socket) => {
    logger.warn(`客户端连接异常：${error && error.message ? error.message : error}`)
    try {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
    } catch {
      /* ignore */
    }
  })

  return server
}

module.exports = { createLocalServer, HOST }
