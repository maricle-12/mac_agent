/**
 * 本地「类 Cloudflare Pages」静态服务器。
 *
 * 为什么需要它：`vite preview` 不实现 Cloudflare Pages 的 `_redirects` 规则，
 * 因此无法用来验证「刷新 SPA 深层路径不会 404」。本脚本读取 `dist/_redirects`
 * 并按 Pages 的语义处理，让本地就能复现线上行为。
 *
 * 用法：
 *   npm run build
 *   node scripts/preview-pages.mjs [port]      # 默认 4180
 */

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const port = Number(process.argv[2] ?? 4180)
const distDir = resolve('dist')
const redirectsFile = join(distDir, '_redirects')

if (!existsSync(distDir)) {
  console.error('未找到 dist/，请先执行 npm run build')
  process.exit(2)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

/** 解析 _redirects：只实现本项目用到的 `/* /index.html 200` 形式 */
function loadRedirects() {
  if (!existsSync(redirectsFile)) return []
  return readFileSync(redirectsFile, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [from, to, status] = line.split(/\s+/)
      return { from, to, status: Number(status ?? 302) }
    })
}

const redirects = loadRedirects()
if (redirects.length === 0) {
  console.warn('⚠️ dist/_redirects 缺失或为空：SPA 深层路径刷新会 404')
} else {
  console.log(`已加载 _redirects: ${redirects.map((r) => `${r.from} → ${r.to} ${r.status}`).join(', ')}`)
}

/** `/*` 视为匹配任意路径 */
function matchRedirect(pathname) {
  for (const rule of redirects) {
    if (rule.from === '/*') return rule
    if (rule.from === pathname) return rule
  }
  return null
}

function sendFile(res, filePath, status = 200) {
  res.writeHead(status, {
    'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
  createReadStream(filePath).pipe(res)
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`)
  const pathname = decodeURIComponent(url.pathname)
  // 防目录穿越
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  const filePath = join(distDir, safePath)

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    sendFile(res, filePath)
    return
  }

  // 目录形式：/foo/ → /foo/index.html
  const indexInDir = join(filePath, 'index.html')
  if (existsSync(indexInDir)) {
    sendFile(res, indexInDir)
    return
  }

  const rule = matchRedirect(pathname)
  if (rule) {
    const target = join(distDir, rule.to)
    if (existsSync(target)) {
      sendFile(res, target, rule.status)
      return
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('404 Not Found')
})

server.listen(port, () => {
  console.log(`类 Cloudflare Pages 预览已启动: http://localhost:${port}`)
})
