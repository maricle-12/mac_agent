# 当前状态

## 总体进度

**阶段 8 / 14 —— 已完成并验证通过（等待用户确认后进入阶段 9）**

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

## 阶段 8：教师 / 学生 System Prompt ✅

- 新建 `src/prompts/`：
  - `teacher.ts`：教师模式角色设定，内容对应需求文档第十五节（12 项任务、应优先考虑的 7 项信息、
    缺失信息处理策略、5 条回答要求、教案应包含的 11 个栏目、「不要机械地每次输出所有栏目」）。
  - `student.ts`：学生模式角色设定，内容对应需求文档第十六节（理解→提示→引导→分步→总结、
    优先解释「为什么」、数学题说明思路、按年级调整语言、错答处理三步、禁止羞辱性语言）。
  - `shared.ts`：所有模式共用的输出格式规则（Markdown 组织答案；行内 `$x^2$`；
    **块级公式 `$$` 独占一行**；不要用代码块包整段回答）。
    —— 这一节是**本项目额外补充**的，需求文档未显式要求，已在 README 标注可整段删除。
  - `index.ts`：`basePrompts` + `getSystemPrompt(mode)`，唯一出口；注释写明未来扩展方式。
- `useChat`：`send` 与 `regenerate` 都通过
  `buildRequestMessages(history, { systemPrompt: getSystemPrompt(mode), maxContextMessages })`
  动态注入；System Prompt **不写入本地历史**。
- 组件层完全不感知 Prompt 内容。

## 验证结果（全部通过）

- `npm run build`：零 TypeScript 错误。
- `npm run check:ui`（**21 项**）：
  - dev：**21/21 通过**；生产 preview：15 通过 + 6 项按预期 SKIP。
  - 新增「System Prompt：按模式正确注入且不写入历史」，通过**拦截请求体**断言：
    1. 教师模式 system 内容含「教育教学智能体」与任务清单，且含公式格式约定；
    2. 学生模式 system 内容含「学习辅导智能体」、关键要求，且**不含**教师 Prompt 内容；
    3. system 消息位于 messages[0]，**有且仅有一条**；
    4. **连续发第二条消息后 system 仍只有一条**（证明不在历史中累积）；
    5. 当前用户消息在请求中只出现 1 次（不重复添加）；
    6. `stream === true`、`model`、`temperature` 均正确传递。
- `npm run check:sse`：30/30；`cd worker && check`：38/38。

## 当前状态

- 后台任务：`pwsh-30`（前端 dev 5173）、`pwsh-35`（wrangler dev 8787）。
- 会话历史仍只在内存（阶段 9）；示例会话仍来自 `src/mocks/mockData.ts`。
- 真实流式链路仍建议用户用 `npm run check:stream` 或浏览器亲自确认一次。

## 下一步（阶段 9：IndexedDB 历史记录）

1. 新建 `src/db/indexedDb.ts`：基于 `idb` 封装 `conversations` 表（含 messages 内联），
   数据库名 `ai-edu-agent`，提供 list / get / put / delete / clear。
2. 把 `useConversations` 从「内存 + 种子数据」切换为 IndexedDB 实现，**保持对外接口不变**。
3. 首屏加载：从 IndexedDB 读取会话列表；`preferences.activeConversationId` 记录选中会话。
4. 删除 `src/mocks/mockData.ts`（或仅在数据库为空时提供一次性示例，需用户确认）。
5. 验证：发送消息 → 刷新页面 → 会话与消息仍在；关闭浏览器重开仍在；
   「清除本地聊天记录」清空 IndexedDB（阶段 10 / 11 完善 UI）。
6. ui-check 增加：刷新后历史保留、删除后刷新仍然删除。

## 风险与限制

- 真实流式链路尚未由代理亲自跑通（无 Key）。
- `.env.production` 仍是占位符，阶段 14 必须替换。
- 会话不持久化、刷新回到种子数据 —— 阶段 9 修复。
