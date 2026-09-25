'use strict'

/**
 * macOS 平台集成：错误对话框、打开默认浏览器。
 *
 * 与 Windows 版的对应关系：
 *   MessageBox（PowerShell + WinForms）  →  osascript display dialog
 *   cmd.exe start / rundll32             →  /usr/bin/open
 *
 * 说明：
 * - 一律使用**绝对路径**调用系统程序（/usr/bin/open、/usr/bin/osascript）。
 *   .app 由 Finder 启动时 PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin，
 *   依赖 PATH 查找会在某些环境下失败。
 * - 参数以 argv 数组传递（不经过 shell），URL 只可能是 http://127.0.0.1:<port>，
 *   不存在命令注入面。
 * - 不申请任何权限、不写注册表/偏好设置的隐私项、不安装服务。
 */

const { spawn, spawnSync } = require('node:child_process')

const OPEN_BIN = '/usr/bin/open'
const OSASCRIPT_BIN = '/usr/bin/osascript'

/**
 * 把普通字符串变成 AppleScript 双引号字符串字面量。
 * AppleScript 的转义规则：\ → \\， " → \"，换行 → \n
 */
function appleScriptLiteral(value) {
  const text = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, '\\n')
  return `"${text}"`
}

/**
 * 弹出 macOS 原生对话框（NSAlert 风格）。
 * 发行版没有控制台窗口，出错时必须靠对话框告知用户，不能静默失败。
 * 失败时退化为用默认程序打开日志文件（通常是「控制台」或「文本编辑」）。
 */
function showDialog({ title, message, logFile }) {
  const script =
    `display dialog ${appleScriptLiteral(message)} ` +
    `with title ${appleScriptLiteral(title)} ` +
    'buttons {"好"} default button "好" with icon caution ' +
    'giving up after 600'

  try {
    const result = spawnSync(OSASCRIPT_BIN, ['-e', script], {
      stdio: 'ignore',
      timeout: 620_000,
    })
    // osascript 在用户点掉对话框后返回 0
    if (result.status === 0) return true
  } catch {
    /* 继续走回退方案 */
  }

  try {
    if (logFile) {
      const child = spawn(OPEN_BIN, [logFile], { detached: true, stdio: 'ignore' })
      child.on('error', () => {
        /* ignore */
      })
      child.unref()
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}

/**
 * 用系统默认浏览器打开地址。
 * `open <url>` 走 LaunchServices，因此尊重用户设置的默认浏览器。
 * 极少数情况下 LaunchServices 找不到 http 的处理程序，退化为显式打开 Safari。
 */
function openBrowser(url) {
  const attempts = [
    () => spawn(OPEN_BIN, [url], { detached: true, stdio: 'ignore' }),
    () => spawn(OPEN_BIN, ['-a', 'Safari', url], { detached: true, stdio: 'ignore' }),
  ]

  for (const attempt of attempts) {
    try {
      const child = attempt()
      child.on('error', () => {
        /* 由下一次尝试兜底 */
      })
      child.unref()
      return true
    } catch {
      /* 尝试下一种方式 */
    }
  }
  return false
}

module.exports = {
  showDialog,
  openBrowser,
}
