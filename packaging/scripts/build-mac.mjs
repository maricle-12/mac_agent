#!/usr/bin/env node
/**
 * 一键构建 macOS 免安装版（.app 应用包 + .dmg 磁盘映像）。
 *
 * 与 build-release.mjs（Windows）严格对称，平台无关的部分共用 scripts/lib/common.mjs：
 *
 *   1. 清理旧的 macOS 构建产物（不动 Windows 的 zip）
 *   2. 前端构建（vite，mode=portable，接口地址 = 同源 /api/chat）      ← 与 Windows 同一份
 *   3. esbuild 打包现有 Worker（worker/src/** 一个字符都不改）          ← 与 Windows 同一份
 *   4. esbuild 打包启动器（注入版本号）                                 ← 与 Windows 同一份
 *   5. 生成 macOS 图标 app.icns（从既有品牌素材，不重新设计）
 *   6. Node SEA：取目标架构的官方 node 二进制 → 去掉原签名 → 注入 blob → ad-hoc 重新签名
 *   7. 组装 AI教育智能体.app（Info.plist + Contents/MacOS + Contents/Resources/app）
 *   8. 静态检查（plutil、Mach-O 架构、SEA 段、签名、安全扫描、首次启动状态）
 *   9. 发行包自检（直接启动 + 用 LaunchServices「双击」启动，打真实接口）
 *  10. hdiutil 生成 DMG 并挂载验收（镜像校验、签名复验、Gatekeeper 结论）
 *
 * 为什么必须在 Mac 上运行：
 *   - SE算 注入后原签名必然失效，Apple 芯片要求所有二进制都有有效签名，
 *     必须用 /usr/bin/codesign 重新做 ad-hoc 签名；codesign 只有 macOS 有。
 *   - .dmg 是 Apple 的 UDIF 格式，只有 /usr/bin/hdiutil 能生成正式可挂载的压缩镜像。
 *   Windows 侧可以做完 1~5 步（见 paths-check 与 Windows 构建），真正必须在 Mac 上的只有 6~10。
 *
 * 用法：
 *   npm run build:mac                     # 通用（arm64 + x64 合成一个 .app → 一个 .dmg）
 *   npm run build:mac:arm64               # 只出 Apple 芯片版
 *   npm run build:mac:x64                 # 只出 Intel 版
 *   node packaging/scripts/build-mac.mjs --arch=universal --node-mirror=https://npmmirror.com/mirrors/node
 *   可选：--node-binary=/path/to/node（离线，自备对应版本二进制）
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { inject } from 'postject'

import { generateMacIconAssets } from './icon.mjs'
import { buildPlist, parsePlistTopLevel } from './plist.mjs'
import { readMachO, hasEnabledSeaFuse, SEA_SEGMENT_NAME, SEA_RESOURCE_NAME } from './macho.mjs'
import { createDmg, verifyDmg } from './dmg.mjs'
import { smokeTest } from './smoke-test.mjs'
import {
  APP_BUNDLE_ID,
  APP_DIR_NAME,
  MAC_APP_NAME,
  MAC_BUNDLE_RESOURCE_SUBDIR,
  MAC_EXECUTABLE_NAME,
  NODE_SEA_FUSE,
  SMOKE_PORT,
  buildFrontend,
  buildMacReadme,
  buildSeaBlob,
  bundleLauncher,
  bundleWorker,
  cleanOwnOutputs,
  dirSize,
  ensureBuildDeps,
  fail,
  humanSize,
  launcherVersionMatches,
  log,
  note,
  readProjectInfo,
  run,
  scanRelease,
} from './lib/common.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packagingDir = path.resolve(__dirname, '..')
const demoRoot = path.resolve(packagingDir, '..')
const buildRoot = path.join(packagingDir, 'build-mac')
const assetsDir = path.join(packagingDir, 'assets')
const releaseRoot = path.join(demoRoot, 'release')
const nodeCacheDir = path.join(buildRoot, 'node-cache')

const MAC_MIN_SYSTEM_VERSION = '11.0'
const NODE_MIRROR_DEFAULT = 'https://nodejs.org/dist'

const { version: VERSION, appConfigVersion } = readProjectInfo(demoRoot)
const NODE_VERSION = process.versions.node

// ---------------------------------------------------------------- 命令行参数

function flag(name) {
  const prefix = `--${name}=`
  for (const arg of process.argv.slice(2)) {
    if (arg === `--${name}`) return ''
    if (arg.startsWith(prefix)) return arg.slice(prefix.length)
  }
  return null
}

const ARCH_ARG = flag('arch') ?? 'universal'
const NODE_MIRROR = flag('node-mirror') ?? NODE_MIRROR_DEFAULT
const LOCAL_NODE_OVERRIDE = flag('node-binary')
const OFFLINE = process.argv.includes('--offline')

const UNIX_BIN = {
  codesign: '/usr/bin/codesign',
  lipo: '/usr/bin/lipo',
  tar: '/usr/bin/tar',
  plutil: '/usr/bin/plutil',
  ditto: '/usr/bin/ditto',
}

/** 这些工具都是绝对路径，直接看文件是否存在即可（不必真的执行一次） */
function toolExists(bin) {
  return fs.existsSync(bin)
}

// ---------------------------------------------------------------- 取目标架构的 node 二进制

const ARCH_LABELS = {
  arm64: 'arm64 版（Apple 芯片 M1/M2/M3/M4）',
  x64: 'x64 版（Intel 处理器）',
  universal: 'universal 版（Intel + Apple 芯片通用）',
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

/**
 * 取到「与构建机 Node 版本完全一致」的 darwin-<arch> node 二进制。
 *
 * SEA blob 必须注入到**同版本**的 node 里，所以这里严格使用 process.versions.node。
 * 优先用本机 node（架构吻合时零下载），否则从官方分发站下载并校验 SHA-256。
 */
async function resolveNodeBinary(arch) {
  if (LOCAL_NODE_OVERRIDE) {
    const resolved = path.resolve(LOCAL_NODE_OVERRIDE)
    if (!fs.existsSync(resolved)) fail(`--node-binary 指定的文件不存在：${resolved}`)
    log('6/10', `使用 --node-binary 指定的 node 二进制：${resolved}`)
    return resolved
  }

  // 本机 node 的架构与目标一致时直接复用（Apple 芯片机器上构建 arm64 版走这条路）
  const localArch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null
  if (localArch === arch) {
    log('6/10', `复用本机 node 二进制（${arch}，版本 ${NODE_VERSION}）：${process.execPath}`)
    return process.execPath
  }

  const baseName = `node-v${NODE_VERSION}-darwin-${arch}`
  const extractDir = path.join(nodeCacheDir, baseName)
  const cachedBinary = path.join(extractDir, 'bin', 'node')
  if (fs.existsSync(cachedBinary)) {
    log('6/10', `复用已缓存的 node 二进制（${arch}，版本 ${NODE_VERSION}）：${cachedBinary}`)
    return cachedBinary
  }

  if (OFFLINE) {
    fail(
      `--offline 模式下找不到 ${arch} 的 node 二进制，且本机 node 架构是 ${process.arch}。\n` +
        `        请在有网络时先跑一次，或用 --node-binary=/path/to/node-${arch} 指定。`,
    )
  }

  const fileName = `${baseName}.tar.gz`
  const url = `${NODE_MIRROR.replace(/\/+$/, '')}/v${NODE_VERSION}/${fileName}`
  log('6/10', `下载目标架构的 node 运行时：${url}`)

  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) fail(`下载 node 运行时失败：HTTP ${response.status} ${url}`)
  const tarball = Buffer.from(await response.arrayBuffer())

  // 校验 SHA-256：构建期引入的外部二进制必须验完整性，不能「下下来就用」
  try {
    const shasumsUrl = `${NODE_MIRROR.replace(/\/+$/, '')}/v${NODE_VERSION}/SHASUMS256.txt`
    const shasumsResponse = await fetch(shasumsUrl, { redirect: 'follow' })
    if (shasumsResponse.ok) {
      const shasumsText = await shasumsResponse.text()
      const line = shasumsText.split('\n').find((item) => item.trim().endsWith(fileName))
      const expected = line?.trim().split(/\s+/)[0]
      if (expected) {
        const actual = sha256(tarball)
        if (actual !== expected) {
          fail(`node 运行时 SHA-256 校验失败：期望 ${expected}，实际 ${actual}`)
        }
        note(`SHA-256 校验通过（${expected.slice(0, 16)}…）`)
      } else {
        note('警告：SHASUMS256.txt 里没有该文件，跳过校验')
      }
    } else {
      note('警告：拿不到 SHASUMS256.txt，跳过校验')
    }
  } catch (error) {
    note(`警告：校验步骤异常（${error.message}），继续使用已下载的文件`)
  }

  fs.mkdirSync(nodeCacheDir, { recursive: true })
  const tarballPath = path.join(nodeCacheDir, fileName)
  fs.writeFileSync(tarballPath, tarball)

  fs.rmSync(extractDir, { recursive: true, force: true })
  fs.mkdirSync(extractDir, { recursive: true })
  run(UNIX_BIN.tar, ['-xzf', tarballPath, '-C', extractDir])

  const binary = path.join(extractDir, baseName, 'bin', 'node')
  if (!fs.existsSync(binary)) fail(`解压后没有找到 node 二进制：${binary}`)
  fs.chmodSync(binary, 0o755)
  log('6/10', `node 运行时已就绪：${binary}（${humanSize(fs.statSync(binary).size)}）`)
  return binary
}

// ---------------------------------------------------------------- SEA 注入 + 签名

/**
 * 把 blob 注入 node 二进制并重新做 ad-hoc 签名。
 *
 * 顺序不能变：
 *   1. codesign --remove-signature：官方 node 是签过名的，改内容会让签名失效；
 *      Apple 芯片会直接杀掉签名无效的进程，所以必须先移除再重签。
 *   2. postject 注入 —— Mach-O 上用 NODE_SEA 段里的 __NODE_SEA_BLOB 分节
 *      （与 Node 官方文档一致）。
 *   3. codesign --sign -：ad-hoc 重新签名。项目没有 Apple 开发者证书，
 *      因此不做公证（notarize），用户首次打开需要「右键 → 打开」。
 */
function injectAndSign({ nodeBinary, blobPath, outBinary }) {
  fs.mkdirSync(path.dirname(outBinary), { recursive: true })
  fs.copyFileSync(nodeBinary, outBinary)
  fs.chmodSync(outBinary, 0o755)

  // 1. 去掉原有签名（二进制本来就没签名时 codesign 会报错，属正常，忽略）
  const remove = spawnSync(UNIX_BIN.codesign, ['--remove-signature', outBinary], { encoding: 'utf8' })
  if (remove.status !== 0) {
    note(`原签名移除跳过（${(remove.stderr || '').trim().split('\n')[0] || '无签名'}）`)
  }

  // 2. 注入（这一步失败会让整个构建失败，因为它就是「单文件应用」本身）
  return inject(outBinary, SEA_RESOURCE_NAME, fs.readFileSync(blobPath), {
    sentinelFuse: NODE_SEA_FUSE,
    machoSegmentName: SEA_SEGMENT_NAME,
  }).then(() => {
    // 3. ad-hoc 签名
    const sign = spawnSync(UNIX_BIN.codesign, ['--force', '--sign', '-', outBinary], { encoding: 'utf8' })
    if (sign.status !== 0) {
      fail(`ad-hoc 签名失败：${(sign.stderr || sign.stdout || '').trim()}`)
    }
    const verify = spawnSync(UNIX_BIN.codesign, ['--verify', '--strict', outBinary], { encoding: 'utf8' })
    if (verify.status !== 0) {
      fail(`签名校验失败：${(verify.stderr || '').trim()}`)
    }
    return outBinary
  })
}

// ---------------------------------------------------------------- .app 组装

/**
 * 组装应用包。
 * 目录结构与启动器 paths.cjs 的约定严格对应：
 *   <App>.app/Contents/MacOS/<exe>
 *   <App>.app/Contents/Resources/app/resources/web/…
 */
function assembleAppBundle({ appPath, executablePath, icnsPath, webRoot, readmeText }) {
  fs.rmSync(appPath, { recursive: true, force: true })
  const contents = path.join(appPath, 'Contents')
  const macosDir = path.join(contents, 'MacOS')
  const resourcesDir = path.join(contents, 'Resources')
  // MAC_BUNDLE_RESOURCE_SUBDIR 是相对 .app 根目录的路径（Contents/Resources/app）
  const appResourceDir = path.join(appPath, MAC_BUNDLE_RESOURCE_SUBDIR)

  fs.mkdirSync(macosDir, { recursive: true })
  fs.mkdirSync(resourcesDir, { recursive: true })
  fs.mkdirSync(appResourceDir, { recursive: true })

  // 主可执行文件
  fs.copyFileSync(executablePath, path.join(macosDir, MAC_EXECUTABLE_NAME))
  fs.chmodSync(path.join(macosDir, MAC_EXECUTABLE_NAME), 0o755)

  // 图标
  fs.copyFileSync(icnsPath, path.join(resourcesDir, 'app.icns'))

  // 前端静态资源
  fs.cpSync(webRoot, path.join(appResourceDir, 'resources', 'web'), { recursive: true })

  // 应用包内的使用说明（DMG 卷根目录还会再放一份给用户先看）
  fs.writeFileSync(path.join(appResourceDir, '使用说明.txt'), readmeText, 'utf8')

  // Info.plist
  const infoPlist = {
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundleDevelopmentRegion: 'zh_CN',
    CFBundleName: APP_DIR_NAME,
    CFBundleDisplayName: APP_DIR_NAME,
    CFBundleExecutable: MAC_EXECUTABLE_NAME,
    CFBundleIdentifier: APP_BUNDLE_ID,
    CFBundlePackageType: 'APPL',
    CFBundleSignature: '????',
    CFBundleShortVersionString: VERSION,
    CFBundleVersion: VERSION,
    CFBundleIconFile: 'app.icns',
    LSMinimumSystemVersion: MAC_MIN_SYSTEM_VERSION,
    NSHighResolutionCapable: true,
    LSApplicationCategoryType: 'public.app-category.education',
    // 后台型应用：不占用 Dock、没有菜单栏。
    // 与 Windows 版的「无窗口、无托盘」体验一致；退出走网页里「关于 → 退出智能体」。
    // 也可以避免「非 Cocoa 进程收不到 Apple 事件导致 Cmd+Q 无效」这个坑。
    LSUIElement: true,
    // 不写 NSHumanReadableCopyright / 组织名：项目没有正式版权信息，不虚构
  }
  fs.writeFileSync(path.join(contents, 'Info.plist'), buildPlist(infoPlist), 'utf8')
  fs.writeFileSync(path.join(contents, 'PkgInfo'), 'APPL????', 'ascii')

  return appPath
}

/** 对应用包整体签名（资源必须在这一步之前全部放好，签名会封存 Resources） */
function signAppBundle(appPath) {
  const result = spawnSync(UNIX_BIN.codesign, ['--force', '--sign', '-', appPath], { encoding: 'utf8' })
  if (result.status !== 0) fail(`应用包签名失败：${(result.stderr || result.stdout || '').trim()}`)
}

// ---------------------------------------------------------------- 主流程

async function buildArch({ arch, blobPath }) {
  log('6/10', `生成 ${arch} 的可执行文件（Node SEA 注入 + ad-hoc 签名）`)
  const nodeBinary = await resolveNodeBinary(arch)
  const workDir = path.join(buildRoot, arch)
  const rawBinary = path.join(workDir, 'sea-raw', MAC_EXECUTABLE_NAME)
  await injectAndSign({ nodeBinary, blobPath, outBinary: rawBinary })

  const macho = readMachO(rawBinary)
  if (macho.arch !== arch) fail(`${arch} 二进制架构不符：实际 ${macho.arch}`)
  if (!macho.seaBlobInjected) fail(`${arch} 二进制里没有找到 NODE_SEA 段中的 __NODE_SEA_BLOB 分节`)
  if (!macho.fuseEnabled) fail(`${arch} 二进制的 SEA fuse 没有翻开（注入未真正生效）`)
  note(`架构 ${macho.arch} · SEA 分节已注入 · fuse 已翻开 · ${humanSize(fs.statSync(rawBinary).size)}`)

  return rawBinary
}

async function main() {
  console.log(`\n=== 构建 ${APP_DIR_NAME} v${VERSION}（macOS） ===\n`)

  if (process.platform !== 'darwin') {
    fail(
      'macOS 发行版只能在 macOS 上构建。\n' +
        '        原因：SEA 注入后必须用 /usr/bin/codesign 重新做 ad-hoc 签名（Apple 芯片会拒绝签名失效的二进制），\n' +
        '        且 .dmg 只能由 /usr/bin/hdiutil 生成 —— 这两者都只有 macOS 自带。\n' +
        '        请在 Mac 上执行：npm run build:mac（依赖见 packaging/MACOS.md）',
    )
  }
  if (!['universal', 'arm64', 'x64'].includes(ARCH_ARG)) {
    fail(`--arch 只能是 universal / arm64 / x64，收到：${ARCH_ARG}`)
  }
  if (appConfigVersion !== VERSION) {
    fail(`版本号不一致：package.json = ${VERSION}，src/config/app.ts = ${appConfigVersion}`)
  }
  for (const [name, bin] of Object.entries(UNIX_BIN)) {
    if (name === 'lipo') continue // lipo 只做通用包时用，缺失时自动降级
    if (!toolExists(bin)) fail(`缺少系统工具：${bin}（这是 macOS 自带命令，请确认系统完整性）`)
  }
  ensureBuildDeps(packagingDir)

  // ---------------------------------------------------------------- 1. 清理
  log('1/10', '清理旧的 macOS 构建产物')
  const staleDmgs = fs.existsSync(releaseRoot)
    ? fs
        .readdirSync(releaseRoot)
        .filter((name) => /^AI教育智能体_v.*_macOS.*\.dmg$/.test(name))
        .map((name) => path.join(releaseRoot, name))
    : []
  // 只删中间产物，保留 node-cache（否则每换一个架构都要重新下载几十 MB 的 node 运行时）
  cleanOwnOutputs({
    targets: [
      path.join(buildRoot, 'app'),
      path.join(buildRoot, 'dmg-stage'),
      path.join(buildRoot, 'arm64'),
      path.join(buildRoot, 'x64'),
      path.join(buildRoot, 'universal-sea'),
      path.join(buildRoot, 'worker.cjs'),
      path.join(buildRoot, 'launcher.bundle.cjs'),
      path.join(buildRoot, 'sea-config.json'),
      path.join(buildRoot, 'sea-prep.blob'),
      ...staleDmgs,
    ],
  })
  fs.mkdirSync(buildRoot, { recursive: true })

  // ---------------------------------------------------------------- 2. 前端
  log('2/10', '构建前端静态资源（vite --mode portable）')
  buildFrontend(demoRoot)

  // ---------------------------------------------------------------- 3. Worker
  log('3/10', '打包现有 Worker 代码（源码不改动）')
  await bundleWorker({ demoRoot, outfile: path.join(buildRoot, 'worker.cjs') })

  // ---------------------------------------------------------------- 4. 启动器
  log('4/10', '打包启动器（注入版本号）')
  const launcherBundlePath = path.join(buildRoot, 'launcher.bundle.cjs')
  await bundleLauncher({ packagingDir, outfile: launcherBundlePath, version: VERSION })

  // ---------------------------------------------------------------- 5. 图标
  log('5/10', '生成 macOS 图标（ICNS，多分辨率 PNG 载荷）')
  const icon = generateMacIconAssets(assetsDir)
  log('5/10', `图标类型：${icon.types.join(', ')} → ${path.relative(demoRoot, icon.icnsPath)}`)

  // ---------------------------------------------------------------- 6. SEA blob（平台无关，只做一次）
  const { blobPath } = buildSeaBlob({ demoRoot, buildDir: buildRoot, launcherBundlePath })

  // 目标架构列表
  const requestedArches =
    ARCH_ARG === 'universal' ? ['arm64', 'x64'] : [ARCH_ARG]

  // ---------------------------------------------------------------- 6'. 逐架构生成二进制
  const binaries = {}
  for (const arch of requestedArches) {
    binaries[arch] = await buildArch({ arch, blobPath })
  }

  let finalBinary
  let usedUniversal = false
  if (ARCH_ARG === 'universal') {
    const universalPath = path.join(buildRoot, 'universal-sea', MAC_EXECUTABLE_NAME)
    fs.mkdirSync(path.dirname(universalPath), { recursive: true })
    const lipo = spawnSync(UNIX_BIN.lipo, ['-create', binaries.arm64, binaries.x64, '-output', universalPath], {
      encoding: 'utf8',
    })
    if (lipo.status === 0) {
      const macho = readMachO(universalPath)
      if (macho.format === 'fat' && macho.arches.includes('arm64') && macho.arches.includes('x64') && macho.seaBlobInjected) {
        fs.chmodSync(universalPath, 0o755)
        const signed = spawnSync(UNIX_BIN.codesign, ['--force', '--sign', '-', universalPath], { encoding: 'utf8' })
        if (signed.status === 0) {
          finalBinary = universalPath
          usedUniversal = true
          log('6/10', `已合成通用二进制（lipo）：${macho.arches.join(' + ')} · ${humanSize(fs.statSync(universalPath).size)}`)
        } else {
          note(`通用二进制签名失败，降级为分架构打包：${(signed.stderr || '').trim().split('\n')[0]}`)
        }
      } else {
        note(`lipo 产物不是预期的双架构 Mach-O（实际 ${macho.arch}），降级为分架构打包`)
      }
    } else {
      note(`lipo 不可用或执行失败，降级为分架构打包：${(lipo.stderr || '').trim().split('\n')[0]}`)
    }
  }

  if (!usedUniversal && ARCH_ARG === 'universal') {
    // 降级：通用包做不出来就分别出两个架构的 DMG，用户按自己的芯片选择（使用说明里已写清）
    note('本次将分别输出 arm64 与 x64 两个 DMG')
  }

  // ---------------------------------------------------------------- 7. 组装
  log('7/10', '组装应用包与 DMG 暂存目录')
  const webRoot = path.join(demoRoot, 'dist')
  const targets = usedUniversal
    ? [{ key: 'universal', binary: finalBinary, arches: ['arm64', 'x64'], label: ARCH_LABELS.universal }]
    : requestedArches.map((arch) => ({
        key: arch,
        binary: binaries[arch],
        arches: [arch],
        label: ARCH_LABELS[arch],
      }))

  const built = []
  for (const target of targets) {
    const appPath = path.join(buildRoot, 'app', target.key, MAC_APP_NAME)
    const readmeText = buildMacReadme({ archLabel: target.label })
    assembleAppBundle({
      appPath,
      executablePath: target.binary,
      icnsPath: icon.icnsPath,
      webRoot,
      readmeText,
    })
    signAppBundle(appPath)

    const staging = path.join(buildRoot, 'dmg-stage', target.key)
    fs.rmSync(staging, { recursive: true, force: true })
    fs.mkdirSync(staging, { recursive: true })
    fs.cpSync(appPath, path.join(staging, MAC_APP_NAME), { recursive: true })
    // 「拖入应用程序」的落点：DMG 卷里必须有 /Applications 的符号链接
    fs.symlinkSync('/Applications', path.join(staging, 'Applications'))
    fs.writeFileSync(path.join(staging, '使用说明.txt'), readmeText, 'utf8')

    built.push({ ...target, appPath, staging, readmeText })
    note(`${target.label} → ${MAC_APP_NAME}（${humanSize(dirSize(appPath))}）`)
  }

  // ---------------------------------------------------------------- 8. 静态检查
  log('8/10', '静态检查与安全扫描')
  const checks = []
  const bundleFiles = fs
    .readdirSync(path.join(demoRoot, 'dist', 'assets'))
    .filter((name) => name.endsWith('.js'))
  let bundleText = ''
  for (const name of bundleFiles) bundleText += fs.readFileSync(path.join(demoRoot, 'dist', 'assets', name), 'utf8')

  checks.push([`启动器注入的版本号正确`, launcherVersionMatches(launcherBundlePath, VERSION)])
  checks.push(['前端接口地址为同源 /api/chat', bundleText.includes('/api/chat')])
  checks.push(['前端不含云端 Worker 地址', !bundleText.includes('workers.dev')])
  checks.push(['版本号一致（package.json = appConfig）', appConfigVersion === VERSION])

  for (const target of built) {
    const tag = target.key === 'universal' ? '通用包' : target.key
    const contents = path.join(target.appPath, 'Contents')
    const plistPath = path.join(contents, 'Info.plist')
    const exePath = path.join(contents, 'MacOS', MAC_EXECUTABLE_NAME)

    checks.push([`[${tag}] 应用包存在（${MAC_APP_NAME}）`, fs.existsSync(target.appPath)])
    checks.push([`[${tag}] Info.plist 存在`, fs.existsSync(plistPath)])

    // plutil -lint 是系统自己的 plist 校验器，比任何自写解析都可信
    const lint = spawnSync(UNIX_BIN.plutil, ['-lint', plistPath], { encoding: 'utf8' })
    checks.push([`[${tag}] Info.plist 通过 plutil 校验`, lint.status === 0, (lint.stdout || '').trim()])

    const plist = parsePlistTopLevel(fs.readFileSync(plistPath, 'utf8'))
    checks.push([`[${tag}] CFBundleName = ${APP_DIR_NAME}`, plist.CFBundleName === APP_DIR_NAME])
    checks.push([`[${tag}] CFBundleExecutable = ${MAC_EXECUTABLE_NAME}（且文件真实存在）`, plist.CFBundleExecutable === MAC_EXECUTABLE_NAME && fs.existsSync(exePath)])
    checks.push([`[${tag}] CFBundleIdentifier = ${APP_BUNDLE_ID}`, plist.CFBundleIdentifier === APP_BUNDLE_ID])
    checks.push([
      `[${tag}] 版本号写入 Info.plist（${VERSION}）`,
      plist.CFBundleShortVersionString === VERSION && plist.CFBundleVersion === VERSION,
    ])
    checks.push([`[${tag}] 图标指向 app.icns 且文件存在`, plist.CFBundleIconFile === 'app.icns' && fs.existsSync(path.join(contents, 'Resources', 'app.icns'))])
    checks.push([`[${tag}] 声明最低系统版本 ${MAC_MIN_SYSTEM_VERSION}`, plist.LSMinimumSystemVersion === MAC_MIN_SYSTEM_VERSION])
    checks.push([`[${tag}] LSUIElement = true（无 Dock/菜单栏，与 Windows 体验一致）`, plist.LSUIElement === true])

    const stat = fs.statSync(exePath)
    checks.push([`[${tag}] 主可执行文件有执行权限（0755）`, (stat.mode & 0o777) === 0o755, `0${(stat.mode & 0o777).toString(8)}`])

    const macho = readMachO(exePath)
    const archOk = target.arches.every((arch) => macho.arches.includes(arch)) && macho.arches.length === target.arches.length
    checks.push([`[${tag}] Mach-O 架构 = ${target.arches.join(' + ')}`, archOk, macho.arches.join(' + ')])
    checks.push([`[${tag}] SEA blob 已注入 NODE_SEA/__NODE_SEA_BLOB`, macho.seaBlobInjected])
    checks.push([`[${tag}] SEA fuse 已翻开（注入真的生效）`, hasEnabledSeaFuse(exePath)])
    // 只查「本项目自己的绝对路径」有没有漏进二进制。
    // 不用泛化的 /Users/xxx：主程序里内嵌的是 Node 官方运行时，其中可能带上游 CI 的路径，
    // 那不属于本项目泄露（会在下面作为提示信息单独打印）。
    checks.push([
      `[${tag}] 二进制里没有本项目路径`,
      !fs.readFileSync(exePath).toString('latin1').includes(demoRoot),
      demoRoot,
    ])

    const verifyExe = spawnSync(UNIX_BIN.codesign, ['--verify', '--strict', exePath], { encoding: 'utf8' })
    checks.push([`[${tag}] 主可执行文件签名有效`, verifyExe.status === 0, (verifyExe.stderr || '').trim().split('\n').slice(-1)[0]])
    const verifyApp = spawnSync(UNIX_BIN.codesign, ['--verify', '--deep', '--strict', target.appPath], { encoding: 'utf8' })
    checks.push([`[${tag}] 应用包整体签名有效（codesign --deep --strict）`, verifyApp.status === 0, (verifyApp.stderr || '').trim().split('\n').slice(-1)[0]])

    checks.push([
      `[${tag}] 前端资源就位`,
      fs.existsSync(path.join(target.appPath, MAC_BUNDLE_RESOURCE_SUBDIR, 'resources', 'web', 'index.html')),
    ])
    checks.push([
      `[${tag}] 使用说明.txt 就位`,
      fs.existsSync(path.join(target.appPath, MAC_BUNDLE_RESOURCE_SUBDIR, '使用说明.txt')),
    ])
    checks.push([
      `[${tag}] 应用包内为首次启动状态（无数据库/配置/日志）`,
      !fs.existsSync(path.join(target.appPath, MAC_BUNDLE_RESOURCE_SUBDIR, 'data', 'app.db')) &&
        !fs.existsSync(path.join(target.appPath, MAC_BUNDLE_RESOURCE_SUBDIR, 'logs', 'app.log')),
    ])
    checks.push([
      `[${tag}] DMG 暂存目录含应用包 + Applications 符号链接 + 使用说明`,
      fs.existsSync(path.join(target.staging, MAC_APP_NAME)) &&
        fs.lstatSync(path.join(target.staging, 'Applications')).isSymbolicLink() &&
        fs.existsSync(path.join(target.staging, '使用说明.txt')),
    ])

    const scan = scanRelease(target.appPath, {
      textRoots: [path.join(target.appPath, MAC_BUNDLE_RESOURCE_SUBDIR)],
      executables: [exePath],
      // 显式给二进制规则：加上「本项目路径」与「构建机用户目录」，但后者只作提示不作失败
      // （主程序里内嵌 Node 官方运行时，上游 CI 路径不属于本项目泄露）
      binaryRules: [
        { name: '真实 API Key', pattern: /sk-[A-Za-z0-9_-]{20,}/ },
        { name: 'DEEPSEEK_API_KEY', pattern: /DEEPSEEK_API_KEY/ },
        { name: 'OPENAI_API_KEY', pattern: /OPENAI_API_KEY/ },
        { name: '已部署的 workers.dev 地址', pattern: /workers\.dev/ },
        { name: '本项目目录路径', pattern: demoRoot },
      ],
    })
    checks.push([`[${tag}] 安全扫描通过（已扫描 ${scan.scannedTextFiles} 个文本文件 + 主程序）`, scan.findings.length === 0])
    checks.push([`[${tag}] 应用包内不含 .env / node_modules`, scan.forbidden.length === 0])
    for (const finding of scan.findings) note(`[${tag}] ! ${finding}`)
    for (const item of scan.forbidden) note(`[${tag}] ! 不允许的文件：${item}`)

    // 提示（不判失败）：主程序里出现构建机用户目录，通常来自上游 Node 运行时自带的 CI 路径
    if (fs.readFileSync(exePath).toString('latin1').includes(os.homedir())) {
      note(`[${tag}] 提示：主程序内含构建机用户目录（多半来自 Node 官方运行时的上游构建路径，非本项目泄露）`)
    }
  }

  let failed = 0
  for (const [name, ok, detail] of checks) {
    console.log(`   ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${!ok && detail ? `（${detail}）` : ''}`)
    if (!ok) failed += 1
  }
  if (failed > 0) fail(`有 ${failed} 项检查未通过`)

  // ---------------------------------------------------------------- 9. 自检
  log('9/10', '发行包自检（直接启动 + LaunchServices「双击」启动，打真实接口）')
  let portCursor = SMOKE_PORT
  for (const target of built) {
    note(`检查 ${target.key} …`)
    const smoke = await smokeTest({
      appDir: target.appPath,
      executableRelPath: path.join('Contents', 'MacOS', MAC_EXECUTABLE_NAME),
      port: portCursor,
      log: (message) => console.log(message),
    })
    portCursor += 2
    if (!smoke.ok) fail(`${target.key} 的发行包自检未通过`)
  }

  // ---------------------------------------------------------------- 10. DMG
  log('10/10', '生成 DMG 并挂载验收')
  const outputs = []
  for (const target of built) {
    const suffix = target.key === 'universal' ? 'universal' : target.key
    const dmgPath = path.join(releaseRoot, `${APP_DIR_NAME}_v${VERSION}_macOS_${suffix}.dmg`)
    const created = createDmg({
      stagingDir: target.staging,
      outPath: dmgPath,
      volumeName: APP_DIR_NAME,
      log: (message) => note(message),
    })
    note(`已生成 ${path.basename(dmgPath)}（${humanSize(created.bytes)}）`)

    const verified = verifyDmg({
      dmgPath,
      appName: MAC_APP_NAME,
      log: (message) => console.log(message),
    })
    if (!verified.ok) fail(`${path.basename(dmgPath)} 的 DMG 验收未通过`)
    note(`Gatekeeper 判定：${verified.gatekeeper}`)

    // 再出一个 .app 的 zip：GitHub Actions 会把 release/*.dmg 与 release/*.zip 一起作为产物上传，
    // 有些场景（例如通过内网/IM 传文件）用 zip 比 dmg 更方便。
    // 必须用 ditto 而不是 zip 命令：只有 ditto 能完整保留 .app 的符号链接、权限位与扩展属性，
    // 用 zip 直接压会破坏应用包结构，用户解压后可能无法启动。
    const zipPath = path.join(releaseRoot, `${APP_DIR_NAME}_v${VERSION}_macOS_${suffix}.app.zip`)
    run(UNIX_BIN.ditto, ['-c', '-k', '--sequesterRsrc', '--keepParent', target.appPath, zipPath])
    const zipBytes = fs.statSync(zipPath).size
    note(`已生成 ${path.basename(zipPath)}（${humanSize(zipBytes)}）`)

    // 解压回临时目录再验一次签名 —— 证明「用户下载 zip、解压后就能启动」，
    // 而不是只证明「zip 文件存在」。
    const zipCheckDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-edu-zipcheck-'))
    try {
      run(UNIX_BIN.ditto, ['-x', '-k', zipPath, zipCheckDir])
      const restoredApp = path.join(zipCheckDir, MAC_APP_NAME)
      const executable = path.join(restoredApp, 'Contents', 'MacOS', MAC_EXECUTABLE_NAME)
      if (!fs.existsSync(executable)) fail(`zip 解压后没有找到应用包：${restoredApp}`)
      const verifyZip = spawnSync(UNIX_BIN.codesign, ['--verify', '--deep', '--strict', restoredApp], {
        encoding: 'utf8',
      })
      if (verifyZip.status !== 0) {
        fail(`zip 解压后的应用包签名无效：${(verifyZip.stderr || '').trim()}`)
      }
      note('zip 解压后签名复验通过（用户解压即可启动）')
    } finally {
      fs.rmSync(zipCheckDir, { recursive: true, force: true })
    }

    outputs.push({
      target,
      dmgPath,
      bytes: created.bytes,
      zipPath,
      zipBytes,
      gatekeeper: verified.gatekeeper,
    })
  }

  // ---------------------------------------------------------------- 汇总
  console.log('\n=== 构建完成（macOS） ===')
  for (const item of outputs) {
    console.log(`交付物：${item.dmgPath}`)
    console.log(`  ${humanSize(item.bytes)} · ${item.target.label}`)
    console.log(`交付物：${item.zipPath}`)
    console.log(`  ${humanSize(item.zipBytes)}（应用包 zip，解压即得 ${MAC_APP_NAME}）`)
    console.log(`  应用包：${item.target.appPath}`)
  }
  console.log('')
  console.log('用户安装方式：打开 .dmg → 把「AI教育智能体」拖进「应用程序」→ 点击启动（浏览器自动打开）。')
  console.log('注意：未使用 Apple 开发者证书，未做公证（notarize）；')
  console.log('      用户首次打开需要「右键 → 打开」，之后可正常双击。详见应用内的「使用说明.txt」。')
  console.log('')
}

main().catch((error) => {
  fail(error && error.stack ? error.stack : String(error))
})
