# 当前状态

## 总体进度

**阶段 4 / 14 —— 已完成并验证通过（等待用户确认后进入阶段 5）**

## 已完成

### 阶段 1：项目骨架 ✅

Vite 8 + React 19 + TypeScript 5.9（strict）+ Tailwind v4。

### 阶段 2：完整静态 UI（含可交互内存态）✅

布局、聊天、Markdown/KaTeX、弹窗、历史记录 UI、Hook 层、工具集。

### 阶段 3：API 设置持久化 ✅

`src/services/storage.ts`（sessionStorage / localStorage 严格分离）、
`useApiSettings`、设置弹窗如实展示 Key 存放位置、「清除 API 配置」二次确认。

### 阶段 4：Cloudflare Worker ✅

- `worker/`：独立 `package.json` + `wrangler.toml`（name `ai-edu-agent-api`，`[dev] port = 8787`）。
- `worker/src/config.ts`：上游 origin 白名单、正文 512 KB 上限、消息 ≤ 60 条、
  单条 ≤ 24000 字符、apiKey ≤ 256 字符、上游超时 300s。
- `worker/src/index.ts`：
  - `POST /api/chat`：正文大小 → JSON 解析 → 字段校验 → Base URL 白名单 → 转发；
    `stream: true` 用 `new Response(upstream.body)` 原样透传 SSE（不缓冲）；
    `stream: false` 透传上游 JSON。
  - `GET /api/health`：部署自检端点。
  - CORS：`ALLOWED_ORIGINS` 逗号分隔白名单，支持 `*.xxx.pages.dev` 子域匹配；
    非白名单来源返回 403 `origin_not_allowed`（并回显 CORS 头以便前端展示可操作提示）。
  - 401/402/403/404/408/429/5xx → 统一 `{ error: { code, message, status, detail } }`，
    `message` 为面向普通用户的中文说明，`detail` 为脱敏后的上游原文（供「查看技术详情」）。
  - 全部响应 `Cache-Control: no-store`；不调用 `console`；`scrub()` 保证 Key 与 Bearer 不外泄。
  - 只透传上游 `Content-Type`，**不透传 `Content-Encoding`**（body 已被 fetch 解压）。
- `worker/test/worker-check.mjs`：38 项无依赖自检。

## 验证结果（全部通过）

- `cd worker && npm run typecheck`：零错误。
- `cd worker && npm run check`（wrangler dev 本地 8787）：**38/38 通过**，覆盖：
  - 路由与方法限制（health 200 / GET chat 405 / 未知路径 404）；
  - CORS 预检放行与拒绝、非白名单来源 403；
  - 请求校验（非 JSON、缺 apiKey、空 messages、61 条消息、非法 role、temperature 超范围、600 KB 正文 → 413）；
  - **SSRF 防护 14 例**：非白名单域名、相似域名、用户名伪装、http、带凭据、查询串、hash、
    内网 IP、localhost、非标准端口、协议相对地址、file 协议、非法 URL 全部拒绝；
    dot-segment 被 URL 规范化后仍在白名单 origin 内；`/v1` 路径变体放行；省略 baseUrl 回退默认地址；
  - **真实上游转发**：用假 Key 请求 DeepSeek，非流式与流式均返回 401 且映射为 `invalid_api_key`，
    中文提示正确（不产生任何费用）；
  - 全部响应中不含完整 API Key、不含 `Bearer xxx`、均带 `Cache-Control: no-store`。
- 前端 `npm run build` 与 `npm run check:ui`（17 项）保持全绿。

## 当前状态

- 后台任务：`pwsh-30`（前端 dev server 5173）、`pwsh-35`（wrangler dev 8787）。
- 前端尚未调用 Worker（`src/services/chatApi.ts` 未创建），阶段 5 接入。
- `worker/src/index.ts` 中的 `setTimeout` 定时器：非流式在读体后、流式在连接建立后立即清理；
  流式进行中的取消依赖客户端断开传导到上游 fetch。

## 下一步（阶段 5：打通 DeepSeek 非流式请求）

1. 新建 `src/services/chatApi.ts`：统一封装对 Worker 的调用、错误码 → 友好文案映射、
   请求体构造（含 `MAX_CONTEXT_MESSAGES` 截断）。
2. `ApiSettingsModal` 的「测试连接」启用：用 `stream: false` + 1 条极短消息验证 Key。
3. 成功 → 绿色「连接成功」；失败 → 按错误码给出可理解提示 + 可折叠「查看技术详情」。
4. 状态机接入 `ApiConnectionStatus`（testing / connected / failed）。
5. 用真实 Key 联调需要用户提供；无 Key 时用假 Key 验证错误分支（映射逻辑相同）。

## 风险与限制

- 尚无真实 DeepSeek API Key：成功路径（200 + 内容）尚未端到端验证，只能验证错误分支。
- `.env.production` 中 Worker 地址仍为占位符，阶段 14 必须替换。
- 会话历史仍只存在内存（阶段 9）；回答仍是模拟内容（阶段 7）。
