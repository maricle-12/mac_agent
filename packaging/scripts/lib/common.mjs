/**
 * Windows / macOS 两个打包脚本共用的构建工具。
 *
 * 抽出来的原则：**平台无关的部分只写一遍**。
 *   平台无关：前端构建、Worker 打包、启动器打包、版本一致性、安全扫描、ZIP/DMG 命名、用户说明文本。
 *   平台相关：可执行文件如何生成（PE + 图标/版本资源/GUI 子系统 ↔ Mach-O + .app 包 + 签名）、
 *             交付物格式（ZIP ↔ DMG）。
 *
 * 本文件不修改任何智能体业务逻辑，只做「打包」。
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import * as esbuild from 'esbuild'

// ---------------------------------------------------------------- 产品标识（唯一来源）

export const APP_DIR_NAME = 'AI教育智能体'
export const WIN_EXE_NAME = '启动智能体.exe'
export const MAC_APP_NAME = `${APP_DIR_NAME}.app`
export const MAC_EXECUTABLE_NAME = '启动智能体'
/** macOS 应用标识。项目没有正式域名，这里用不含公司主张的稳定标识，不虚构组织信息。 */
export const APP_BUNDLE_ID = 'ai-edu-agent.portable'
/** macOS 应用包内部放资源的目录，相对 .app 根目录（与启动器 paths.cjs 的约定一致） */
export const MAC_BUNDLE_RESOURCE_SUBDIR = path.join('Contents', 'Resources', 'app')

export const NODE_SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
export const NODE_SEA_BLOB_RESOURCE = 'NODE_SEA_BLOB'
export const NODE_SEA_SEGMENT = 'NODE_SEA'

/** 自检用的端口（与默认端口错开，避免撞上正在运行的实例） */
export const SMOKE_PORT = 8799

// ---------------------------------------------------------------- 日志 / 失败

export function log(step, message) {
  console.log(`\x1b[36m[${step}]\x1b[0m ${message}`)
}

export function note(message) {
  console.log(`   ${message}`)
}

export function fail(message) {
  console.error(`\x1b[31m[失败]\x1b[0m ${message}`)
  process.exit(1)
}

// ---------------------------------------------------------------- 文件系统

export function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true })
}

export function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  fs.cpSync(from, to, { recursive: true })
}

/** 递归收集文件（可选过滤） */
export function walk(dir, filter = () => true) {
  const files = []
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name)
    if (item.isDirectory()) files.push(...walk(full, filter))
    else if (item.isFile() && filter(full)) files.push(full)
  }
  return files
}

export function humanSize(bytes) {
  if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

export function dirSize(dir) {
  let total = 0
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name)
    if (item.isDirectory()) total += dirSize(full)
    else if (item.isFile()) total += fs.statSync(full).size
  }
  return total
}

// ---------------------------------------------------------------- 命令执行

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) fail(`执行 ${command} 失败：${result.error.message}`)
  if (result.status !== 0) fail(`${command} ${args.join(' ')} 退出码 ${result.status}`)
}

/** 执行一条完整命令行（Windows 上 npm 是 .cmd，必须走 shell；macOS 上是 sh 脚本，同样适用） */
export function runLine(commandLine, options = {}) {
  const result = spawnSync(commandLine, { stdio: 'inherit', shell: true, ...options })
  if (result.error) fail(`执行 ${commandLine} 失败：${result.error.message}`)
  if (result.status !== 0) fail(`${commandLine} 退出码 ${result.status}`)
}

/**
 * 构建期依赖（esbuild / postject / resedit）缺失时自动安装。
 * 只有开发机构建用得到；发行包里不含 node_modules。
 */
export function ensureBuildDeps(packagingDir) {
  const marker = path.join(packagingDir, 'node_modules', 'esbuild')
  if (fs.existsSync(marker)) return
  log('0/x', '安装构建期依赖（esbuild / postject / resedit）')
  runLine('npm install --no-audit --no-fund', { cwd: packagingDir })
}

// ---------------------------------------------------------------- 版本一致性

/**
 * 版本号以 package.json 为唯一来源，并与前端 appConfig.version 交叉校验。
 * 版本漂移是发布事故里最常见的一类，所以在构建开始就拦住。
 */
export function readProjectInfo(demoRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(demoRoot, 'package.json'), 'utf8'))
  const appConfigSource = fs.readFileSync(path.join(demoRoot, 'src', 'config', 'app.ts'), 'utf8')
  const appConfigVersion = /version:\s*'([^']+)'/.exec(appConfigSource)?.[1]
  return { pkg, version: pkg.version, appConfigVersion }
}

// ---------------------------------------------------------------- 三块平台无关的打包

/** 1. 前端静态资源（mode=portable，接口地址 = 同源 /api/chat） */
export function buildFrontend(demoRoot) {
  runLine('npm run build:portable', { cwd: demoRoot })
  if (!fs.existsSync(path.join(demoRoot, 'dist', 'index.html'))) {
    fail('前端构建产物缺失：dist/index.html')
  }
}

/** 2. 现有 Worker 代码原样打包成 CJS（worker/src/** 一个字符都不改） */
export async function bundleWorker({ demoRoot, outfile }) {
  await esbuild.build({
    entryPoints: [path.join(demoRoot, 'worker', 'src', 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile,
    logLevel: 'warning',
  })
}

/**
 * 构建期的**唯一固定约定**：Worker 产物必须落在 <packaging>/build/worker.cjs。
 *
 * 原因：`packaging/src/local-server.cjs` 里写的是
 *     const workerModule = require('../build/worker.cjs')
 * 这句相对路径是相对 `packaging/src/` 解析的，**只能**解析到 `packaging/build/worker.cjs`。
 * 打包启动器时 esbuild 会把这一句静态解析掉，所以：
 *
 *   - Windows 与 macOS 必须把 Worker 产物写到**同一个位置**（就是这里）；
 *   - 谁都不许自己拼一个别的目录名（例如 build-mac/worker.cjs），
 *     否则在干净环境里 esbuild 会直接报 "Could not resolve ../build/worker.cjs"。
 *
 * 历史上 macOS 构建就是这么失败的：它把产物写进了 packaging/build-mac/，
 * 而 local-server.cjs 只认 packaging/build/。Windows 构建刚好也用 packaging/build/，
 * 所以只有 macOS 会挂 —— 属于「看起来两边都写了 Worker 打包、其实路径不一致」。
 */
export const WORKER_BUNDLE_RELPATH = path.join('build', 'worker.cjs')

/** Worker 产物的绝对路径（Windows / macOS 共用这一个） */
export function workerBundlePath(packagingDir) {
  return path.join(packagingDir, WORKER_BUNDLE_RELPATH)
}

/**
 * 保证 Worker 产物存在，且落在 local-server.cjs 要求的那个位置。
 *
 * @param {{ packagingDir: string, demoRoot: string, force?: boolean }} options
 *   force=true 时总是重新生成（构建主流程用，保证产物与当前源码一致）；
 *   force=false 时仅在缺失时补生成（作为兜底，见 bundleLauncher 的前置检查）。
 */
export async function ensureWorkerBundle({ packagingDir, demoRoot, force = false }) {
  const outfile = workerBundlePath(packagingDir)
  const exists = fs.existsSync(outfile)
  if (exists && !force) return outfile

  console.log(exists ? 'worker bundle: rebuilding...' : 'worker bundle missing, generating...')
  console.log(`   ${path.relative(demoRoot, outfile)}  ←  worker/src/index.ts（esbuild 打包，源码不改动）`)

  try {
    fs.mkdirSync(path.dirname(outfile), { recursive: true })
    await bundleWorker({ demoRoot, outfile })
  } catch (error) {
    // 明确报「worker build failed」，而不是让调用方在后续 esbuild 解析里看到
    // "Could not resolve ../build/worker.cjs" 这种看不出根因的错误。
    console.error('worker build failed')
    console.error(`   原因：${error && error.message ? error.message : error}`)
    throw new Error(`worker build failed（无法把 worker/src/index.ts 打包到 ${outfile}）`)
  }

  const size = fs.existsSync(outfile) ? fs.statSync(outfile).size : 0
  if (size < 1024) {
    console.error('worker build failed')
    console.error(`   产物缺失或异常：${outfile}（${size} 字节）`)
    throw new Error('worker build failed')
  }

  console.log(`worker bundle ok（${(size / 1024).toFixed(1)} KB）`)
  return outfile
}

/**
 * 3. 启动器打包成单文件 CJS（注入版本号，供 paths.cjs 使用）。
 *
 * 打包前先做一次前置检查：launcher.cjs → local-server.cjs 里有一句
 * `require('../build/worker.cjs')`，esbuild 会尝试静态解析它；
 * 如果那个文件不存在，就会抛出难以定位的 "Could not resolve" 错误。
 * 这里就地补上，让「谁先谁后」不再是一个隐藏的隐含依赖。
 */
export async function bundleLauncher({ packagingDir, demoRoot, outfile, version }) {
  await ensureWorkerBundle({ packagingDir, demoRoot, force: false })
  await esbuild.build({
    entryPoints: [path.join(packagingDir, 'src', 'launcher.cjs')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile,
    define: { __APP_VERSION__: JSON.stringify(version) },
    logLevel: 'warning',
  })
}

/**
 * 4. Node SEA 准备 blob（平台无关）。
 * useSnapshot / useCodeCache 必须为 false：它们只能在编译它的平台上加载，
 * 而我们要把一个 blob 注入到不同架构的 Node 二进制里（参见 Node 官方文档）。
 */
export function buildSeaBlob({ demoRoot, buildDir, launcherBundlePath }) {
  const seaConfigPath = path.join(buildDir, 'sea-config.json')
  const blobPath = path.join(buildDir, 'sea-prep.blob')
  fs.writeFileSync(
    seaConfigPath,
    JSON.stringify(
      {
        main: path.relative(demoRoot, launcherBundlePath),
        output: path.relative(demoRoot, blobPath),
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
      },
      null,
      2,
    ),
  )

  run(process.execPath, ['--experimental-sea-config', path.relative(demoRoot, seaConfigPath)], {
    cwd: demoRoot,
  })
  if (!fs.existsSync(blobPath)) fail('SEA blob 生成失败')
  return { seaConfigPath, blobPath }
}

/** 打包后的启动器里的版本号是否与 package.json 一致（版本漂移会在这里暴露） */
export function launcherVersionMatches(launcherBundlePath, version) {
  const source = fs.readFileSync(launcherBundlePath, 'utf8')
  return source.includes(`"${version}"`)
}

// ---------------------------------------------------------------- 安全扫描

const COMMON_TEXT_RULES = [
  { name: '真实 API Key（sk- 后 20 位以上）', pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: 'DEEPSEEK_API_KEY', pattern: /DEEPSEEK_API_KEY/ },
  { name: 'OPENAI_API_KEY', pattern: /OPENAI_API_KEY/ },
  { name: 'Authorization / Bearer', pattern: /Bearer\s+[A-Za-z0-9._-]{8,}/ },
  { name: '已部署的 workers.dev 地址', pattern: /workers\.dev/ },
  // 注意用 \b：否则 "secondary" 里的 "conda" 会被误判
  { name: '开发机绝对路径', pattern: /H:\\agent|C:\\Users\\[^\\\s"']+|\/Users\/[^/\s"']+|\bconda\b|node_modules/ },
  { name: '开发端口（8787 / 5173）', pattern: /localhost:(8787|5173)|127\.0\.0\.1:(8787|5173)/ },
]

/**
 * 发行包不得包含任何开发机密。
 * 注意：脱敏后的界面文案形如 sk-****abcd，其中 * 不属于 [A-Za-z0-9]，因此不会被误判。
 *
 * rule.pattern 可以是正则，也可以是字符串（字符串按「子串包含」判定）——
 * 后者用于「构建机上的绝对路径」这类含分隔符、不适合写正则的检查。
 *
 * @param {string} appDir 发行目录（Windows）或应用包（macOS）
 * @param {{ textRoots: string[], extraTextFiles?: string[], executables: string[], binaryRules?: any[] }} options
 */
export function scanRelease(appDir, options) {
  const findings = []

  const textFiles = []
  for (const root of options.textRoots) {
    if (fs.existsSync(root)) {
      const stat = fs.statSync(root)
      if (stat.isDirectory()) textFiles.push(...walk(root))
      else textFiles.push(root)
    }
  }
  for (const file of options.extraTextFiles ?? []) {
    if (fs.existsSync(file)) textFiles.push(file)
  }

  const hit = (rule, content) =>
    typeof rule.pattern === 'string' ? content.includes(rule.pattern) : rule.pattern.test(content)

  for (const file of textFiles) {
    let content
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const rule of COMMON_TEXT_RULES) {
      if (hit(rule, content)) {
        findings.push(`${path.relative(appDir, file)} 命中「${rule.name}」`)
      }
    }
  }

  // 可执行文件按二进制扫描：只查真正的机密特征。
  // 注意这里**不**用泛化的 /Users/xxx 正则：主程序内嵌的是 Node 官方运行时，
  // 其中可能带有上游构建机的路径（例如 CI 的 /Users/runner/work/node/...），
  // 那属于上游内容而不是本项目泄露；调用方应改为传入**本项目自己的**绝对路径做子串检查。
  const binaryRules = options.binaryRules ?? [
    { name: '真实 API Key', pattern: /sk-[A-Za-z0-9_-]{20,}/ },
    { name: 'DEEPSEEK_API_KEY', pattern: /DEEPSEEK_API_KEY/ },
    { name: 'OPENAI_API_KEY', pattern: /OPENAI_API_KEY/ },
    { name: '开发机绝对路径', pattern: /H:\\agent|C:\\Users\\[A-Za-z]/ },
    { name: '已部署的 workers.dev 地址', pattern: /workers\.dev/ },
  ]
  for (const executable of options.executables) {
    if (!fs.existsSync(executable)) {
      findings.push(`缺少可执行文件：${path.relative(appDir, executable)}`)
      continue
    }
    const text = fs.readFileSync(executable).toString('latin1')
    for (const rule of binaryRules) {
      if (hit(rule, text)) findings.push(`${path.relative(appDir, executable)} 命中「${rule.name}」`)
    }
  }

  // 不允许出现的文件
  const forbidden = []
  for (const file of walk(appDir)) {
    const relative = path.relative(appDir, file)
    if (/(^|[\\/])\.env/.test(relative)) forbidden.push(relative)
    if (relative.includes('node_modules')) forbidden.push(relative)
  }

  return { findings, forbidden, scannedTextFiles: textFiles.length }
}

// ---------------------------------------------------------------- 用户说明文本

const COMMON_USAGE_HEAD = `【使用方法】
`

const COMMON_USAGE_TAIL = `【注意事项】

- 请不要删除保存数据的文件夹，否则历史记录或配置会丢失。
- 使用完毕后，如果想彻底关闭程序，可以在网页里的“关于”窗口点击“退出智能体”。
- 如果双击后浏览器没有自动打开，请等待几秒钟后再试一次。
- 如果提示启动失败，请把日志文件（app.log）提供给技术支持。
`

export const WIN_README_TEXT = `${COMMON_USAGE_HEAD}
1. 请先完整解压本压缩包（不要直接在压缩包里双击运行）。
2. 双击“启动智能体.exe”。
3. 程序会自动打开浏览器，进入智能体界面。
4. 首次使用请按照页面提示填写你自己的 DeepSeek API Key。
5. 以后再次使用，直接双击“启动智能体.exe”即可，不需要重新填写。

【我的数据在哪里】

- 聊天记录保存在本文件夹的 data 文件夹里，关掉软件、重启电脑都不会丢。
- API Key 保存在本文件夹的 config 文件夹里，只存在这台电脑上，不会上传到任何服务器。
- 换电脑使用时，把整个文件夹一起复制过去，聊天记录和配置会一起带走。

【注意事项】

- 请不要删除 data 和 config 文件夹，否则历史记录或配置会丢失。
- 请不要把“启动智能体.exe”单独复制到别处，它需要和同目录的文件一起使用。
- 使用完毕后，如果想彻底关闭程序，可以在网页里的“关于”窗口点击“退出智能体”。
- 如果双击后浏览器没有自动打开，请等待几秒钟后再双击一次。
- 如果提示启动失败，请把 logs 文件夹里的 app.log 提供给技术支持。
`

/** macOS 版本的用户说明。结尾的“首次打开”一段是必须的：应用未做 Apple 公证。 */
export function buildMacReadme({ archLabel }) {
  return `${COMMON_USAGE_HEAD}
1. 打开下载的磁盘映像（.dmg）文件。
2. 把“${APP_DIR_NAME}”图标拖到右侧的“应用程序”文件夹里。
3. 打开“启动台”或“应用程序”，点击“${APP_DIR_NAME}”。
4. 程序会自动打开浏览器，进入智能体界面（不会出现终端窗口）。
5. 首次使用请按照页面提示填写你自己的 DeepSeek API Key。
6. 以后再次使用，直接点击“${APP_DIR_NAME}”即可，不需要重新填写。

【首次打开被系统拦住怎么办】

本软件没有购买 Apple 开发者证书，因此第一次打开时 macOS 会提示
“无法验证开发者”或“无法检查是否包含恶意软件”。这是正常的，按下面任一方式即可打开：

- 方式一（推荐）：在“应用程序”里按住 Control 键点击“${APP_DIR_NAME}”，选择“打开”，
  在弹窗里再点一次“打开”。之后就可以正常双击打开了。
- 方式二：先双击一次（会弹出提示），然后打开
  “系统设置 → 隐私与安全性”，在“安全性”一栏点击“仍要打开”。

只有在系统提示“已损坏，无法打开”时（极少见），才需要在“终端”里执行一次：
  xattr -dr com.apple.quarantine /Applications/${MAC_APP_NAME}
这条命令只是去掉“从网上下载”的标记，不会修改程序本身。

【我的数据在哪里】

- 聊天记录与配置保存在你自己的用户目录下：
  ~/Library/Application Support/${APP_DIR_NAME}
  （在“访达”中按 ⌘⇧G，粘贴上面的路径即可打开。）
- 这些数据只存在这台电脑上，不会上传到任何服务器。
- 卸载软件时删除“应用程序”里的“${APP_DIR_NAME}”即可；上面那个数据文件夹可以保留，
  下次安装回来聊天记录还在；确认不需要时可以手动删除。

【这个安装包适合哪种 Mac】

- 本文件：${archLabel}
- 如果你的 Mac 是 Apple 芯片（M1 / M2 / M3 / M4 等），选择文件名带 arm64 或 universal 的版本。
- 如果是 Intel 处理器，选择文件名带 x64 或 universal 的版本。
- 不确定也没关系：带 universal 的版本两种芯片都能用。

${COMMON_USAGE_TAIL}`
}

export const DATA_NOTE = `这个文件夹保存聊天记录数据库（app.db），请不要删除。\n`
export const CONFIG_NOTE = `这个文件夹保存本机配置（API Key 与模型设置），请不要删除。\n`
export const LOGS_NOTE = `这个文件夹保存运行日志。启动失败时，请把 app.log 提供给技术支持。\n`

// ---------------------------------------------------------------- release 目录

/**
 * 清理本平台自己的旧产物。
 *
 * 有意**不**删除整个 release/ 目录：Windows 与 macOS 的交付物要能同时存在，
 * 打 Windows 包不应该把已经做好的 .dmg 删掉（反之亦然）。
 */
export function cleanOwnOutputs({ targets }) {
  for (const target of targets) rmrf(target)
}
