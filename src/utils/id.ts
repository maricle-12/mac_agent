/**
 * 生成本地唯一 id。
 * 不使用 crypto.randomUUID：非 HTTPS 环境（例如局域网 IP 访问）下不可用。
 */
export function createId(prefix = ''): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}${Date.now().toString(36)}${random}`
}
