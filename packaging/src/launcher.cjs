'use strict'

/**
 * AI 教育智能体 · 免安装便携版启动器（Windows / macOS 通用）
 *
 * 职责（仅此而已，不含任何智能体业务逻辑）：
 *   1. 初始化必要目录（data / config / logs）
 *   2. 检查配置 / 资源
 *   3. 判断是否已有实例在运行（单实例）
 *   4. 自动寻找可用端口（默认 8765，被占用则依次尝试）
 *   5. 启动本地后端（复用现有 Worker 代码，只监听 127.0.0.1）
 *   6. 健康检查通过后自动打开系统默认浏览器
 *   7. 管理进程生命周期（收到「退出智能体」请求时干净退出）
 *
 * 平台差异全部收敛在 paths.cjs（目录）与 platform.cjs（打开浏览器 / 错误对话框）：
 *   Windows：GUI 子系统 EXE，双击不出现控制台窗口；PowerShell MessageBox 兜底报错
 *   macOS：.app 应用包，双击不出现终端窗口；osascript 原生对话框兜底报错
 *   启动器本身的流程与业务逻辑在两个平台上完全一致。
 */

// ------------------------------------------------------- 启动参数 / 环境变量
/**
 * 读取运行参数。
 *
 * 普通用户双击启动时**没有任何参数**，一切走默认值；这些开关只用于：
 *   - 自动化验收（自检脚本需要固定端口、不弹浏览器、数据写到临时副本）；
 *   - 技术支持（例如让用户换一个端口启动）。
 *
 * 命令行参数优先于环境变量。参数扫描只看 argv 里形如 --name / --name=value 的项，
 * 因此不依赖 argv[0..1] 的布局差异（原生 Mach-O 与 Node SEA 的 argv 长度不同）。
 */
function readFlag(name) {
  const prefix = `--${name}=`
  for (const arg of process.argv.slice(1)) {
    if (arg === `--${name}`) return ''
    if (arg.startsWith(prefix)) return arg.slice(prefix.length)
  }
  return null
}

const RUN_OPTIONS = (() => {
  const flagDebug = process.argv.slice(1).includes('--debug')
  return {
    debug: flagDebug || process.env.AI_EDU_DEBUG === '1',
    port: readFlag('port') ?? process.env.AI_EDU_PORT ?? null,
    noBrowser: process.argv.slice(1).includes('--no-browser') || process.env.AI_EDU_NO_BROWSER === '1',
    dataRoot: readFlag('data-root') ?? process.env.AI_EDU_DATA_ROOT ?? null,
    appRoot: readFlag('app-root') ?? process.env.AI_EDU_APP_ROOT ?? null,
  }
})()

/** 把命令行参数折叠进 env，供 paths.cjs 的 planRoots 统一处理 */
const RUN_ENV = {
  ...process.env,
  ...(RUN_OPTIONS.dataRoot ? { AI_EDU_DATA_ROOT: RUN_OPTIONS.dataRoot } : {}),
  ...(RUN_OPTIONS.appRoot ? { AI_EDU_APP_ROOT: RUN_OPTIONS.appRoot } : {}),
}

const DEBUG = RUN_OPTIONS.debug

// ------------------------------------------------------- 无控制台 / 无终端兜底
// 打包后的进程没有可用的 stdout/stderr 句柄（Windows GUI 子系统下句柄无效，
// macOS 由 Finder 启动时输出流向系统日志而不是终端），先替换掉 console，
// 避免 Node 内部（或第三方代码）写控制台时抛 EBADF 导致进程退出。
if (!DEBUG) {
  const noop = () => true
  for (const streamName of ['stdout', 'stderr']) {
    try {
      const stream = process[streamName]
      if (stream && typeof stream.write === 'function') {
        stream.write = noop
      }
    } catch {
      /* ignore */
    }
  }
  try {
    console.log = noop
    console.info = noop
    console.warn = noop
    console.error = noop
    console.debug = noop
    console.trace = noop
  } catch {
    /* ignore */
  }
}

const { APP_ID, APP_NAME, APP_VERSION, IS_MAC, resolveRoots } = require('./paths.cjs')
const { createLogger } = require('./logger.cjs')
const { openDatabase } = require('./db.cjs')
const { openSettings } = require('./settings.cjs')
const { createLocalServer, HOST } = require('./local-server.cjs')
const {
  OS_LABEL,
  openBrowser,
  probeHealth,
  probeHealthWithRetry,
  readLastPort,
  writeLastPort,
  showDialog,
  delay,
} = require('./platform.cjs')

const DEFAULT_PORT = 8765
const PORT_SCAN_LIMIT = 30 // 8765 ~ 8794

let logger = null
let server = null
let database = null
let settings = null
let shuttingDown = false
let activePort = null

/** 致命错误：写日志 + 弹窗，然后退出（绝不静默失败） */
function fatal(reason, error) {
  const detail = error && error.message ? error.message : error ? String(error) : ''
  const logFile = logger ? logger.file : '(日志未初始化)'
  const message =
    `${APP_NAME}启动失败\n\n` +
    `原因：${reason}${detail ? `\n${detail}` : ''}\n\n` +
    `详细日志已保存到：\n${logFile}` +
    // macOS 上数据目录在 Application Support 里，普通用户不容易手动找到
    (IS_MAC ? '\n\n（在「访达」中按 ⌘⇧G，粘贴上面的路径即可定位）' : '')

  if (logger) {
    logger.exception(`启动失败：${reason}`, error || new Error(detail || reason))
  }
  showDialog({ title: `${APP_NAME} 启动失败`, message, logFile })
  shutdown('fatal', 1)
}

function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  if (logger) logger.info(`本地服务退出（原因：${reason}）`)
  try {
    server?.close()
  } catch {
    /* ignore */
  }
  try {
    database?.checkpoint()
    database?.close()
  } catch {
    /* ignore */
  }
  try {
    logger?.close()
  } catch {
    /* ignore */
  }
  // 给日志流一点刷盘时间，然后退出
  setTimeout(() => process.exit(exitCode), 120)
}

/** 端口候选：优先复用上次成功的端口，保证浏览器 origin 稳定（聊天记录按 origin 隔离） */
function buildPortCandidates(lastPort) {
  const candidates = []
  if (lastPort) candidates.push(lastPort)
  for (let i = 0; i < PORT_SCAN_LIMIT; i += 1) {
    const port = DEFAULT_PORT + i
    if (!candidates.includes(port)) candidates.push(port)
  }
  return candidates
}

function tryListen(target, port) {
  return new Promise((resolve) => {
    const onError = (error) => {
      cleanup()
      resolve({ ok: false, code: error.code || 'UNKNOWN' })
    }
    const onListening = () => {
      cleanup()
      resolve({ ok: true })
    }
    function cleanup() {
      target.off('error', onError)
      target.off('listening', onListening)
    }
    target.once('error', onError)
    target.once('listening', onListening)
    target.listen(port, HOST)
  })
}

async function main() {
  // ---------------------------------------------------------------- 1. 目录与日志
  const roots = resolveRoots({ env: RUN_ENV })
  logger = createLogger({ logDir: roots.logDir, debug: DEBUG })

  logger.info('='.repeat(60))
  logger.info(`${APP_NAME} 便携版启动 平台=${OS_LABEL} 版本=${APP_VERSION} pid=${process.pid}`)
  logger.info(`程序文件：${process.execPath}`)
  logger.info(`当前工作目录：${process.cwd()}`)
  logger.info(`资源根目录：${roots.resourceRoot}（${roots.resourceReason}）`)
  logger.info(`前端资源：${roots.webRoot}`)
  logger.info(`数据目录：${roots.dataRoot}（${roots.dataModeLabel}）`)
  // macOS 上「数据不放在应用包里」是既定约定而非异常，因此按信息级记录（不是警告）
  if (roots.fallbackReason) logger.info(roots.fallbackReason)
  logger.info(`日志文件：${logger.file}`)

  // ---------------------------------------------------------------- 2. 检查配置 / 资源
  const fs = require('node:fs')
  if (!fs.existsSync(`${roots.webRoot}/index.html`)) {
    fatal(`前端资源缺失，未找到 ${roots.webRoot}/index.html。请重新完整解压压缩包。`)
    return
  }

  // ---------------------------------------------------------------- 2.1 本地数据（SQLite + 配置）
  try {
    database = openDatabase({ dataDir: roots.dataDir, logger })
  } catch (error) {
    fatal('本地聊天数据库无法打开或创建。', error)
    return
  }

  try {
    settings = openSettings({ configDir: roots.configDir, logger })
  } catch (error) {
    fatal('本地配置文件无法读取或创建。', error)
    return
  }

  const dbStats = database.stats()
  const publicSettings = settings.getPublicSettings()

  logger.info(`数据库文件：${dbStats.path}`)
  logger.info(`配置文件：${settings.file}`)
  logger.info(`数据库结构版本：${dbStats.schemaVersion}`)
  logger.info(`历史迁移状态：${database.getMeta('indexeddb_migration_v1') === 'true' ? '已完成' : '未完成'}`)
  logger.info(`本地会话数量：${dbStats.conversationCount}`)
  logger.info(
    `API 配置：model=${publicSettings.model} baseUrl=${publicSettings.baseUrl} apiKey=${publicSettings.maskedApiKey || '(未配置)'}`,
  )
  if (dbStats.corruptedBackup) {
    logger.warn(`检测到数据库损坏，原文件已备份为：${dbStats.corruptedBackup}`)
  }

  // ---------------------------------------------------------------- 3. 单实例 + 端口
  const lastPort = readLastPort(roots.configDir)
  // 测试/调试可用 --port=8799 或 AI_EDU_PORT=8799 固定端口；正式使用时不设置，走「上次端口 → 8765 起顺延」
  const forcedPort = Number.parseInt(RUN_OPTIONS.port ?? '', 10)
  const useForcedPort = Number.isInteger(forcedPort) && forcedPort >= 1024 && forcedPort <= 65535
  const candidates = useForcedPort ? [forcedPort] : buildPortCandidates(lastPort)
  logger.info(
    `端口候选：${candidates.slice(0, 6).join(', ')}${candidates.length > 6 ? ' ...' : ''}（上次使用：${lastPort ?? '无'}${useForcedPort ? '，已固定端口' : ''}）`,
  )

  for (const port of candidates) {
    // 3.1 已有实例在运行 → 直接打开它的页面，不再启动第二个服务
    const existing = await probeHealth(port)
    if (existing) {
      logger.info(
        `端口 ${port} 上已存在运行中的实例（便携版 ${existing.portableVersion ?? existing.version ?? 'unknown'}），直接复用`,
      )
      openBrowser(`http://${HOST}:${port}`)
      shutdown('reuse-existing', 0)
      return
    }

    // 3.2 尝试监听
    const localServer = createLocalServer({
      port,
      webRoot: roots.webRoot,
      logger,
      version: APP_VERSION,
      onShutdown: (reason) => shutdown(reason, 0),
      db: database,
      settings,
      appRoot: roots.dataRoot,
    })

    const result = await tryListen(localServer, port)
    if (result.ok) {
      server = localServer
      activePort = port
      break
    }

    if (result.code === 'EADDRINUSE') {
      // 可能另一个实例正在启动，稍等一下再确认
      const appeared = await probeHealthWithRetry(port, 6000)
      if (appeared) {
        logger.info(`端口 ${port} 上的实例启动完成，直接复用`)
        openBrowser(`http://${HOST}:${port}`)
        shutdown('reuse-existing', 0)
        return
      }
      logger.warn(`端口 ${port} 已被其他程序占用，尝试下一个端口`)
      continue
    }

    fatal(`无法监听 ${HOST}:${port}（${result.code}）。`, new Error(result.code))
    return
  }

  if (!server || activePort === null) {
    fatal(`端口 ${candidates[0]}~${candidates[candidates.length - 1]} 全部被占用，无法启动本地服务。`)
    return
  }

  if (!useForcedPort) writeLastPort(roots.configDir, activePort)
  const url = `http://${HOST}:${activePort}`
  logger.info(`本地服务已监听 ${url}（仅本机可访问）`)

  // ---------------------------------------------------------------- 4. 健康检查
  let healthy = null
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    healthy = await probeHealth(activePort, 2000)
    if (healthy) break
    await delay(250)
  }

  if (!healthy) {
    fatal(
      '本地服务启动失败。',
      new Error(`健康检查未通过：${url}/api/health（20 秒超时）`),
    )
    return
  }

  logger.info(
    `健康检查通过：service=${healthy.service ?? 'unknown'} 转发模块=${healthy.version ?? 'unknown'} 便携版=${healthy.portableVersion ?? APP_VERSION}`,
  )

  // ---------------------------------------------------------------- 5. 打开默认浏览器
  let opened = true
  if (RUN_OPTIONS.noBrowser) {
    // 供自动化测试使用：只启动服务，不弹浏览器
    logger.info(`已跳过自动打开浏览器（--no-browser / AI_EDU_NO_BROWSER=1）：${url}`)
  } else {
    opened = openBrowser(url)
    logger.info(`打开默认浏览器：${url} → ${opened ? '已发起' : '失败'}`)
    if (!opened) {
      logger.warn('自动打开浏览器失败，请手动访问上面的地址')
    }
  }

  // ---------------------------------------------------------------- 6. 常驻
  process.on('SIGINT', () => shutdown('sigint', 0))
  process.on('SIGTERM', () => shutdown('sigterm', 0))
}

process.on('uncaughtException', (error) => {
  if (logger) {
    logger.exception('未捕获异常', error)
  }
  // 服务已经起来过就只记录，不再弹窗打扰用户
  if (!server) {
    fatal('程序发生未捕获异常。', error)
  }
})

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason))
  if (logger) logger.exception('未处理的 Promise 拒绝', error)
  if (!server) fatal('程序发生未处理的异常。', error)
})

main().catch((error) => {
  fatal('启动过程发生异常。', error)
})

// 供调试：把启动器状态暴露到日志
if (DEBUG) {
  logger?.debug(`APP_ID=${APP_ID}`)
}
