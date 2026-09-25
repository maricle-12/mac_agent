'use strict'

/**
 * 运行日志。
 *
 * 硬性要求：
 * - 绝不把完整 API Key 写进日志（这里再做一次兜底脱敏）。
 * - 不记录请求正文 / 聊天内容。
 * - 日志文件固定在 logs/app.log，超过上限自动轮转，避免无限增长。
 */

const fs = require('node:fs')
const path = require('node:path')

const MAX_LOG_BYTES = 2 * 1024 * 1024

/** 兜底脱敏：任何情况下都不允许完整 Key 出现在日志里 */
function scrub(text) {
  return String(text)
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, (match) => `sk-****${match.slice(-4)}`)
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer ****')
    .replace(/(api[_-]?key["'\s:=]+)[A-Za-z0-9._-]{8,}/gi, '$1****')
}

function rotateIfNeeded(file) {
  try {
    const stat = fs.statSync(file)
    if (stat.size > MAX_LOG_BYTES) {
      const old = `${file}.1`
      try {
        fs.rmSync(old, { force: true })
      } catch {
        /* ignore */
      }
      fs.renameSync(file, old)
    }
  } catch {
    /* 文件不存在，无需轮转 */
  }
}

/**
 * @param {{ logDir: string, debug?: boolean }} options
 */
function createLogger(options) {
  const logDir = options.logDir
  const debug = options.debug === true
  const logFile = path.join(logDir, 'app.log')
  let stream = null

  try {
    fs.mkdirSync(logDir, { recursive: true })
    rotateIfNeeded(logFile)
    stream = fs.createWriteStream(logFile, { flags: 'a' })
    stream.on('error', () => {
      stream = null
    })
  } catch {
    stream = null
  }

  function write(level, message) {
    const line = `[${new Date().toISOString()}] [${level}] ${scrub(message)}\n`
    if (stream) {
      try {
        stream.write(line)
      } catch {
        /* 写日志失败不能影响主流程 */
      }
    }
    if (debug) {
      try {
        process.stderr.write(line)
      } catch {
        /* GUI 子系统下没有 stderr，忽略 */
      }
    }
  }

  return {
    file: logFile,
    info: (message) => write('INFO', message),
    warn: (message) => write('WARN', message),
    error: (message) => write('ERROR', message),
    debug: (message) => {
      if (debug) write('DEBUG', message)
    },
    /** 记录异常对象（含堆栈），同样经过脱敏 */
    exception: (message, error) => {
      const detail = error && error.stack ? error.stack : String(error)
      write('ERROR', `${message} :: ${detail}`)
    },
    close: () => {
      try {
        stream?.end()
      } catch {
        /* ignore */
      }
    },
  }
}

module.exports = { createLogger, scrub }
