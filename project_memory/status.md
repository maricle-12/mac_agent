# 当前状态

## 总体进度

**阶段 3 / 14 —— 已完成并验证通过（等待用户确认后进入阶段 4）**

## 已完成

### 阶段 1：项目骨架 ✅

Vite 8 + React 19 + TypeScript 5.9（strict）+ Tailwind v4；配置层、公共类型、
环境变量方案、SPA 回退、Git 初始化。

### 阶段 2：完整静态 UI（含可交互内存态）✅

布局（AppLayout / Sidebar / Header）、聊天（ChatView / MessageList / MessageBubble /
ChatInput / EmptyState）、Markdown（MarkdownRenderer / CodeBlock / KaTeX）、
弹窗（Modal / ConfirmDialog / ApiSettingsModal / AboutModal）、
历史记录 UI（ConversationList / ConversationItem）、
Hook 层（useConversations / useChat）、工具集（cn / id / clipboard / time / title / markdown）。

### 阶段 3：API 设置持久化 ✅

- `src/services/storage.ts`：统一存储封装，键名前缀 `ai-edu-agent:`。
  - `sessionStorage`：默认的 API Key（`api-key:session`）
  - `localStorage`：用户主动记住的 API Key（`api-key:local`）+ 非敏感设置（`api-settings`）+ 模式偏好（`preferences`）
  - 存储不可用（隐私模式 / 超限）时静默降级，不抛异常。
  - `saveApiKey()` 保证同一个 Key 只存在于一个位置（写入前先清空两处）。
  - `loadApiSettings()` 的 `rememberApiKey` 始终按 Key 真实存储位置推导，不会出现「勾了但没记住」的假象。
- `src/hooks/useApiSettings.ts`：读取 / 保存 / 清除 Key 与设置，`keyStorage` 暴露真实存储位置。
- `ApiSettingsModal`：底部显示 Key 当前存放位置；「清除 API 配置」改为二次确认后清除。
- `App.tsx`：接入 Hook；模式偏好写入 localStorage；清除配置走 ConfirmDialog。
- `useConversations(initialMode)`：刷新后自动打开与上次模式一致的会话，避免模式与内容不匹配。

## 验证结果（全部通过）

- `npm run build`：零 TypeScript 错误。
- `npm run check:ui`：**17 项全部通过**（dev 与生产 preview 各跑一次），
  新增 5 项存储行为验证：
  1. 未勾选「记住此设备」→ 清空 sessionStorage + 重新打开后 Key 必须消失；
  2. 勾选「记住此设备」→ 清空 sessionStorage + 重新打开后 Key 必须保留；
  3. Base URL / Model 刷新后保留、顶部模型名同步更新；
  4. 「清除 API 配置」（含二次确认）后 Key 与设置一并清除、恢复到默认模型；
  5. 模式偏好刷新后保留，且刷新后自动打开对应模式的会话；
     有内容的会话切换模式弹确认、空会话就地切换不弹确认。
- 首屏「未配置 Key」时新会话显示欢迎引导与「配置 DeepSeek API」按钮，点击直接打开设置。
- 每次运行无 `console.error`、无未捕获异常、无浏览器日志错误。
- 安全扫描：源码无真实密钥，无 `VITE_*_API_KEY` 注入。

## 当前状态

- 目录：`H:\agent\demo`；dev server job `pwsh-30`（http://localhost:5173）。
- 生产包体积：JS 699 kB（gzip 213 kB）、CSS 59 kB（gzip 14 kB）；代码分割留到阶段 13。
- **临时实现**：`src/mocks/mockData.ts` 仍提供模拟会话与模拟回答；
  会话不持久化（刷新回到种子数据）；「测试连接」按钮禁用并标注原因。

## 下一步（阶段 4：建立 Cloudflare Worker）

1. 新建 `worker/`：独立 `package.json`、`wrangler.toml`、`tsconfig.json`、`src/index.ts`。
2. Worker 只接受 `POST /api/chat`；校验方法、正文大小、必要字段。
3. Base URL 白名单（第一版仅允许 `https://api.deepseek.com`），防 SSRF。
4. CORS：开发允许 `http://localhost:5173`，生产允许 Cloudflare Pages 域名；
   不使用 `Access-Control-Allow-Origin: *`。
5. 响应头 `Cache-Control: no-store`；不记录 Authorization 等敏感 Header；不持久化任何数据。
6. 本地 `wrangler dev` 跑通在 8787 端口，前端 `.env.development` 已指向该地址。
7. 阶段 5 再接入真实 DeepSeek 非流式请求，阶段 6 改流式。

## 风险与限制

- 尚无真实 DeepSeek API Key，阶段 5 之后需要用户提供 Key 才能端到端联调。
- `.env.production` 中 Worker 地址仍为占位符，阶段 14 必须替换。
- 会话历史仍只存在内存（阶段 9 修复）；「测试连接」未实现（阶段 5）。
