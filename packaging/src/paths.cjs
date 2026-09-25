'use strict'

/**
 * 便携版路径解析（跨平台）。
 *
 * 目标：正式发行版不依赖任何开发机路径（Conda / Python / Node 安装目录 / 当前工作目录），
 * 所有资源都通过「程序自身所在位置」定位，并且用户数据只写入稳定目录。
 *
 * 目录约定（Windows 发行版）：
 *   启动智能体.exe            程序本体（内置 Node 运行时）
 *   resources/web/            前端静态资源
 *   data/                     聊天数据库 app.db
 *   config/                   本机配置（API Key / 模型设置 / 上次端口）
 *   logs/                     运行日志
 *
 * 目录约定（macOS 发行版，应用包形式）：
 *   AI教育智能体.app/Contents/MacOS/启动智能体     程序本体（内置 Node 运行时）
 *   AI教育智能体.app/Contents/Resources/app/resources/web/   前端静态资源
 *   用户数据 → ~/Library/Application Support/AI教育智能体/{data,config,logs}
 *
 * 为什么 macOS 不把数据放在 .app 里：
 *   1. 写入应用包内容会破坏代码签名（Gatekeeper / 公证都会因此失效）；
 *   2. macOS 的既定约定就是用户数据放 Application Support；
 *   3. 用户从 DMG 直接运行时会被 App Translocation 挂载到只读随机路径，
 *      写在包内的数据每次启动都会「消失」。
 *   注意这里只改变**数据目录**，前端资源仍然从程序自身位置读取。
 *
 * 若程序所在目录不可写（例如 Windows 上被解压到 Program Files），
 * 数据目录自动回退到系统用户数据目录，但资源仍然从程序旁边读取。
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const APP_NAME = 'AI教育智能体'
const APP_ID = 'ai-edu-agent-portable'
/** macOS 应用包名（与构建脚本保持一致） */
const APP_BUNDLE_NAME = `${APP_NAME}.app`
/** macOS 可执行文件名（应用包 Contents/MacOS 下的那个文件） */
const MAC_EXECUTABLE_NAME = '启动智能体'
/** Windows 可执行文件名 */
const WIN_EXECUTABLE_NAME = '启动智能体.exe'

// 版本号由构建脚本在打包时注入（见 packaging/scripts/build-release.mjs 的 define），
// 保证 package.json / 前端 / 启动器 / EXE 版本资源四处一致。未打包时用占位值。
// eslint-disable-next-line no-undef
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev'

const IS_WINDOWS = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

/** 当前进程是否为 Node SEA 打包后的可执行文件 */
function isSea() {
  try {
    return require('node:sea').isSea() === true
  } catch {
    return false
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 目录是否真的可写（Windows 权限限制下 mkdir 可能成功但写文件失败） */
function isWritable(dir) {
  try {
    ensureDir(dir)
    const probe = path.join(dir, `.write-test-${process.pid}`)
    fs.writeFileSync(probe, 'ok')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

/** Windows 用户数据目录：%LOCALAPPDATA%\AI教育智能体 */
function windowsDataRoot(homeDir, env, j = path.join) {
  const base =
    env.LOCALAPPDATA && env.LOCALAPPDATA.trim()
      ? env.LOCALAPPDATA
      : j(homeDir, 'AppData', 'Local')
  return j(base, APP_NAME)
}

/** macOS 用户数据目录：~/Library/Application Support/AI教育智能体 */
function macDataRoot(homeDir, env, j = path.join) {
  void env
  return j(homeDir, 'Library', 'Application Support', APP_NAME)
}

/** Linux 用户数据目录：$XDG_DATA_HOME/AI教育智能体 或 ~/.local/share/AI教育智能体 */
function linuxDataRoot(homeDir, env, j = path.join) {
  const base =
    env.XDG_DATA_HOME && env.XDG_DATA_HOME.trim()
      ? env.XDG_DATA_HOME
      : j(homeDir, '.local', 'share')
  return j(base, APP_NAME)
}

/**
 * 判断 SEA 可执行文件是否位于 macOS 应用包内。
 * 传入的 exeDir 形如 <App>.app/Contents/MacOS，是包内则返回 Contents/Resources/app；
 * 直接运行裸二进制（开发 / 自测）时返回 null。
 *
 * @param {string} exeDir 可执行文件所在目录
 * @param {{ dirname: Function, basename: Function, join: Function }} p 该平台的 path 实现
 */
function macBundleResourceRoot(exeDir, p) {
  if (p.basename(exeDir) !== 'MacOS') return null
  const contentsDir = p.dirname(exeDir)
  if (p.basename(contentsDir) !== 'Contents') return null
  return p.join(contentsDir, 'Resources', 'app')
}

/**
 * 纯函数式的目录规划：只计算路径，不创建目录、不写文件。
 *
 * 之所以把「计算」和「落地」拆开，是为了能在任意一台机器上验证
 * macOS / Linux 的路径规则（打包自检会用它断言，而不是靠肉眼看代码）。
 *
 * @param {{
 *   platform?: NodeJS.Platform,
 *   execPath?: string,
 *   env?: NodeJS.ProcessEnv,
 *   homeDir?: string,
 *   sea?: boolean,
 *   writable?: (dir: string) => boolean,
 * }} [options]
 */
function planRoots(options = {}) {
  const platform = options.platform ?? process.platform
  const execPath = options.execPath ?? process.execPath
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? os.homedir()
  const sea = options.sea ?? isSea()
  const writable = options.writable ?? isWritable
  // 按目标平台选择 path 实现：这样在 Windows 上也能把 macOS / Linux 的规则算准
  const p = platform === 'win32' ? path.win32 : path.posix
  const j = p.join
  const resolve = p.resolve

  const exeDir = p.dirname(execPath)

  // ---------------------------------------------------------------- 资源根目录
  let resourceRoot
  let resourceReason
  const forcedAppRoot = env.AI_EDU_APP_ROOT && env.AI_EDU_APP_ROOT.trim()

  if (forcedAppRoot) {
    resourceRoot = resolve(forcedAppRoot)
    resourceReason = 'AI_EDU_APP_ROOT 显式指定（开发 / 自测）'
  } else if (sea) {
    if (platform === 'darwin') {
      const bundleRoot = macBundleResourceRoot(exeDir, p)
      resourceRoot = bundleRoot ?? exeDir
      resourceReason = bundleRoot ? 'macOS 应用包 Contents/Resources/app' : 'macOS 可执行文件所在目录（非应用包）'
    } else {
      resourceRoot = exeDir
      resourceReason = '可执行文件所在目录'
    }
  } else {
    // 未打包时（node launcher.cjs）回退到仓库目录，方便开发调试
    resourceRoot = path.resolve(__dirname, '..', '..')
    resourceReason = '仓库目录（未打包）'
  }

  // ---------------------------------------------------------------- 数据根目录
  let dataRoot
  let portable = false
  let dataModeLabel
  let fallbackReason = null

  if (env.AI_EDU_DATA_ROOT && env.AI_EDU_DATA_ROOT.trim()) {
    dataRoot = resolve(env.AI_EDU_DATA_ROOT)
    portable = true
    dataModeLabel = 'AI_EDU_DATA_ROOT 显式指定（自动化测试）'
  } else if (forcedAppRoot) {
    dataRoot = resourceRoot
    portable = true
    dataModeLabel = '便携模式（数据与程序同目录）'
  } else if (platform === 'darwin') {
    dataRoot = macDataRoot(homeDir, env, j)
    dataModeLabel = 'macOS 标准位置（用户数据不写入应用包）'
    fallbackReason =
      `macOS 约定：聊天记录与配置保存在 ${dataRoot}。` +
      '不写入应用包内部，避免破坏应用签名、也避免从 DMG 直接运行时数据丢失。'
  } else if (writable(resourceRoot)) {
    dataRoot = resourceRoot
    portable = true
    dataModeLabel = '便携模式（数据与程序同目录）'
  } else {
    dataRoot =
      platform === 'win32' ? windowsDataRoot(homeDir, env, j) : linuxDataRoot(homeDir, env, j)
    dataModeLabel = '回退模式（程序目录不可写）'
    fallbackReason = `程序目录不可写（${resourceRoot}），已回退到 ${dataRoot}`
  }

  // 前端静态资源：发行版在 resources/web，开发时直接用 vite 的 dist
  const packagedWeb = j(resourceRoot, 'resources', 'web')
  const devWeb = j(resourceRoot, 'dist')

  return {
    resourceRoot,
    resourceReason,
    packagedWeb,
    devWeb,
    dataRoot,
    dataDir: j(dataRoot, 'data'),
    configDir: j(dataRoot, 'config'),
    logDir: j(dataRoot, 'logs'),
    portable,
    dataModeLabel,
    fallbackReason,
  }
}

/**
 * 解析全部运行期目录（在 planRoots 的结果上真正创建目录）。
 * @returns {{ resourceRoot: string, resourceReason: string, webRoot: string, dataRoot: string, configDir: string, logDir: string, dataDir: string, portable: boolean, dataModeLabel: string, fallbackReason: string|null }}
 */
function resolveRoots(options = {}) {
  const plan = planRoots(options)
  const hasPackagedWeb = fs.existsSync(path.join(plan.packagedWeb, 'index.html'))
  const webRoot = hasPackagedWeb ? plan.packagedWeb : plan.devWeb

  return {
    resourceRoot: plan.resourceRoot,
    resourceReason: plan.resourceReason,
    webRoot,
    dataRoot: plan.dataRoot,
    dataDir: ensureDir(plan.dataDir),
    configDir: ensureDir(plan.configDir),
    logDir: ensureDir(plan.logDir),
    portable: plan.portable,
    dataModeLabel: plan.dataModeLabel,
    fallbackReason: plan.fallbackReason,
  }
}

module.exports = {
  APP_NAME,
  APP_ID,
  APP_BUNDLE_NAME,
  APP_VERSION,
  WIN_EXECUTABLE_NAME,
  MAC_EXECUTABLE_NAME,
  IS_WINDOWS,
  IS_MAC,
  isSea,
  ensureDir,
  isWritable,
  planRoots,
  resolveRoots,
}
