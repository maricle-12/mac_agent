/**
 * 极简 SSE（Server-Sent Events）解析器。
 *
 * 为什么不能简单 `chunk.split('\n')`：
 *   1. 一个网络 chunk 可能只包含半行 JSON，另一半在下一个 chunk 里；
 *   2. 一个 chunk 也可能一次包含多行；
 *   3. 一个中文字符（3 字节 UTF-8）可能被切在两个 chunk 之间。
 * 因此这里使用「上一个残余字符串 + 新 chunk」的行缓冲，并用
 * `TextDecoder({ stream: true })` 处理跨 chunk 的多字节字符。
 *
 * 同时遵循 SSE 规范：同一事件内多行 `data:` 用换行拼接，空行才触发一次派发。
 */

export interface SseHandlers {
  /** 每收到一段正文增量时调用 */
  onContent: (text: string) => void
  /** 收到 `data: [DONE]` 时调用一次 */
  onDone: () => void
  /** 流内出现错误负载时调用 */
  onError?: (message: string, detail?: string) => void
  /** DeepSeek reasoner 的思维链增量（可选） */
  onReasoning?: (text: string) => void
}

export interface SseParser {
  /** 送入一个网络 chunk（原始字节，不能先自行解码） */
  push: (chunk: Uint8Array) => void
  /** 流结束时调用，冲刷缓冲与解码器 */
  flush: () => void
  /** 是否已收到 [DONE] */
  readonly finished: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface DeltaFields {
  content?: string
  reasoning?: string
  error?: { message: string; detail?: string }
}

/**
 * 从一条 SSE data 负载中取出增量字段。
 * 兼容 OpenAI / DeepSeek：choices[0].delta.content；同时兼容非流式的 message.content。
 */
export function readSseDelta(payload: unknown): DeltaFields {
  if (!isRecord(payload)) return {}

  if (isRecord(payload.error)) {
    return {
      error: {
        message:
          typeof payload.error.message === 'string' ? payload.error.message : '模型服务返回了错误',
        detail: typeof payload.error.detail === 'string' ? payload.error.detail : undefined,
      },
    }
  }

  const choices = payload.choices
  if (!Array.isArray(choices) || choices.length === 0) return {}

  const first = choices[0]
  if (!isRecord(first)) return {}

  const delta = isRecord(first.delta) ? first.delta : {}
  const message = isRecord(first.message) ? first.message : {}

  const deltaContent = typeof delta.content === 'string' ? delta.content : undefined
  const messageContent = typeof message.content === 'string' ? message.content : undefined

  return {
    content: deltaContent ?? messageContent,
    reasoning: typeof delta.reasoning_content === 'string' ? delta.reasoning_content : undefined,
  }
}

export function createSseParser(handlers: SseHandlers): SseParser {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let dataLines: string[] = []
  let finished = false

  function dispatch(): void {
    if (dataLines.length === 0) return
    const payload = dataLines.join('\n')
    dataLines = []

    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      // 无法解析的负载直接忽略，避免整条流因此中断
      return
    }

    const delta = readSseDelta(parsed)
    if (delta.error) {
      handlers.onError?.(delta.error.message, delta.error.detail)
      return
    }
    if (delta.reasoning) handlers.onReasoning?.(delta.reasoning)
    if (delta.content) handlers.onContent(delta.content)
  }

  function handleLine(rawLine: string): void {
    if (finished) return

    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine

    // 空行 = 一个事件结束
    if (line === '') {
      dispatch()
      return
    }
    // 以冒号开头的是注释（常用于心跳）
    if (line.startsWith(':')) return

    const colonIndex = line.indexOf(':')
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex)
    let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field !== 'data') return // event / id / retry 字段本项目用不到

    if (value === '[DONE]') {
      finished = true
      handlers.onDone()
      return
    }
    dataLines.push(value)
  }

  return {
    push(chunk: Uint8Array): void {
      if (finished) return
      // stream: true 让解码器保留跨 chunk 的不完整多字节字符
      buffer += decoder.decode(chunk, { stream: true })

      let index = buffer.indexOf('\n')
      while (index >= 0) {
        handleLine(buffer.slice(0, index))
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
      }
    },

    flush(): void {
      buffer += decoder.decode()
      if (buffer.length > 0) {
        handleLine(buffer)
        buffer = ''
      }
      // 流在最后一个空行前结束的情况
      dispatch()
    },

    get finished(): boolean {
      return finished
    },
  }
}

/**
 * 把 ReadableStream 逐块喂给解析器。
 * 返回一个 Promise，在流结束或收到 [DONE] 后 resolve。
 */
export async function consumeSseStream(
  stream: ReadableStream<Uint8Array>,
  handlers: SseHandlers,
): Promise<void> {
  const parser = createSseParser(handlers)
  const reader = stream.getReader()

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
}
