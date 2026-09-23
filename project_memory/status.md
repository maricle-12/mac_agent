# 当前状态

## 总体进度

**阶段 5 / 14 —— 已完成并验证通过（等待用户确认后进入阶段 6）**

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

## 验证结果（全部通过）

- `npm run build`：零 TypeScript 错误。
- `npm run check:ui` 扩到 **19 项**：
  - dev（端点指向本地 Worker）：**19/19 通过**；
  - 生产 preview（`.env.production` 仍是占位符）：17 通过 + 2 项按预期 `SKIP`。
  - 新增两项：
    1. **测试连接失败路径（真实链路）**：假 Key → 浏览器 → Worker → DeepSeek 真实 401 →
       页面显示中文「API Key 不正确」+「查看技术详情」+ 常见原因；
       并断言页面非输入框位置不出现完整 Key（防泄露）。
    2. **测试连接成功分支界面**：用 stub 响应验证「连接成功」+ 模型回复预览 + 展开技术详情能看到 HTTP 200。
  - 有意触发的 4xx 会产生一条浏览器 network 日志，harness 通过 `tolerateNetworkError()`
    计数容忍，**预期外的网络错误仍会导致失败**。
- `cd worker && npm run check`：38/38 仍全绿。
- 无 `console.error`、无未捕获异常。

## 尚未验证（重要）

**真实成功路径（有效 Key → 真实 200 + 回答内容）未被验证**：环境中没有任何 DeepSeek API Key。
已验证的是「请求确实抵达 api.deepseek.com 并拿到真实 401 → 正确映射」，
说明转发链路本身是通的；未验证的是有效响应的解析与展示（`readCompletion` + 成功界面）。

关闭方式（二选一）：
1. 用户在浏览器「API 设置」里填入自己的 Key → 点「测试连接」→ 应显示绿色「连接成功」与模型回复。
2. 用户提供 Key，由代理执行端到端验证（Key 只在内存中使用，不写入任何文件）。

## 当前状态

- 后台任务：`pwsh-30`（前端 dev 5173）、`pwsh-35`（wrangler dev 8787）。
- 聊天回答仍是阶段 2 的模拟内容，阶段 7 接入真实流式输出。
- 会话历史仍只在内存，阶段 9 接入 IndexedDB。

## 下一步（阶段 6：改为 Streaming）

1. Worker 侧已支持 `stream: true` 并透传 SSE（阶段 4 完成），本阶段主要做验证：
   确认透传无缓冲、`Content-Type: text/event-stream`、跨 chunk 的 JSON 不被截断。
2. 若需要，补充 Worker 侧的流式验证用例（断流、`[DONE]`、非 2xx 前置错误）。
3. 前端 SSE 解析放到阶段 7（`useChat` 内 `runGeneration` 替换模拟实现）。

## 风险与限制

- 真实成功路径未验证（见上）。
- `.env.production` 仍是占位符，阶段 14 必须替换。
- 会话历史不持久化（阶段 9）；回答不是真实模型输出（阶段 7）。
