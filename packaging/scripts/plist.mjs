/**
 * 极小的 Info.plist 生成 / 读取工具（macOS 应用包用）。
 *
 * 只做两件事：
 *   1. 把 JS 对象序列化成 Apple 的 XML plist（不依赖任何第三方库）；
 *   2. 把生成的 plist 再读回来，供打包自检做断言 —— 断言的是「文件里真的写了什么」，
 *      而不是「我以为写了什么」。
 *
 * 不虚构公司信息：CompanyName / 版权一律不写（与 Windows 版本资源保持一致）。
 */

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function serializeValue(value, indent) {
  const pad = '\t'.repeat(indent)
  if (typeof value === 'string') return `${pad}<string>${escapeXml(value)}</string>`
  if (typeof value === 'boolean') return `${pad}<${value ? 'true' : 'false'}/>`
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Info.plist 不支持的值：${value}`)
    return Number.isInteger(value) ? `${pad}<integer>${value}</integer>` : `${pad}<real>${value}</real>`
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => serializeValue(item, indent + 1)).join('\n')
    return `${pad}<array>\n${items}\n${pad}</array>`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, item]) => `${pad}\t<key>${escapeXml(key)}</key>\n${serializeValue(item, indent + 1)}`)
      .join('\n')
    return `${pad}<dict>\n${entries}\n${pad}</dict>`
  }
  throw new Error(`Info.plist 不支持的类型：${typeof value}`)
}

/**
 * 生成完整的 XML plist 文本（含 DOCTYPE，macOS 的 CFBundle 解析器接受该形式）。
 * @param {Record<string, unknown>} dict
 */
export function buildPlist(dict) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    serializeValue(dict, 0),
    '</plist>',
    '',
  ].join('\n')
}

/**
 * 读取 plist 文本里**顶层** key → 值（字符串 / 布尔 / 数字）。
 * 只支持本工具自己生成的扁平结构，用于打包自检；不做完整 plist 解析。
 * @returns {Record<string, unknown>}
 */
export function parsePlistTopLevel(text) {
  const inner = text.replace(/^[\s\S]*?<plist[^>]*>/, '').replace(/<\/plist>[\s\S]*$/, '')
  const out = {}
  const pattern =
    /<key>([\s\S]*?)<\/key>\s*(?:<string>([\s\S]*?)<\/string>|<(true|false)\/>|<integer>([\s\S]*?)<\/integer>)/g
  let match
  while ((match = pattern.exec(inner)) !== null) {
    const key = unescapeXml(match[1])
    if (match[2] !== undefined) out[key] = unescapeXml(match[2])
    else if (match[3] !== undefined) out[key] = match[3] === 'true'
    else if (match[4] !== undefined) out[key] = Number.parseInt(match[4], 10)
  }
  return out
}

function unescapeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
