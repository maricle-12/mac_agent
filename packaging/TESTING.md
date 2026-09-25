# Windows / macOS 发行版测试方案

本文件给出**发行包**（不是源码树）的验收方案。原则只有一条：

> 被测对象必须是 release 目录里那个真东西 —— 用户拿到手的 zip / dmg 里的程序。

分三层：

| 层 | 谁执行 | 覆盖 |
| --- | --- | --- |
| A. 构建期自动自检 | 构建脚本，每次构建必跑 | 结构、安全、接口、持久化、单实例、双击启动 |
| B. 人工验收清单 | 发布前由人按步骤点一遍 | 真实 Key 对话、浏览器体验、权限与安装 |
| C. 回归检查 | 改代码后 | 前端全量 UI 检查、SSE 解析、Worker 自检 |

---

## 0. 先对齐一件事：本产品没有「文件上传」

需求里提到「文件上传」测试项。本项目**第一版明确不做文件上传 / 知识库 / RAG**，
界面上也没有上传入口，因此该项在 Windows 与 macOS 上都不适用（N/A），
不存在「Windows 有、Mac 没有」的功能差异。下面清单里保留该条目并标注 N/A，
以免下次验收时被误当成漏测。

对外部输入的测试以「**API Key 与模型请求**」为主：Key 的保存、脱敏、校验失败路径、
真实对话成功路径、流式输出。

---

## A. 构建期自动自检（每次构建必跑）

### A1. 与平台无关的静态自检（Windows 上即可跑完）

```bash
npm run check:paths        # 50 项：跨平台目录规则 + 平台分发 + 构建期路径不变量 + 架构名归一化
npm run check:mac-assets   # 37 项：ICNS 容器/PNG CRC、Info.plist 往返、Mach-O 解析器与架构映射（合成样本）
npm run check:mac-build    # macOS 构建线的「打包前半段」：Worker 打包 → 启动器打包 → 图标 → SEA blob
npm run check:sse          # 30 项：SSE 解析器（含逐字节与随机切分）
```

`check:mac-build` 是 `build-mac.mjs --preflight`：只跑**与操作系统无关**的那几步，然后停下。
它的存在是因为 `build:mac` 在非 macOS 上会被平台守卫整体拦住，导致前半段的错误
（本项目真实发生过：Worker 产物被写到了别的目录，esbuild 报
`Could not resolve "../build/worker.cjs"`）在开发机上永远跑不到、只能等 CI 暴露。

`check:paths` 会把 **darwin / linux 的目录规则在 Windows 上算一遍并断言**，包括：

- `AI教育智能体.app/Contents/MacOS/启动智能体` → 资源根 = `Contents/Resources/app`
- 数据目录 = `~/Library/Application Support/AI教育智能体`（**即使应用包内可写也不写进包内**）
- 路径全部为 POSIX 形式（无盘符、无反斜杠）
- `AI_EDU_DATA_ROOT` / `AI_EDU_APP_ROOT` 的优先级在两个平台上一致
- `platform.cjs` 把「打开浏览器 / 弹对话框」分发到了当前平台的正确实现
- `mac.cjs` 只用绝对路径调 `/usr/bin/open`、`/usr/bin/osascript`，不经 shell，不含 Windows 专属程序
- 运行期源码里没有 `H:\agent` / `C:\Users\...` 这类开发机路径

`check:mac-assets` 用**合成的 thin / fat Mach-O** 验证解析器本身没写错
（能认出 arm64 / x86_64 / universal、`NODE_SEA` 段里的 `__NODE_SEA_BLOB` 分节、fuse 是否翻开），
这样 Mac 上的断言不会「自己先错」。

### A2. Windows 构建内置（`npm run build:win`）

- **19 项静态断言**：资源齐全、GUI 子系统（无控制台窗口）、SEA blob 已注入且 fuse 已翻开、
  EXE 版本资源与产品图标、版本号四处一致、前端为同源 `/api/chat`、前端不含 `workers.dev`、
  启动器不含开发机绝对路径、无真实 Key、无 `.env` / `node_modules`、发行包处于首次启动状态。
- **25 项发行包自检**：把发行目录复制到临时目录后**真启动 exe**，然后：
  首页与 JS/CSS/图标资源、`/api/local/info`、`/api/local/settings` 不返回完整 Key、
  会话写入/读回（含中文）/删除、导出数据不含 Key、跨站 Origin 被 403 拒绝、
  未配置 Key 时 `/api/chat` 返回可读中文提示、数据库/配置/日志确实落盘、
  日志无完整 Key、**单实例（同端口再起一个进程会复用已有服务并自行退出，且第一个实例仍正常服务）**、
  `/api/local/shutdown` 能真正关掉服务。
- 结束后断言 `release/AI教育智能体/data/app.db` **不存在**（自检不得污染发行包）。

### A3. macOS 构建内置（`npm run build:mac`）

静态断言（每个架构各一份，通用包为 1 组）：

- 应用包结构、`Info.plist` 通过 **`plutil -lint`**（用系统自己的校验器，不用自写解析背书）
- `CFBundleName` / `CFBundleExecutable`（且文件真实存在）/ `CFBundleIdentifier` /
  `CFBundleShortVersionString` / `CFBundleVersion` / `CFBundleIconFile` / `LSMinimumSystemVersion` / `LSUIElement`
- 主可执行文件权限为 `0755`
- **Mach-O 架构**与目标一致（arm64 / x86_64 / 两者）
- **SEA blob 已注入** `NODE_SEA` / `__NODE_SEA_BLOB`，**fuse 已从 `:0` 翻成 `:1`**
- `codesign --verify --strict`（主程序）与 `codesign --verify --deep --strict`（整包）
- 前端资源与使用说明就位、包内为首次启动状态、不含 `.env` / `node_modules` / 开发机路径
- 安全扫描不含真实 Key 与 `workers.dev`

发行包自检（**每个架构都真启动一次**，两遍）：

1. 直接启动 `Contents/MacOS/启动智能体`（`--port` / `--no-browser` / `--data-root` 指向临时副本）
   → 打完整接口矩阵（同 A2 的 25 项，另加「接口上报平台 = darwin」与「日志标明 平台=macOS」）。
2. 用 `/usr/bin/open <副本>/AI教育智能体.app` 走 **LaunchServices 启动**（与用户双击同一条路径，独立端口）
   → 验证 `Info.plist` / `CFBundleExecutable` / 代码签名 / 启动真的成立，
   并且它的数据确实写进了指定的临时目录。
3. `hdiutil verify` 校验镜像 → 挂载 → 确认卷根有 `.app` 与 `Applications` 符号链接 →
   挂载状态下复验 `codesign --verify --deep --strict` → 卸载。
4. 记录 **Gatekeeper（`spctl -a`）判定结果**，如实打印，不作为失败条件（未公证必然被拒）。

---

### A4. GitHub Actions 自动构建（`macos-latest`，无需本地 Mac）

`.github/workflows/build-mac.yml` 把 A1～A3 全部搬到云端执行：

1. `npm ci`（根目录 + `packaging/`，两处 lockfile 都参与缓存）
2. `npm run check:paths` + `npm run check:mac-assets`（**先做跨平台自检，早失败**）
3. `npm run build:mac`（含 A3 的全部静态断言与发行包自检）
4. 校验 `release/*.dmg` 确实存在
5. 上传 artifact `AI教育智能体-macOS-build`（`if: always()`，构建后段失败也保住产物）
6. 失败时额外打印目录结构与 `app.log`

两点与「本地 Mac 构建」不同的地方，已在工作流与构建脚本里显式处理：

- **`upload-artifact` 不保留文件权限**，所以上传的是 `.dmg` 与 `ditto` 生成的 `.app.zip`（权限与签名封在归档内），
  **不是** 裸 `.app` 目录；构建脚本还会把 zip 解压回来复验 `codesign --verify --deep --strict`。
- **`LaunchServices`「双击」验收需要图形会话**：脚本先查 `launchctl managername`，
  非 `Aqua` 时**明确跳过并打印原因**（不误报为失败）；其余（真启动二进制 + 完整接口矩阵 + 签名复验）照常执行。

## B. Windows 人工验收清单

在一台**没有装 Node / Python / conda** 的 Windows 电脑上做（关键前提，否则验不出「免安装」）。

| # | 项目 | 步骤 | 判定标准 |
| --- | --- | --- | --- |
| 1 | 解压 | 解压 `AI教育智能体_v1.0.1_Windows.zip` | 解压后**第一层就见到** `启动智能体.exe`，不是套了好几层目录 |
| 2 | 启动 | 双击 `启动智能体.exe` | **不出现黑色命令行窗口**；几秒内默认浏览器自动打开界面 |
| 3 | 免环境 | 同上，且该机无 Node/Python | 正常启动（EXE 自带运行时） |
| 4 | 中文/空格路径 | 把整个文件夹放到 `D:\我的 软件\AI教育智能体\` 再双击 | 正常启动 |
| 5 | 单实例 | 保持运行，再双击一次 exe | 不出现第二个服务；浏览器直接打开已有实例的页面 |
| 6 | 首次体验 | 首次进入 | 显示欢迎引导 + 空状态，**没有预置的假历史** |
| 7 | API Key | 设置 → 填自己的 DeepSeek Key → 保存 | 提示保存成功（服务端先用真实请求验证过）；弹窗只显示 `sk-****abcd` |
| 8 | 坏 Key | 填一个假 Key → 保存 | 被拒绝保存并给出上游的中文提示；**不会存下坏 Key** |
| 9 | AI 对话 | 发送一句需要思考的问题 | 有**逐字流式**输出，不是一次性整段出现 |
| 10 | 停止生成 | 流式中途点「停止生成」 | 已生成内容保留 + 友好提示；上游请求被中断 |
| 11 | 中断保留 | 流式中途断网 | 已生成内容保留 + 友好提示，不是整条变红 |
| 12 | 文件上传 | —— | **N/A**：本产品无文件上传功能 |
| 13 | 数据保存 | 关掉程序（网页「关于」→ 退出智能体）→ 重新双击 exe | 刚发的对话仍在 |
| 14 | 历史记录 | 新建 / 重命名 / 删除会话 | 操作即时生效；删除当前会话后自动选中相邻会话 |
| 15 | 历史持久化 | 重启电脑后再打开 | 历史与 Key 都还在 |
| 16 | 跨端口不丢数据 | 占用 8765（例如用别的程序监听）后重新启动 | 自动换到 8766；**历史与 Key 仍在**（数据在 SQLite，与端口无关） |
| 17 | Key 不进浏览器 | 开发者工具 → Application | `localStorage` 只剩 `preferences`；`sessionStorage` 为空；**任何位置都没有完整 Key** |
| 18 | 导出数据 | 关于 → 导出本地数据 | 得到 JSON 文件，含会话内容、`"includesApiKey": false` |
| 19 | 跨站防护 | 用另一个网站的页面请求 `/api/local/settings` | 403 `origin_not_allowed` |
| 20 | 数据即文件 | 打开 `data\app.db` 所在目录 | 存在单个 `app.db`，可直接复制备份（无 `-wal` / `-shm` 附属文件） |
| 21 | 只读目录 | 把文件夹放进 `C:\Program Files\` 下再双击 | 仍能启动；数据自动落到 `%LOCALAPPDATA%\AI教育智能体`，日志里有回退说明 |
| 22 | 失败不静默 | 临时改坏 `resources\web\index.html` 的路径后启动 | 弹出原生错误对话框，并给出 `logs\app.log` 的完整路径 |
| 23 | 退出 | 关于 → 退出智能体 | 本地服务关闭；任务管理器中进程消失 |
| 24 | 杀软 | 用 Windows Defender 全盘扫描发行目录 | 无拦截；程序不是加壳/混淆的 |

---

## C. macOS 人工验收清单

在一台**没有装 Node / Python** 的 Mac 上做。建议 Apple 芯片与 Intel 各一台（或至少用对应 dmg 各跑一次）。

| # | 项目 | 步骤 | 判定标准 |
| --- | --- | --- | --- |
| 1 | 打开 dmg | 双击 `..._macOS_universal.dmg` | 正常挂载；卷里能看到 `AI教育智能体.app` + `Applications` 快捷方式 + `使用说明.txt` |
| 2 | 安装 | 把 `AI教育智能体` 拖入「应用程序」 | 拷贝完成；应用图标是品牌图标（不是默认白图标） |
| 3 | 卸载 dmg | 在访达侧边栏点推出 | 正常推出 |
| 4 | 首次打开（权限） | 双击应用 | 出现「无法验证开发者」提示（未公证，属预期）；按「Control + 点击 → 打开」后可正常启动 |
| 5 | 启动 | 再次双击应用 | **不出现终端窗口**；默认浏览器自动打开界面；Dock 无残留图标（后台型应用） |
| 6 | 免环境 | 该 Mac 无 Node/Python | 正常启动（运行时已打进 `.app`） |
| 7 | 中文/空格路径 | 把应用放到 `~/我的 应用/` 下再打开 | 正常启动 |
| 8 | 单实例 | 保持运行，再次双击应用 | 不重复起服务；浏览器打开已有实例页面 |
| 9 | 架构 | Apple 芯片用 universal/arm64；Intel 用 universal/x64 | 均能启动；arm64 版无法在 Intel 机器上运行（属预期） |
| 10 | 数据位置 | 启动后打开 `~/Library/Application Support/AI教育智能体/` | 存在 `data/app.db`、`config/settings.json`、`logs/app.log`；**应用包内部没有写入任何数据** |
| 11 | 应用包完整性 | 启动后执行 `codesign --verify --deep --strict "/Applications/AI教育智能体.app"` | 通过（说明程序没有偷偷改写自己的包，签名未被破坏） |
| 12 | API Key | 设置 → 填 Key → 保存 | 保存成功；只显示 `sk-****abcd` |
| 13 | API 请求（成功） | 发送一句话 | **逐字流式**输出；真实打到 `api.deepseek.com` |
| 14 | API 请求（失败） | 填假 Key 后发送 | 结构化 401 + 中文提示；**提示里不含完整 Key** |
| 15 | UI 显示 | 查看中文、Markdown 表格、代码块、`$$` 块级公式 | 全部正常渲染；公式独立成行；字体与 Windows 一致 |
| 16 | 数据保存/历史 | 退出（关于 → 退出智能体）后重新打开 | 历史与 Key 都在 |
| 17 | 文件读写权限 | 检查 `~/Library/Application Support/AI教育智能体/logs/app.log` 可读 | 有启动日志；**没有被 TCC 权限拦截**的报错 |
| 18 | 从 dmg 直接运行 | 不拖入「应用程序」，直接在挂载卷里双击应用 | 能运行（App Translocation）；数据仍写在 Application Support，不是临时只读路径 |
| 19 | 文件上传 | —— | **N/A**：本产品无文件上传功能 |
| 20 | 退出 | 关于 → 退出智能体 | 服务关闭；`ps aux \| grep 启动智能体` 无残留 |
| 21 | 关机/注销 | 应用运行时注销当前用户 | 收到 SIGTERM 后干净退出，数据库无损坏（再次启动历史完整） |
| 22 | 升级覆盖 | 用新版本 dmg 覆盖「应用程序」里的应用 | 聊天记录与 Key 保留（数据不在应用包里） |

---

## D. 两平台一致性对照（差异必须是「有意为之」）

| 行为 | Windows | macOS | 是否一致 |
| --- | --- | --- | --- |
| 双击启动、不弹终端/控制台 | ✅ | ✅ | 一致 |
| 自动打开默认浏览器 | ✅ | ✅ | 一致 |
| 单实例（第二次启动复用已有实例） | ✅ | ✅ | 一致 |
| 端口自动顺延 8765+ 并记忆 | ✅ | ✅ | 一致 |
| 聊天历史 SQLite（与端口无关） | `data/app.db` | `~/Library/Application Support/…/data/app.db` | 存储位置按各系统约定，**行为一致** |
| API Key 只在本机、浏览器只见脱敏值 | ✅ | ✅ | 一致 |
| 退出方式 | 网页「关于」→ 退出智能体 | 同 | 一致 |
| 日志 | `<程序目录>/logs/app.log` | `~/Library/Application Support/…/logs/app.log` | 一致 |
| 无 Dock/托盘/菜单栏图标 | ✅（GUI 子系统，无窗口） | ✅（`LSUIElement`） | 一致 |
| 首次使用的安全拦截 | SmartScreen 可能提示（未签名） | Gatekeeper「无法验证开发者」（未公证） | 同类问题，处理方式不同（见各自说明） |
| 数据便携（拷走文件夹即带走数据） | ✅ 数据在程序目录旁 | ❌ 数据在 Application Support（**有意**：写入应用包会破坏签名，且从 dmg 直接运行会丢数据） | 有意不一致 |

---

## E. 如实声明：已实测 / 未实测

### 已实测（真实执行，非推断）

- Windows 发行包完整构建通过：**19/19 静态断言 + 25/25 发行包自检**（本机真启动 exe 打接口，
  含单实例复用与自行退出）。
- `npm run check:paths` **33/33**、`npm run check:mac-assets` **23/23**（在 Windows 上执行，
  覆盖 macOS 目录规则、ICNS、Info.plist、Mach-O 解析器）。
- 重构前后**同一台机器、同一份源码**对比：发行目录结构一致、`使用说明.txt` 逐字一致、
  exe 87.8 MB / 发行目录 89.6 MB / zip 34.6 MB 71 个文件 —— 完全一致。
- Windows 启动器新增的 `--port` / `--no-browser` / `--data-root` 参数已被发行包自检实际使用并通过
  （即：在 SEA 打包后的真实 exe 上验证过参数解析与路径生效）。

### 未实测（必须在 Mac 上补做）

| 项目 | 原因 |
| --- | --- |
| macOS `.app` / `.dmg` 的生成 | 需要 `/usr/bin/codesign`（ad-hoc 重新签名）与 `/usr/bin/hdiutil`（DMG），**只有 macOS 有** |
| macOS 上的真实启动与接口矩阵 | 同上：没有 Mac 就无法运行 arm64 / x64 的 Mach-O |
| LaunchServices「双击」验收 | 同上 |
| 无终端窗口、Gatekeeper 首次打开提示 | 需要真实 macOS 桌面会话（无法用截图自动化替代，需人工确认） |
| Intel（x64）SEA 的可用性 | Node 官方 CI 对 macOS SEA **只覆盖 arm64**，x64 未被上游测试；已用「每个架构都真启动 + 打接口」兜住 |
| 真实 DeepSeek Key 的成功回答 | 与平台无关的历史遗留项（构建机没有可用 Key） |

### 结论

Windows 与 macOS 共享同一份前端、同一份 Worker、同一份启动器逻辑；差异被收敛到
`packaging/src/paths.cjs`（目录）、`packaging/src/platform.cjs` + `win.cjs` / `mac.cjs`（系统集成）、
以及两个构建脚本的「可执行文件生成 + 交付格式」部分。

macOS 侧的代码与资源生成**已经全部实现并在 Windows 上做了可做的验证**；
剩下必须在 Mac 上完成的是「签名 + 出 dmg + 真机跑一遍」，这两条已在
[`MACOS.md`](./MACOS.md) 中写明为客观工具链限制，而不是本项目的实现取舍。
