/**
 * Worker 接口与安全边界自检（无第三方依赖，直接使用 fetch）。
 *
 * 用法：
 *   1) 先启动 Worker：npm run dev      （默认 http://127.0.0.1:8787）
 *   2) 再执行自检：    npm run check
 *   也可以指定地址：    node test/worker-check.mjs https://xxx.workers.dev
 *
 * 其中「鉴权失败」用例会真的请求一次上游 DeepSeek（使用假 Key），
 * 用来验证转发链路与错误映射，不需要真实 API Key，也不会产生任何费用。
 */

const base = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/+$/, '')
const ALLOWED_ORIGIN = 'http://localhost:5173'
const BLOCKED_ORIGIN = 'https://evil.example.com'
const FAKE_KEY = 'sk-fake-key-for-worker-self-check-000000'

const seenBodies = []
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

async function call(path, { method = 'POST', headers = {}, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  })

  const text = await response.text()
  seenBodies.push(text)

  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // 非 JSON 响应保持 null
  }

  return { status: response.status, headers: response.headers, text, json }
}

function chatBody(overrides = {}) {
  return {
    apiKey: 'sk-dummy',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: '你好' }],
    stream: false,
    ...overrides,
  }
}

console.log(`=== Worker 自检 ===\n地址: ${base}\n`)

// ---------------------------------------------------------------- 基础路由

const health = await call('/api/health', { method: 'GET' })
check('GET /api/health 返回 200', health.status === 200, `实际 ${health.status}`)
check('健康检查内容正确', health.json?.ok === true && typeof health.json?.service === 'string')
check(
  '/api/health 带 Cache-Control: no-store',
  health.headers.get('cache-control') === 'no-store',
  `实际 ${health.headers.get('cache-control')}`,
)

const getChat = await call('/api/chat', { method: 'GET' })
check('GET /api/chat 返回 405（只允许 POST）', getChat.status === 405, `实际 ${getChat.status}`)

const unknown = await call('/api/anything', { method: 'POST', body: {} })
check('未知路径返回 404', unknown.status === 404, `实际 ${unknown.status}`)

// ---------------------------------------------------------------- CORS

const preflightOk = await call('/api/chat', {
  method: 'OPTIONS',
  headers: { Origin: ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'POST' },
})
check('允许来源的预检返回 204', preflightOk.status === 204, `实际 ${preflightOk.status}`)
check(
  '允许来源的预检回显 Access-Control-Allow-Origin',
  preflightOk.headers.get('access-control-allow-origin') === ALLOWED_ORIGIN,
  `实际 ${preflightOk.headers.get('access-control-allow-origin')}`,
)

const preflightBlocked = await call('/api/chat', {
  method: 'OPTIONS',
  headers: { Origin: BLOCKED_ORIGIN, 'Access-Control-Request-Method': 'POST' },
})
check(
  '未允许来源的预检不返回 Access-Control-Allow-Origin',
  preflightBlocked.headers.get('access-control-allow-origin') === null,
  `实际 ${preflightBlocked.headers.get('access-control-allow-origin')}`,
)

const blockedPost = await call('/api/chat', {
  headers: { Origin: BLOCKED_ORIGIN },
  body: chatBody(),
})
check('未允许来源的请求被拒绝（403）', blockedPost.status === 403, `实际 ${blockedPost.status}`)
check(
  '来源被拒时返回可读错误码',
  blockedPost.json?.error?.code === 'origin_not_allowed',
  `实际 ${JSON.stringify(blockedPost.json)}`,
)

const allowedPost = await call('/api/chat', {
  headers: { Origin: ALLOWED_ORIGIN },
  body: chatBody({ apiKey: '' }),
})
check(
  '允许来源的请求带 CORS 头',
  allowedPost.headers.get('access-control-allow-origin') === ALLOWED_ORIGIN,
)

// ---------------------------------------------------------------- 请求校验

const notJson = await call('/api/chat', { body: '这不是 JSON' })
check('非 JSON 正文返回 400 invalid_json', notJson.json?.error?.code === 'invalid_json', `实际 ${JSON.stringify(notJson.json)}`)

const missingKey = await call('/api/chat', { body: chatBody({ apiKey: '' }) })
check('缺少 apiKey 返回 400', missingKey.status === 400, `实际 ${missingKey.status}`)
check(
  '缺少 apiKey 的错误码为 invalid_request',
  missingKey.json?.error?.code === 'invalid_request',
  `实际 ${JSON.stringify(missingKey.json)}`,
)

const noMessages = await call('/api/chat', { body: chatBody({ messages: [] }) })
check('messages 为空返回 400', noMessages.status === 400, `实际 ${noMessages.status}`)

const tooManyMessages = await call('/api/chat', {
  body: chatBody({
    messages: Array.from({ length: 61 }, () => ({ role: 'user', content: '你好' })),
  }),
})
check('消息条数超限返回 400', tooManyMessages.status === 400, `实际 ${tooManyMessages.status}`)

const badRole = await call('/api/chat', {
  body: chatBody({ messages: [{ role: 'tool', content: '你好' }] }),
})
check('不支持的 role 返回 400', badRole.status === 400, `实际 ${badRole.status}`)

const badTemperature = await call('/api/chat', { body: chatBody({ temperature: 9 }) })
check('temperature 超范围返回 400', badTemperature.status === 400, `实际 ${badTemperature.status}`)

const hugeBody = await call('/api/chat', {
  body: chatBody({ messages: [{ role: 'user', content: 'a'.repeat(600 * 1024) }] }),
})
check('超大体量正文返回 413', hugeBody.status === 413, `实际 ${hugeBody.status}`)

// ---------------------------------------------------------------- SSRF 防护

const ssrfCases = [
  ['非白名单域名', 'https://evil.example.com'],
  ['白名单域名的子域但不同 origin', 'https://api.deepseek.com.evil.com'],
  ['用用户名伪装白名单域名', 'https://api.deepseek.com@evil.example.com'],
  ['使用 http 协议', 'http://api.deepseek.com'],
  ['URL 中携带凭据', 'https://user:pass@api.deepseek.com'],
  ['带查询串', 'https://api.deepseek.com?x=1'],
  ['带 hash', 'https://api.deepseek.com#x'],
  ['指向内网地址', 'http://169.254.169.254'],
  ['指向 localhost', 'http://127.0.0.1:8080'],
  ['非标准端口的白名单域名', 'https://api.deepseek.com:8443'],
  ['协议相对地址', '//evil.example.com'],
  ['file 协议', 'file:///etc/passwd'],
  ['非法 URL', 'not a url'],
]

for (const [name, baseUrl] of ssrfCases) {
  const result = await call('/api/chat', { body: chatBody({ baseUrl }) })
  check(
    `SSRF 防护：${name} 被拒绝`,
    result.status === 400 && result.json?.error?.code === 'base_url_not_allowed',
    `实际 status=${result.status} body=${JSON.stringify(result.json)}`,
  )
}

// dot-segment 会被 URL 解析器规范化掉，因此不会改变 origin。
// 这里断言它仍然被接受，反证请求始终落在白名单 origin 内（未逃逸）。
const dotSegment = await call('/api/chat', {
  body: chatBody({ baseUrl: 'https://api.deepseek.com/../evil', apiKey: FAKE_KEY }),
})
check(
  'SSRF 防护：dot-segment 不改变 origin（仍只请求白名单 origin）',
  dotSegment.json?.error?.code !== 'base_url_not_allowed',
  `实际 ${JSON.stringify(dotSegment.json)?.slice(0, 200)}`,
)

// 省略 baseUrl 时应回退到默认白名单地址
const noBaseUrl = await call('/api/chat', { body: chatBody({ baseUrl: undefined, apiKey: FAKE_KEY }) })
check(
  '省略 baseUrl 时回退到默认白名单地址',
  noBaseUrl.status === 401 && noBaseUrl.json?.error?.code === 'invalid_api_key',
  `实际 status=${noBaseUrl.status} body=${noBaseUrl.text.slice(0, 200)}`,
)

// 允许的 /v1 路径变体（OpenAI 兼容写法）
const v1Path = await call('/api/chat', {
  body: chatBody({ baseUrl: 'https://api.deepseek.com/v1', apiKey: FAKE_KEY }),
})
check(
  'SSRF 防护：白名单 origin 下的 /v1 路径变体被允许',
  v1Path.status === 401,
  `实际 status=${v1Path.status} body=${v1Path.text.slice(0, 200)}`,
)

// ---------------------------------------------------------------- 真实上游转发（使用假 Key）

const upstreamNonStream = await call('/api/chat', { body: chatBody({ apiKey: FAKE_KEY }) })
check(
  '非流式：假 Key 转发到 DeepSeek 后返回 401',
  upstreamNonStream.status === 401,
  `实际 status=${upstreamNonStream.status} body=${upstreamNonStream.text.slice(0, 200)}`,
)
check(
  '非流式：错误码映射为 invalid_api_key',
  upstreamNonStream.json?.error?.code === 'invalid_api_key',
  `实际 ${JSON.stringify(upstreamNonStream.json)}`,
)
check(
  '非流式：错误信息为面向用户的中文说明',
  typeof upstreamNonStream.json?.error?.message === 'string' &&
    /API Key/.test(upstreamNonStream.json.error.message),
  `实际 ${upstreamNonStream.json?.error?.message}`,
)

const upstreamStream = await call('/api/chat', { body: chatBody({ apiKey: FAKE_KEY, stream: true }) })
check(
  '流式：假 Key 同样返回结构化错误而非流',
  upstreamStream.status === 401 && upstreamStream.json?.error?.code === 'invalid_api_key',
  `实际 status=${upstreamStream.status} body=${upstreamStream.text.slice(0, 200)}`,
)

const badModel = await call('/api/chat', {
  body: chatBody({ apiKey: FAKE_KEY, model: 'not-a-real-model' }),
})
check(
  '不存在的模型也能正向映射为可读错误',
  [401, 404].includes(badModel.status) && typeof badModel.json?.error?.message === 'string',
  `实际 status=${badModel.status} body=${badModel.text.slice(0, 200)}`,
)

// ---------------------------------------------------------------- 密钥不泄露

const leaked = seenBodies.filter((text) => text.includes(FAKE_KEY) || text.includes('sk-dummy'))
check('所有响应中均未出现完整 API Key', leaked.length === 0, `泄露 ${leaked.length} 处`)

const leakedAuth = seenBodies.filter((text) => /Bearer\s+\S/.test(text))
check('所有响应中均未出现 Authorization 头内容', leakedAuth.length === 0, `泄露 ${leakedAuth.length} 处`)

const allNoStore = [health, getChat, unknown, blockedPost, upstreamNonStream].every(
  (item) => item.headers.get('cache-control') === 'no-store',
)
check('所有响应均带 Cache-Control: no-store', allNoStore)

console.log(`\n结果: ${failed === 0 ? '全部通过' : `${failed} 项失败`}`)
process.exitCode = failed === 0 ? 0 : 1
