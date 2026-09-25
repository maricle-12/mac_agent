/**
 * 页面截图工具（无依赖，CDP 实现）。
 * 用法：node scripts/screenshot.mjs [url] [outDir]
 * 产出：desktop-chat.png / desktop-empty.png / desktop-settings.png / mobile-chat.png
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://localhost:5173/'
const outDir = process.argv[3] ?? 'screenshots'

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  // macOS / Linux（在 Mac 上做验收时需要）
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

const browserPath = candidates.find((item) => existsSync(item))
if (!browserPath) {
  console.error('未找到 Chrome / Edge，请设置 CHROME_PATH')
  process.exit(2)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const userDataDir = mkdtempSync(join(tmpdir(), 'shot-'))
const port = 9000 + Math.floor(Math.random() * 900)

const browser = spawn(
  browserPath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let nextId = 1
const pending = new Map()

function send(ws, method, params = {}, sessionId) {
  const id = nextId++
  const payload = { id, method, params }
  if (sessionId) payload.sessionId = sessionId
  ws.send(JSON.stringify(payload))
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`CDP 超时: ${method}`))
      }
    }, 20000)
  })
}

async function waitForVersion() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return await response.json()
    } catch {
      // 尚未启动
    }
    await sleep(250)
  }
  throw new Error('等待调试端口超时')
}

try {
  const version = await waitForVersion()
  const ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('无法连接调试通道')), { once: true })
  })

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
    }
  })

  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true })
  await send(ws, 'Page.enable', {}, sessionId)
  await send(ws, 'Runtime.enable', {}, sessionId)

  const setViewport = (width, height, mobile) =>
    send(
      ws,
      'Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile },
      sessionId,
    )

  const evaluate = async (expression) => {
    const result = await send(
      ws,
      'Runtime.evaluate',
      { expression: `(() => { ${expression} })()`, returnByValue: true },
      sessionId,
    )
    return result.result?.value
  }

  const shot = async (name) => {
    const result = await send(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId)
    mkdirSync(outDir, { recursive: true })
    const file = join(outDir, `${name}.png`)
    writeFileSync(file, Buffer.from(result.data, 'base64'))
    console.log(`已保存 ${file}`)
  }

  await setViewport(1440, 900, false)
  await send(ws, 'Page.navigate', { url }, sessionId)
  await sleep(3000)
  await shot('desktop-chat')

  await evaluate(`
    const btn = [...document.querySelectorAll('button')].find((el) =>
      (el.textContent || '').includes('新建对话'));
    if (btn) btn.click();
    return true;
  `)
  await sleep(600)
  await shot('desktop-empty')

  await evaluate(`
    const btn = [...document.querySelectorAll('button')].find((el) =>
      (el.textContent || '').trim() === '设置');
    if (btn) btn.click();
    return true;
  `)
  await sleep(600)
  await shot('desktop-settings')

  await setViewport(390, 844, true)
  await send(ws, 'Page.navigate', { url }, sessionId)
  await sleep(2500)
  await shot('mobile-chat')

  ws.close()
} catch (error) {
  console.error('截图失败:', error.message)
  process.exitCode = 1
} finally {
  browser.kill()
  await sleep(400)
  try {
    rmSync(userDataDir, { recursive: true, force: true })
  } catch {
    // 忽略
  }
}
