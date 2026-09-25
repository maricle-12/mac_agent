/**
 * macOS DMG 打包与验收（只在 macOS 上可用）。
 *
 * 为什么必须用系统的 hdiutil：
 *   .dmg 是 Apple 的 UDIF 磁盘映像格式，只有 macOS 自带的 hdiutil 能生成
 *   带压缩、可挂载、带卷名的正式 DMG。第三方跨平台方案要么生成的是 ISO，
 *   要么需要 Linux 上的 libdmg-hfsplus（产出的镜像在 macOS 上行为不一致）。
 *   因此「生成 DMG」这一步必须在 Mac 上完成 —— 这正是本项目
 *   「Windows 侧可完成的部分全部前置、Mac 侧只做最后一步」的原因。
 *
 * 本文件只做打包与验收，不涉及任何智能体业务逻辑。
 * 全部使用绝对路径 /usr/bin/hdiutil、/usr/bin/spctl，参数以 argv 传递（不经过 shell）。
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HDIUTIL = '/usr/bin/hdiutil'
const SPCTL = '/usr/sbin/spctl'

function assertMac(osName = process.platform) {
  if (osName !== 'darwin') {
    throw new Error(`DMG 只能在 macOS 上生成（当前平台：${osName}）。请在 Mac 上运行 npm run build:mac。`)
  }
}

function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, { encoding: 'utf8', ...options })
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ? result.error.message : null,
  }
}

/**
 * 创建压缩 DMG。
 * @param {{ stagingDir: string, outPath: string, volumeName: string, log?: (m: string) => void }} options
 * @returns {{ ok: boolean, bytes: number, detail: string }}
 */
export function createDmg(options) {
  assertMac()
  const { stagingDir, outPath, volumeName } = options
  const log = options.log ?? (() => {})

  if (!fs.existsSync(stagingDir)) throw new Error(`DMG 暂存目录不存在：${stagingDir}`)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.rmSync(outPath, { force: true })

  // UDZO = 压缩只读镜像；HFS+ 是兼容性最好的卷格式（中文文件名/符号链接都没问题）
  const result = run(HDIUTIL, [
    'create',
    '-volname',
    volumeName,
    '-srcfolder',
    stagingDir,
    '-fs',
    'HFS+',
    '-format',
    'UDZO',
    '-ov',
    outPath,
  ])

  if (!result.ok) {
    log(`hdiutil 输出：${result.stdout.trim()} ${result.stderr.trim()}`.trim())
    throw new Error(`hdiutil create 失败（退出码 ${result.status ?? 'unknown'}）：${result.error ?? result.stderr.trim()}`)
  }

  return { ok: true, bytes: fs.statSync(outPath).size, detail: result.stdout.trim().split('\n').pop() ?? '' }
}

/**
 * 验收 DMG：校验镜像完整性 → 挂载 → 确认应用包在卷根目录且签名有效 → 卸载。
 *
 * 这一步的意义是「验收交付物本身」，而不是验收源目录：
 * 只有真的挂载过、真的在卷里看到 .app，才能说这个 DMG 是可用的。
 *
 * @param {{ dmgPath: string, appName: string, log?: (m: string) => void }} options
 * @returns {{ ok: boolean, checks: Array<{ name: string, ok: boolean, detail?: string }>, gatekeeper?: string }}
 */
export function verifyDmg(options) {
  assertMac()
  const { dmgPath, appName } = options
  const log = options.log ?? (() => {})
  const checks = []
  const record = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail })
    log(`   ${ok ? '✓' : '✗'} ${name}${detail ? `（${detail}）` : ''}`)
  }

  const verify = run(HDIUTIL, ['verify', dmgPath])
  record('DMG 镜像校验通过（hdiutil verify）', verify.ok, verify.stderr.trim() || undefined)
  if (!verify.ok) return { ok: false, checks }

  const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-edu-dmg-'))
  let attached = false
  // Gatekeeper 结论只做如实汇报，不作为失败条件：
  // 项目没有 Apple 开发者证书，无法公证（notarize），用户首次打开需要「右键 → 打开」。
  let gatekeeper = 'unknown'
  try {
    const attach = run(HDIUTIL, ['attach', dmgPath, '-nobrowse', '-readonly', '-mountpoint', mountPoint])
    attached = attach.ok
    record('DMG 可挂载', attach.ok, attach.ok ? mountPoint : attach.stderr.trim())
    if (!attach.ok) return { ok: false, checks }

    const appPath = path.join(mountPoint, appName)
    record(`卷根目录存在 ${appName}`, fs.existsSync(appPath))

    const linkPath = path.join(mountPoint, 'Applications')
    const linkStat = fs.lstatSync(linkPath, { throwIfNoEntry: false })
    record('卷内有 Applications 快捷方式（支持拖入安装）', Boolean(linkStat && linkStat.isSymbolicLink()))

    if (fs.existsSync(appPath)) {
      const executable = path.join(appPath, 'Contents', 'MacOS')
      record('应用包结构完整（Contents/MacOS 存在）', fs.existsSync(executable))

      // codesign --verify 是判断「这个包在目标机器上能不能启动」最接近的手段
      const signature = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
      record('应用包签名有效（codesign --verify --deep --strict）', signature.ok, signature.stderr.trim().split('\n').slice(-1)[0])

      const info = run('/usr/bin/codesign', ['-dv', appPath])
      record('签名类型为 ad-hoc（无 Apple 开发者证书）', /adhoc/i.test(info.stderr) || /adhoc/i.test(info.stdout))

      // 必须在卸载之前问 Gatekeeper（它需要真实存在的路径）
      const spctl = run(SPCTL, ['-a', '-vvv', '-t', 'exec', appPath])
      gatekeeper = `${spctl.ok ? 'accepted' : 'rejected'} :: ${(spctl.stderr || spctl.stdout).trim().split('\n').slice(0, 2).join(' | ')}`
    }
  } finally {
    if (attached) {
      let detach = run(HDIUTIL, ['detach', mountPoint, '-force'])
      if (!detach.ok) detach = run(HDIUTIL, ['detach', mountPoint, '-force'])
      log(`   卸载 DMG：${detach.ok ? '完成' : detach.stderr.trim()}`)
    }
    // 挂载点可能已被 hdiutil 自己删掉；删不掉不影响构建结果
    try {
      fs.rmSync(mountPoint, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }

  return { ok: checks.every((item) => item.ok), checks, gatekeeper }
}
