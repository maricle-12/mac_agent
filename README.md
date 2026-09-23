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
├─ src/services/ · src/db/    # ⏳ 阶段 3 / 7 / 9 创建
├─ worker/                    # ⏳ 阶段 4 创建（独立 package.json + wrangler.toml）
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

### 自动化验证

项目自带两个无第三方依赖的浏览器自动化脚本（用本机 Chrome/Edge 的无头模式 + CDP）：

```bash
# UI 检查：渲染、Markdown/公式、发送、停止生成、弹窗、删除确认、响应式布局
npm run check:ui                      # 默认检查 http://localhost:5173/

node scripts/ui-check.mjs http://localhost:4173/   # 也可以检查生产预览

# 截图（输出到 screenshots/，该目录不提交 Git）
node scripts/screenshot.mjs http://localhost:5173/
```

`ui-check.mjs` 会检查 12 项内容并在最后汇总 `console.error`、未捕获异常与浏览器日志错误。
修改 UI 后建议先跑一遍，能第一时间发现渲染或交互回归。

> **本地完整链路**：`localhost 页面 → localhost Worker → DeepSeek`。
> Worker 将在**阶段 4** 创建，届时用 `npx wrangler dev`（或 `npm run dev`，在 `worker/` 目录内）启动在 `http://localhost:8787`，前端通过 `.env.development` 中的 `VITE_API_ENDPOINT` 连接它。

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

---

## 9. 模型设置项

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| API Provider | DeepSeek | 第一版仅 DeepSeek |
| API Key | 空 | 用户输入，形如 `sk-xxxxxxxx` |
| Base URL | `https://api.deepseek.com` | 用户可改，Worker 侧做白名单校验 |
| Model | `deepseek-chat` | 用户可改 |

架构上保留 **OpenAI-Compatible API** 支持：未来只需在 `src/config/api.ts` 增加 Provider、在 Worker 白名单中加入对应域名即可。

---

## 10. 开发路线图（14 个阶段）

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 项目骨架，`npm run dev` 可运行 | ✅ 已完成 |
| 2 | 完整静态 UI（模拟消息） | ✅ 已完成 |
| 3 | API 设置（Key 输入 / 保存 / 测试连接） | ⬜ |
| 4 | 建立 Cloudflare Worker | ⬜ |
| 5 | 打通 DeepSeek 非流式请求 | ⬜ |
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
