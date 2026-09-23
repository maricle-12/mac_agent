# 当前状态

## 总体进度

**阶段 7 / 14 —— 已完成并验证通过（等待用户确认后进入阶段 8）**

## 阶段 1 ~ 6 ✅

骨架 / 完整静态 UI / API 设置持久化 / Cloudflare Worker / 非流式转发与测试连接 / SSE 解析器与流式验证工具。
详见下方「已完成」与 `decision.md`。

## 阶段 7：网页接入 Streaming ✅

- `src/hooks/useChat.ts` 重写为真实流式：
  - 先插入空的 assistant 占位消息，收到增量后逐块写入；
  - 增量累积到闭包变量，用 `requestAnimationFrame` **合并刷新**，避免每个 token 都重解析 Markdown；
  - `AbortController` 实现「停止生成」，并传导到 Worker 与上游；保留已生成内容，
    一个字都没生成时移除空气泡；
  - **空闲超时**（`apiConfig.streamIdleTimeoutMs` = 60s）自动中断并提示；
  - 出错时保留部分内容 + 红色错误提示（不再二选一）；
  - 未配置 Key 时直接给出可操作提示，不发请求。
- `useChat` 现在接收 `apiKey` 与 `settings`，消息列表由调用方传入（避免读取到过期的 state）。
- `src/services/chatApi.ts`：新增 `buildRequestMessages(history, { systemPrompt?, maxContextMessages })`。
  只取最近 N 条、过滤空内容与出错消息、**不重复添加当前用户消息**（调用方传入的历史已包含它）。
  `systemPrompt` 参数已就位，阶段 8 由 `src/prompts` 提供。
- `MessageList`：
  - 「AI 正在思考」只在「生成中且还没有任何正文」时显示，且此时隐藏空气泡；
  - `canRegenerate` 改为 `!generating` —— 停止或出错后依然可以「重新生成」。
- `MessageBubble`：正文与错误提示可以同时显示；正文为空时不显示「复制」。
- `src/mocks/mockData.ts`：删除 `createMockReply`，不再生成任何模拟回答（仅保留示例会话，阶段 9 移除）。
- `vite.config.ts`：`server.watch.ignored` 排除 `worker/`、`screenshots/`、`project_memory/`。

## 验证结果（全部通过）

- `npm run build`：零 TypeScript 错误。
- `npm run check:sse`：**30/30 通过**。
- `cd worker && npm run typecheck` + `check`：零错误 + **38/38 通过**。
- `npm run check:ui`（**20 项**）：
  - dev（端点指向本地 Worker）：**20/20 通过**；
  - 生产 preview（`.env.production` 仍是占位符）：14 通过 + 6 项按预期 SKIP。
  - 新增的流式三项用**桩 SSE 确定性复现**（不依赖真实 Key）：
    1. 「AI 正在思考」→ 增量渲染：**前后两次采样证明内容在增长**（不是一次性出现）；
       结束后出现「复制 / 重新生成」，标题自动生成；
    2. 停止生成：内容保留、不再增长、`AbortSignal` 确认触发（证明真中断）；
    3. 重新生成：用户消息不重复（1 → 1）。
  - 新增「探测转发端点是否已配置」用例，据此决定依赖真实端点的用例是执行还是跳过。
- 无 `console.error`、无未捕获异常；两条预期内的 401 网络日志已显式容忍。

## 过程中修掉的问题

1. **Vite 监听了 `worker/` 子项目**，导致改动 Worker 时前端清缓存并强制整页刷新，
   曾让一次自动化检查整体误报为「#root 未渲染」。已通过 `server.watch.ignored` 修复。
2. `canRegenerate` 原本要求 `status === 'idle'`，导致停止/出错后无法重新生成（真实 UX 缺陷）。
3. 测试脚本里「发送消息」步骤提前失败后，其流仍在运行，导致下一步的 `send()` 被
   `abortRef.current` 守卫静默拦下，产生级联误判。已在每个流式用例前加前置条件等待。

## 当前状态

- 后台任务：`pwsh-30`（前端 dev 5173）、`pwsh-35`（wrangler dev 8787）。
- 聊天回答已由 DeepSeek 真实流式返回；示例会话内容仍为静态文本（阶段 9 移除）。
- **尚未由代理亲自跑通真实流式**（无 Key）；用户可执行 `npm run check:stream`，
  或直接在浏览器聊天验证。

## 下一步（阶段 8：教师 / 学生 System Prompt）

1. 新建 `src/prompts/teacher.ts`、`student.ts`、`index.ts`，内容严格按需求文档第五、十六节。
2. `index.ts` 导出 `getSystemPrompt(mode)`，并预留 `lessonPlan` / `examGenerator` / `errorAnalysis` 的扩展位。
3. `useChat` 调用 `buildRequestMessages(history, { systemPrompt: getSystemPrompt(mode), ... })`。
4. 组件层不感知 Prompt 内容。
5. 验证：在 ui-check 中拦截请求体，断言教师/学生模式下 system 消息内容分别正确；
   并断言本地 IndexedDB/内存历史中不含 system 消息。

## 风险与限制

- 真实流式链路尚未由代理亲自跑通（无 Key）。
- `.env.production` 仍是占位符，阶段 14 必须替换。
- 会话历史仍只在内存（阶段 9）；学校/学科工具等入口仍是「即将支持」占位。
