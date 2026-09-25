/**
 * 从项目现有品牌素材生成 Windows 图标（app.ico）。
 *
 * 素材来源：public/favicon.svg（品牌圆角蓝底 + 白色 A 字标）—— 不重新设计品牌，
 * 只是把同一个图形按 Windows 需要的多个尺寸重新栅格化。
 *
 * 实现上不依赖任何第三方库、也不需要浏览器：
 *   - 用「有向距离场 + 4×4 超采样」在纯 JS 里把 SVG 里的两个图形画出来（抗锯齿）；
 *   - 自己写 PNG 编码（zlib 来自 node:zlib）与 ICO 容器；
 *   - 16~64 px 用 32 位 BMP 条目，128/256 px 用 PNG 条目（Windows Vista 以后都支持）。
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------- 品牌参数
// 与 public/favicon.svg 保持一致
const VIEWBOX = 64
const BRAND = [0x3b, 0x6e, 0xf6] // #3b6ef6
const WHITE = [0xff, 0xff, 0xff]
const CORNER_RADIUS = 14
const STROKE_WIDTH = 4.5
const STROKES = [
  [
    [20, 42],
    [32, 20],
    [44, 42],
  ],
  [
    [25, 35],
    [39, 35],
  ],
]

const SIZES = [16, 24, 32, 48, 64, 128, 256]
// 16~64 与 256 用 32 位 BMP 条目（兼容性最好，含老工具与 .NET GDI+）；
// 128 用 PNG 条目（Windows Vista 以后原生支持）。两种格式都存在，避免任何取图失败。
const BMP_SIZES = new Set([16, 24, 32, 48, 64, 256])

// ---------------------------------------------------------------- 几何

/** 点到线段的距离 */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** 圆角矩形内部判定（坐标空间 0..VIEWBOX） */
function insideRoundedRect(px, py) {
  const half = VIEWBOX / 2
  const dx = Math.max(Math.abs(px - half) - (half - CORNER_RADIUS), 0)
  const dy = Math.max(Math.abs(py - half) - (half - CORNER_RADIUS), 0)
  return Math.hypot(dx, dy) <= CORNER_RADIUS
}

function insideStroke(px, py) {
  const radius = STROKE_WIDTH / 2
  for (const polyline of STROKES) {
    for (let i = 0; i < polyline.length - 1; i += 1) {
      const [ax, ay] = polyline[i]
      const [bx, by] = polyline[i + 1]
      if (distanceToSegment(px, py, ax, ay, bx, by) <= radius) return true
    }
  }
  return false
}

/**
 * 渲染一个尺寸的 RGBA 像素（非预乘 alpha）。
 * 4×4 超采样让 16px 这种小尺寸也不至于锯齿严重。
 *
 * samples 可调：Windows 的 ICO 一律使用默认的 4×4（保持 v1.0.1 的产物逐字节不变）；
 * macOS 的 1024px 大图用 2×2 即可（该尺寸下锯齿不可见，但计算量降到 1/4）。
 */
export function renderIcon(size, samples = 4) {
  const rgba = Buffer.alloc(size * size * 4)
  const scale = VIEWBOX / size

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let coverage = 0
      let whiteCoverage = 0

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = (x + (sx + 0.5) / samples) * scale
          const py = (y + (sy + 0.5) / samples) * scale
          if (!insideRoundedRect(px, py)) continue
          coverage += 1
          if (insideStroke(px, py)) whiteCoverage += 1
        }
      }

      const total = samples * samples
      const alpha = coverage / total
      const whiteRatio = coverage > 0 ? whiteCoverage / coverage : 0
      const offset = (y * size + x) * 4

      rgba[offset] = Math.round(BRAND[0] * (1 - whiteRatio) + WHITE[0] * whiteRatio)
      rgba[offset + 1] = Math.round(BRAND[1] * (1 - whiteRatio) + WHITE[1] * whiteRatio)
      rgba[offset + 2] = Math.round(BRAND[2] * (1 - whiteRatio) + WHITE[2] * whiteRatio)
      rgba[offset + 3] = Math.round(alpha * 255)
    }
  }

  return rgba
}

// ---------------------------------------------------------------- PNG

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

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

/** 极简 PNG 编码：8 位 RGBA，无隔行 */
export function encodePng(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------- ICO

/** 32 位 BMP（DIB）条目：BITMAPINFOHEADER + BGRA 倒序行 + AND 掩码 */
function encodeBmpEntry(rgba, size) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8) // 高度含掩码，故为 2 倍
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(0, 16)
  header.writeUInt32LE(size * size * 4, 20)

  const xor = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    const sourceRow = (size - 1 - y) * size * 4
    for (let x = 0; x < size; x += 1) {
      const from = sourceRow + x * 4
      const to = (y * size + x) * 4
      xor[to] = rgba[from + 2] // B
      xor[to + 1] = rgba[from + 1] // G
      xor[to + 2] = rgba[from] // R
      xor[to + 3] = rgba[from + 3] // A
    }
  }

  const maskRowBytes = Math.ceil(size / 32) * 4
  const mask = Buffer.alloc(maskRowBytes * size) // 全 0：不透明区域由 alpha 通道决定

  return Buffer.concat([header, xor, mask])
}

/** 生成 ICO 文件内容 */
export function buildIco(entries) {
  const images = entries.map(({ size, data, png }) => ({
    size,
    data,
    png,
  }))

  const directory = Buffer.alloc(6)
  directory.writeUInt16LE(0, 0)
  directory.writeUInt16LE(1, 2) // type: icon
  directory.writeUInt16LE(images.length, 4)

  let offset = 6 + images.length * 16
  const headerParts = [directory]
  const dataParts = []

  for (const image of images) {
    const entry = Buffer.alloc(16)
    entry[0] = image.size >= 256 ? 0 : image.size
    entry[1] = image.size >= 256 ? 0 : image.size
    entry[2] = 0 // 调色板数
    entry[3] = 0
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(image.data.length, 8)
    entry.writeUInt32LE(offset, 12)
    headerParts.push(entry)
    dataParts.push(image.data)
    offset += image.data.length
  }

  return Buffer.concat([...headerParts, ...dataParts])
}

/** 生成 app.ico 与预览 PNG */
export function generateIconAssets(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true })

  const entries = []
  for (const size of SIZES) {
    const rgba = renderIcon(size)
    if (BMP_SIZES.has(size)) {
      entries.push({ size, data: encodeBmpEntry(rgba, size), png: false })
    } else {
      entries.push({ size, data: encodePng(rgba, size, size), png: true })
    }
  }

  const icoPath = path.join(outputDir, 'app.ico')
  fs.writeFileSync(icoPath, buildIco(entries))

  const previewPath = path.join(outputDir, 'app-256.png')
  fs.writeFileSync(previewPath, encodePng(renderIcon(256), 256, 256))

  return { icoPath, previewPath, sizes: SIZES }
}

// ---------------------------------------------------------------- ICNS（macOS）

/**
 * macOS 图标容器（.icns）。
 *
 * 只使用 PNG 载荷的现代类型 ic07~ic14 —— 这些类型自 Mac OS X 10.7 起由
 * IconServices 原生支持，本应用的最低系统版本是 macOS 11，因此不需要
 * 再写 it32/is32 那套（24 位平面 RGB + 独立掩码）的老式条目。
 * 不引入任何第三方依赖（不做 iconutil 那样的 iconset 目录 + 系统命令依赖），
 * 这样在构建机上既不需要 Xcode，也能在任意平台生成同一个文件。
 *
 * 类型 → 逻辑尺寸（像素）：
 *   ic07 128   ic08 256   ic09 512   ic10 1024（512@2x）
 *   ic11  32（16@2x）  ic12  64（32@2x）  ic13 256（128@2x）  ic14 512（256@2x）
 */
const ICNS_TYPES = [
  { type: 'ic07', size: 128 },
  { type: 'ic08', size: 256 },
  { type: 'ic09', size: 512 },
  { type: 'ic10', size: 1024 },
  { type: 'ic11', size: 32 },
  { type: 'ic12', size: 64 },
  { type: 'ic13', size: 256 },
  { type: 'ic14', size: 512 },
]

/**
 * 生成 ICNS 文件内容。
 * @param {Array<{ type: string, size: number, png: Buffer }>} entries
 */
export function buildIcns(entries) {
  const chunks = []
  for (const entry of entries) {
    const header = Buffer.alloc(8)
    header.write(entry.type, 0, 4, 'ascii')
    // 长度字段包含 8 字节头本身
    header.writeUInt32BE(8 + entry.png.length, 4)
    chunks.push(header, entry.png)
  }

  const body = Buffer.concat(chunks)
  const fileHeader = Buffer.alloc(8)
  fileHeader.write('icns', 0, 4, 'ascii')
  fileHeader.writeUInt32BE(8 + body.length, 4)
  return Buffer.concat([fileHeader, body])
}

/**
 * 生成 macOS 应用包需要的图标：app.icns（以及一张 512px 预览 PNG，便于人工核对）。
 * 与 generateIconAssets 一样从既有品牌素材生成，不重新设计品牌。
 */
export function generateMacIconAssets(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true })

  // 同一个尺寸只渲染一次（ic08/ic13 都是 256，ic09/ic14 都是 512）
  const rendered = new Map()
  const renderOnce = (size) => {
    if (!rendered.has(size)) {
      rendered.set(size, encodePng(renderIcon(size, size > 256 ? 2 : 4), size, size))
    }
    return rendered.get(size)
  }

  const entries = ICNS_TYPES.map(({ type, size }) => ({ type, size, png: renderOnce(size) }))
  const icnsPath = path.join(outputDir, 'app.icns')
  fs.writeFileSync(icnsPath, buildIcns(entries))

  const previewPath = path.join(outputDir, 'app-mac-512.png')
  fs.writeFileSync(previewPath, renderOnce(512))

  return {
    icnsPath,
    previewPath,
    types: ICNS_TYPES.map((item) => item.type),
    sizes: ICNS_TYPES.map((item) => item.size),
  }
}

// 允许直接运行：node packaging/scripts/icon.mjs
const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets')
  const result = generateIconAssets(target)
  console.log(`已生成图标：${result.icoPath}`)
  console.log(`尺寸：${result.sizes.join(', ')}`)
  console.log(`预览：${result.previewPath}`)
  const mac = generateMacIconAssets(target)
  console.log(`已生成 macOS 图标：${mac.icnsPath}`)
  console.log(`类型：${mac.types.join(', ')}`)
}
