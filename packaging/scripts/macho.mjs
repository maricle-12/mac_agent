/**
 * 极小的 Mach-O 读取工具（只读，不改写）。
 *
 * 用途：macOS 打包完成后做**静态断言** —— 生成的二进制到底是不是
 * 目标架构、SEA blob 是不是真的被注入进了 NODE_SEA / __NODE_SEA_BLOB、
 * SEA 的 fuse 是不是真的从 :0 翻成了 :1。
 *
 * 只依赖 node:fs / node:buffer，不做任何写操作。
 * 生产环境不需要它（只用于构建期与自检）。
 */

import fs from 'node:fs'

const MH_MAGIC_64 = 0xfeedfacf
const FAT_MAGIC = 0xcafebabe
const FAT_MAGIC_64 = 0xcafebabf
const LC_SEGMENT_64 = 0x19

const CPU_ARCH_ABI64 = 0x01000000
const CPU_TYPE_X86 = 7
const CPU_TYPE_ARM = 12

const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

function cpuTypeName(cputype) {
  if (cputype === CPU_ARCH_ABI64 + CPU_TYPE_X86) return 'x86_64'
  if (cputype === CPU_ARCH_ABI64 + CPU_TYPE_ARM) return 'arm64'
  return `unknown(0x${cputype.toString(16)})`
}

/** 读取固定长度（NUL 结尾）的字符字段 */
function readName(buffer, offset, length) {
  const raw = buffer.subarray(offset, offset + length)
  const end = raw.indexOf(0)
  return raw.subarray(0, end === -1 ? raw.length : end).toString('ascii')
}

/** 解析一个 thin Mach-O 切片 */
function readThinSlice(buffer, base) {
  const magic = buffer.readUInt32LE(base)
  if (magic !== MH_MAGIC_64) {
    throw new Error(`不是 64 位 Mach-O：magic=0x${magic.toString(16)}`)
  }

  const cputype = buffer.readInt32LE(base + 4)
  const cpusubtype = buffer.readInt32LE(base + 8)
  const filetype = buffer.readUInt32LE(base + 12)
  const ncmds = buffer.readUInt32LE(base + 16)

  const segments = []
  let offset = base + 32
  for (let i = 0; i < ncmds; i += 1) {
    const cmd = buffer.readUInt32LE(offset)
    const cmdsize = buffer.readUInt32LE(offset + 4)
    if (cmdsize <= 0) break

    if (cmd === LC_SEGMENT_64) {
      const name = readName(buffer, offset + 8, 16)
      const nsects = buffer.readUInt32LE(offset + 64)
      const sections = []
      let sectionOffset = offset + 72
      for (let s = 0; s < nsects; s += 1) {
        sections.push({
          section: readName(buffer, sectionOffset, 16),
          segment: readName(buffer, sectionOffset + 16, 16),
          size: Number(buffer.readBigUInt64LE(sectionOffset + 40)),
        })
        sectionOffset += 80
      }
      segments.push({ name, sections })
    }
    offset += cmdsize
  }

  return {
    arch: cpuTypeName(cputype),
    cputype,
    cpusubtype,
    filetype,
    segments,
    sliceBytes: null,
  }
}

/**
 * 读取一个 Mach-O（thin 或 fat/universal）。
 * @param {string} filePath
 * @returns {{ format: 'thin'|'fat', arch: string, arches: string[], slices: Array<any>, seaBlobInjected: boolean, fuseEnabled: boolean }}
 */
export function readMachO(filePath) {
  const buffer = fs.readFileSync(filePath)
  const magic = buffer.readUInt32BE(0)

  let slices
  let format
  if (magic === FAT_MAGIC || magic === FAT_MAGIC_64) {
    format = 'fat'
    const is64 = magic === FAT_MAGIC_64
    const nfat = buffer.readUInt32BE(4)
    slices = []
    for (let i = 0; i < nfat; i += 1) {
      const entry = 8 + i * (is64 ? 32 : 20)
      const sliceOffset = is64 ? Number(buffer.readBigUInt64BE(entry + 8)) : buffer.readUInt32BE(entry + 8)
      const slice = readThinSlice(buffer, sliceOffset)
      slice.fileOffset = sliceOffset
      slices.push(slice)
    }
  } else {
    format = 'thin'
    slices = [readThinSlice(buffer, 0)]
  }

  // SEA 注入痕迹：段 NODE_SEA 里的 __NODE_SEA_BLOB 分节，以及被翻成 :1 的 fuse
  const seaBlobInjected = slices.some((slice) =>
    slice.segments.some(
      (segment) =>
        (segment.name === 'NODE_SEA' || segment.name === '__NODE_SEA') &&
        segment.sections.some((section) => section.section === '__NODE_SEA_BLOB' || section.section === 'NODE_SEA_BLOB'),
    ),
  )

  return {
    format,
    arch: slices.length === 1 ? slices[0].arch : 'universal',
    arches: slices.map((slice) => slice.arch),
    slices,
    seaBlobInjected,
    fuseEnabled: hasEnabledSeaFuse(filePath),
  }
}

/**
 * SEA fuse 是否已被翻开（postject 把 `...:0` 改成 `...:1`）。
 * 这是「注入真的生效了」最直接的证据 —— 对 Mach-O 与 PE（Windows EXE）都适用。
 * @param {string} filePath
 */
export function hasEnabledSeaFuse(filePath) {
  const haystack = fs.readFileSync(filePath).toString('latin1')
  return haystack.includes(`${SEA_FUSE}:1`)
}

/** SEA 相关常量，供构建脚本复用（避免两处硬编码字符串） */
export const SEA_FUSE_NAME = SEA_FUSE

export const SEA_SEGMENT_NAME = 'NODE_SEA'
export const SEA_RESOURCE_NAME = 'NODE_SEA_BLOB'
