# 当前状态

## 总体进度

**阶段 6 / 14 —— 已完成并验证通过（真实流式链路验证需用户提供 Key 运行 `npm run check:stream`）**

## 已完成

### 阶段 1 ~ 4 ✅

骨架 / 完整静态 UI / API 设置持久化 / Cloudflare Worker（详见下方向导与 `decision.md`）。

### 阶段 5：打通非流式请求 + 测试连接 ✅

- `src/services/chatApi.ts`（新增，前端调用 Worker 的唯一入口）：
  - `requestChatCompletion(payload, signal)`：统一 POST、非 2xx 转 `ApiRequestError`、
    用户取消透传 `AbortError`。
  - 本地错误码与文案：`endpoint_missing`（端点为占位符）、`network_error`、`invalid_response`、`unknown_error`。
  - `parseErrorBody()` 解析 Worker 的 `{ error: { code, message, status, detail } }`，
    前端只展示 `message`，`detail` 进「查看技术详情」。
  - `readCompletion(data)`：从 OpenAI 兼容响应取 `choices[0].message.content` / `model` / `usage.total_tokens`。
  - `testConnection(settings, apiKey)`：一条 `你好` 的极小非流式请求，永不抛异常，
    返回 `{ ok, message, detail, preview, model, totalTokens }`。
- `src/hooks/useApiSettings.ts`：新增 `status`（unconfigured / unknown / testing / connected / failed）、
  `lastTestResult`、`test(settings, apiKey)`；`save()` 后自动回到 `unknown`（配置变了，旧结论作废）。
- `ApiSettingsModal`：启用「测试连接」，支持用**未保存的表单值**先测；
  成功显示绿色「连接成功」+ 模型回复预览；失败显示红色友好文案 + 常见原因 + 「查看技术详情」折叠区；
  表单被修改后自动清除上一次结论。
- `Header` 的 API 状态改为直接使用 `api.status`（已连接 / 连接失败 / 检测中 等）。

## 阶段 5 验证结果（用户确认）

用户在浏览器中填入自己的 DeepSeek Key 后点击「测试连接」，**显示绿色「连接成功」**。
=> 「浏览器 → Worker → DeepSeek → 解析 → 成功界面」真实成功路径已闭环验证。

## 阶段 6：Streaming ✅

- `src/services/sseStream.ts`（新增）：生产级 SSE 解析器。
  - 行缓冲（残余字符串 + 新 chunk），绝不 `chunk.split('\n')`；
  - `TextDecoder({ stream: true })` 处理跨 chunk 的多字节中文；
  - 遵循 SSE 规范：同事件多行 `data:` 按换行拼接、空行才派发、忽略 `:` 注释；
  - `[DONE]` 立即结束并忽略其后内容；非法 JSON 负载安全忽略；
  - 兼容 `choices[0].delta.content` 与 `message.content`，单独提取 `reasoning_content`（reasoner），
    识别流内 `error` 负载；
  - `consumeSseStream(stream, handlers)` 封装 ReadableStream 消费。
- `scripts/sse-parse-check.mjs`（新增 `npm run check:sse`）：**30 项全部通过**，
  含整段/逐字节/2·3·5·7·13·64·997 字节切分/**随机切分 200 次**、CRLF、多行 data、
  纯心跳、结尾无空行、`[DONE]` 之后的数据被忽略、reasoning 与 content 不混淆。
  通过 Node 24 的类型擦除直接 import 源码 `.ts`，验证的就是生产代码本身。
- `scripts/stream-check.mjs`（新增 `npm run check:stream`）：真实流式链路验证工具。
  测量首字节 / 首个增量 / 末个增量 / 总耗时，断言 `Content-Type: text/event-stream`、
  多块增量、首末增量间隔 > 50ms（证明无整体缓冲）、收到 `[DONE]`、响应不含 Key；
  并附带一次非流式对照请求。无 Key 时打印指引并 SKIP（退出码 0）。
- Worker 改进：`request.signal` → `controller.abort()`，客户端断开（点停止生成 / 关页面）
  时同步中断上游请求，避免继续消耗用户 token。

## 验证结果（全部通过）

- `npm run build`：零 TypeScript 错误。
- `npm run check:sse`：**30/30 通过**（无需网络与 Key）。
- `cd worker && npm run typecheck`：零错误；`cd worker && npm run check`：**38/38 通过**。
- `npm run check:ui`：dev 19/19；生产 preview 17 通过 + 2 项按预期 SKIP。
- `npm run check:stream`：未提供 Key，按预期 SKIP（用户可自行运行做真实验证）。

## 当前状态

- 后台任务：`pwsh-30`（前端 dev 5173）、`pwsh-35`（wrangler dev 8787）。
- SSE 解析器已就绪但**前端尚未使用**（`useChat.runGeneration` 仍是模拟实现），阶段 7 接入。
- 会话历史仍只在内存，阶段 9 接入 IndexedDB。

## 下一步（阶段 7：网页接入 Streaming）

1. `useChat.runGeneration` 改为：`requestChatCompletion({...stream:true})` →
   `consumeSseStream(response.body, handlers)` 增量写入 assistant 消息。
2. 需要给 `useConversations` 增加「创建空 assistant 消息」+「按 id 追加内容」的能力。
3. 首个增量到达前保持「AI 正在思考」；到达后切换为 `streaming` 状态并显示光标。
4. `AbortController` 实现「停止生成」；保留已生成的部分内容并把状态置为 `aborted`。
5. 建议加**空闲超时**（例如 60s 无增量则中断并提示），避免流挂死。
6. 移除 `src/mocks/mockData.ts` 的模拟回答（种子会话可保留或一并删除）。
7. 错误处理：流中途断开、401/402/429、网络中断都要在消息里显示友好提示且页面不崩。

## 风险与限制

- 真实流式链路尚未由代理亲自跑通（无 Key）；用户可用 `npm run check:stream` 验证。
- `.env.production` 仍是占位符，阶段 14 必须替换。
- 会话历史不持久化（阶段 9）。
