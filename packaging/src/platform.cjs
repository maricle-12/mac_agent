'use strict'

/**
 * 平台集成层：把「打开默认浏览器」「弹一个原生错误对话框」这两件与操作系统
 * 强相关的事情，按 process.platform 分发到对应实现。
 *
 *   win32  → ./win.cjs     （PowerShell MessageBox + cmd.exe/rundll32）
 *   darwin → ./mac.cjs     （osascript 对话框 + /usr/bin/open）
 *   其他   → ./generic.cjs （没有原生对话框时，退化为只写日志）
 *
 * 启动器只依赖本文件，不再直接 require win.cjs —— 这样新增平台时只要加一个实现文件。
 * 平台无关的网络/端口工具在 ./net.cjs。
 */

const net = require('./net.cjs')

const OS_LABELS = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
}

let impl
if (process.platform === 'win32') {
  impl = require('./win.cjs')
} else if (process.platform === 'darwin') {
  impl = require('./mac.cjs')
} else {
  impl = require('./generic.cjs')
}

module.exports = {
  ...net,
  showDialog: impl.showDialog,
  openBrowser: impl.openBrowser,
  /** 平台显示名，用于日志与错误提示 */
  OS_LABEL: OS_LABELS[process.platform] ?? process.platform,
}
