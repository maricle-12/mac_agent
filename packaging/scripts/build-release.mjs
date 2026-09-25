#!/usr/bin/env node
/**
 * 一键构建 Windows 免安装便携版。
 *
 * 流程：
 *   1. 清理旧的 Windows 构建产物（不动 macOS 的 .dmg）
 *   2. 前端构建（vite，mode=portable，接口地址 = 同源 /api/chat）
 *   3. 用 esbuild 把现有 Worker 源码原样打包成 CJS（源码零改动）
 *   4. 用 esbuild 把启动器打包成单文件 CJS（注入版本号）
 *   5. 从品牌素材生成多尺寸产品图标 app.ico
 *   6. Node SEA：生成 blob → 复制 node.exe → 注入 blob → 写入图标与版本资源 → 改为 GUI 子系统
 *   7. 组装 release/AI教育智能体/（exe + resources/web + data + config + logs + 使用说明）
 *   8. 静态检查（资源齐全、无开发机密、版本一致、无控制台窗口、SEA fuse 已翻开）
 *   9. 发行包自检（在临时副本里真正启动 EXE，把关键接口全部打一遍）
 *  10. 生成 AI教育智能体_v<版本>_Windows.zip
 *
 * 说明：整个过程只做「打包」，不修改任何智能体业务逻辑。
 * 平台无关的部分集中在 scripts/lib/common.mjs；macOS 版本见 scripts/build-mac.mjs。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { inject } from 'postject'

import { setGuiSubsystem, readSubsystem } from './pe.mjs'
import { applyWindowsMetadata, readWindowsMetadata } from './pe-metadata.mjs'
import { generateIconAssets } from './icon.mjs'
import { smokeTest } from './smoke-test.mjs'
import { zipDirectory } from './zip.mjs'
import { hasEnabledSeaFuse } from './macho.mjs'
import {
  APP_DIR_NAME,
  DATA_NOTE,
  CONFIG_NOTE,
  LOGS_NOTE,
  NODE_SEA_BLOB_RESOURCE,
  NODE_SEA_FUSE,
  SMOKE_PORT,
  WIN_EXE_NAME,
  WIN_README_TEXT,
  buildFrontend,
  buildSeaBlob,
  bundleLauncher,
  cleanOwnOutputs,
  dirSize,
  ensureBuildDeps,
  ensureWorkerBundle,
  fail,
  humanSize,
  launcherVersionMatches,
  log,
  readProjectInfo,
  scanRelease,
} from './lib/common.mjs'

const EXE_NAME = WIN_EXE_NAME

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packagingDir = path.resolve(__dirname, '..')
const demoRoot = path.resolve(packagingDir, '..')
const buildDir = path.join(packagingDir, 'build')
const assetsDir = path.join(packagingDir, 'assets')
const releaseRoot = path.join(demoRoot, 'release')

const APP_DIR = path.join(releaseRoot, APP_DIR_NAME)

// 版本号以 package.json 为唯一来源，并与前端 appConfig.version 保持一致
const { version: VERSION, appConfigVersion } = readProjectInfo(demoRoot)
const ZIP_NAME = `${APP_DIR_NAME}_v${VERSION}_Windows.zip`

async function main() {
  console.log(`\n=== 构建 ${APP_DIR_NAME} 便携版 v${VERSION}（Windows） ===\n`)

  if (process.platform !== 'win32') {
    fail('Windows 发行版只能在 Windows 上构建（Node SEA 的 PE 头部改写需要 Windows 自带的 node.exe）。macOS 请用 npm run build:mac。')
  }
  if (appConfigVersion !== VERSION) {
    fail(`版本号不一致：package.json = ${VERSION}，src/config/app.ts = ${appConfigVersion}`)
  }
  ensureBuildDeps(packagingDir)

  // ---------------------------------------------------------------- 1. 清理
  log('1/10', '清理旧的 Windows 构建产物')
  // 只删本平台的产物：release/AI教育智能体/ 与旧版本的 Windows ZIP。
  // 有意不删整个 release/ —— macOS 的 .dmg 也要放在这里。
  const staleZips = fs.existsSync(releaseRoot)
    ? fs
        .readdirSync(releaseRoot)
        .filter((name) => /^AI教育智能体_v.*_Windows\.zip$/.test(name))
        .map((name) => path.join(releaseRoot, name))
    : []
  cleanOwnOutputs({ targets: [buildDir, APP_DIR, ...staleZips] })
  fs.mkdirSync(buildDir, { recursive: true })
  fs.mkdirSync(APP_DIR, { recursive: true })

  // ---------------------------------------------------------------- 2. 前端
  log('2/10', '构建前端静态资源（vite --mode portable）')
  buildFrontend(demoRoot)

  // ---------------------------------------------------------------- 3. Worker
  log('3/10', '打包现有 Worker 代码（源码不改动）')
  // 产物落在 packaging/build/worker.cjs —— 这是 local-server.cjs 里
  // require('../build/worker.cjs') 解析到的位置，Windows 与 macOS 共用同一份位置约定。
  await ensureWorkerBundle({ packagingDir, demoRoot, force: true })

  // ---------------------------------------------------------------- 4. 启动器
  log('4/10', '打包启动器（注入版本号）')
  const launcherBundlePath = path.join(buildDir, 'launcher.bundle.cjs')
  await bundleLauncher({ packagingDir, demoRoot, outfile: launcherBundlePath, version: VERSION })

  // ---------------------------------------------------------------- 5. 图标
  log('5/10', '生成产品图标（多尺寸 ICO）')
  const icon = generateIconAssets(assetsDir)
  log('5/10', `图标尺寸：${icon.sizes.join(', ')} → ${path.relative(demoRoot, icon.icoPath)}`)

  // ---------------------------------------------------------------- 6. EXE
  log('6/10', '生成可执行文件（Node SEA + 图标 + 版本资源 + 隐藏控制台）')
  const { blobPath } = buildSeaBlob({ demoRoot, buildDir, launcherBundlePath })

  const exePath = path.join(APP_DIR, EXE_NAME)
  fs.copyFileSync(process.execPath, exePath)

  // 顺序很重要：先注入 SEA 资源，再写图标/版本资源（resedit 会完整保留已有资源）
  await inject(exePath, NODE_SEA_BLOB_RESOURCE, fs.readFileSync(blobPath), {
    sentinelFuse: NODE_SEA_FUSE,
  })

  const metadata = applyWindowsMetadata(exePath, {
    icoPath: icon.icoPath,
    version: VERSION,
    productName: APP_DIR_NAME,
    fileDescription: APP_DIR_NAME,
    originalFilename: EXE_NAME,
    // 项目没有正式公司名与版权声明，按需求留空，不虚构
    companyName: '',
    copyright: '',
  })
  log('6/10', `版本资源：${metadata.version}，图标组：${metadata.icon} 张`)

  const subsystem = setGuiSubsystem(exePath)
  log('6/10', `子系统：${subsystem.before} → ${subsystem.after}（2 = GUI，双击不出现控制台）`)

  // ---------------------------------------------------------------- 7. 组装
  log('7/10', '组装发行目录')
  fs.cpSync(path.join(demoRoot, 'dist'), path.join(APP_DIR, 'resources', 'web'), { recursive: true })

  const dataDir = path.join(APP_DIR, 'data')
  const configDir = path.join(APP_DIR, 'config')
  const logsDir = path.join(APP_DIR, 'logs')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(configDir, { recursive: true })
  fs.mkdirSync(logsDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, '说明.txt'), DATA_NOTE, 'utf8')
  fs.writeFileSync(path.join(configDir, '说明.txt'), CONFIG_NOTE, 'utf8')
  fs.writeFileSync(path.join(logsDir, '说明.txt'), LOGS_NOTE, 'utf8')
  fs.writeFileSync(path.join(APP_DIR, '使用说明.txt'), WIN_README_TEXT, 'utf8')

  // ---------------------------------------------------------------- 8. 静态检查
  log('8/10', '静态检查与安全扫描')

  const checks = []
  const assetDir = path.join(APP_DIR, 'resources', 'web', 'assets')
  const bundleFiles = fs.existsSync(assetDir)
    ? fs.readdirSync(assetDir).filter((name) => name.endsWith('.js'))
    : []
  let bundleText = ''
  for (const name of bundleFiles) bundleText += fs.readFileSync(path.join(assetDir, name), 'utf8')

  const launcherBundle = fs.readFileSync(launcherBundlePath, 'utf8')
  const windowsMeta = readWindowsMetadata(exePath)

  checks.push(['启动智能体.exe 存在', fs.existsSync(exePath)])
  checks.push(['前端 index.html 存在', fs.existsSync(path.join(APP_DIR, 'resources', 'web', 'index.html'))])
  checks.push(['前端 assets 目录存在', fs.existsSync(assetDir)])
  checks.push(['使用说明.txt 存在', fs.existsSync(path.join(APP_DIR, '使用说明.txt'))])
  checks.push([
    'data / config / logs 目录存在',
    fs.existsSync(dataDir) && fs.existsSync(configDir) && fs.existsSync(logsDir),
  ])
  checks.push(['可执行文件为 GUI 子系统（无控制台窗口）', readSubsystem(exePath) === 2])
  checks.push(['SEA blob 已注入且 fuse 已翻开（程序真的能自启动）', hasEnabledSeaFuse(exePath)])
  checks.push([`EXE 版本 = ${VERSION}`, windowsMeta?.fileVersion === VERSION && windowsMeta?.productVersion === VERSION])
  checks.push([`EXE 产品名 = ${APP_DIR_NAME}`, windowsMeta?.productName === APP_DIR_NAME])
  checks.push([`EXE 原始文件名 = ${EXE_NAME}`, windowsMeta?.originalFilename === EXE_NAME])
  checks.push(['EXE 已写入产品图标', (windowsMeta?.iconGroups ?? 0) > 0])
  checks.push(['版本号一致（package.json = appConfig）', appConfigVersion === VERSION])
  checks.push(['启动器注入的版本号正确', launcherVersionMatches(launcherBundlePath, VERSION)])
  checks.push(['前端接口地址为同源 /api/chat', bundleText.includes('/api/chat')])
  checks.push(['前端不含云端 Worker 地址', !bundleText.includes('workers.dev')])
  checks.push(['启动器不含开发机绝对路径', !/H:\\agent|C:\\Users/.test(launcherBundle)])
  checks.push(['发行包为首次启动状态（无数据库/配置/日志）', !fs.existsSync(path.join(dataDir, 'app.db')) && !fs.existsSync(path.join(configDir, 'settings.json')) && !fs.existsSync(path.join(logsDir, 'app.log'))])

  const scan = scanRelease(APP_DIR, {
    textRoots: [
      path.join(APP_DIR, 'resources'),
      dataDir,
      configDir,
      logsDir,
    ],
    extraTextFiles: fs.readdirSync(APP_DIR).filter((name) => name.endsWith('.txt')).map((name) => path.join(APP_DIR, name)),
    executables: [exePath],
  })
  checks.push([
    `安全扫描通过（已扫描 ${scan.scannedTextFiles} 个文本文件 + EXE）`,
    scan.findings.length === 0,
  ])
  checks.push(['发行包中不含 .env / node_modules', scan.forbidden.length === 0])

  let failed = 0
  for (const [name, ok] of checks) {
    console.log(`   ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`)
    if (!ok) failed += 1
  }
  for (const finding of scan.findings) console.log(`   \x1b[31m!\x1b[0m ${finding}`)
  for (const item of scan.forbidden) console.log(`   \x1b[31m!\x1b[0m 不允许的文件：${item}`)
  if (failed > 0) fail(`有 ${failed} 项检查未通过`)

  // ---------------------------------------------------------------- 9. 自检
  log('9/10', '发行包自检（在临时副本中启动 EXE 并打接口）')
  const smoke = await smokeTest({
    appDir: APP_DIR,
    executableRelPath: EXE_NAME,
    port: SMOKE_PORT,
    log: (message) => console.log(message),
  })
  if (!smoke.ok) fail('发行包自检未通过')
  if (fs.existsSync(path.join(dataDir, 'app.db'))) {
    fail('自检污染了正式发行目录（data/app.db 不应存在）')
  }

  // ---------------------------------------------------------------- 10. ZIP
  log('10/10', '生成 ZIP 压缩包')
  const zipPath = path.join(releaseRoot, ZIP_NAME)
  const zipResult = zipDirectory(APP_DIR, zipPath)

  const exeSize = fs.statSync(exePath).size
  const appSize = dirSize(APP_DIR)
  const zipSize = fs.statSync(zipPath).size

  console.log('\n=== 构建完成（Windows） ===')
  console.log(`发行目录：${APP_DIR}`)
  console.log(`  启动智能体.exe  ${humanSize(exeSize)}`)
  console.log(`  整个目录        ${humanSize(appSize)}`)
  console.log(`ZIP：${zipPath}`)
  console.log(`  ${humanSize(zipSize)}（${zipResult.fileCount} 个文件）`)
  console.log('')
}

main().catch((error) => {
  fail(error && error.stack ? error.stack : String(error))
})
