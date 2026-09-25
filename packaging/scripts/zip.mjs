/**
 * 极简 ZIP 打包器（deflate）。
 *
 * 为什么不用 Compress-Archive：发行包里包含中文文件名
 * （启动智能体.exe / 使用说明.txt / AI教育智能体），必须确保
 * 文件名以 UTF-8 写入并置上「语言编码标志位」，否则在部分解压工具里会乱码。
 * 自己写可以完全控制这一点，并且保证目录条目（data/ config/ logs/）被写进包里。
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear())
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: day }
}

/** 递归收集条目：目录也作为条目写入，保证解压后目录结构完整 */
function collect(rootDir, relative = '') {
  const entries = []
  const absolute = path.join(rootDir, relative)
  for (const item of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = relative ? `${relative}/${item.name}` : item.name
    if (item.isDirectory()) {
      entries.push({ type: 'dir', name: `${rel}/` })
      entries.push(...collect(rootDir, rel))
    } else if (item.isFile()) {
      entries.push({ type: 'file', name: rel, path: path.join(rootDir, rel) })
    }
  }
  return entries
}

/**
 * 把 rootDir 的内容打包成 zip（rootDir 本身不进入压缩包，解压后直接看到里面的文件）。
 * @param {string} rootDir
 * @param {string} outFile
 */
export function zipDirectory(rootDir, outFile) {
  const entries = collect(rootDir)
  const now = new Date()
  const { time, date } = dosDateTime(now)

  const localParts = []
  const centralParts = []
  let offset = 0

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8')
    const isDir = entry.type === 'dir'
    const raw = isDir ? Buffer.alloc(0) : fs.readFileSync(entry.path)
    const deflated = isDir || raw.length === 0 ? Buffer.alloc(0) : zlib.deflateRawSync(raw, { level: 9 })
    const useDeflate = !isDir && deflated.length > 0 && deflated.length < raw.length
    const data = useDeflate ? deflated : raw
    const method = useDeflate ? 8 : 0
    const crc = isDir ? 0 : crc32(raw)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4) // version needed
    localHeader.writeUInt16LE(0x0800, 6) // UTF-8 文件名标志
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt16LE(time, 10)
    localHeader.writeUInt16LE(date, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(data.length, 18)
    localHeader.writeUInt32LE(raw.length, 22)
    localHeader.writeUInt16LE(nameBuffer.length, 26)
    localHeader.writeUInt16LE(0, 28)

    localParts.push(localHeader, nameBuffer, data)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4) // version made by
    centralHeader.writeUInt16LE(20, 6) // version needed
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt16LE(time, 12)
    centralHeader.writeUInt16LE(date, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(data.length, 20)
    centralHeader.writeUInt32LE(raw.length, 24)
    centralHeader.writeUInt16LE(nameBuffer.length, 28)
    centralHeader.writeUInt16LE(0, 30) // extra
    centralHeader.writeUInt16LE(0, 32) // comment
    centralHeader.writeUInt16LE(0, 34) // disk
    centralHeader.writeUInt16LE(0, 36) // internal attrs
    centralHeader.writeUInt32LE(isDir ? 0x10 : 0x20, 38) // external attrs
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, nameBuffer)

    offset += localHeader.length + nameBuffer.length + data.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  fs.writeFileSync(outFile, Buffer.concat([...localParts, ...centralParts, end]))
  return { fileCount: entries.filter((e) => e.type === 'file').length, bytes: offset + centralSize + 22 }
}
