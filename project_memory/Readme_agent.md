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

## 第二条发布线：免安装便携版（Windows + macOS）

同一份前端与同一份 Worker 代码，还可以被打包成**普通用户双击即用的桌面软件**：

- Windows：`启动智能体.exe`（单文件，自带 Node 运行时）
- macOS：`AI教育智能体.app`（应用包，`Contents/MacOS/启动智能体` 同样自带 Node 运行时）
- 用户不需要安装 Node / Python / npm / conda。

```
Windows：启动智能体.exe          macOS：AI教育智能体.app/Contents/MacOS/启动智能体
   （Node SEA + PE 改 GUI 子系统）      （Node SEA + 去掉原签名 → 注入 → ad-hoc 重新签名）
  ↓ 启动器：初始化目录 → 单实例检测 → 自动选端口 → 启动本地服务 → 健康检查 → 打开默认浏览器
  ↓ 本地服务（packaging/src/local-server.cjs）：只监听 127.0.0.1
  ├─ 静态资源：resources/web（vite 构建产物，同源提供）
  ├─ /api/local/*：聊天历史（SQLite app.db）、API 配置（settings.json）、
  │                一次性迁移、数据导出、退出
  └─ /api/chat → 适配层补齐 apiKey/baseUrl/model → 原封不动的 worker/src/index.ts → DeepSeek API
```

数据目录（行为一致，位置按各系统约定）：

| | Windows | macOS |
| --- | --- | --- |
| 可执行文件 | `<发行目录>/启动智能体.exe` | `AI教育智能体.app/Contents/MacOS/启动智能体` |
| 前端资源 | `<发行目录>/resources/web` | `AI教育智能体.app/Contents/Resources/app/resources/web` |
| 聊天数据 / 配置 / 日志 | `<发行目录>/{data,config,logs}` | `~/Library/Application Support/AI教育智能体/{data,config,logs}` |
| 交付格式 | `.zip`（解压即用） | `.dmg`（拖入「应用程序」） |
| 构建入口 | `npm run build:win` / `build_release.bat` | `npm run build:mac` / `build_release_mac.command` |

- 业务逻辑零改动：`worker/src/**`、`src/**` 的聊天 / 历史 / 存储 / Prompt 逻辑完全保留；
- 数据与端口解耦：聊天历史在本机 SQLite，换端口/换浏览器都还能看到；
- API Key 只在本机配置里，浏览器只能看到 `sk-****abcd`；
- 前端在网页部署模式下仍然使用 IndexedDB + localStorage（行为与 v1.0.0 一致）。
- macOS 数据**有意**不放在应用包内：写入会破坏代码签名，且从 dmg 直接运行会被 App Translocation
  挂到只读随机路径，写在包内的数据每次启动都会「消失」。
- 详见 `decision.md` 中「便携版用 Node SEA 打包」「macOS 继续用 Node SEA 而不是 Electron」
  「macOS 用户数据放 Application Support」等条目；构建与验收细节见 `packaging/MACOS.md` 与 `packaging/TESTING.md`。

## 目录职责（✅ 已实现 / ⏳ 计划中）

```
demo/
├─ index.html                # 前端入口 HTML
├─ vite.config.ts            # Vite 配置（React + Tailwind 插件、@ 别名）
├─ tsconfig*.json            # TypeScript 严格模式配置
├─ .env.development          # 本地开发端点（指向 localhost:8787 Worker）
├─ .env.production           # 生产端点（部署 Worker 后填写）
├─ .env.portable             # ✅ 便携版端点（同源 /api/chat，不依赖任何已部署服务）
├─ build_release.bat         # ✅ 一键构建 Windows 免安装便携版（开发者双击）
├─ build_release_mac.command # ✅ 一键构建 macOS 版 .app + .dmg（Mac 上双击）
├─ .github/workflows/
│  └─ build-mac.yml          # ✅ GitHub Actions：用 macos-latest runner 云端构建 .app + .dmg（无需本地 Mac）
├─ packaging/                # ✅ 便携版打包（仅构建期，不进入发行包）
│  ├─ package.json           #    构建期依赖：esbuild / postject / resedit
│  ├─ MACOS.md               #    macOS 构建指南（含为什么最后几步必须在 Mac 上做）
│  ├─ TESTING.md             #    Windows / macOS 发行版测试方案（自动化 + 人工清单 + 已实测声明）
│  ├─ assets/                #    生成的 app.ico（Windows）与 app.icns（macOS）
│  ├─ src/                   #    启动器与本地服务
│  │  ├─ launcher.cjs        #      端口选择 / 单实例 / 健康检查 / 开浏览器 / 错误弹窗（两平台共用）
│  │  ├─ local-server.cjs    #      Node http ↔ Fetch 适配 + 静态资源 + /api/local/*
│  │  ├─ db.cjs              #      SQLite（node:sqlite）：会话 / 消息 / meta / 损坏备份
│  │  ├─ settings.cjs        #      config/settings.json：API Key 读写与脱敏
│  │  ├─ paths.cjs           #      跨平台路径解析（planRoots 纯计算 + resolveRoots 落地）
│  │  ├─ net.cjs             #      平台无关：健康探测 / 端口记忆 / 延时
│  │  ├─ platform.cjs        #      按 process.platform 分发 showDialog / openBrowser
│  │  ├─ win.cjs             #      Windows 集成：PowerShell MessageBox + cmd/rundll32
│  │  ├─ mac.cjs             #      macOS 集成：osascript 对话框 + /usr/bin/open（绝对路径，不经 shell）
│  │  ├─ generic.cjs         #      其他平台兜底（不静默失败）
│  │  └─ logger.cjs          #      logs/app.log（含 Key 兜底脱敏、轮转）
│  └─ scripts/               #    build-release（Windows）/ build-mac（macOS）+ lib/common.mjs 共用
│     ├─ lib/common.mjs      #      两平台共用的构建步骤、命名、安全扫描、说明文本
│     ├─ icon.mjs            #      favicon.svg → app.ico（ICO）与 app.icns（ICNS）
│     ├─ pe.mjs / pe-metadata.mjs / zip.mjs   # Windows 专用（子系统、版本资源、UTF-8 ZIP）
│     ├─ plist.mjs / macho.mjs / dmg.mjs      # macOS 专用（Info.plist、Mach-O 读取、DMG 打包与验收）
│     ├─ paths-check.mjs     #      跨平台目录规则自检（33 项，可在 Windows 上验 macOS 规则）
│     ├─ mac-assets-check.mjs#      macOS 打包资源自检（23 项，含合成 Mach-O）
│     └─ smoke-test.mjs / portable-e2e.mjs    # 发行包自检（两平台共用 / 便携版端到端）
├─ release/                  # ✅ 构建输出（gitignore）：Windows 发行目录 + ZIP、macOS DMG
├─ public/_redirects         # Cloudflare Pages SPA 回退，避免刷新 404
├─ scripts/
│  ├─ ui-check.mjs           # ✅ 无依赖 UI 自动化检查（CDP，28 项断言 + 控制台错误）
│  ├─ sse-parse-check.mjs    # ✅ SSE 解析器单元验证（30 项，含逐字节与随机切分）
│  ├─ stream-check.mjs       # ✅ 真实流式链路验证（需 DEEPSEEK_API_KEY，测首字节与分块时间）
│  ├─ preview-pages.mjs      # ✅ 类 Cloudflare Pages 本地预览（应用 dist/_redirects）
│  └─ screenshot.mjs         # ✅ 无依赖页面截图工具（输出到 screenshots/，已 gitignore）
├─ src/
│  ├─ config/                # ✅ 品牌与 API 配置、快捷卡片文案
│  ├─ types/                 # ✅ 公共类型（chat / conversation / settings）
│  ├─ utils/                 # ✅ cn / id / clipboard / time / title / markdown
│  ├─ prompts/               # ✅ teacher.ts / student.ts / shared.ts / index.ts（getSystemPrompt）
│  ├─ db/                    # ✅ IndexedDB 封装（indexedDb.ts，idb）
│  ├─ services/              # ✅ storage、chatApi（Worker 调用与错误映射）、sseStream（SSE 解析）
│  ├─ hooks/                 # ✅ useConversations（IndexedDB）/ useChat（真实流式）/ useApiSettings
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

| 数据 | 网页版（Cloudflare Pages） | 便携版（Windows） | 便携版（macOS） |
| --- | --- | --- | --- |
| 聊天记录 | IndexedDB `ai-edu-agent` | **`data/app.db`（SQLite）** | **`~/Library/Application Support/AI教育智能体/data/app.db`** |
| API Key | sessionStorage `api-key:session` / localStorage `api-key:local` | **`config/settings.json`（浏览器只拿 `sk-****abcd`）** | **同左（在 Application Support 下）** |
| Provider / Base URL / Model | localStorage `api-settings` | **`config/settings.json`** | **同左** |
| 当前模式 / 当前会话 | localStorage `preferences` | localStorage `preferences`（UI 偏好，允许） | 同左 |
| 运行日志 / 端口 | —— | `logs/app.log`、`config/port.txt` | 同左（在 Application Support 下） |

同一个 Key 只能存在于一个位置；`rememberApiKey` 由 Key 实际位置推导，不独立持久化。
便携版下 `keyStorage` 恒为 `'server'`，浏览器不保存完整 Key。
两个平台的存储**行为**一致，只有目录位置按各系统约定不同（见 `decision.md`）。

## 验证手段

- `npm run build`：`tsc -b` + `vite build`，必须零类型错误。
- `npm run check:ui`（23 项）：无头 Chrome/Edge + CDP，检查渲染、Markdown/公式、交互、弹窗、
  存储行为、流式渲染（桩 SSE：增量增长 / 停止中断 / 重新生成不重复）、System Prompt 注入、
  **IndexedDB 持久化（刷新 / 删除 / 清除后的一致性，直接读库校验）**、
  测试连接错误路径（真实打到 DeepSeek）、三档桌面分辨率布局、移动端抽屉，
  并汇总 console 错误 / 未捕获异常 / 预期外的网络错误。端点未配置时相关用例显式 SKIP。
  验证生产构建时可用 `.env.production.local` 指向本地 Worker 跑完整检查。
- `npm run check:sse`（30 项）：SSE 解析器单元验证，无需网络与 Key。
- `npm run check:stream`：真实流式链路验证（需 `DEEPSEEK_API_KEY`）。
- `cd worker && npm run check`（38 项）：Worker 路由、CORS、请求校验、14 例 SSRF 防护、
  真实上游转发与错误映射、密钥不泄露。
- `node scripts/screenshot.mjs`：生成桌面 / 空状态 / 设置弹窗 / 移动端截图。
- 当前模型不支持读取图片，视觉验收需依靠 `ui-check.mjs` 的数值断言 + 用户查看截图。
- 便携版：双击 `build_release.bat`（或 `npm run build:win`）构建 Windows 版；构建脚本自带 19 项发行包断言
  （资源齐全 / GUI 子系统 / **SEA fuse 已翻开** / EXE 版本与图标 / 版本号一致 / 同源接口 / 无 `workers.dev` /
  无开发机绝对路径 / 无 API Key / 无 `.env` 与 `node_modules` / 首次启动状态）
  以及 25 项发行包自检（在临时副本里真启动 EXE，打接口、写读删会话、验跨站拒绝、单实例复用与退出）。
- macOS 版：双击 `build_release_mac.command`（或 `npm run build:mac`，**必须在 Mac 上**）构建 `.app` + `.dmg`；
  自带逐架构静态断言（`plutil -lint`、Mach-O 架构、`NODE_SEA`/`__NODE_SEA_BLOB` 分节、fuse、
  `codesign --verify --deep --strict`、安全扫描）+ 逐架构发行包自检（直接启动 + **LaunchServices 双击启动**）
  + DMG 挂载验收（`hdiutil verify`、卷内 `.app` 与 `Applications` 链接、挂载后复验签名、Gatekeeper 结论）。
- 跨平台自检（可在 Windows 上跑，用于覆盖 macOS 规则）：`npm run check:paths` 33 项、
  `npm run check:mac-assets` 23 项（含用**合成 Mach-O** 验证解析器）。
- 便携版实测：`ui-check.mjs` 全量 27 项对发行版全通过；`packaging/scripts/portable-e2e.mjs`
  分 `local / chat / seed-legacy / verify-migration / quit / seed / verify` 阶段验证
  「本地模式存储边界」「界面落库」「一次性迁移」「退出按钮」「跨端口历史与 Key」。
- 完整的 Windows / macOS 人工验收清单与「已实测 / 未实测」声明见 `packaging/TESTING.md`。
- macOS 云端构建：`.github/workflows/build-mac.yml`（`macos-latest`）。
  触发：`GitHub → Actions → Build macOS → Run workflow`，或 push 到 `main`。
  产物：Artifacts → `AI教育智能体-macOS-build`（`.dmg` + `.app.zip`，保留 30 天）。
  工作流本身可在本机校验（YAML 结构 + 每个 `run:` 块的 `bash -n`），另有 `packaging/MACOS.md` 第 5、9 节
  说明 CI 的两条客观限制（artifact 不保留权限 → 只传 dmg/zip；LaunchServices 需要 Aqua 会话 → 无则显式跳过）。

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
