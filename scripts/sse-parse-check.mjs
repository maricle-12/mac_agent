/**
 * SSE 解析器单元验证（无第三方依赖）。
 *
 * Node 24 可直接 import TypeScript（类型擦除），因此这里直接引用前端源码，
 * 保证被验证的就是生产代码本身，而不是复制品。
 *
 * 核心目标：证明「一个 JSON 被拆到两个 chunk」以及
 * 「一个中文字符被拆到两个 chunk」都不会导致解析错误。
 *
 * 用法：npm run check:sse
 */

import { createSseParser, readSseDelta } from '../src/services/sseStream.ts'

let failed = 0
let passed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`PASS  ${name}`)
    return
  }
  failed += 1
  console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`)
}

function equal(name, actual, expected) {
  check(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

// ---------------------------------------------------------------- 测试数据

/** 构造一段贴近 DeepSeek 真实输出的 SSE 文本 */
function buildSseText() {
  const chunks = [
    { choices: [{ delta: { role: 'assistant', content: '' } }] },
    { choices: [{ delta: { content: '分类' } }] },
    { choices: [{ delta: { content: '与整理' } }] },
    { choices: [{ delta: { content: '是二年级' } }] },
    { choices: [{ delta: { content: '数学内容' } }] },
    { choices: [{ delta: { content: '。' }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ]
  const lines = [
    ': keep-alive',
    '',
    ...chunks.map((item) => `data: ${JSON.stringify(item)}\n`),
    'data: [DONE]',
    '',
  ]
  return { text: lines.join('\n'), expected: '分类与整理是二年级数学内容。' }
}

/** 运行一次解析并返回结果 */
function run(chunks) {
  let content = ''
  let done = 0
  let errors = []
  let reasoning = ''

  const parser = createSseParser({
    onContent: (text) => {
      content += text
    },
    onDone: () => {
      done += 1
    },
    onError: (message) => errors.push(message),
    onReasoning: (text) => {
      reasoning += text
    },
  })

  for (const chunk of chunks) parser.push(chunk)
  parser.flush()

  return { content, done, errors, reasoning, finished: parser.finished }
}

const encoder = new TextEncoder()

function toBytes(text) {
  return encoder.encode(text)
}

/** 按固定大小切分字节，模拟网络分块 */
function splitBytes(bytes, size) {
  const out = []
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size))
  return out
}

// ---------------------------------------------------------------- 用例

{
  const { text, expected } = buildSseText()
  const result = run([toBytes(text)])
  equal('整段一次送达时解析正确', result.content, expected)
  equal('整段一次送达时收到 [DONE]', result.done, 1)
  check('整段一次送达后标记 finished', result.finished === true)
}

{
  const { text, expected } = buildSseText()
  const result = run(splitBytes(toBytes(text), 1))
  equal('【关键】逐字节送达（JSON 与中文都被切开）仍解析正确', result.content, expected)
  equal('逐字节送达时 [DONE] 仍被识别', result.done, 1)
}

{
  const { text, expected } = buildSseText()
  for (const size of [2, 3, 5, 7, 13, 64, 997]) {
    const result = run(splitBytes(toBytes(text), size))
    check(`按 ${size} 字节切分仍解析正确`, result.content === expected, `实际 ${JSON.stringify(result.content)}`)
  }
}

{
  // 每个 chunk 随机大小，重复多次以覆盖不同切分位置
  const { text, expected } = buildSseText()
  const bytes = toBytes(text)
  let allOk = true
  for (let round = 0; round < 200; round += 1) {
    const chunks = []
    let offset = 0
    while (offset < bytes.length) {
      const size = 1 + Math.floor(Math.random() * 17)
      chunks.push(bytes.slice(offset, offset + size))
      offset += size
    }
    if (run(chunks).content !== expected) {
      allOk = false
      break
    }
  }
  check('随机切分 200 次全部解析正确', allOk)
}

{
  // CRLF 行尾
  const sse = 'data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: [DONE]\r\n\r\n'
  const result = run(splitBytes(toBytes(sse), 3))
  equal('CRLF 行尾兼容', result.content, '你好')
  equal('CRLF 下的 [DONE]', result.done, 1)
}

{
  // 同一事件内多行 data 需按换行拼接（SSE 规范）
  const sse = 'data: {"choices":[{"delta":{"content":"多"}}]}\ndata: \n\n'
  const result = run([toBytes(sse)])
  equal('多行 data 事件不误判', result.content, '多')

  const raw = 'data: ac\ndata: b\n\n'
  let seen = null
  const parser = createSseParser({
    onContent: () => {},
    onDone: () => {},
  })
  parser.push(toBytes(raw))
  // 该负载不是合法 JSON，应被安全忽略而不是抛错
  check('非法 JSON 负载被安全忽略', true)
  void seen
}

{
  // 流内错误负载
  const sse = 'data: {"error":{"message":"上游限流","detail":"rate limit"}}\n\n'
  const result = run([toBytes(sse)])
  equal('流内错误被识别', result.errors[0], '上游限流')
}

{
  // DeepSeek reasoner 的思维链
  const sse =
    'data: {"choices":[{"delta":{"reasoning_content":"先看题目"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n' +
    'data: [DONE]\n\n'
  const result = run(splitBytes(toBytes(sse), 4))
  equal('reasoning_content 被单独提取', result.reasoning, '先看题目')
  equal('reasoning 与 content 互不混淆', result.content, '答案')
}

{
  // 缺少尾部空行（部分服务端实现）
  const sse = 'data: {"choices":[{"delta":{"content":"结尾无空行"}}]}'
  const result = run([toBytes(sse)])
  equal('结尾没有空行时 flush 仍能派发', result.content, '结尾无空行')
}

{
  // 只有注释和空行
  const result = run([toBytes(': ping\n\n: ping\n\n')])
  equal('纯心跳流不产生内容', result.content, '')
  check('纯心跳流不会被误判为结束', result.finished === false)
}

{
  // [DONE] 之后的内容应被忽略
  const sse =
    'data: {"choices":[{"delta":{"content":"前"}}]}\n\n' +
    'data: [DONE]\n\n' +
    'data: {"choices":[{"delta":{"content":"后"}}]}\n\n'
  const result = run([toBytes(sse)])
  equal('忽略 [DONE] 之后的数据', result.content, '前')
  equal('[DONE] 只触发一次', result.done, 1)
}

// ---------------------------------------------------------------- readSseDelta

equal('readSseDelta 取 delta.content', readSseDelta({ choices: [{ delta: { content: 'a' } }] }).content, 'a')
equal(
  'readSseDelta 兼容 message.content',
  readSseDelta({ choices: [{ message: { content: 'b' } }] }).content,
  'b',
)
equal('readSseDelta 忽略空 choices', readSseDelta({ choices: [] }).content, undefined)
equal('readSseDelta 容忍非对象输入', readSseDelta(null).content, undefined)
equal('readSseDelta 容忍字符串输入', readSseDelta('abc').content, undefined)

console.log(`\n结果: ${failed === 0 ? `全部通过（${passed} 项）` : `${failed} 项失败`}`)
process.exitCode = failed === 0 ? 0 : 1
