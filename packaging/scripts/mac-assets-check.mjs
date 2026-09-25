/**
 * macOS 打包资源自检（可在任意平台运行）。
 *
 * 打包用的 .icns / Info.plist / Mach-O 断言逻辑本身与操作系统无关，
 * 因此在 Windows 开发机上就能把它们验一遍，不必等到 Mac 上「跑起来才知道错」。
 *
 * 覆盖三块：
 *   A. ICNS：容器结构、分节长度、PNG 载荷的签名与尺寸、PNG 各 chunk 的 CRC32；
 *   B. Info.plist：序列化 ↔ 解析往返、XML 转义、DOCTYPE；
 *   C. Mach-O：用**合成**的 thin / fat Mach-O 验证解析器能正确报出
 *      架构、SEA 段/分节、fuse 状态（这样 Mac 上的断言不至于自己先写错）。
 *
 * 运行：node packaging/scripts/mac-assets-check.mjs
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateMacIconAssets } from './icon.mjs'
import { buildPlist, parsePlistTopLevel } from './plist.mjs'
import {
  readMachO,
  hasEnabledSeaFuse,
  archFamily,
  sameArch,
  detectMachO,
  auditMachOFiles,
  ARCH_FAMILIES,
  SEA_SEGMENT_NAME,
  SEA_RESOURCE_NAME,
} from './macho.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packagingDir = path.resolve(__dirname, '..')
const demoRoot = path.resolve(packagingDir, '..')

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail })
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-edu-mac-assets-'))

// ---------------------------------------------------------------- A. ICNS

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

/** 校验一个 PNG 的所有 chunk CRC 与 IHDR 尺寸 */
function inspectPng(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!buffer.subarray(0, 8).equals(signature)) return { ok: false, reason: 'PNG 签名不对' }

  let offset = 8
  let width = null
  let height = null
  let badCrc = null
  const types = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    const stored = buffer.readUInt32BE(offset + 8 + length)
    const actual = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]))
    if (stored !== actual && badCrc === null) badCrc = type
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
    }
    types.push(type)
    offset += 12 + length
  }
  return { ok: badCrc === null && width !== null && offset === buffer.length, width, height, badCrc, types }
}

{
  const outputDir = path.join(tempRoot, 'icons')
  const icon = generateMacIconAssets(outputDir)
  const icns = fs.readFileSync(icon.icnsPath)

  check('生成 app.icns 文件', fs.existsSync(icon.icnsPath), icon.icnsPath)
  check('ICNS 魔数为 "icns"', icns.subarray(0, 4).toString('ascii') === 'icns')
  check('ICNS 头部总长度与实际文件大小一致', icns.readUInt32BE(4) === icns.length, `${icns.readUInt32BE(4)} vs ${icns.length}`)

  const expected = new Map([
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
    ['ic11', 32],
    ['ic12', 64],
    ['ic13', 256],
    ['ic14', 512],
  ])

  let offset = 8
  const seen = []
  let structureOk = true
  let pngOk = true
  let sizesOk = true
  const problems = []
  while (offset < icns.length) {
    const type = icns.subarray(offset, offset + 4).toString('ascii')
    const length = icns.readUInt32BE(offset + 4)
    const payload = icns.subarray(offset + 8, offset + length)
    if (length < 8 || offset + length > icns.length) {
      structureOk = false
      problems.push(`${type} 分节长度非法（${length}）`)
      break
    }
    seen.push(type)
    const png = inspectPng(payload)
    if (!png.ok) {
      pngOk = false
      problems.push(`${type} 的 PNG 载荷异常（${png.badCrc ? `CRC 错误：${png.badCrc}` : png.reason}）`)
    } else if (expected.has(type) && (png.width !== expected.get(type) || png.height !== expected.get(type))) {
      sizesOk = false
      problems.push(`${type} 尺寸应为 ${expected.get(type)}，实际 ${png.width}×${png.height}`)
    }
    offset += length
  }

  check('ICNS 分节结构合法且总长度自洽', structureOk && offset === icns.length, problems[0])
  check('ICNS 包含 ic07~ic14 全部 8 种分节', [...expected.keys()].every((type) => seen.includes(type)), seen.join(', '))
  check('每种分节的 PNG 载荷都通过 CRC32 与签名校验', pngOk, problems.find((p) => p.includes('PNG')))
  check('每种分节的像素尺寸与类型定义一致', sizesOk, problems.find((p) => p.includes('尺寸')))
  check('附带了 512px 预览图便于人工核对', fs.existsSync(icon.previewPath))
}

// ---------------------------------------------------------------- B. Info.plist

{
  const sample = {
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundleName: 'AI教育智能体',
    CFBundleExecutable: '启动智能体',
    CFBundleShortVersionString: '1.0.1',
    LSUIElement: true,
    NSHighResolutionCapable: true,
    LSMinimumSystemVersion: '11.0',
    CFBundleDisplayName: 'A&B <教育> "智能体"',
  }
  const xml = buildPlist(sample)
  const parsed = parsePlistTopLevel(xml)

  check('Info.plist 含 XML 声明与 Apple DOCTYPE', xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>') && xml.includes('-//Apple//DTD PLIST 1.0//EN'))
  check('Info.plist 为 UTF-8 且无 BOM', !xml.startsWith('\uFEFF'))
  check('字符串/布尔/小数都能往返', parsed.CFBundleName === sample.CFBundleName && parsed.LSUIElement === true && parsed.CFBundleShortVersionString === '1.0.1')
  check('XML 特殊字符被正确转义并可还原', parsed.CFBundleDisplayName === sample.CFBundleDisplayName, parsed.CFBundleDisplayName)
  check('没有把布尔值写成字符串（<true/> 而非 <string>true</string>）', /<key>LSUIElement<\/key>\s*<true\/>/.test(xml))
  check('版本号以字符串写入（CFBundleShortVersionString）', /<key>CFBundleShortVersionString<\/key>\s*<string>1\.0\.1<\/string>/.test(xml))
}

// ---------------------------------------------------------------- C. Mach-O 解析

/** 合成一个 64 位 thin Mach-O：一个 NODE_SEA 段，含 __NODE_SEA_BLOB 分节 */
function makeThinMachO({ cputype, includeSeaSection = true, fuseEnabled = true }) {
  const segmentSize = 72 + (includeSeaSection ? 80 : 0)
  const total = 32 + segmentSize
  const buffer = Buffer.alloc(total)

  buffer.writeUInt32LE(0xfeedfacf, 0) // magic
  buffer.writeInt32LE(cputype, 4)
  buffer.writeInt32LE(0, 8)
  buffer.writeUInt32LE(2, 12) // MH_EXECUTE
  buffer.writeUInt32LE(1, 16) // ncmds
  buffer.writeUInt32LE(segmentSize, 20)
  buffer.writeUInt32LE(0, 24)
  buffer.writeUInt32LE(0, 28)

  const segmentOffset = 32
  buffer.writeUInt32LE(0x19, segmentOffset) // LC_SEGMENT_64
  buffer.writeUInt32LE(segmentSize, segmentOffset + 4)
  buffer.write(SEA_SEGMENT_NAME, segmentOffset + 8, 'ascii')
  buffer.writeBigUInt64LE(0x100000000n, segmentOffset + 24) // vmaddr
  buffer.writeBigUInt64LE(0x1000n, segmentOffset + 32)
  buffer.writeBigUInt64LE(0x1000n, segmentOffset + 40) // fileoff
  buffer.writeBigUInt64LE(BigInt(segmentSize), segmentOffset + 48)
  buffer.writeUInt32LE(1, segmentOffset + 64) // nsects

  if (includeSeaSection) {
    const sectionOffset = segmentOffset + 72
    buffer.write('__NODE_SEA_BLOB', sectionOffset, 'ascii')
    buffer.write(SEA_SEGMENT_NAME, sectionOffset + 16, 'ascii')
    buffer.writeBigUInt64LE(0x100000000n, sectionOffset + 32)
    buffer.writeBigUInt64LE(0x400n, sectionOffset + 40) // size
  }

  const fuse = Buffer.from(`NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:${fuseEnabled ? 1 : 0}`, 'ascii')
  return Buffer.concat([buffer, fuse])
}

// ---------------------------------------------------------------- C1. 架构名归一化
//
// 这一节的由来：macOS 构建在 CI 上失败于
//     x64 二进制架构不符：实际 x86_64        （build-mac.mjs）
// 根因是拿 Mach-O 头部的架构名（x86_64）去和 Node 分发包的架构名（x64）直接比较。
// arm64 在两套命名里同名，所以只有 x64 会暴露。下面把映射关系本身断言下来。
{
  check('架构映射：arm64 族包含 arm64 / aarch64', archFamily('arm64') === 'arm64' && archFamily('aarch64') === 'arm64')
  check(
    '架构映射：x64 族包含 x64 / x86_64 / amd64',
    archFamily('x64') === 'x64' && archFamily('x86_64') === 'x64' && archFamily('amd64') === 'x64',
  )
  check('架构映射：大小写与空白不敏感', archFamily(' X86_64 ') === 'x64' && archFamily('ARM64') === 'arm64')
  check('架构映射：universal 不是单一架构族', archFamily('universal') === null)
  check('架构映射：未知名字不会被猜成某个族', archFamily('mips') === null && archFamily(undefined) === null)

  // 这正是当初失败的比较：Node 的 x64 ↔ Mach-O 的 x86_64
  check('sameArch：x86_64 与 x64 视为同一架构（本次故障的那一对）', sameArch('x86_64', 'x64') === true)
  check('sameArch：arm64 与 arm64 视为同一架构（arm64 之所以先通过）', sameArch('arm64', 'arm64') === true)
  check('sameArch：aarch64 与 arm64 视为同一架构', sameArch('aarch64', 'arm64') === true)
  check('sameArch：不同架构必须判为不同', sameArch('x86_64', 'arm64') === false && sameArch('x64', 'arm64') === false)
  check('架构映射表声明了构建脚本用到的两个族', Boolean(ARCH_FAMILIES.arm64) && Boolean(ARCH_FAMILIES.x64))
}

// ---------------------------------------------------------------- C2. Mach-O 解析

/** 合成一个 universal（fat）Mach-O：把若干 thin 切片拼起来（fat 头 + 架构表 + 各切片） */
function makeFatMachO(sliceList) {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(0xcafebabe, 0)
  header.writeUInt32BE(sliceList.length, 4)
  const entries = []
  let offset = 8 + sliceList.length * 20
  for (const { cputype, data } of sliceList) {
    const entry = Buffer.alloc(20)
    entry.writeInt32BE(cputype, 0)
    entry.writeUInt32BE(offset, 8)
    entry.writeUInt32BE(data.length, 12)
    entry.writeUInt32BE(14, 16)
    entries.push(entry)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...sliceList.map((slice) => slice.data)])
}

{
  const arm64Path = path.join(tempRoot, 'thin-arm64.bin')
  fs.writeFileSync(arm64Path, makeThinMachO({ cputype: 0x0100000c }))
  const arm64 = readMachO(arm64Path)
  check('thin Mach-O：识别为 arm64', arm64.format === 'thin' && arm64.arch === 'arm64', arm64.arch)
  check('thin Mach-O（arm64）：架构族 = arm64，与 --arch=arm64 可比', arm64.archFamily === 'arm64', String(arm64.archFamily))
  check('thin Mach-O：识别出 NODE_SEA 段里的 __NODE_SEA_BLOB 分节', arm64.seaBlobInjected)
  check('thin Mach-O：识别出 fuse 已翻开', arm64.fuseEnabled)

  const x64Path = path.join(tempRoot, 'thin-x64.bin')
  fs.writeFileSync(x64Path, makeThinMachO({ cputype: 0x01000007, includeSeaSection: false, fuseEnabled: false }))
  const x64 = readMachO(x64Path)
  check('thin Mach-O：原始架构名是 x86_64（如实反映头部）', x64.arch === 'x86_64', x64.arch)
  // 这一条就是 build-mac.mjs 里 x64 构建的断言现在依赖的等价形式
  check(
    'thin Mach-O（x86_64）：架构族 = x64，因此 --arch=x64 的断言能通过',
    x64.archFamily === 'x64' && x64.archFamilies.length === 1 && x64.archFamilies[0] === 'x64',
    x64.archFamilies.join(' + '),
  )
  check('thin Mach-O（x86_64）：sameArch 判定与 --arch=x64 一致', sameArch(x64.arch, 'x64') === true)
  check('未注入的二进制不会被误判为已注入', !x64.seaBlobInjected && !x64.fuseEnabled)

  // 合成 universal：fat 头 + 两个切片
  const sliceA = makeThinMachO({ cputype: 0x0100000c })
  const sliceB = makeThinMachO({ cputype: 0x01000007 })
  const fatPath = path.join(tempRoot, 'universal.bin')
  fs.writeFileSync(
    fatPath,
    makeFatMachO([
      { cputype: 0x0100000c, data: sliceA },
      { cputype: 0x01000007, data: sliceB },
    ]),
  )

  const fat = readMachO(fatPath)
  check(
    'universal：原始架构名是 arm64 + x86_64',
    fat.format === 'fat' && fat.arches.includes('arm64') && fat.arches.includes('x86_64'),
    fat.arches.join(' + '),
  )
  // 通用包能否被认定为「双架构」，靠的就是这一条（直接 includes('x64') 会永远为假 → 静默降级）
  check(
    'universal：架构族 = [arm64, x64]，与 --arch=universal 的目标集合一致',
    fat.archFamilies.length === 2 && fat.archFamilies.includes('arm64') && fat.archFamilies.includes('x64'),
    fat.archFamilies.join(' + '),
  )
  check('universal：两个切片都被判定为已注入 SEA', fat.seaBlobInjected)
  check('universal：fuse 已翻开', fat.fuseEnabled)

  // ---------------------------------------------------------------- C3. 全包 Mach-O 扫描
  // 用于回答「到底哪个文件不是 universal」—— build-mac.mjs 的失败诊断与静态断言都依赖它。
  const scanDir = path.join(tempRoot, 'scan')
  fs.mkdirSync(path.join(scanDir, 'nested'), { recursive: true })
  fs.writeFileSync(path.join(scanDir, 'universal-bin'), fs.readFileSync(fatPath))
  fs.writeFileSync(path.join(scanDir, 'arm64-only'), sliceA)
  fs.writeFileSync(path.join(scanDir, 'index.html'), '<html><body>not a mach-o</body></html>')
  fs.writeFileSync(path.join(scanDir, 'nested', 'app.js'), 'console.log(1)\n')

  check('detectMachO：认得出 Mach-O 文件', Boolean(detectMachO(path.join(scanDir, 'universal-bin'))?.macho))
  check('detectMachO：普通文本文件返回 null（不会被误判）', detectMachO(path.join(scanDir, 'index.html')) === null)
  check('detectMachO：嵌套目录里的 js 也不会被误判', detectMachO(path.join(scanDir, 'nested', 'app.js')) === null)

  const audit = auditMachOFiles(scanDir, {})
  check('auditMachOFiles：只统计 Mach-O（2 个），文本文件不计入', audit.machoCount === 2, `machoCount=${audit.machoCount}`)
  check('auditMachOFiles：文件总数统计正确（含非 Mach-O）', audit.fileCount === 4, `fileCount=${audit.fileCount}`)
  const uniEntry = audit.entries.find((entry) => entry.relative === 'universal-bin')
  const armEntry = audit.entries.find((entry) => entry.relative === 'arm64-only')
  check('auditMachOFiles：双架构文件判定 universal = true', uniEntry?.universal === true)
  check(
    'auditMachOFiles：能指出「只含 arm64」的文件（这正是「漏合并」的样子）',
    armEntry?.universal === false && armEntry?.macho?.archFamilies.join('+') === 'arm64',
    armEntry?.macho?.archFamilies.join('+'),
  )
  check('auditMachOFiles：没有解析问题时 problems 为空', audit.problems.length === 0, audit.problems.join('; '))
}

// Windows EXE 也能用同一套 fuse 判定（跨格式复用，顺带验证判定逻辑本身）。
// 注意：这个自检是**跨平台**的，也会在 macOS 的 CI runner 上运行，那里没有 Windows 发行包，
// 所以「exe 不存在」必须算跳过（打印说明）而不是失败，否则会把 macOS 构建流程整个卡死。
{
  const exePath = path.join(demoRoot, 'release', 'AI教育智能体', '启动智能体.exe')
  if (fs.existsSync(exePath)) {
    check('Windows EXE 用的是同一套 SEA fuse 判定（对 PE 同样有效）', hasEnabledSeaFuse(exePath))
  } else {
    console.log('   · 跳过：本机没有 Windows 发行包（release/AI教育智能体/启动智能体.exe 不存在）；')
    console.log('     交叉验证 PE 上的 fuse 判定需要先在本机跑一次 npm run build:win。')
  }
}

// ---------------------------------------------------------------- 输出

fs.rmSync(tempRoot, { recursive: true, force: true })

let failed = 0
console.log(`\n=== macOS 打包资源自检（当前机器：${process.platform}） ===\n`)
for (const item of results) {
  if (!item.ok) failed += 1
  console.log(`   ${item.ok ? '✓' : '✗'} ${item.name}${item.detail && !item.ok ? `（实际：${item.detail}）` : ''}`)
}
console.log(`\n共 ${results.length} 项，失败 ${failed} 项\n`)

process.exit(failed === 0 ? 0 : 1)
