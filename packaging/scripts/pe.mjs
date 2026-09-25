/**
 * 极小的 PE 头工具：把可执行文件的子系统改成「Windows GUI」。
 *
 * 为什么需要它：
 *   Node 官方的 node.exe 是「控制台子系统」程序，即使包成 SEA，
 *   双击时依然会弹出一个黑色命令行窗口。普通用户软件不能这样。
 *   把 OptionalHeader.Subsystem 从 3（CONSOLE）改成 2（GUI）后，
 *   双击完全不出现控制台窗口，程序仍然可以正常读写文件、监听端口。
 *
 * 只做这一处原地修改，不加密、不加壳、不改动任何代码段。
 */

import fs from 'node:fs'

const IMAGE_SUBSYSTEM_WINDOWS_GUI = 2
const IMAGE_SUBSYSTEM_WINDOWS_CUI = 3

/** @returns {number} 当前的子系统值 */
export function readSubsystem(filePath) {
  const buffer = fs.readFileSync(filePath)
  return readSubsystemFromBuffer(buffer)
}

function readSubsystemFromBuffer(buffer) {
  if (buffer.readUInt16LE(0) !== 0x5a4d) {
    throw new Error('不是有效的 PE 文件：缺少 MZ 头')
  }
  const peOffset = buffer.readUInt32LE(0x3c)
  if (buffer.readUInt32LE(peOffset) !== 0x00004550) {
    throw new Error('不是有效的 PE 文件：缺少 PE 签名')
  }
  const optionalHeaderOffset = peOffset + 24
  return buffer.readUInt16LE(optionalHeaderOffset + 68)
}

/**
 * 把子系统改成 GUI（隐藏控制台窗口），并清空校验和（改头之后校验和必然失效，
 * Windows 对普通 EXE 不校验该字段，置 0 比留旧值更干净）。
 */
export function setGuiSubsystem(filePath) {
  const buffer = fs.readFileSync(filePath)
  const before = readSubsystemFromBuffer(buffer)
  if (before === IMAGE_SUBSYSTEM_WINDOWS_GUI) {
    return { changed: false, before, after: before }
  }
  if (before !== IMAGE_SUBSYSTEM_WINDOWS_CUI) {
    throw new Error(`非预期的子系统值 ${before}，为安全起见不修改`)
  }

  const peOffset = buffer.readUInt32LE(0x3c)
  const optionalHeaderOffset = peOffset + 24
  buffer.writeUInt16LE(IMAGE_SUBSYSTEM_WINDOWS_GUI, optionalHeaderOffset + 68)
  buffer.writeUInt32LE(0, optionalHeaderOffset + 64) // CheckSum
  fs.writeFileSync(filePath, buffer)

  return { changed: true, before, after: IMAGE_SUBSYSTEM_WINDOWS_GUI }
}
