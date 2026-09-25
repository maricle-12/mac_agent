# 当前状态

## macOS 云端构建（GitHub Actions）

仓库 `maricle-12/mac_agent`（**已转为公开**）里配置了 `.github/workflows/build-mac.yml`：
用 GitHub 提供的 **macOS Runner** 完成原本必须在 Mac 上做的最后几步，
从而**不需要本地 Mac 电脑**。

```
git push  →  macos-latest runner：checkout → setup-node 22 → npm ci(根 + packaging)
          → check:paths / check:mac-assets（早失败）
          → npm run build:mac（Worker 打包 → 启动器打包 → SEA 注入 → ad-hoc 签名
                              → .app → 自检 → dmg → 挂载验收 → .app.zip）
          → Artifacts: AI教育智能体-macOS-build（.dmg + .app.zip）
```

### 交付物与用法

| 项 | 内容 |
| --- | --- |
| 工作流文件 | `.github/workflows/build-mac.yml` |
| 触发 | `workflow_dispatch` + push 到 `main` |
| 下载 | 该次运行页面底部 **Artifacts** → `AI教育智能体-macOS-build`（保留 30 天） |
| 内容 | `AI教育智能体_v1.0.1_macOS_universal.dmg`、`AI教育智能体_v1.0.1_macOS_universal.app.zip` |
| 签名 | 只用 `codesign --force --sign -`（ad-hoc）；**不接 Apple 账号、不公证** |
| 架构 | 默认 universal（arm64 复用 runner 的 Node，x64 从 nodejs.org 下载并校验 SHA-256，再 lipo 合成） |
| 分钟数 | 仓库公开后标准 runner **免费不限量**（私有仓库时 macOS 按 10 倍计费，现已无此顾虑） |

### ⚠️ 第一次真实运行的失败与修复（Worker 产物路径不一致）

**失败点**：`[3/10]` 打包 Worker 之后，`[4/10]` 打包启动器时报

```
ERROR: Could not resolve "../build/worker.cjs"
   位置：packaging/src/local-server.cjs:29
```

**根因**：`local-server.cjs` 里那句 `require('../build/worker.cjs')` 是相对 `packaging/src/` 解析的，
**只能**指向 `packaging/build/worker.cjs`；而 `build-mac.mjs` 把 Worker 产物写到了
`packaging/build-mac/worker.cjs`（`build-release.mjs` 恰好用 `packaging/build/`，所以只有 macOS 会挂）。
esbuild 打包启动器时会静态解析这句 require，于是直接解析失败。

**为什么开发机上没发现**：
1. Windows 构建「刚好」也写 `packaging/build/`，路径碰巧一致；
2. 本机 `packaging/build/worker.cjs` 早就存在（历次构建留下），即使路径写错也能解析成功；
3. `build-mac.mjs` 的平台守卫让整条 macOS 构建线在非 macOS 上**完全跑不到** —— 只能等 CI 暴露。

**修复**（`packaging/scripts/lib/common.mjs` 统一约定 + 自愈 + 静态断言）：

| 改动 | 作用 |
| --- | --- |
| 新增 `WORKER_BUNDLE_RELPATH` / `workerBundlePath()` | 把「Worker 产物唯一位置」变成一处声明，两个构建脚本共用 |
| 新增 `ensureWorkerBundle({ force })` | 产物缺失时自动生成，输出 `worker bundle missing, generating...`；失败时明确输出 `worker build failed` 并抛错，不再让下游 esbuild 报出看不出根因的错误 |
| `bundleLauncher()` 增加前置检查 | 打包启动器前先保证 Worker 产物就位，消除「谁先谁后」的隐藏依赖 |
| `build-release.mjs` / `build-mac.mjs` 第 3 步 | 都改为调用 `ensureWorkerBundle({ force: true })`，产物都落在 `packaging/build/worker.cjs` |
| `build-mac.mjs` 新增 `--preflight` | 只跑「Worker 打包 → 启动器打包 → 图标 → SEA blob」，**平台无关**，可在 Windows 上验证 macOS 构建线的前半段 |
| `paths-check.mjs` 新增 D 节 9 条断言 | 直接固化不变量：`local-server.cjs` 要求的路径 == 构建脚本约定的路径、两个脚本都走 `ensureWorkerBundle`、`packaging/src` 的相对 require 全部可解析 |

### 修复后已实测（真实执行，非推断）

- **复现原始故障条件并通过**：删掉整个 `packaging/build/`（等价于 macOS runner 的干净环境）后执行
  `npm run check:mac-build` → `[3/10]` 打印 `worker bundle missing, generating...` + `worker bundle ok（14.5 KB）`，
  `[4/10]` **打包启动器成功**（产 94 KB launcher bundle），SEA blob 也生成成功 → 原先失败的两步现已通过。
- **自愈路径**：单独删掉 `packaging/build/worker.cjs` 后直接调用 `bundleLauncher()` →
  自动补生成并成功打包启动器（不再依赖调用顺序）。
- **失败提示**：临时改名 `worker/src/index.ts` 触发失败 → 输出 `worker build failed` + 具体原因，
  抛出的错误信息明确指向该步骤（验证后源文件已还原，无残留）。
- `npm run check:paths` **42/42**（含 9 条新增的构建期路径不变量断言）、`npm run check:mac-assets` **23/23**。
- `npm run build:win` **19/19 静态断言 + 25/25 发行包自检**，体积与改造前完全一致。

### 仍未实测（需要下一次 GitHub Actions 运行确认）

| 项目 | 说明 |
| --- | --- |
| 云端 macOS 构建能否走完 | 前半段（到 SEA blob）已在 Windows 上验证通过；后半段 `codesign` / `hdiutil` / `lipo` 仍需在 runner 上真跑 |
| runner 上 `codesign` / `hdiutil` / `lipo` 的行为 | 已用 `Show runner environment` 步骤把版本与可用性打进日志 |
| runner 上是否有 Aqua 图形会话 | 有则真验「双击启动」，无则跳过并打印原因（两种都不会导致构建失败） |

> 说明：本会话**没有 GitHub Token**，无法读取 Actions 日志。若再次失败，请把失败步骤名称 + 完整日志发回来；
> 现在 `Could not resolve "../build/worker.cjs"` 这一类问题已由 `check:paths` 的不变量断言 + `check:mac-build` 预检兜住。

## macOS 本地构建（v1.0.1，代码与打包线已完成）

在**不改动任何智能体业务逻辑**的前提下，为已有 Windows 免安装版增加 macOS 支持。
做法是复用同一条 Node SEA 打包线，把平台差异收敛到三个地方。

### 交付形态

| 项 | Windows | macOS |
| --- | --- | --- |
| 程序 | `启动智能体.exe`（PE，GUI 子系统） | `AI教育智能体.app`（Mach-O，`Contents/MacOS/启动智能体`） |
| 用户流程 | 下载 zip → 解压 → 双击 exe | 下载 dmg → 打开 → 拖入「应用程序」→ 点击启动 |
| 交付物 | `AI教育智能体_v1.0.1_Windows.zip` | `AI教育智能体_v1.0.1_macOS_universal.dmg` |
| 构建入口 | `npm run build:win` / `build_release.bat` | `npm run build:mac` / `build_release_mac.command` |
| 数据 / 配置 / 日志 | `<发行目录>/{data,config,logs}` | `~/Library/Application Support/AI教育智能体/{data,config,logs}` |
| 架构 | x64 | universal（arm64 + x64，lipo 合成；失败自动降级为分架构 DMG） |
| 运行时 | Node SEA（用户无需装 Node / Python / conda） | 同左 |

### 代码改了什么（业务逻辑零改动）

- `packaging/src/paths.cjs`：改为跨平台；新增 `planRoots()`（纯计算，可跨平台验证）与
  `resolveRoots()`（真正建目录）；macOS 数据目录 = Application Support，资源仍从
  `Contents/Resources/app` 读。
- 新增 `packaging/src/net.cjs`（平台无关的健康探测/端口记忆，从 win.cjs 搬出，逻辑不变）、
  `mac.cjs`（osascript 对话框 + `/usr/bin/open`，绝对路径、不经 shell）、
  `generic.cjs`（其他平台兜底）、`platform.cjs`（按平台分发）。
- `launcher.cjs`：平台无关化；新增 `--port` / `--no-browser` / `--data-root` / `--app-root`
  （命令行优先于环境变量；普通用户双击不带参数，行为与之前一致）。
- `local-server.cjs`：`/api/local/info` **新增** `platform` 与 `relaunchHint` 字段（纯新增）。
- 前端：`AboutModal` 的「下次如何启动」文案按平台显示；`localApi.ts` 补类型。
- 新增 `packaging/scripts/lib/common.mjs`（两平台共用的构建步骤/命名/安全扫描/说明文本）、
  `build-mac.mjs`、`plist.mjs`、`macho.mjs`、`dmg.mjs`、`paths-check.mjs`、`mac-assets-check.mjs`。
- `icon.mjs` 增加 ICNS 生成（`ic07~ic14`，PNG 载荷）；Windows 用的 `renderIcon(size)` 默认参数
  未变，ICO 产物逐字节不变。
- 构建清理逻辑改为「只删本平台产物」，两个平台的交付物可以同时存在于 `release/`。

### 实测结论（真实执行，非推断）

- **Windows 零回归**：重构前后同一台机器同一份源码，`npm run build:win` 全绿 ——
  静态断言 18 → **19 项**（新增「SEA fuse 已翻开」）、发行包自检 22 → **25 项**
  （新增「接口上报平台」「单实例复用并自行退出」「单实例后第一个实例仍正常服务」），两项全过；
  发行目录结构、`使用说明.txt` 逐字、
  体积（exe 87.8 MB / 目录 89.6 MB / zip 34.6 MB / 71 个文件）**完全一致**。
  另外把打包后的发行版跑了一遍 `npm run check:ui`（**27/27 通过，零 console 错误**），
  并确认它真的走的是便携版本地模式（用例写入的会话确实出现在本机 SQLite 里）。
- `npm run check:paths` **33/33**：在 Windows 上把 macOS / Linux 的目录规则算了一遍并断言
  （应用包定位、Application Support、POSIX 形式、环境变量优先级、平台分发、
  mac.cjs 不经 shell / 不含 Windows 专属程序）。**该自检当场抓出一个真实 bug**
  （应用包资源根多上了一级目录），已修复。
- `npm run check:mac-assets` **23/23**：ICNS 容器结构与每段 PNG 的 CRC32、各尺寸、
  Info.plist 往返与 XML 转义、用**合成 thin/fat Mach-O** 验证解析器（架构 / `NODE_SEA` 段 /
  `__NODE_SEA_BLOB` 分节 / fuse），并交叉验证同一套 fuse 判定对 Windows PE 也成立。
- Windows 启动器新参数已被发行包自检在**真实的 SEA exe 上**用到并通过。

### 未实测（必须在 Mac 上补做，原因是工具链限制）

| 项目 | 原因 |
| --- | --- |
| 生成 `.app`（ad-hoc 签名）与 `.dmg` | 需要 `/usr/bin/codesign` 与 `/usr/bin/hdiutil`，只有 macOS 有 |
| macOS 上真实启动 + 完整接口矩阵 | 同上，没有 Mac 就无法运行 Mach-O |
| LaunchServices「双击」验收、无终端窗口、Gatekeeper 首次打开提示 | 需真实 macOS 桌面会话，需人工确认 |
| Intel（x64）SEA 可用性 | Node 官方 CI 对 macOS SEA 只覆盖 arm64；已用「逐架构真启动打接口」兜住 |

> 一句话：**macOS 侧代码与资源生成已全部实现，并做完了在 Windows 上能做的全部验证；
> 剩下必须在 Mac 上做的是「签名 + 出 dmg + 真机跑一遍」，`npm run build:mac` 会自动完成并自检。**
> 构建与验收步骤见 `packaging/MACOS.md`，完整测试方案见 `packaging/TESTING.md`。

## Windows 免安装便携版（v1.0.1，已完成并实测）

在原有「静态前端 + Worker 转发」项目之上，新增了一条**打包发布线**，把已经能运行的项目
封装成普通用户可用的 Windows 免安装软件。**没有改动任何智能体业务逻辑**
（`worker/src/**`、`src/prompts/**`、聊天 / 历史 / 存储逻辑全部原样保留）。

### v1.0.1 相对 v1.0.0 的四项收尾

| 项 | v1.0.0 | v1.0.1 |
| --- | --- | --- |
| 聊天历史 | 浏览器 IndexedDB（按 origin 隔离，换端口看起来「历史丢失」） | **本机 SQLite `data/app.db`**，与端口无关 |
| API Key | 浏览器 sessionStorage / localStorage | **本机 `config/settings.json`**，浏览器只拿到 `sk-****abcd` |
| EXE 图标 / 版本 | Node 默认图标，无版本资源 | 品牌图标（16~256 七种尺寸）+ Version Resource 1.0.1 |
| 旧数据 | —— | 首次启动自动把旧 IndexedDB 历史与旧 Key 迁移进本机，**不删除**旧数据 |

### 交付物

| 项 | 结果 |
| --- | --- |
| 构建入口 | `build_release.bat`（开发者双击即可，10 个步骤含自检） |
| 发行目录 | `release/AI教育智能体/`（`启动智能体.exe` + `resources/web` + `data` + `config` + `logs` + `使用说明.txt`） |
| 压缩包 | `release/AI教育智能体_v1.0.1_Windows.zip` |
| 运行时 | Node SEA（`node.exe` + 注入 blob），**用户无需安装 Node / Python / Conda** |
| 数据库 | Node 内置 `node:sqlite`（实测在 SEA 中可用），**无任何 native 依赖** |
| 控制台窗口 | 无（PE 子系统改为 GUI） |
| 监听地址 | 仅 `127.0.0.1`，8765 起自动探测，端口记在 `config/port.txt` |

### 实测结论（全部真实执行，非推断）

- `scripts/ui-check.mjs` **全量 27 项对发行版全通过**（含流式渲染、IndexedDB/SQLite 持久化、
  设置弹窗、删除/重命名、移动端、清除记录），零 console 错误、零异常网络请求；
- **跨端口验收**：在 8765 创建会话「端口切换测试」并保存 Key → 退出 → 用别的程序占用 8765 →
  再次启动自动切到 8766 → **历史与 Key 都还在**（这正是 v1.0.0 的核心缺陷，已修复）；
- **一次性迁移验收**：向浏览器写入旧 IndexedDB 历史与旧 API Key → 重置迁移标记 → 打开页面 →
  历史进入 SQLite、旧 Key 进入本机配置、**浏览器存储里的完整 Key 被清除**、IndexedDB 旧数据保留；
- 浏览器 `localStorage` 只剩 `preferences`，`sessionStorage` 为空，**没有任何完整 API Key**；
- EXE 版本资源与图标用 Windows API 独立复核：ProductName/FileDescription = AI教育智能体、
  FileVersion/ProductVersion = 1.0.1、OriginalFilename = 启动智能体.exe；
- 中文 + 空格路径、剥离 PATH（无 node/python/conda）、单实例、退出按钮、导出数据均正常；
- 构建脚本内置静态断言 + 发行包自检（在临时副本里真启动 EXE 打接口），全绿。
  加入 macOS 支持后计数为 **19 项静态断言 + 25 项发行包自检**（见上一节的对零回归对比）。

**尚未验证**：真实 DeepSeek API Key 的成功回答（本机无可用 Key）。
失败路径（假 Key → 401 → 中文提示 → 不泄露 Key）、流式渲染（桩 SSE）、
整条转发链路与落库均已验证。

## 产品形态：本地免安装应用（**不再需要 Cloudflare**）

Decision（2026-09 确认）: 本项目的交付形态确定为**本地免安装桌面应用**：
Windows 解压后双击 `启动智能体.exe`，macOS 打开 dmg 拖进「应用程序」后点击启动；
前后端都跑在用户自己的电脑上（本地服务只监听 `127.0.0.1`）。
**不需要 Cloudflare、不需要服务器、不需要域名、不需要任何云端账号。**

由此产生的文档与配置调整：

| 项 | 处理 |
| --- | --- |
| README 开头与「整体架构」 | 改写为「本地服务 + 浏览器界面」，不再以「一个公网链接」作为产品定位 |
| README 第 14 章（Cloudflare 从零部署教程，283 行） | 移到 `docs/legacy-cloudflare-deployment.md`，标注为**可选的历史方案**；README 原位只留一个简短小节 |
| README 第 15 章验收清单 | 修正 6 条与本地版不符的条目（公网链接 / IndexedDB / 云端数据库 / Key 持有方）；云端条目标为「可选」 |
| README 第 16 章排查 | 顶部加说明：16.9～16.13、16.18～16.19 属于云端可选方案专用 |
| README 第 7 章环境变量 | 明确本地版用 `.env.portable`（同源 `/api/chat`），`.env.production` 仅用于可选云端部署 |
| `.env.production` | 清掉已部署的 Worker 地址，改为空值 + 说明（仓库已公开，且该地址已不再使用） |
| 个人邮箱 | 从 README 与 `status.md` 中清除（仓库已公开） |

> `worker/` 目录**必须保留**：它不是「只有 Cloudflare 才需要的东西」，
> 本地服务用的就是同一份 `worker/src/index.ts`（构建时由 esbuild 打包进可执行文件），
> 校验 / CORS / SSRF 白名单 / 流式透传逻辑全在里面。删掉它本地版会直接失效。

## 总体进度

**14 / 14 阶段完成**；早期已完成过公网部署与验证（见下面的历史记录），
当前交付路径已改为本地免安装应用（Windows + macOS）。

## 历史记录（可选方案）：公网部署与验证

> 以下内容记录的是项目早期「纯静态前端 + 无状态转发 Worker」的公网部署过程与验证结果。
> **它不再是本项目的交付路径**，仅作为可选方案的历史记录保留；具体教程见
> [`docs/legacy-cloudflare-deployment.md`](../docs/legacy-cloudflare-deployment.md)。

### 当时的线上地址

| 项 | 地址 |
| --- | --- |
| 前端（公网入口） | **https://ai-edu-agent.pages.dev** |
| Worker | https://ai-edu-agent-api.edu-demo-2026.workers.dev |
| workers.dev 子域名 | `edu-demo-2026`（首选 `edu-demo` 已被占用） |
| Pages 项目 | `ai-edu-agent`（Production 分支 `main`） |

### 公网验证结果（当时实际打线上服务，非本地模拟）

| 验证 | 结果 |
| --- | --- |
| 前端可访问 | ✅ HTTP 200 |
| Worker `/api/health` | ✅ `{"ok":true,...,"allowedOrigins":8}` |
| Pages 域名预检（OPTIONS） | ✅ 204 + 正确 ACAO |
| 未授权来源预检 | ✅ 不返回 ACAO |
| 未授权来源 POST | ✅ 403 `origin_not_allowed` |
| 真实上游转发（假 Key，非流式） | ✅ 401 `invalid_api_key` + 中文提示，Key 脱敏为 `****0000` |
| 真实上游转发（假 Key，流式） | ✅ 同样的结构化 401（不是坏掉的流） |
| SSRF 防护 | ✅ 400 `base_url_not_allowed` |
| **Worker 全量自检（打线上）** | ✅ **38/38 通过** |
| **前端全量检查（无头浏览器打公网，走代理）** | ✅ **28/28 通过** |
| 本地回归（dev 5173 + 本地 Worker） | ✅ 28/28 通过 |
| `npm run check:sse` | ✅ 30/30 通过 |

## 本轮部署的实际过程

1. `npx wrangler login`（用户完成 OAuth 授权）→ `whoami` 确认账号与权限（workers/pages write）
2. **卡点一**：账号没有 workers.dev 子域名 → 用脚本调 API 注册（`edu-demo` 被占用 → `edu-demo-2026`）
3. `wrangler deploy` → Worker 上线
4. **卡点二**：新子域名 DNS 传播中，本机解析一度返回错误 IP；等待约 1 分钟后正常
5. 把 Worker 地址写入 `.env.production` → 重新构建（产物已确认含真实地址、不含占位符）
6. 创建 Pages 项目并部署
7. **卡点三**：本地 git 分支是 `master`，直接部署会进 Preview → 用 `--branch main` 部署到生产
8. 更新 `ALLOWED_ORIGINS`（Pages 正式域名 + 通配符 + 本地端口）→ 重新部署 Worker
9. **卡点四**：`[vars]` 边缘生效有约半分钟延迟，`allowedOrigins` 从 6 变 8 需要等待
10. 公网协议层验证 + 线上 Worker 自检 38/38
11. **卡点五（真实缺陷）**：公网跑前端全量检查时，`刷新后块级公式丢失` 失败 ——
    阶段 13 引入的 KaTeX 懒加载在慢网络下会让首屏先显示原始 `$$...$$`。
    已通过「浏览器空闲时预取公式分块」（`prefetchMathChunk`）修复，首屏体积不受影响；
    同时把该用例改为等待公式渲染到位再断言（区分「正在下载」与「真的丢失」）。
12. 重新部署 Pages → 公网前端检查 **28/28 通过**

## ⚠️ 关于「国内打不开 pages.dev / workers.dev」—— 已由本地版解决

**`workers.dev` 与 `pages.dev` 在中国大陆访问不稳定甚至被阻断。**
本机实测：直连失败，必须走代理；走代理全部正常。这意味着**目标用户（大陆教师/学生）
可能打不开那个链接**，与「打开就能用」的产品目标冲突。

**现状**：这已经不再是问题 —— 交付方式改为**本地免安装应用**后，程序完全跑在用户自己电脑上，
不经过任何境外域名，也就没有可访问性问题。（这条限制只对可选的公网方案仍然成立；
若将来仍要提供公网链接，原来的三条应对方案见下：）

1. **绑定自定义域名**（推荐先试）—— 可访问性通常明显好于 `pages.dev`；
2. 换国内可直连的静态托管（会偏离需求文档指定的 Cloudflare）；
3. 只面向有代理的用户。

## 尚未验证（如实记录）

| 项目 | 原因 |
| --- | --- |
| 真实 Key 的完整流式输出 | 代理无 DeepSeek Key。用户可用 `npm run check:stream` 或直接在界面里问一句 |
| macOS 云端构建的实际运行结果 | 需 GitHub Actions 跑一次；本机是 Windows，无法本地预跑 codesign / hdiutil |
| 真机 iOS / Android | 需要实体设备；本项目现在是桌面应用，移动端浏览器不再是交付面 |
| 真机 Mac 上的首次打开（Gatekeeper）与双击启动 | 需要带桌面的 Mac 人工确认；CI 上无 Aqua 会话时会显式跳过该项 |

## 环境注意事项

- 本机有**本地代理** `http://127.0.0.1:7897`（环境变量 `HTTP_PROXY` 等已设置）。
  - `wrangler` 会提示「Proxy environment variables detected」，属正常（仅在跑可选云端方案时用到）。
  - 无头浏览器验证公网链接时需 `CHROME_PROXY=http://127.0.0.1:7897`（已给
    `scripts/ui-check.mjs` 加了该支持）。
- 本地 git 分支为 `master`；**推送到 GitHub 仓库 `maricle-12/mac_agent` 时用的是 `main`**。
- 临时脚本 `cf-subdomain.mjs`（注册 workers.dev 子域名用）放在系统临时目录，不在仓库内；
  它只打印 API 返回结果，不打印 Token。

## 后续可选优化

1. `react-markdown` 也可按需加载（约再省 40 kB gzip，代价是首屏渲染消息时闪一下）；
2. 学科工具 / 教学资源入口目前是「即将支持」占位；
3. 可扩展 Agent：`lessonPlan` / `examGenerator` / `errorAnalysis` / `research`
   （在 `src/prompts/index.ts` 的 `basePrompts` 中扩展）；
4. 文件上传 / 知识库 / RAG（第一版明确不做）；
5. 若要额外提供公网链接：见 `docs/legacy-cloudflare-deployment.md`（可选，非必需）。
