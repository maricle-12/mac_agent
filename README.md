# AI 教育智能体

> 面向教师与学生的智能学习助手 —— **一个链接即可访问的独立智能体**。

用户打开一个公网链接（例如 `https://xxx.pages.dev`）即可使用，无需安装软件、无需注册登录。
首次使用时填写**自己的 DeepSeek API Key**，模型 Token 成本由用户自己的账户承担。

---

## 1. 这个项目是什么

一个类似 ChatGPT / Coze 的网页版 AI 智能体，产品化定位为「AI 教育智能体」，内置两种模式：

| 模式 | 面向 | 能力 |
| --- | --- | --- |
| 教师模式 | 教师 | 教学设计、教案生成、教学目标与重难点分析、课堂活动设计、练习题与作业设计、易错点分析、学情分析、教学评价建议 |
| 学生模式 | 学生 | 知识点讲解、题目分析、答案检查、错题整理、分步骤启发式辅导 |

### 核心产品原则

> **用户自己提供 API Key，我们提供网页、Prompt、Agent 能力、UI、工作流。**

- 运营方固定成本为 **0**：前端是纯静态站点，后端是无状态转发 Worker，不使用任何数据库或常驻服务器。
- 用户数据只存在用户自己的浏览器里：聊天历史在 IndexedDB，API Key 在 sessionStorage（可选 localStorage）。
- 没有账号系统、没有云端聊天记录、没有管理员后台。

---

## 2. 整体架构

```
用户浏览器
    │  ① 用户在页面输入问题
    ▼
React Web App（Cloudflare Pages 静态托管）
    │  UI / 会话管理 / 模式切换 / 本地历史 / API 设置 / Markdown 渲染
    │  ② POST /api/chat  { apiKey, baseUrl, model, messages, temperature }
    ▼
Cloudflare Worker（无状态转发）
    │  ③ 校验来源与 Base URL 白名单 → 转发 DeepSeek，透传 SSE 流
    │  不保存 API Key、不保存聊天内容、不写日志、不使用 KV / D1
    ▼
DeepSeek API  https://api.deepseek.com/chat/completions  (stream: true)
    │  ④ SSE 流式返回
    ▼
React 页面逐 chunk 实时渲染，支持「停止生成」
```

**各层职责划分**

- **React 页面**：UI、会话管理、模式切换、本地聊天历史、API 设置、用户输入、Markdown 渲染。
- **Worker**：接收浏览器请求、接收用户临时传入的 API Key、转发 DeepSeek、处理 CORS、透传 Streaming Response、不保存任何数据。

---

## 3. 技术栈

| 层 | 选型 |
| --- | --- |
| 前端框架 | React 19 + TypeScript 5.9（strict） |
| 构建工具 | Vite 8 |
| 样式 | Tailwind CSS v4（CSS-first，设计令牌在 `src/index.css`） |
| 公网静态部署 | Cloudflare Pages |
| API 转发 | Cloudflare Workers |
| 聊天历史 | IndexedDB（`idb`） |
| 用户偏好 | localStorage |
| API Key | sessionStorage（默认）/ localStorage（用户主动勾选「记住」后） |
| Markdown | react-markdown + remark-gfm |
| 包管理 | npm |

**明确不使用**：Coze、Dify、FastGPT、Docker、Python 后端、VPS、云服务器、Supabase、Firebase、MySQL、PostgreSQL、MongoDB、Electron、Redux。

---

## 4. 目录结构

```
demo/
├─ index.html                 # HTML 入口
├─ vite.config.ts             # Vite 配置（React + Tailwind 插件、@ → src 别名）
├─ tsconfig.json              # 项目引用入口
├─ tsconfig.app.json          # 前端源码的严格 TS 配置
├─ tsconfig.node.json         # 构建脚本（vite.config.ts）的 TS 配置
├─ package.json               # 前端依赖与脚本
├─ .env.development           # 本地开发端点（指向 localhost:8787 Worker）
├─ .env.production            # 生产端点（部署 Worker 后替换为真实地址）
├─ .env.example               # 环境变量示例与安全说明
├─ .gitignore
├─ README.md
├─ public/
│  ├─ favicon.svg             # 站点图标
│  └─ _redirects              # Cloudflare Pages SPA 回退，保证刷新不 404
├─ scripts/
│  ├─ ui-check.mjs            # 无依赖 UI 自动化检查（渲染 + 交互 + 控制台错误）
│  └─ screenshot.mjs          # 无依赖页面截图工具
├─ src/
│  ├─ main.tsx                # 应用挂载入口（含 KaTeX 样式引入）
│  ├─ App.tsx                 # 组装层：状态编排与弹窗调度，不写具体业务
│  ├─ index.css               # Tailwind 引入 + 设计令牌 + Markdown 正文排版
│  ├─ vite-env.d.ts           # 环境变量类型声明
│  ├─ config/
│  │  ├─ app.ts               # 品牌配置：appName / appSubtitle / logo / version
│  │  ├─ api.ts               # 端点、Provider 列表、默认模型、上下文条数上限
│  │  └─ quickPrompts.ts      # 空状态快捷卡片、问候语、输入框占位符
│  ├─ types/                  # chat / conversation / settings 公共类型
│  ├─ utils/                  # cn / id / clipboard / time / title / markdown
│  ├─ hooks/
│  │  ├─ useConversations.ts  # 会话增删改（阶段 9 换为 IndexedDB，对外接口不变）
│  │  └─ useChat.ts           # 发送 / 停止 / 重新生成（阶段 7 换为真实流式）
│  ├─ mocks/                  # 阶段 2 临时模拟数据（阶段 7 / 9 完成后删除）
│  └─ components/
│     ├─ layout/              # AppLayout / Sidebar / Header
│     ├─ chat/                # ChatView / MessageList / MessageBubble
│     │                       # ChatInput / EmptyState / MarkdownRenderer / CodeBlock
│     ├─ settings/            # ApiSettingsModal / AboutModal
│     ├─ history/             # ConversationList / ConversationItem
│     └─ common/              # Modal / ConfirmDialog / Button / icons
├─ src/prompts/               # ⏳ 阶段 8 创建（teacher.ts / student.ts / index.ts）
├─ src/services/ · src/db/    # storage ✅ ／ chatApi、IndexedDB ⏳ 阶段 7 / 9
├─ worker/                    # ✅ 阶段 4：Cloudflare Worker（独立 package.json）
│  ├─ wrangler.toml           # Worker 名称、端口、ALLOWED_ORIGINS 白名单
│  ├─ package.json            # dev / deploy / typecheck / check 脚本
│  ├─ tsconfig.json           # Workers 类型 + strict
│  ├─ src/config.ts           # 白名单、大小与条数上限、超时
│  ├─ src/index.ts            # POST /api/chat：校验 → 转发 → 流式透传
│  └─ test/worker-check.mjs   # 无依赖接口与安全自检（38 项）
└─ project_memory/            # 项目长期记忆（状态 / 决策 / 地图）
```

> 标 ⏳ 的目录会在对应阶段创建。目录职责：`config` 放可改配置、`types` 放公共类型、
> `prompts` 放 System Prompt（唯一来源）、`db` 封装 IndexedDB、`services` 封装 API 与存储、
> `hooks` 放状态与业务逻辑、`components` 按 layout / chat / settings / history / common 拆分。

---

## 5. 环境要求

只需要两样东西，都是免费的：

| 软件 | 版本要求 | 下载地址 | 说明 |
| --- | --- | --- | --- |
| Node.js | ≥ 20.19（推荐 22 LTS 或 24） | https://nodejs.org/zh-cn （选 **LTS**） | 自带 npm |
| Git | 任意较新版本 | https://git-scm.com/downloads | 用于下载代码与部署到 Cloudflare |

验证安装：

```bash
node -v     # 应输出 v20.x / v22.x / v24.x
npm -v      # 应输出 10.x 或更高
git --version
```

> 本项目**不需要** Python、Docker、VPS 或任何数据库。

---

## 6. 本地运行

```bash
# 1) 进入项目目录
cd demo

# 2) 安装依赖
npm install

# 3) 启动前端开发服务器
npm run dev
```

看到下面的输出即成功：

```
  VITE v8.x.x  ready in 300 ms
  ➜  Local:   http://localhost:5173/
```

浏览器打开 http://localhost:5173 即可看到页面。

### 其他常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动本地开发服务器（热更新） |
| `npm run build` | 生产构建（先做 TypeScript 全量类型检查，再打包到 `dist/`） |
| `npm run preview` | 本地预览 `dist/` 构建产物（http://localhost:4173） |
| `npm run typecheck` | 只做类型检查 |
| `npm run check:ui` | 无头浏览器 UI 自动化检查（需先启动 `npm run dev` 或 `npm run preview`） |
| `npm run check:sse` | SSE 解析器单元验证（含逐字节切分等极端情况，无需网络） |
| `npm run check:stream` | **真实流式链路验证**（需 `DEEPSEEK_API_KEY`，测量首字节与分块到达时间） |

### 自动化验证

项目自带两个无第三方依赖的浏览器自动化脚本（用本机 Chrome/Edge 的无头模式 + CDP）：

```bash
# UI 检查：渲染、Markdown/公式、发送、停止生成、弹窗、删除确认、响应式布局
npm run check:ui                      # 默认检查 http://localhost:5173/

node scripts/ui-check.mjs http://localhost:4173/   # 也可以检查生产预览

# SSE 解析器单元验证（不需要网络、不需要 Key）
npm run check:sse

# 真实流式链路验证（需要你自己的 Key，脚本不保存也不打印 Key）
$env:DEEPSEEK_API_KEY="sk-xxxx"; npm run check:stream    # PowerShell
set DEEPSEEK_API_KEY=sk-xxxx && npm run check:stream      # CMD

# 截图（输出到 screenshots/，该目录不提交 Git）
node scripts/screenshot.mjs http://localhost:5173/
```

`ui-check.mjs` 会检查 23 项内容并在最后汇总 `console.error`、未捕获异常与浏览器日志错误。
修改 UI 后建议先跑一遍，能第一时间发现渲染或交互回归。

其中包含**历史记录持久化验证**（直接读写 IndexedDB 校验，不只看界面）：
刷新后会话与消息仍在（含 Markdown、表格、公式）、刷新后回到上次活跃的会话、
删除会话后刷新不会「复活」、清除本地聊天记录后刷新仍为空。

其中包含**System Prompt 验证**（拦截请求体断言）：教师/学生模式下 system 消息内容分别正确、
system 消息位于最前且**有且仅有一条**、连续请求后不会在历史中累积、
当前用户消息不会重复出现。

其中包含**流式输出验证**（用桩 SSE 确定性复现）：断言「AI 正在思考」状态、用户气泡、
**回答内容随时间增长**（证明是流式而不是一次性渲染）、停止生成后内容保留且请求真被中断
（AbortSignal 触发）、重新生成不重复添加用户消息。

其中包含**本地存储行为验证**：未勾选「记住此设备」时清空 `sessionStorage` 后 Key 必须消失；
勾选后必须跨会话保留；「清除 API 配置」后必须两处都清干净。

以及**真实链路验证**：会先用一个假 Key 走一遍 `浏览器 → Worker → DeepSeek`，
断言错误提示是中文友好文案、且页面上不出现完整 Key。
（需要 Worker 正在运行；未运行时这些用例自动跳过。）

> 生产构建在 `.env.production` 仍为占位符时，依赖 Worker 的用例会自动标记为 `SKIP`
> 而不是失败 —— 这是预期状态，阶段 14 部署完 Worker 并填好地址后即会正常执行。

**想验证「生产构建」本身**（推荐在部署前做一次）：临时创建一个被 gitignore 的
`.env.production.local` 把生产包指向本地 Worker，就能对着压缩后的真实产物跑完整检查：

```bash
# 新建 demo/.env.production.local，内容：
#   VITE_API_ENDPOINT=http://127.0.0.1:8787/api/chat
npm run build && npm run preview
node scripts/ui-check.mjs http://localhost:4173/     # 预期 23 项全部通过
```

检查完记得删除该文件（它只用于本地验证，不应提交）。

> **本地完整链路**：`localhost 页面 → localhost Worker → DeepSeek`，分两个终端启动：

**终端 1 —— 启动 Worker**（默认 http://127.0.0.1:8787）

```bash
cd demo/worker
npm install          # 首次需要
npm run dev          # 等价于 npx wrangler dev
```

看到下面的输出即成功：

```
⎔ Starting local server...
[wrangler:info] Ready on http://127.0.0.1:8787
```

> ⚠️ Worker **不需要**任何 API Key 环境变量。用户 Key 由浏览器在每次请求中临时携带。

**终端 2 —— 启动前端**（http://localhost:5173）

```bash
cd demo
npm run dev
```

前端通过 `.env.development` 中的 `VITE_API_ENDPOINT=http://localhost:8787/api/chat`
连接本地 Worker，两者端口必须一致（Worker 端口配在 `worker/wrangler.toml` 的 `[dev] port`）。

**验证 Worker 是否正常**（可选）

```bash
# 浏览器打开，或：
curl http://127.0.0.1:8787/api/health

cd demo/worker && npm run check    # 38 项接口与安全自检
```

`npm run check` 会用假 Key 真实请求一次 DeepSeek，验证转发链路与错误映射，
**不需要真实 API Key，也不产生任何费用**。

---

## 7. 环境变量

前端只有一个环境变量：

| 变量 | 说明 | 示例 |
| --- | --- | --- |
| `VITE_API_ENDPOINT` | Worker 转发端点 | 开发 `http://localhost:8787/api/chat`<br>生产 `https://<worker名>.<子域>.workers.dev/api/chat` |

- 开发环境写在 `.env.development`，生产环境写在 `.env.production`。
- 缺失时回退到同源 `/api/chat`。
- 个人临时覆盖请写入 `.env.local`（已被 `.gitignore` 忽略）。

> ### ⚠️ 安全红线
> **绝对不要**把 API Key 放进任何 `VITE_*` 环境变量。
> Vite 会把 `VITE_` 开头的变量**打包进公开的前端产物**，任何人打开网页都能看到。
> 用户 Key 只能由用户在网页「API 设置」中输入。

---

## 8. API Key 安全设计

| 要求 | 实现方式 |
| --- | --- |
| 不写死在源码 | 源码中不存在任何 Key；只有用户输入 |
| 不上传 GitHub | 无 Key 可提交；`.env.local` / `.dev.vars` 已忽略 |
| 不用公共环境变量 | 不使用任何 `VITE_*_API_KEY`；Worker 无 Key 环境变量 |
| 不存云端数据库 | 无数据库；Worker 收到 Key 后仅用于当前请求 |
| 不写日志 | Worker 不打印 Authorization 等敏感 Header |
| 默认只存 sessionStorage | 关闭浏览器即失效 |
| 可选记住设备 | 用户主动勾选「在此设备记住 API Key」后才写 localStorage |
| 可清除 | 设置中提供「清除 API 配置」按钮 |
| 错误信息脱敏 | Worker 错误响应中不包含完整 Key |
| 禁止缓存 | 响应头 `Cache-Control: no-store` |

页面内固定提示文案：

> API Key 仅用于调用您选择的模型服务。本应用不会将 API Key 保存到云端数据库。

### 浏览器存储位置对照表

所有键名统一使用 `ai-edu-agent:` 前缀（见 `src/services/storage.ts`）。

| 数据 | 存储位置 | 键名 | 说明 |
| --- | --- | --- | --- |
| API Key（默认） | sessionStorage | `ai-edu-agent:api-key:session` | 关闭浏览器即失效 |
| API Key（勾选记住后） | localStorage | `ai-edu-agent:api-key:local` | 仅用户主动勾选才写入 |
| Provider / Base URL / Model | localStorage | `ai-edu-agent:api-settings` | 非敏感 |
| 当前模式 / 当前会话 id | localStorage | `ai-edu-agent:preferences` | 非敏感 |
| 聊天记录（含消息） | IndexedDB | 数据库 `ai-edu-agent`，表 `conversations` | 见下 |

**聊天记录的持久化策略**（`src/hooks/useConversations.ts`）：

- 一次会话（连同它的 `messages` 数组）作为一条记录整体存取；
- 所有改动先更新界面（即时响应），再**按会话节流**写入 —— 流式输出时增量非常频繁，
  若每个 token 都写库会造成大量无谓的磁盘写入（默认 400ms 内同一会话只写一次）；
- 新建会话与删除会话**立即落库**，避免「刚建好就刷新」导致丢失；
- 页面隐藏 / 离开时把待写入内容立刻落库；
- 首次加载会申请**持久化存储**（`navigator.storage.persist()`），降低浏览器在磁盘紧张时
  清除聊天记录的概率（被拒绝也不影响使用）；
- 隐私模式等无法使用 IndexedDB 的环境会自动降级为仅内存，并在设置里给出提示。

规则：

- 同一个 API Key **只会存在于一个位置**：勾选记住就写 localStorage（并清掉 sessionStorage 中的副本），
  否则只写 sessionStorage（并清掉 localStorage 中的副本）。
- 设置弹窗底部会如实显示当前 Key 的存放位置（未保存 / 仅本次会话 / 已保存在此设备）。
- 「清除 API 配置」会把两个位置中的 Key 一并删除，并把 Base URL / Model 恢复默认值。

---

## 9. 模型设置项
| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| API Provider | DeepSeek | 第一版仅 DeepSeek |
| API Key | 空 | 用户输入，形如 `sk-xxxxxxxx` |
| Base URL | `https://api.deepseek.com` | 用户可改，Worker 侧做白名单校验 |
| Model | `deepseek-chat` | 用户可改 |

架构上保留 **OpenAI-Compatible API** 支持：未来只需在 `src/config/api.ts` 增加 Provider、在 Worker 白名单中加入对应域名即可。

### 「测试连接」行为

点击后用**当前表单里的值**（不必先保存）发一次极小的非流式请求（一条 `你好`）：

- 成功 → 绿色「连接成功」，并展示模型的实际回复片段与消耗 token 数。
- 失败 → 红色友好提示（API Key 不正确 / 余额不足 / 请求过于频繁 / 模型不存在 / 无法连接…），
  并附「查看技术详情」折叠区展示脱敏后的原始信息。
- 表单一旦被修改，上一次的测试结论会自动清空，避免误导。

顶部栏的 API 状态会同步为：`未配置` / `待验证` / `检测中` / `已连接` / `连接失败`。

---

## 10. System Prompt 架构

Prompt 是产品的核心资产，全部集中在 `src/prompts/`，组件层不感知内容：

```
src/prompts/
├─ teacher.ts   # 教师模式角色设定（对应需求文档第十五节）
├─ student.ts   # 学生模式角色设定（对应需求文档第十六节）
├─ shared.ts    # 所有模式共用的输出格式规则（Markdown / LaTeX 公式约定）
└─ index.ts     # getSystemPrompt(mode) —— 唯一出口
```

规则：

| 规则 | 说明 |
| --- | --- |
| 唯一出口 | 只有 `getSystemPrompt(mode)` 能取到 Prompt，组件不得直接 import 具体 Prompt 常量 |
| 动态插入 | System Prompt 在每次请求时拼接，**不写入本地聊天历史** —— 修改 Prompt 后新请求立即生效 |
| 不累积 | 历史里只有 user / assistant；重复请求不会导致 system 消息越来越多 |
| 可扩展 | 未来新增 `lessonPlan` / `examGenerator` / `errorAnalysis` / `research` 时，在 `basePrompts` 里补一项、放宽 `AgentMode` 联合类型即可 |

`shared.ts` 里的输出格式规则是本项目**额外补充**的（需求文档未显式要求），原因是网页端用
Markdown + KaTeX 渲染，明确告知模型公式分隔符写法能显著改善排版：

- 行内公式写 `$x^2$`；
- **块级公式必须让 `$$` 独占一行** —— 这与 `remark-math` 的解析规则一致
  （同行 `$$...$$` 会被当成行内公式，见 `src/utils/markdown.ts`）。

如果你不想要这部分，删除 `src/prompts/shared.ts` 并去掉 `index.ts` 中的拼接即可。

---

## 10. 开发路线图（14 个阶段）

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 项目骨架，`npm run dev` 可运行 | ✅ 已完成 |
| 2 | 完整静态 UI（模拟消息） | ✅ 已完成 |
| 3 | API 设置（Key 输入 / 保存 / 测试连接） | ✅ 已完成 |
| 4 | 建立 Cloudflare Worker | ✅ 已完成 |
| 5 | 打通 DeepSeek 非流式请求 | ✅ 已完成 |
| 6 | 改为 Streaming（SSE 透传） | ✅ 已完成 |
| 7 | 网页接入 Streaming + 停止生成 | ✅ 已完成 |
| 8 | 教师 / 学生 System Prompt | ✅ 已完成 |
| 9 | IndexedDB 历史记录 | ✅ 已完成 |
| 10 | 新建 / 删除 / 重命名对话 | ⬜ |
| 6 | 改为 Streaming（SSE 透传） | ⬜ |
| 7 | 网页接入 Streaming + 停止生成 | ⬜ |
| 8 | 教师 / 学生 System Prompt | ⬜ |
| 9 | IndexedDB 历史记录 | ⬜ |
| 10 | 新建 / 删除 / 重命名对话 | ⬜ |
| 11 | 错误处理完善 | ⬜ |
| 12 | 移动端适配 | ⬜ |
| 13 | 生产 Build 验收 | ⬜ |
| 14 | Cloudflare Pages + Worker 部署 | ⬜ |

---

## 10. Worker 接口说明

### `GET /api/health`

无需鉴权，用于部署后确认 Worker 是否可用：

```json
{ "ok": true, "service": "ai-edu-agent-api", "version": "0.1.0", "allowedOrigins": 4, "upstreams": ["https://api.deepseek.com"] }
```

### `POST /api/chat`

请求体：

```json
{
  "apiKey": "sk-xxxxxxxx（仅本次请求使用，服务端不保存）",
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-chat",
  "messages": [
    { "role": "system", "content": "系统提示词" },
    { "role": "user", "content": "用户消息" }
  ],
  "temperature": 0.7,
  "stream": true
}
```

- `stream: true`（默认）→ 原样透传上游 SSE 流，`Content-Type: text/event-stream`。
- `stream: false` → 透传上游 JSON，用于「测试连接」等一次性请求。
- 所有响应带 `Cache-Control: no-store`。

### 错误响应格式（前端直接展示 `message`）

```json
{
  "error": {
    "code": "invalid_api_key",
    "message": "API Key 不正确或已失效，请在「API 设置」中检查后重新填写。",
    "status": 401,
    "detail": "（已脱敏的上游原始信息，用于「查看技术详情」）"
  }
}
```

| code | 含义 | 前端提示 |
| --- | --- | --- |
| `invalid_api_key` | 401 | API Key 不正确 |
| `insufficient_balance` | 402 | 余额不足或账户异常 |
| `rate_limited` | 429 | 请求过于频繁 |
| `model_not_found` | 404 | 模型不存在 |
| `bad_request` | 400 / 422 | 参数有误 |
| `upstream_error` | 5xx | 模型服务异常 |
| `upstream_unreachable` | 网络失败 | 无法连接模型服务 |
| `upstream_timeout` | 超时 | 模型服务响应超时 |
| `payload_too_large` | 413 | 请求内容过大 |
| `base_url_not_allowed` | 400 | API 地址不被允许（SSRF 防护） |
| `origin_not_allowed` | 403 | 网页来源未授权 |
| `worker_error` | 500 | 转发服务异常 |

### 安全边界（`worker/src/index.ts` + `worker/src/config.ts`）

| 项 | 实现 |
| --- | --- |
| 只允许 POST | 其他方法返回 405；`OPTIONS` 仅用于 CORS 预检 |
| 正文大小限制 | 512 KB（先看 `Content-Length`，再按实际字节数复核） |
| 字段校验 | apiKey / model / messages 必有，role 白名单，条数 ≤ 60，单条 ≤ 24000 字符，temperature ∈ [0,2] |
| SSRF 防护 | Base URL 必须是 `https`、origin 命中白名单、禁止 URL 内携带凭据 / 查询串 / hash / 非标准端口 |
| CORS 白名单 | `ALLOWED_ORIGINS` 逗号分隔，支持 `*.xxx.pages.dev`；非白名单来源返回 403 |
| 不缓存 | 所有响应 `Cache-Control: no-store` |
| 不落盘 | 无 KV / D1 / 缓存 API；Worker 无状态 |
| 不泄露 | 不调用 `console`，错误信息中的 Key 与 Bearer 一律脱敏，`Authorization` 从不出现在响应里 |

> **为什么来源被拒时仍然回显 CORS 头？** 这样前端能读到「来源未授权，请检查 ALLOWED_ORIGINS」
> 这条可操作的提示，而不是一个无法定位的 CORS 报错。该响应只包含错误说明，不含任何数据。

### 流式（SSE）实现要点

这是本项目最容易出错的地方，实现时严格遵守了以下几点：

1. **Worker 不做整体缓冲**：直接把上游 `ReadableStream` 交给 `Response`，边生成边下发。
2. **只透传 `Content-Type`**：`Content-Encoding` 不能透传 —— Workers 的 `fetch` 已自动解压
   body，再透传会让浏览器二次解压导致乱码。
3. **客户端断开即中断上游**：`request.signal` 触发时 `controller.abort()`，
   用户点「停止生成」或关闭页面后不再继续消耗 token。
4. **前端按行缓冲解析**：绝不使用 `chunk.split('\n')` 后假设每块都是完整 JSON。
   `src/services/sseStream.ts` 用「残余字符串 + 新 chunk」的方式按行切分，
   并用 `TextDecoder({ stream: true })` 处理跨 chunk 的多字节中文字符。
5. **遵循 SSE 规范**：同一事件内多行 `data:` 用换行拼接，空行才派发一次；
   忽略 `:` 注释（心跳）；收到 `data: [DONE]` 立即结束并忽略其后内容。

`npm run check:sse` 会逐字节切分真实格式的 SSE 文本（JSON 与中文都被切开），
并随机切分 200 次，验证解析结果始终正确。

### 前端侧的配套处理

| 场景 | 处理方式 |
| --- | --- |
| 增量渲染性能 | 增量先写入 ref，用 `requestAnimationFrame` 合并刷新，避免每个 token 都重解析 Markdown |
| 首个增量到达前 | 显示轻量的「AI 正在思考…」，到达后立刻替换为正文（不显示空白气泡） |
| 停止生成 | `AbortController.abort()`；已生成的内容保留，未生成任何内容时移除空气泡 |
| 停止后重新生成 | 停止/出错后依然可以「重新生成」，不会因为状态不是 idle 而卡住 |
| 空闲超时 | 60 秒没有任何增量则自动中断并提示，避免流挂死后一直显示「正在思考」 |
| 出错但有部分内容 | 正文与红色错误提示同时显示，不会丢掉已经生成的部分 |
| 上下文控制 | 只携带最近 `MAX_CONTEXT_MESSAGES`（默认 20）条；当前用户消息不重复添加 |

---

## 11. Cloudflare 部署步骤

> 本节将在**阶段 14** 补全为面向新手的逐步教程（注册 Cloudflare → 创建 Pages 项目 → 部署 Worker → 修改 `VITE_API_ENDPOINT` → 配置 CORS → 最终验证）。

---

## 12. 常见问题排查

### 12.1 `npm install` 很慢或失败

先确认网络能访问 npm 源，或换用国内镜像：

```bash
npm config set registry https://registry.npmmirror.com
npm install
```

### 12.2 端口被占用（5173 / 4173 / 8787）

Vite 会自动换到下一个可用端口，注意看终端输出的实际地址。Worker 端口被占用时，
修改 `worker/wrangler.toml` 里的端口，并同步修改 `.env.development` 的
`VITE_API_ENDPOINT`。

### 12.3 改了 `.env.development` 不生效

Vite 只在启动时读取环境变量文件。改完必须**重启** `npm run dev`。

### 12.4 数学公式显示成行内样式，而不是独立成行

`remark-math` 只有把 `$$` 写在**单独一行**时才识别为块级公式：

```
$$
x^2 + y^2 = 1
$$
```

模型经常输出同行写法 `$$x^2 + y^2 = 1$$`。项目已在
`src/utils/markdown.ts` 的 `normalizeMarkdown()` 中自动规范化，无需手动处理。
若公式完全没渲染，检查 `src/main.tsx` 是否引入了 `katex/dist/katex.min.css`。

### 12.5 Windows 上编辑源码后中文变成乱码 ⚠️

**不要用 Windows PowerShell 5.1 的 `Get-Content` / `Set-Content` 改写源码文件。**
PowerShell 5.1 的 `Set-Content` 默认使用 ANSI 编码，会把 UTF-8 中文写成乱码，
之后 `npm run build` 会报 `invalid UTF-8` 或渲染出乱码。

正确做法：用 VS Code（右下角确认编码为 `UTF-8`）编辑；
必须用命令行时请用 PowerShell 7（`pwsh`）或在写入时显式指定 UTF-8。

### 12.6 `npm run build` 报 TypeScript 错误但页面能跑

Vite 开发服务器**不做类型检查**，类型错误只在 `build` 或 `typecheck` 时暴露。
提交前请务必执行 `npm run build`。

### 12.7 页面白屏

打开浏览器控制台（F12）看第一条红色报错。常见原因：

- `#root` 挂载节点缺失 → 检查 `index.html`；
- 依赖没装全 → 重新执行 `npm install`；
- 路径别名问题 → 确认 `tsconfig.app.json` 与 `vite.config.ts` 中的 `@` 指向 `${projectRoot}/src`。

### 12.8 `npm run check:ui` 报「未找到 Chrome / Edge」

脚本会自动查找 Chrome / Edge。如果装在非默认位置，指定路径即可：

```bash
set CHROME_PATH=D:\你的路径\chrome.exe   # Windows CMD
$env:CHROME_PATH="D:\你的路径\chrome.exe" # PowerShell
npm run check:ui
```

### 12.9 页面报 CORS 错误 / Worker 返回 `origin_not_allowed`

说明访问网页的域名不在 Worker 的 `ALLOWED_ORIGINS` 里。打开 `worker/wrangler.toml`，
把你的域名加进去（必须是完整 origin，含协议，不要以 `/` 结尾），然后重新部署：

```toml
[vars]
ALLOWED_ORIGINS = "https://你的项目.pages.dev,https://*.你的项目.pages.dev,http://localhost:5173"
```

```bash
cd demo/worker && npx wrangler deploy
```

### 12.10 页面报「无法连接模型服务」/ Worker 请求失败

1. 确认 Worker 在跑：浏览器打开 `http://127.0.0.1:8787/api/health` 应返回 `{"ok":true,...}`。
2. 确认端口一致：`worker/wrangler.toml` 的 `[dev] port` 与 `.env.development` 的
   `VITE_API_ENDPOINT` 必须是同一个端口。
3. 生产环境确认 `.env.production` 已改成真实 Worker 地址，并且**重新构建**过前端。
4. 修改 `.env.*` 后必须重启 `npm run dev`。

### 12.11 返回 `base_url_not_allowed`

Worker 出于 SSRF 防护只允许白名单内的 API 地址。默认只允许 `https://api.deepseek.com`
（支持 `/v1` 这类路径变体）。要接入其他 OpenAI 兼容服务，请修改
`worker/src/config.ts` 的 `ALLOWED_BASE_URL_ORIGINS` 后重新部署 Worker。

### 12.12 `wrangler dev` 启动失败

- 首次使用需要登录：`npx wrangler login`（仅部署需要，本地开发不需要）。
- 8787 端口被占用：改 `wrangler.toml` 的 `[dev] port`，并同步改 `.env.development`。
- 提示 `compatibility_date` 过新：把 `wrangler.toml` 里的日期改成不晚于今天的日期。

### 12.13 测试连接提示「尚未配置模型转发地址」

说明当前构建里的 `VITE_API_ENDPOINT` 还是占位符（`https://REPLACE-WITH-YOUR-WORKER...`）。
按第 6 章跑本地开发（会自动读取 `.env.development`），或按第 11 章部署 Worker 并修改
`.env.production` 后重新构建。

### 12.14 测试连接成功，但聊天回答不出现或不是流式

- 先确认 `.env.production` / `.env.development` 里的端点不是占位符（见 12.13）。
- 若回答一次性整段出现、没有逐字输出：说明中间有层做了缓冲。本项目 Worker 直接透传
  `ReadableStream`，可用 `npm run check:stream` 测量首字节与分块到达时间来定位。
- 若一直显示「AI 正在思考」不结束：可能是网络中断或上游挂死，
  前端会在 60 秒无增量后自动中断并提示；也可手动点「停止生成」。

### 12.15 开发时页面莫名整页刷新

`worker/` 是独立子项目，若不排除会被 Vite 的文件监听捕获，导致改 Worker 时前端清缓存重载。
本项目已在 `vite.config.ts` 的 `server.watch.ignored` 中排除 `worker/`、`screenshots/`、
`project_memory/`。若你新增了其他子目录（例如将来的 `functions/`），记得一并排除。
