'use strict'

/**
 * Windows 平台集成：错误对话框、打开默认浏览器。
 *
 * 说明：本文件只服务于「便携启动器」本身，不含任何智能体业务逻辑。
 * 不申请管理员权限、不修改注册表、不安装服务、不做开机自启动。
 *
 * 平台无关的健康检查与端口工具在 net.cjs；按平台分发在 platform.cjs。
 */

const fs = require('node:fs')
const { spawn, spawnSync } = require('node:child_process')

const APP_ID = 'ai-edu-agent-portable'

/** 把字符串编码成 PowerShell -EncodedCommand 需要的 Base64(UTF-16LE)，避免引号转义问题 */
function encodePowerShellCommand(script) {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/**
 * 弹出 Windows 对话框。
 * 发行版是 GUI 子系统（无控制台），所以出错时只能靠对话框告知用户，不能静默失败。
 * 优先使用 PowerShell 的 WinForms MessageBox（windowsHide，不会闪黑窗）；
 * 失败时退化为用记事本打开日志文件。
 */
function showDialog({ title, message, logFile }) {
  const script =
    "Add-Type -AssemblyName System.Windows.Forms; " +
    `[System.Windows.Forms.MessageBox]::Show(${psLiteral(message)}, ${psLiteral(title)}, ` +
    "[System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null"

  try {
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodePowerShellCommand(script)],
      { windowsHide: true, stdio: 'ignore', timeout: 30_000 },
    )
    if (result.status === 0) return true
  } catch {
    /* 继续走回退方案 */
  }

  try {
    if (logFile && fs.existsSync(logFile)) {
      spawn('notepad.exe', [logFile], { windowsHide: false, detached: true, stdio: 'ignore' }).unref()
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}

/** PowerShell 单引号字符串字面量（内部单引号翻倍） */
function psLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * 用系统默认浏览器打开地址。
 * `start` 会走 ShellExecute，因此尊重用户设置的默认浏览器；
 * windowsHide 保证不会出现黑色命令行窗口。
 */
function openBrowser(url) {
  const attempts = [
    () =>
      spawn('cmd.exe', ['/c', 'start', '', url], {
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
      }),
    () =>
      spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
      }),
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
  APP_ID,
  showDialog,
  openBrowser,
}
