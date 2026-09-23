/**
 * Worker 流式转发的真实链路验证。
 *
 * 验证内容：
 *   1. 响应 Content-Type 是 text/event-stream（而不是被缓冲成 JSON）；
 *   2. 首块到达时间明显早于总耗时 → 证明是「边生成边下发」而不是「等完整再返回」；
 *   3. 多个 chunk 分散到达 → 证明中间层（Worker）没有做整体缓冲；
 *   4. 用项目里生产的 SSE 解析器解析真实数据，能拼出完整回答并收到 [DONE]；
 *   5. 非流式请求同样可用（作为对照）。
 *
 * 需要 API Key（脚本不会保存、也不会打印 Key）：
 *   PowerShell:  $env:DEEPSEEK_API_KEY="sk-xxxx"; node scripts/stream-check.mjs
 *   CMD:         set DEEPSEEK_API_KEY=sk-xxxx && node scripts/stream-check.mjs
 *
 * 可选环境变量：
 *   WORKER_URL   默认 http://127.0.0.1:8787
 *   DEEPSEEK_MODEL  默认 deepseek-chat
 */

import { createSseParser } from '../src/services/sseStream.ts'

const workerUrl = (process.env.WORKER_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '')
const apiKey = process.env.DEEPSEEK_API_KEY ?? process.env.API_KEY ?? ''
const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat'

let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`PASS  ${name}`)
    return true
  }
  failed += 1
  console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`)
  return false
}

if (!apiKey) {
  console.log('SKIP  未提供 DEEPSEEK_API_KEY，跳过真实流式验证')
  console.log('')
  console.log('如需验证，请先设置环境变量后重跑（Key 不会被写入任何文件）：')
  console.log('  PowerShell:  $env:DEEPSEEK_API_KEY="sk-xxxx"; node scripts/stream-check.mjs')
  console.log('  CMD:         set DEEPSEEK_API_KEY=sk-xxxx && node scripts/stream-check.mjs')
  process.exit(0)
}

// 先确认 Worker 可用
try {
  const health = await fetch(`${workerUrl}/api/health`)
  if (!health.ok) throw new Error(`HTTP ${health.status}`)
} catch (error) {
  console.error(`无法访问 Worker：${workerUrl}/api/health（${error.message}）`)
  console.error('请先在 worker/ 目录执行 npm run dev')
  process.exit(2)
}

const prompt = '请用大约 150 字介绍小学数学「分类与整理」的教学重点与常见易错点。'

console.log(`=== 流式转发验证 ===`)
console.log(`Worker: ${workerUrl}`)
console.log(`模型:   ${model}`)
console.log(`提示词: ${prompt}\n`)

// ---------------------------------------------------------------- 流式请求

const startedAt = Date.now()
let response
try {
  response = await fetch(`${workerUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({
      apiKey,
      baseUrl: 'https://api.deepseek.com',
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      stream: true,
    }),
  })
} catch (error) {
  console.error(`请求失败：${error.message}`)
  process.exit(2)
}

const contentType = response.headers.get('content-type') ?? ''
console.log(`HTTP ${response.status} · Content-Type: ${contentType}`)
console.log(`Cache-Control: ${response.headers.get('cache-control')}\n`)

if (!response.ok) {
  const text = await response.text()
  console.error(`上游返回错误，无法验证流式：${text.slice(0, 400)}`)
  process.exit(1)
}

check('响应状态为 200', response.status === 200)
check('Content-Type 为 text/event-stream（未被缓冲成 JSON）', contentType.includes('text/event-stream'), `实际 ${contentType}`)
check('响应带 Cache-Control: no-store', response.headers.get('cache-control') === 'no-store')
check('响应体是可读流', Boolean(response.body))

const ttfb = Date.now() - startedAt

let content = ''
let reasoning = ''
const arrivals = []
const errors = []
let doneCount = 0

const parser = createSseParser({
  onContent: (text) => {
    content += text
    arrivals.push(Date.now() - startedAt)
  },
  onDone: () => {
    doneCount += 1
  },
  onError: (message) => errors.push(message),
  onReasoning: (text) => {
    reasoning += text
  },
})

const reader = response.body.getReader()
try {
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) parser.push(value)
    if (parser.finished) break
  }
  parser.flush()
} finally {
  reader.releaseLock()
}

const total = Date.now() - startedAt
const firstArrival = arrivals.length > 0 ? arrivals[0] : null
const lastArrival = arrivals.length > 0 ? arrivals[arrivals.length - 1] : null

console.log('\n--- 到达时间分布 ---')
console.log(`首字节（响应头）: ${ttfb} ms`)
console.log(`首个正文增量:     ${firstArrival ?? '—'} ms`)
console.log(`末个正文增量:     ${lastArrival ?? '—'} ms`)
console.log(`总耗时:           ${total} ms`)
console.log(`正文增量块数:     ${arrivals.length}`)
if (reasoning) console.log(`思维链字符数:     ${reasoning.length}`)

console.log('\n--- 回答内容 ---')
console.log(content.trim() || '（空）')

console.log('\n--- 断言 ---')
check('收到正文增量', content.trim().length > 0)
check('收到 [DONE]', doneCount === 1, `实际 ${doneCount} 次`)
check('正文被拆成多个增量块（说明是逐块下发）', arrivals.length >= 2, `实际 ${arrivals.length} 块`)
check(
  '首个增量明显早于最后增量（说明没有整体缓冲）',
  firstArrival !== null && lastArrival !== null && lastArrival - firstArrival > 50,
  `首 ${firstArrival} ms / 末 ${lastArrival} ms`,
)
check('首字节早于总耗时', firstArrival !== null && firstArrival < total, `首增量 ${firstArrival} ms / 总 ${total} ms`)
check('流内没有错误负载', errors.length === 0, errors.join(' | '))
check('响应中不包含 API Key', !content.includes(apiKey))

// ---------------------------------------------------------------- 非流式对照

console.log('\n--- 非流式对照 ---')
const nonStreamStart = Date.now()
const nonStream = await fetch(`${workerUrl}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
  body: JSON.stringify({
    apiKey,
    baseUrl: 'https://api.deepseek.com',
    model,
    messages: [{ role: 'user', content: '用一句话说明什么是分类。' }],
    stream: false,
  }),
})
const nonStreamBody = await nonStream.json()
const nonStreamText = nonStreamBody?.choices?.[0]?.message?.content ?? ''
console.log(`HTTP ${nonStream.status} · ${Date.now() - nonStreamStart} ms`)
console.log(`回答: ${String(nonStreamText).trim().slice(0, 120)}`)

check('非流式请求返回 200', nonStream.status === 200)
check('非流式响应可解析出回答', String(nonStreamText).trim().length > 0)

console.log(`\n结果: ${failed === 0 ? '全部通过' : `${failed} 项失败`}`)
process.exitCode = failed === 0 ? 0 : 1
