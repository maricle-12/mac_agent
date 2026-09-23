# 项目地图（Agent 版）

## 项目目标

构建一个**可公网访问的网页版 AI 教育智能体**，产品定位：

> 一个链接即可访问的独立智能体。

- 用户打开 `https://xxx.pages.dev` 即可使用，无需安装任何软件、无需注册登录。
- 用户**自带 DeepSeek API Key**（首次使用时在网页内填写），模型 Token 成本由用户自己的账户承担。
- 运营方固定成本为 0：纯静态前端（Cloudflare Pages）+ 无状态转发 Worker（Cloudflare Workers）。
- 第一版不含账号系统、不含云端数据库、不含云端聊天记录。

## 技术路线

```
用户浏览器
  ↓  React Web App（UI / 会话管理 / 模式切换 / 本地历史 / 设置）
  ↓  Cloudflare Worker（/api/chat，无状态转发 + CORS + 流式透传）
  ↓  DeepSeek API（OpenAI-Compatible /chat/completions, stream: true）
  ↓  SSE 流式返回，前端逐 chunk 渲染
```

- 聊天历史：IndexedDB（浏览器本地，刷新/重开仍在，跨用户互相隔离）
- 用户偏好：localStorage（模式、Base URL、Model 等非敏感项）
- API Key：默认 sessionStorage；用户主动勾选「在此设备记住」后才存 localStorage
- Worker 不保存任何 Key 与聊天内容，不写日志，不使用 KV / D1

## 目录职责（✅ 已实现 / ⏳ 计划中）

```
demo/
├─ index.html                # 前端入口 HTML
├─ vite.config.ts            # Vite 配置（React + Tailwind 插件、@ 别名）
├─ tsconfig*.json            # TypeScript 严格模式配置
├─ .env.development          # 本地开发端点（指向 localhost:8787 Worker）
├─ .env.production           # 生产端点（部署 Worker 后填写）
├─ public/_redirects         # Cloudflare Pages SPA 回退，避免刷新 404
├─ scripts/
│  ├─ ui-check.mjs           # ✅ 无依赖 UI 自动化检查（CDP，19 项断言 + 控制台错误）
│  ├─ sse-parse-check.mjs    # ✅ SSE 解析器单元验证（30 项，含逐字节与随机切分）
│  ├─ stream-check.mjs       # ✅ 真实流式链路验证（需 DEEPSEEK_API_KEY，测首字节与分块时间）
│  └─ screenshot.mjs         # ✅ 无依赖页面截图工具（输出到 screenshots/，已 gitignore）
├─ src/
│  ├─ config/                # ✅ 品牌与 API 配置、快捷卡片文案
│  ├─ types/                 # ✅ 公共类型（chat / conversation / settings）
│  ├─ utils/                 # ✅ cn / id / clipboard / time / title / markdown
│  ├─ prompts/               # ✅ teacher.ts / student.ts / shared.ts / index.ts（getSystemPrompt）
│  ├─ db/                    # ⏳ 阶段 9：IndexedDB 封装（idb）
│  ├─ services/              # ✅ storage、chatApi（Worker 调用与错误映射）、sseStream（SSE 解析）
│  ├─ hooks/                 # ✅ useConversations / useChat（真实流式）/ useApiSettings
│  ├─ mocks/                 # ✅ 仅剩示例会话（阶段 9 接入 IndexedDB 后移除）
│  ├─ components/            # ✅ layout / chat / settings / history / common
│  └─ App.tsx                # ✅ 组装层，只做状态编排与弹窗调度
├─ worker/                   # ✅ 阶段 4：Cloudflare Worker
│  ├─ wrangler.toml          # name / [dev] port=8787 / ALLOWED_ORIGINS
│  ├─ src/config.ts          # 上游 origin 白名单、大小与条数上限、超时
│  ├─ src/index.ts           # POST /api/chat（校验 → 转发 → 流式透传）+ GET /api/health
│  └─ test/worker-check.mjs  # 38 项无依赖接口与安全自检
└─ project_memory/           # 项目长期记忆
```

## Worker 要点

- 请求：`POST /api/chat`，body 为 `{ apiKey, baseUrl, model, messages, temperature?, maxTokens?, stream? }`。
- 响应：`stream: true` 原样透传 SSE；`stream: false` 透传上游 JSON；
  错误统一为 `{ error: { code, message, status, detail } }`，前端直接展示 `message`。
- 安全：方法限制、512 KB 正文上限、字段校验、Base URL origin 白名单（防 SSRF）、
  CORS 白名单（支持 `*.xxx.pages.dev`）、`no-store`、无 KV/D1、不调用 `console`、Key 全程脱敏。
- 本地端口 8787，必须与前端 `.env.development` 的 `VITE_API_ENDPOINT` 一致。
- 部署 Pages 后必须把 Pages 域名加入 `wrangler.toml` 的 `ALLOWED_ORIGINS` 并重新 `wrangler deploy`。

## 本地存储约定

统一在 `src/services/storage.ts`，键名前缀 `ai-edu-agent:`。

| 数据 | 位置 | 键名 |
| --- | --- | --- |
| API Key（默认） | sessionStorage | `api-key:session` |
| API Key（主动记住） | localStorage | `api-key:local` |
| Provider / Base URL / Model | localStorage | `api-settings` |
| 当前模式 | localStorage | `preferences` |
| 聊天记录 | IndexedDB | 阶段 9 接入 |

同一个 Key 只能存在于一个位置；`rememberApiKey` 由 Key 实际位置推导，不独立持久化。

## 验证手段

- `npm run build`：`tsc -b` + `vite build`，必须零类型错误。
- `npm run check:ui`（20 项）：无头 Chrome/Edge + CDP，检查渲染、Markdown/公式、交互、弹窗、
  存储行为、流式渲染（桩 SSE：增量增长 / 停止中断 / 重新生成不重复）、测试连接错误路径
  （真实打到 DeepSeek）、三档桌面分辨率布局、移动端抽屉，
  并汇总 console 错误 / 未捕获异常 / 预期外的网络错误。端点未配置时相关用例显式 SKIP。
- `npm run check:sse`（30 项）：SSE 解析器单元验证，无需网络与 Key。
- `npm run check:stream`：真实流式链路验证（需 `DEEPSEEK_API_KEY`）。
- `cd worker && npm run check`（38 项）：Worker 路由、CORS、请求校验、14 例 SSRF 防护、
  真实上游转发与错误映射、密钥不泄露。
- `node scripts/screenshot.mjs`：生成桌面 / 空状态 / 设置弹窗 / 移动端截图。
- 当前模型不支持读取图片，视觉验收需依靠 `ui-check.mjs` 的数值断言 + 用户查看截图。

## 联调状态

- 已用真实网络验证：**假 Key 端到端**（浏览器 → Worker → api.deepseek.com → 401 → 中文友好提示）。
- 已由用户验证：**真实 Key 的非流式成功路径**（「测试连接」显示「连接成功」）。
- 前端流式渲染已用**桩 SSE 确定性验证**；真实流式链路尚未由代理亲自跑通（无 Key），
  用户可执行 `npm run check:stream` 或在浏览器聊天验证。

## 关键约束（不可违反）

1. 源码、仓库、Cloudflare 环境变量中**永远不出现真实 API Key**。
2. Worker 只做无状态转发：不持久化、不写日志、不回显 Key、错误信息中脱敏。
3. Worker 必须做 Base URL 白名单校验，防止 SSRF。
4. 聊天历史只存 `user` / `assistant`，System Prompt 在调用时动态插入。
5. 必须实现真正的 SSE 流式输出，并处理跨 chunk 截断的 JSON（使用 buffer 按行解析）。
6. 产品名称、品牌统一在 `src/config/app.ts`，不在组件中硬编码。

## 实施阶段（每阶段验证通过后再进入下一阶段）

1. 项目骨架（React 页面可运行）
2. 静态 UI（模拟消息）
3. API 设置（Key 输入与保存）
4. Cloudflare Worker 建立
5. DeepSeek 非流式请求打通
6. 改为 Streaming
7. 网页接入 Streaming
8. 教师 / 学生 Prompt
9. IndexedDB 历史记录
10. 新建 / 删除 / 重命名对话
11. 错误处理完善
12. 移动端适配
13. 生产 Build
14. Cloudflare Pages + Worker 部署
