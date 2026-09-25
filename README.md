# AI 教育智能体

> 面向教师与学生的智能学习助手 —— **免安装的本地桌面应用**。

Windows 下载 zip 解压后双击 `启动智能体.exe`；macOS 打开 dmg 拖进「应用程序」后点击启动。
界面在浏览器里打开，程序完全跑在用户自己的电脑上，**不需要服务器、不需要注册登录、不需要配置任何环境**
（Node 运行时已打进程序内部）。首次使用时填写**自己的 DeepSeek API Key**，模型 Token 成本由用户自己的账户承担。

---

## 1. 这个项目是什么

一个类似 ChatGPT / Coze 的网页版 AI 智能体，产品化定位为「AI 教育智能体」，内置两种模式：

| 模式 | 面向 | 能力 |
| --- | --- | --- |
| 教师模式 | 教师 | 教学设计、教案生成、教学目标与重难点分析、课堂活动设计、练习题与作业设计、易错点分析、学情分析、教学评价建议 |
| 学生模式 | 学生 | 知识点讲解、题目分析、答案检查、错题整理、分步骤启发式辅导 |

### 核心产品原则

> **用户自己提供 API Key，我们提供程序、Prompt、Agent 能力、UI、工作流。**

- 使用者零门槛：下载即用，不需要安装 Node / Python / 任何开发环境（运行时已打进程序内部）。
- 运营方固定成本为 **0**：没有服务器、没有数据库、没有云端账号；模型调用由用户本机直接打到 DeepSeek。
- 用户数据只存在用户自己的电脑上：聊天历史在本机 SQLite（`data/app.db`），
  API Key 在本机配置文件里（浏览器只能拿到 `sk-****abcd`），**不上传任何服务器**。
- 没有账号系统、没有云端聊天记录、没有管理员后台。

---

## 2. 整体架构

程序内部就是「本地服务 + 浏览器界面」的组合：双击启动后本地服务监听 `127.0.0.1`，
自动用默认浏览器打开界面，之后所有请求都只在你自己这台电脑上流转。

```
用户双击启动（Windows: 启动智能体.exe ／ macOS: AI教育智能体.app）
    │  ① 启动器：初始化 data/config/logs → 单实例检测 → 自动选端口 → 健康检查
    ▼
本地服务（只监听 127.0.0.1，随 Node SEA 一起打包进可执行文件）
    ├─ 静态资源：内置前端（React 构建产物，与接口同源提供）
    ├─ /api/local/*：聊天历史（SQLite data/app.db）、API 配置（config/settings.json）、导出、退出
    ▼
POST /api/chat  { apiKey, baseUrl, model, messages, temperature }
    │  ② 校验 + Base URL 白名单（防 SSRF）→ 转发 DeepSeek，透传 SSE 流
    │  不保存请求正文、不外传任何数据
    ▼
DeepSeek API  https://api.deepseek.com/chat/completions  (stream: true)
    │  ③ SSE 流式返回
    ▼
浏览器页面逐 chunk 实时渲染，支持「停止生成」
```

**各层职责划分**

- **前端（React）**：UI、会话管理、模式切换、API 设置、用户输入、Markdown / 公式渲染。
- **本地服务**：提供静态资源；用同一份转发代码（`worker/src/index.ts`，构建时由 esbuild 打包进来）
  做校验、白名单与流式透传；把聊天历史与配置落到本机文件。
- **启动器**：单实例、端口选择、健康检查、打开浏览器、错误提示 —— 不含任何业务逻辑。

> Cloudflare 部署方式已不再使用。想额外提供公网链接的，可参考作为历史记录保留的
> [`docs/legacy-cloudflare-deployment.md`](docs/legacy-cloudflare-deployment.md) —— 那**不是**使用本项目所必需的步骤。

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
| `npm run preview:pages` | **类 Cloudflare Pages 预览**（http://localhost:4180，会应用 `dist/_redirects`） |
| `npm run typecheck` | 只做类型检查 |
| `npm run check:ui` | 无头浏览器 UI 自动化检查（需先启动 `npm run dev` 或 `npm run preview`） |
| `npm run check:sse` | SSE 解析器单元验证（含逐字节切分等极端情况，无需网络） |
| `npm run check:stream` | **真实流式链路验证**（需 `DEEPSEEK_API_KEY`，测量首字节与分块到达时间） |
| `npm run check:paths` | **跨平台路径自检**（33 项，含把 macOS / Linux 的目录规则在本机算一遍并断言） |
| `npm run check:mac-assets` | **macOS 打包资源自检**（23 项：ICNS、Info.plist、Mach-O 解析器，可在任意平台跑） |
| `npm run build:win` | 构建 Windows 免安装版（`release/...zip`；等价于双击 `build_release.bat`） |
| `npm run build:mac` | 构建 macOS 版 `.app` + `.dmg`（**只能在 macOS 上运行**；等价于双击 `build_release_mac.command`） |

### 打包成免安装桌面软件（Windows / macOS）

普通用户拿到的是**解压/挂载即用**的软件包，不需要安装 Node、Python、npm、conda：

```bash
# Windows：产出 release/AI教育智能体_v1.0.1_Windows.zip（解压后双击 启动智能体.exe）
npm run build:win            # 或双击 build_release.bat

# macOS：产出 release/AI教育智能体_v1.0.1_macOS_universal.dmg（拖进「应用程序」后点击启动）
npm run build:mac            # 或双击 build_release_mac.command（需在 Mac 上）
npm run build:mac:arm64      # 只出 Apple 芯片版
npm run build:mac:x64        # 只出 Intel 版
```

**没有 Mac 电脑也可以构建 macOS 版**：仓库内置了 GitHub Actions（`.github/workflows/build-mac.yml`），
用 GitHub 提供的 macOS Runner 在云端完成签名、出 dmg 与全套自检。

```
GitHub → Actions → Build macOS → Run workflow
```

构建完成后在该次运行页面的 **Artifacts** 里下载 `AI教育智能体-macOS-build`，
内含 `.dmg`（安装用）与 `.app.zip`（应用包）。详见 [`packaging/MACOS.md`](packaging/MACOS.md)。

两个平台的构建脚本都**自带断言与发行包自检**（在临时副本里真启动程序并打接口），
任一环节失败即中断构建，不会产出「看起来成功但跑不起来」的包。

- macOS 构建指南（含为什么「签名 + 出 dmg」必须在 Mac 上做）：[`packaging/MACOS.md`](packaging/MACOS.md)
- 两个平台的完整测试方案与「已实测 / 未实测」声明：[`packaging/TESTING.md`](packaging/TESTING.md)

> 说明：本产品**没有文件上传功能**（第一版明确不做上传 / 知识库 / RAG），
> 两个平台的测试清单中该项均为 N/A。
>
> macOS 版未使用 Apple 开发者证书、未做公证，用户首次打开需要「右键 → 打开」。
> 这是未签名软件的固有提示，应用内的「使用说明.txt」已写清处理方式。

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

`ui-check.mjs` 会检查 28 项内容并在最后汇总 `console.error`、未捕获异常与浏览器日志错误。
修改 UI 后建议先跑一遍，能第一时间发现渲染或交互回归。

其中包含**移动端适配验证**：360×640 / 390×844 / 414×896 / 768×1024 四种尺寸下的
无横向溢出、输入区不被视口裁掉、整页滚动被禁用、应用外壳高度与视口一致、
手机端侧边栏折叠与平板端常驻、抽屉内点击目标 ≥36px、
以及**窄屏下会话的「⋯」按钮必须常显**（手机上永远没有 hover）。

其中包含**会话管理验证**：新建 / ⋯ 菜单 / 重命名（空标题被拒绝、改名后刷新仍在）/
删除确认与取消 / **删除当前会话后自动选中相邻会话** / 删除后刷新不复活。

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
npm run build && npm run preview:pages
node scripts/ui-check.mjs http://localhost:4180/     # 预期 28 项全部通过
```

检查完记得删除该文件（它只用于本地验证，不应提交）。

`npm run preview:pages` 是**类 Cloudflare Pages 的本地预览服务器**：它会读取
`dist/_redirects` 并按 Pages 的语义处理，因此本地就能验证「刷新 SPA 深层路径不会 404」
（`vite preview` 不实现该规则）。

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
| `VITE_API_ENDPOINT` | 模型转发端点 | **本地版（默认）**：`.env.portable` 里的 `/api/chat`（同源）<br>开发调试：`http://localhost:8787/api/chat`<br>云端可选方案：`https://<你的转发服务>/api/chat` |

- **本地免安装版用 `.env.portable`（内容为 `/api/chat`），它是同源相对路径，不依赖任何已部署服务。**
  构建命令 `npm run build:win` / `npm run build:mac` 会自动走这个模式。
- 开发环境写在 `.env.development`；`.env.production` 仅用于可选的云端静态部署，默认为空。
- 缺失时回退到同源 `/api/chat`（因此本地版不会因为漏配而失效）。
- 个人临时覆盖请写入 `.env.local`（已被 `.gitignore` 忽略）。

> ### ⚠️ 安全红线
> **绝对不要**把 API Key 放进任何 `VITE_*` 环境变量。
> Vite 会把 `VITE_` 开头的变量**打包进公开的前端产物**，任何人打开网页都能看到。
> 用户 Key 只能由用户在界面「API 设置」中输入（本地版保存在本机配置文件里，浏览器只拿到脱敏值）。

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

## 11. 开发路线图（14 个阶段）

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
| 10 | 新建 / 删除 / 重命名对话 | ✅ 已完成 |
| 11 | 错误处理完善 | ✅ 已完成 |
| 12 | 移动端适配 | ✅ 已完成 |
| 13 | 生产 Build 验收 | ✅ 已完成 |
| 14 | Cloudflare Pages + Worker 部署 | ⬜ |

---

## 12. Worker 接口说明

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

### 错误处理

所有错误都收敛到「用户能看懂的一句话」，技术细节折叠在「查看技术详情」里。
页面不会因为任何错误白屏或崩溃。

| 场景 | 用户看到 | 界面表现 |
| --- | --- | --- |
| 401 API Key 不正确 | 「API Key 不正确或已失效，请在「API 设置」中检查后重新填写。」 | 消息内红色提示 + 可重新生成 |
| 402 余额不足 | 「账户余额不足或账户状态异常，请到模型服务商控制台检查。」 | 同上 |
| 429 请求过于频繁 | 「请求过于频繁，请稍后再试。」 | 同上 |
| 404 模型不存在 | 「模型不存在或没有访问权限，请检查模型名称。」 | 同上 |
| 5xx 上游异常 | 「模型服务异常，请稍后重试。」 | 同上 |
| 网络断开（发不出请求） | 「网络连接中断，请检查网络后重试。」 | 同上 |
| Worker 未部署 / 地址是占位符 | 「尚未配置模型转发地址，请参考 README 完成 Worker 部署后再试。」 | 同上 |
| **流式输出中途断开** | 「生成过程中连接中断，**已保留已生成的内容**。可点击「重新生成」重试。」 | **已生成的部分照常显示**，不整条变红 |
| 用户主动停止 | 无错误提示 | 保留已生成内容；一个字都没生成时移除空气泡 |
| 空闲超时（60s 无增量） | 「模型服务长时间没有返回内容，已自动中断。请稍后重试。」 | 同上 |
| 未配置 API Key 就发送 | 「尚未配置 API Key。请点击右上角「设置」填写你自己的 DeepSeek API Key。」 | 不发请求，直接提示 |
| 渲染期异常（兜底） | 「页面出现了意外错误 / 你的聊天记录仍然安全地保存在本机浏览器中」+ 重新加载按钮 | 整页兜底，**不白屏** |
| 单条消息渲染异常 | 「这条消息渲染失败，内容可能含有不支持的格式。」 | 只影响这一条消息 |

实现位置：

- 错误码 → 文案映射：Worker（`worker/src/index.ts` 的 `ERROR_TEXT`）+ 前端本地兜底
  （`src/services/chatApi.ts` 的 `LOCAL_ERROR_MESSAGES`）。
- 流式相关状态机与部分内容保留：`src/hooks/useChat.ts`。
- 兜底 UI：`src/components/common/ErrorBoundary.tsx`（整页级别包在 `main.tsx`，
  单条消息级别包在 `MessageBubble` 的 Markdown 渲染外层）。

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

## 13. 生产构建体积与验收

### 体积（`npm run build`）

| 产物 | 未压缩 | gzip | 何时加载 |
| --- | --- | --- | --- |
| `index.js`（应用外壳 + React + 基础 Markdown） | 443 kB | **137 kB** | 首屏 |
| `index.css` | 31 kB | 7 kB | 首屏 |
| `MathMarkdown.js`（remark-math + rehype-katex + KaTeX） | 274 kB | 83 kB | **仅当回答里出现 `$` 公式时** |
| `MathMarkdown.css`（KaTeX 样式） | 30 kB | 8 kB | 同上 |

首屏总计约 **144 kB（gzip）**。KaTeX 及其样式被拆成按需分块 ——
没有公式的对话完全不会下载它。字体文件带 `unicode-range`，浏览器只取用到的字形。

> 想继续压体积，可把 `react-markdown` 也改成按需加载，但首屏渲染消息时会闪一下，
> 收益（约 40 kB gzip）不值得。需要的话改 `MarkdownRenderer` 里 `React.lazy` 的边界即可。

### 验收清单

| 验收项 | 状态 | 验证方式 |
| --- | --- | --- |
| `npm run build` 无 TypeScript 错误 | ✅ | `tsc -b` |
| 无 sourcemap（不暴露源码结构） | ✅ | 扫描 `dist/**/*.map` |
| 产物中无任何密钥 | ✅ | 扫描 `dist` 中 `sk-...` 形态字符串 |
| 刷新 SPA 深层路径不 404 | ✅ | `npm run preview:pages` + 请求 `/some/deep/route` 应返回 200 与 `#root` |
| 无 console 错误 | ✅ | `npm run check:ui` 汇总 console.error / 未捕获异常 / 网络错误 |
| 压缩产物行为与开发一致 | ✅ | 对生产构建跑完整 `ui-check`（28 项） |
| Pages 需要的文件齐全 | ✅ | `dist/_redirects`、`dist/index.html`、`dist/favicon.svg` |

---

## 14. 云端部署（可选，本项目不需要）

本项目的交付方式是**本地免安装应用**，前后端都跑在用户自己的电脑上：

| | Windows | macOS |
| --- | --- | --- |
| 交付物 | `AI教育智能体_v<版本>_Windows.zip` | `AI教育智能体_v<版本>_macOS_universal.dmg` |
| 用户操作 | 解压 → 双击 `启动智能体.exe` | 打开 dmg → 拖进「应用程序」→ 点击启动 |
| 后端 | 本机 Node SEA 可执行文件内的本地服务（只监听 `127.0.0.1`） | 同左 |
| 构建 | `npm run build:win` / `build_release.bat` | `npm run build:mac` / GitHub Actions（`Build macOS`） |

- **不需要** Cloudflare、不需要服务器、不需要域名、不需要数据库。
- 聊天记录与 API Key 都存在用户自己的电脑上（SQLite + 本机配置文件），不上传任何服务器。
- 构建与验收细节：[`packaging/MACOS.md`](packaging/MACOS.md)、[`packaging/TESTING.md`](packaging/TESTING.md)。

> **可选**：如果你确实想额外提供一个公网链接（例如给不方便安装软件的用户），
> 仍然可以把前端部署成纯静态站点、把 `worker/` 部署成无状态转发服务。
> 那份从零开始的教程已移到 [`docs/legacy-cloudflare-deployment.md`](docs/legacy-cloudflare-deployment.md)，
> 属于历史记录，**不是**使用本项目所必需的步骤。

---

## 15. 最终验收清单

对应需求文档第五十二条，逐条给出验证方式。`npm run check:ui` 会自动覆盖其中大部分。

> **说明**：这张表来自最初「公网网页版」的需求文档。本项目现在的交付方式是**本地免安装应用**，
> 因此下表中凡涉及「公网链接 / 云端部署 / 浏览器存储」的条目，都以**本地版的实际行为为准**
> （已在表中标注）。云端相关条目保留为可选历史能力，不是必需的。
> 本地版的完整验收清单见 [`packaging/TESTING.md`](packaging/TESTING.md)。

| # | 验收项 | 状态 | 验证方式 |
| --- | --- | --- | --- |
| 1 | 启动后能显示界面 | ✅ | 双击启动后自动打开浏览器界面；发行包自检断言首页与全部静态资源可访问 |
| 2 | 不登录即可使用 | ✅ | 无账号系统，直接可用 |
| 3 | 可以填写 DeepSeek API Key | ✅ | 设置弹窗；ui-check「API 设置弹窗」 |
| 4 | API Key 不写死在源码 | ✅ | `git grep 'sk-[A-Za-z0-9]{20,}'` 无结果；发行包扫描无密钥 |
| 5 | 可以测试 API | ✅ | 「测试连接」（成功 / 失败两条分支均有自动化用例） |
| 6 | DeepSeek 能正常回答 | ⏳ 需你的 Key | 用真实 Key 在界面里问一句；或 `npm run check:stream` |
| 7 | AI 使用 Streaming 输出 | ✅ | ui-check「流式增量渲染」断言内容随时间增长 |
| 8 | 能停止生成 | ✅ | ui-check「停止生成」断言保留内容且 AbortSignal 触发 |
| 9 | 教师模式 Prompt 正确 | ✅ | ui-check 拦截请求体断言 system 内容 |
| 10 | 学生模式 Prompt 正确 | ✅ | 同上（且不含教师 Prompt） |
| 11 | 可以新建对话 | ✅ | 侧边栏「新建对话」；ui-check 覆盖 |
| 12 | 历史记录本地保存 | ✅ | **本机 SQLite（`data/app.db`）**，与浏览器和端口无关；ui-check 直接读库校验 |
| 13 | 刷新后聊天不会消失 | ✅ | ui-check「历史记录持久化」 |
| 14 | 可以删除历史记录 | ✅ | ⋯ → 删除；ui-check「删除后刷新不复活」 |
| 15 | 可以重新生成 | ✅ | ui-check「重新生成不重复用户消息」 |
| 16 | 可以复制 AI 回答 | ✅ | 消息下方「复制」按钮（含降级方案） |
| 17 | API 错误有友好提示 | ✅ | 第 12 章错误对照表（13 种场景） |
| 18 | 页面手机端可使用 | ✅ | ui-check 4 种尺寸 + 触摸目标 + 窄屏常显操作按钮 |
| 19 | ~~Cloudflare Pages 部署正常~~ | ⚪ 可选 | 已不再是交付路径；历史记录见 [`docs/legacy-cloudflare-deployment.md`](docs/legacy-cloudflare-deployment.md) |
| 20 | ~~Worker 部署正常~~ | ⚪ 可选 | 同上（`worker/` 代码仍在，本地版把它打包进程序内部使用） |
| 21 | 不需要 VPS | ✅ | 本地版连转发服务都是本机进程；云端可选方案也不需要 VPS |
| 22 | 不需要外部数据库 | ✅ | 本地版用单文件 SQLite（`data/app.db`）；云端可选方案无 KV / D1 |
| 23 | 不需要 Coze / Dify | ✅ | 未使用任何低代码 Agent 平台 |
| 24 | 用户模型费用由自己的 API Key 承担 | ✅ | Key 由用户输入；**只存在用户本机配置文件里**，不上传任何服务器 |

标记 ⏳ 的条目需要你自己的 DeepSeek API Key 才能确认（我没有 Key，只能验证到「假 Key 打通链路」这一层）。

**发行包层面的验收（本地版）**：Windows `19/19` 静态断言 + `25/25` 发行包自检；
macOS 逐架构静态断言 + 发行包自检 + DMG 挂载验收 + zip 解压后签名复验 —— 见 [`packaging/TESTING.md`](packaging/TESTING.md)。

**历史上在公网环境做过的验证**（可选方案，非当前交付路径）：前端可访问、转发服务健康检查、
CORS 白名单放行与拒绝、真实上游 401 映射与密钥脱敏、SSRF 防护、线上自检 38/38 ——
记录见 [`docs/legacy-cloudflare-deployment.md`](docs/legacy-cloudflare-deployment.md)。

---

## 16. 常见问题排查

> **本节包含两部分**：16.1～16.8 与 16.14～16.17 是通用的（开发与本地版都适用）；
> **16.9～16.13 与 16.18～16.19 是「云端可选方案 / 本地 wrangler 转发」专用的**
> （涉及 CORS、`origin_not_allowed`、`wrangler dev`、`pages.dev` 可访问性等）。
> 本地免安装版不走这些路径，遇到问题请优先看 [`packaging/MACOS.md`](packaging/MACOS.md) 的故障排查章节。

### 16.1 `npm install` 很慢或失败

先确认网络能访问 npm 源，或换用国内镜像：

```bash
npm config set registry https://registry.npmmirror.com
npm install
```

### 16.2 端口被占用（5173 / 4173 / 8787）

Vite 会自动换到下一个可用端口，注意看终端输出的实际地址。Worker 端口被占用时，
修改 `worker/wrangler.toml` 里的端口，并同步修改 `.env.development` 的
`VITE_API_ENDPOINT`。

### 16.3 改了 `.env.development` 不生效

Vite 只在启动时读取环境变量文件。改完必须**重启** `npm run dev`。

### 16.4 数学公式显示成行内样式，而不是独立成行

`remark-math` 只有把 `$$` 写在**单独一行**时才识别为块级公式：

```
$$
x^2 + y^2 = 1
$$
```

模型经常输出同行写法 `$$x^2 + y^2 = 1$$`。项目已在
`src/utils/markdown.ts` 的 `normalizeMarkdown()` 中自动规范化，无需手动处理。
若公式完全没渲染，检查 `src/main.tsx` 是否引入了 `katex/dist/katex.min.css`。

### 16.5 Windows 上编辑源码后中文变成乱码 ⚠️

**不要用 Windows PowerShell 5.1 的 `Get-Content` / `Set-Content` 改写源码文件。**
PowerShell 5.1 的 `Set-Content` 默认使用 ANSI 编码，会把 UTF-8 中文写成乱码，
之后 `npm run build` 会报 `invalid UTF-8` 或渲染出乱码。

正确做法：用 VS Code（右下角确认编码为 `UTF-8`）编辑；
必须用命令行时请用 PowerShell 7（`pwsh`）或在写入时显式指定 UTF-8。

### 16.6 `npm run build` 报 TypeScript 错误但页面能跑

Vite 开发服务器**不做类型检查**，类型错误只在 `build` 或 `typecheck` 时暴露。
提交前请务必执行 `npm run build`。

### 16.7 页面白屏

打开浏览器控制台（F12）看第一条红色报错。常见原因：

- `#root` 挂载节点缺失 → 检查 `index.html`；
- 依赖没装全 → 重新执行 `npm install`；
- 路径别名问题 → 确认 `tsconfig.app.json` 与 `vite.config.ts` 中的 `@` 指向 `${projectRoot}/src`。

### 16.8 `npm run check:ui` 报「未找到 Chrome / Edge」

脚本会自动查找 Chrome / Edge。如果装在非默认位置，指定路径即可：

```bash
set CHROME_PATH=D:\你的路径\chrome.exe   # Windows CMD
$env:CHROME_PATH="D:\你的路径\chrome.exe" # PowerShell
npm run check:ui
```

### 16.9 页面报 CORS 错误 / Worker 返回 `origin_not_allowed`

说明访问网页的域名不在 Worker 的 `ALLOWED_ORIGINS` 里。打开 `worker/wrangler.toml`，
把你的域名加进去（必须是完整 origin，含协议，不要以 `/` 结尾），然后重新部署：

```toml
[vars]
ALLOWED_ORIGINS = "https://你的项目.pages.dev,https://*.你的项目.pages.dev,http://localhost:5173"
```

```bash
cd demo/worker && npx wrangler deploy
```

### 16.10 页面报「无法连接模型服务」/ Worker 请求失败

1. 确认 Worker 在跑：浏览器打开 `http://127.0.0.1:8787/api/health` 应返回 `{"ok":true,...}`。
2. 确认端口一致：`worker/wrangler.toml` 的 `[dev] port` 与 `.env.development` 的
   `VITE_API_ENDPOINT` 必须是同一个端口。
3. 生产环境确认 `.env.production` 已改成真实 Worker 地址，并且**重新构建**过前端。
4. 修改 `.env.*` 后必须重启 `npm run dev`。

### 16.11 返回 `base_url_not_allowed`

Worker 出于 SSRF 防护只允许白名单内的 API 地址。默认只允许 `https://api.deepseek.com`
（支持 `/v1` 这类路径变体）。要接入其他 OpenAI 兼容服务，请修改
`worker/src/config.ts` 的 `ALLOWED_BASE_URL_ORIGINS` 后重新部署 Worker。

### 16.12 `wrangler dev` 启动失败

- 首次使用需要登录：`npx wrangler login`（仅部署需要，本地开发不需要）。
- 8787 端口被占用：改 `wrangler.toml` 的 `[dev] port`，并同步改 `.env.development`。
- 提示 `compatibility_date` 过新：把 `wrangler.toml` 里的日期改成不晚于今天的日期。

### 16.13 测试连接提示「尚未配置模型转发地址」

说明当前构建里的 `VITE_API_ENDPOINT` 还是占位符（`https://REPLACE-WITH-YOUR-WORKER...`）。
按第 6 章跑本地开发（会自动读取 `.env.development`），或按第 14 章部署 Worker 并修改
`.env.production` 后重新构建。

### 16.14 测试连接成功，但聊天回答不出现或不是流式

- 先确认 `.env.production` / `.env.development` 里的端点不是占位符（见 16.13）。
- 若回答一次性整段出现、没有逐字输出：说明中间有层做了缓冲。本项目 Worker 直接透传
  `ReadableStream`，可用 `npm run check:stream` 测量首字节与分块到达时间来定位。
- 若一直显示「AI 正在思考」不结束：可能是网络中断或上游挂死，
  前端会在 60 秒无增量后自动中断并提示；也可手动点「停止生成」。

### 16.15 开发时页面莫名整页刷新

`worker/` 是独立子项目，若不排除会被 Vite 的文件监听捕获，导致改 Worker 时前端清缓存重载。
本项目已在 `vite.config.ts` 的 `server.watch.ignored` 中排除 `worker/`、`screenshots/`、
`project_memory/`。若你新增了其他子目录（例如将来的 `functions/`），记得一并排除。

### 16.16 手机上点不到会话的「⋯」（重命名 / 删除）

已按设计处理：**窄屏（<768px）下会话行的「⋯」按钮始终显示**。
桌面端才做「悬停才出现」的收起效果。不要改成只依赖 `@media (hover: none)` ——
不同浏览器与机型对 hover 能力的上报并不一致，会把「能否管理会话」交给一个不可靠的判断。
如果发现手机上仍看不到该按钮，检查自定义样式的加载顺序是否覆盖了 `.conversation-more`。

### 16.17 手机上软键盘盖住输入框

已做两件事：

1. `index.html` 的 viewport 加了 `interactive-widget=resizes-content`（Chrome 支持）；
2. `#root` 高度用 `100dvh`（带 `100%` 回退），键盘弹出时整个外壳随之缩小。

若仍有遮挡，检查是否又用回了 `100vh`/`h-screen` —— 它们在移动端等于**最大**视口高度，
键盘弹出时不会收缩。

### 16.18 ⚠️ 国内用户打不开 `*.pages.dev` / `*.workers.dev`

这是**必须提前知道的限制**，不是代码问题：

- `workers.dev` 与 `pages.dev` 在中国大陆**访问不稳定甚至被直接阻断**。
  本机实测：直连失败，走代理正常。
- 也就是说，如果你的用户在大陆且没有代理，他们可能**打不开你部署后的链接** ——
  这与「一个链接即可访问」的产品目标直接冲突。

可选应对（按推荐顺序）：

1. **绑定自定义域名**（在 Cloudflare Pages 里加 Custom domain）。
   自带域名的**可访问性通常明显好于 `pages.dev`**，是最省事的一步。
   注意：域名仍需能解析到 Cloudflare 的 IP，且大陆访问质量取决于线路。
2. **换部署平台**：前端放到国内可直连的静态托管。
   代价是偏离需求文档指定的 Cloudflare Pages，Worker 转发也要跟着搬。
3. **只面向海外/有代理的用户**：当前状态即可用。

> 如果你要继续用 Cloudflare，建议先在第 1 条上做验证：
> 绑好自定义域名后，用手机 4G（不走代理）打开试试，确认目标用户能访问。

### 16.19 部署相关的其他坑

见 14.11，那里记录了本次真实部署踩到的 6 个坑（子域名注册、DNS 传播、
git 分支决定部署环境、`[vars]` 边缘延迟、代理、懒加载分块晚一步）。
