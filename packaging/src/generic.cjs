'use strict'

/**
 * 其他桌面平台（主要是 Linux）的集成兜底。
 *
 * 当前发行目标只有 Windows 与 macOS；本文件存在的意义是：
 * 让启动器在没有原生对话框实现时也能**不静默失败** —— 至少把日志写下来，
 * 并且仍然能尝试用 xdg-open 打开浏览器。
 * 不引入任何新依赖。
 */

const { spawn } = require('node:child_process')

/** 没有通用原生对话框：把提示写到 stderr（终端启动时可见）并返回 false */
function showDialog({ title, message, logFile }) {
  try {
    process.stderr.write(`\n[${title}]\n${message}\n${logFile ? `日志：${logFile}\n` : ''}\n`)
  } catch {
    /* GUI 下没有 stderr，忽略 */
  }
  return false
}

/** 用 xdg-open 打开默认浏览器；失败时返回 false，由启动器写日志提示用户手动访问 */
function openBrowser(url) {
  try {
    const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
    child.on('error', () => {
      /* 由调用方根据返回值/日志处理 */
    })
    child.unref()
    return true
  } catch {
    return false
  }
}

module.exports = {
  showDialog,
  openBrowser,
}
