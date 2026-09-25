'use strict'

/**
 * 平台无关的小工具：健康检查、端口记忆、延时。
 *
 * 这些函数原本放在 win.cjs 里（Windows 便携版只有 Windows 一种目标平台）。
 * 加入 macOS 支持后，它们既不属于 Windows 也不属于 macOS，因此单独成文件，
 * 由 win.cjs / mac.cjs 之外的启动器代码直接引用。
 *
 * 逻辑与 v1.0.1 完全一致，只是搬家，没有任何行为变化。
 */

const fs = require('node:fs')
const path = require('node:path')

/** 健康检查：确认 127.0.0.1:port 上跑的是本应用（而不是别的程序） */
async function probeHealth(port, timeoutMs = 1500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    const body = await response.json()
    if (body && typeof body === 'object' && body.local === true) return body
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 在指定时间内反复探测，用于处理「另一个实例正在启动」的竞态 */
async function probeHealthWithRetry(port, totalMs = 8000, intervalMs = 400) {
  const deadline = Date.now() + totalMs
  for (;;) {
    const body = await probeHealth(port)
    if (body) return body
    if (Date.now() >= deadline) return null
    await delay(intervalMs)
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 读取上次成功使用的端口（用于保持浏览器 origin 稳定，从而保留聊天记录） */
function readLastPort(configDir) {
  try {
    const raw = fs.readFileSync(path.join(configDir, 'port.txt'), 'utf8').trim()
    const port = Number.parseInt(raw, 10)
    if (Number.isInteger(port) && port >= 1024 && port <= 65535) return port
  } catch {
    /* 首次启动没有该文件 */
  }
  return null
}

function writeLastPort(configDir, port) {
  try {
    fs.writeFileSync(path.join(configDir, 'port.txt'), `${port}\n`, 'utf8')
  } catch {
    /* 写不了也不影响运行 */
  }
}

module.exports = {
  probeHealth,
  probeHealthWithRetry,
  delay,
  readLastPort,
  writeLastPort,
}
