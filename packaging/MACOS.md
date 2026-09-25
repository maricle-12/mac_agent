# macOS 版本构建指南

本文件说明如何把本项目打包成 **macOS 用户下载后即可使用**的 `.dmg`（内含 `AI教育智能体.app`），
以及为什么其中最后几步必须在 Mac 上完成。

> 最终用户不需要安装 Node / Python / npm / conda —— 运行时（Node）已经打包进 `.app` 内部。
> **构建机**需要 Node（仅构建时使用）。

---

## 1. 交付形态对照

| | Windows | macOS |
| --- | --- | --- |
| 程序形态 | `启动智能体.exe`（单文件，内置 Node 运行时） | `AI教育智能体.app`（应用包，内含 `Contents/MacOS/启动智能体`，同样内置 Node 运行时） |
| 交付格式 | `.zip`（解压后双击 exe） | `.dmg`（打开后拖入「应用程序」） |
| 用户操作 | 下载 → 解压 → 双击 `启动智能体.exe` | 下载 → 打开 dmg → 拖到「应用程序」→ 点击启动 |
| 是否弹终端 / 控制台 | 否（PE 子系统改为 GUI） | 否（LaunchServices 启动 `.app`，不会打开终端） |
| 聊天数据 | `<程序目录>/data/app.db` | `~/Library/Application Support/AI教育智能体/data/app.db` |
| API Key | `<程序目录>/config/settings.json` | `~/Library/Application Support/AI教育智能体/config/settings.json` |
| 日志 | `<程序目录>/logs/app.log` | `~/Library/Application Support/AI教育智能体/logs/app.log` |
| 关闭方式 | 网页「关于」→ 退出智能体 | 网页「关于」→ 退出智能体 |
| 构建命令 | `npm run build:win` 或双击 `build_release.bat` | `npm run build:mac` 或双击 `build_release_mac.command` |

功能完全一致：同一份前端、同一份 Worker 转发代码、同一份启动器流程，只有「可执行文件如何生成」
和「数据放在哪个标准目录」按操作系统不同而不同。

---

## 2. 为什么最后几步必须在 Mac 上做

Node SEA（single executable application）把启动器脚本注入到一份 Node 官方二进制里。
这个操作会**破坏该二进制原有的代码签名**，而：

- **Apple 芯片（arm64）强制要求所有二进制都有有效签名**，签名失效的进程会被内核直接杀掉；
- `.dmg` 是 Apple 的 UDIF 磁盘映像格式，只有 macOS 自带的 `/usr/bin/hdiutil` 能生成正式可挂载的压缩镜像。

因此这两步（ad-hoc 重新签名、生成 dmg）无法在 Windows 上完成 —— 不是本项目的实现选择，
而是操作系统工具链的客观限制。相应地，**其它步骤都已经做成平台无关并能提前验证**：

| 步骤 | 能否在 Windows 上完成 | 验证方式 |
| --- | --- | --- |
| 前端构建（vite `--mode portable`） | ✅ | 与 Windows 版共用同一份产物 |
| Worker 打包（esbuild） | ✅ | 同上 |
| 启动器打包（esbuild + 注入版本号） | ✅ | 同上 |
| `.icns` 图标生成 | ✅ | `npm run check:mac-assets`（校验 ICNS 容器、PNG 载荷 CRC32、各尺寸） |
| `Info.plist` 生成 | ✅ | `npm run check:mac-assets`（往返解析、XML 转义、`<true/>` 形式） |
| Mach-O 断言逻辑 | ✅ | `npm run check:mac-assets`（用**合成**的 thin/fat Mach-O 验证解析器） |
| macOS 目录规则（应用包定位 / Application Support） | ✅ | `npm run check:paths`（把 darwin 平台算一遍并断言） |
| SEA blob 生成 | ✅ | 平台无关，同一份 blob 注入不同架构 |
| 去掉原签名 + 注入 + ad-hoc 签名 | ❌ 必须 macOS | 构建脚本内 `codesign --verify --strict` 断言 |
| 组装 `.app` 并整体签名 | ❌ 必须 macOS | `codesign --verify --deep --strict` 断言 |
| 生成 `.dmg` | ❌ 必须 macOS | `hdiutil verify` + 挂载后复验签名 |
| 「双击启动」验收 | ❌ 必须 macOS | 用 `/usr/bin/open` 走 LaunchServices 真启动一次 |

---

## 3. 构建机准备

1. 安装 Node.js 22 或以上（<https://nodejs.org/>）。
   - 本项目使用 Node 内置的 `node:sqlite`，Node 22.5+ 才有；构建脚本会检查主版本号。
2. 确认系统自带命令可用（macOS 默认都有，通常不需要额外安装 Xcode）：

   ```bash
   /usr/bin/codesign --version
   /usr/bin/hdiutil help
   /usr/bin/plutil -help
   /usr/bin/lipo -info /usr/bin/lipo     # 只有构建通用包时才需要
   ```

3. 首次构建时脚本会自动执行 `npm install`（在 `packaging/` 下装 esbuild / postject / resedit）。

> 通用包（universal）需要把 arm64 与 x64 两份 Node 官方二进制都取到。
> 若构建机是 Apple 芯片，arm64 那份直接复用本机 Node，x64 那份会从 nodejs.org 下载并校验 SHA-256。
> 国内网络可改用镜像：`npm run build:mac:cn`。
> 完全离线时可用 `--node-binary=/path/to/node` 指定已准备好的对应版本二进制。

---

## 4. 构建

在项目根目录（`demo/`）执行：

```bash
# 通用包（Intel + Apple 芯片，一个 .dmg）
npm run build:mac

# 只出 Apple 芯片版
npm run build:mac:arm64

# 只出 Intel 版
npm run build:mac:x64

# 国内镜像下载 Node 运行时
npm run build:mac:cn
```

或者直接**双击** `build_release_mac.command`（与 Windows 的 `build_release.bat` 对称）。

脚本会依次完成 10 个步骤，并在末尾打印交付物路径。任一静态断言或发行包自检失败都会以非零退出码结束。

### 产物

```
release/
├─ AI教育智能体_v1.0.1_macOS_universal.dmg      ← 交付给用户
└─ （分开构建时：..._macOS_arm64.dmg / ..._macOS_x64.dmg）

packaging/build-mac/                            ← 构建中间产物（已 gitignore）
├─ node-cache/                                  # 缓存的 Node 官方二进制（跨构建复用）
├─ app/universal/AI教育智能体.app                # 已签名的应用包，可直接拖到 /Applications 本地试
└─ dmg-stage/universal/                         # DMG 卷内容：.app + Applications 符号链接 + 使用说明.txt
```

---

## 5. 在 GitHub Actions 上构建（没有本地 Mac 时的推荐方式）

前面说过「签名 + 出 dmg」必须在 macOS 上做 —— 但**不一定需要你自己的 Mac**。
仓库里已经配好 GitHub Actions，用 GitHub 提供的 macOS Runner 在云端完成全部 10 个步骤：

```
Windows 开发机                      GitHub Actions (macos-latest, Apple 芯片)
──────────────                      ────────────────────────────────────────
git push  ─────────────────────►    checkout → setup-node 22 → npm ci
                                    → npm run build:mac
                                       ├─ Node SEA 注入（保持原架构不变）
                                       ├─ codesign ad-hoc 签名（不接 Apple 账号）
                                       ├─ 组装 AI教育智能体.app
                                       ├─ 逐架构真启动 + 打接口自检
                                       └─ hdiutil 出 dmg + 挂载验收
                                    ◄──── Artifacts: AI教育智能体-macOS-build
```

### 使用方法

1. 把代码推到 `main` 分支（或手动触发）。
2. 打开仓库页面 → **Actions** → 左侧选 **Build macOS** → 右侧 **Run workflow** → 选 `main` → **Run workflow**。
3. 等 5～10 分钟（首次会下载 Node 官方 darwin 运行时，约 50 MB）。
4. 构建结束后，在**这次运行的结果页**最下方 **Artifacts** 区域下载 `AI教育智能体-macOS-build`，
   解压得到：
   - `AI教育智能体_v1.0.1_macOS_universal.dmg` ← 给用户安装用
   - `AI教育智能体_v1.0.1_macOS_universal.app.zip` ← 应用包 zip（解压即得 `.app`）

工作流文件：`.github/workflows/build-mac.yml`（触发条件：`workflow_dispatch` + push 到 `main`）。

### 这个流程的几条约定

| 项 | 说明 |
| --- | --- |
| Runner | `macos-latest`（当前是 macOS 26 / Apple 芯片）。arm64 复用 runner 自带 Node，x64 从 nodejs.org 下载并校验 SHA-256，再 `lipo` 合成通用包 |
| 架构 | 默认 `universal`（Intel + Apple 芯片都能用）；`lipo` 失败会自动降级为分架构 DMG |
| 签名 | 只用 `codesign --force --sign -` 做 **ad-hoc 签名**；**不接入 Apple Developer 账号**，也不做公证 |
| 依赖 | `npm ci`（根目录 + `packaging/`）分别安装；两处 lockfile 都参与 npm 缓存 |
| 产物保留 | 30 天（`retention-days: 30`）。GitHub 的 artifact 是临时存储，长期分发请转存 Release 或自己的存储 |
| 失败时 | 上传步骤用 `if: always()`，所以**即使后段校验失败，已经生成的 dmg 仍然可以下载**；另有一步会打印目录结构与 `app.log` |
| 权限 | 只需要 `contents: read`，不需要任何 Secret |

### GitHub Runner 上的两点客观限制（不影响交付物）

1. **文件权限不随 artifact 传递**：`upload-artifact` 会丢弃文件的权限位，所以**不能**直接上传 `.app` 目录。
   本项目上传的是 `hdiutil` 生成的 `.dmg` 与 `ditto` 生成的 `.app.zip` —— 权限与签名都封在归档内部，
   用户解压/挂载后完全正常。（这也是为什么要额外产出一个 zip，而不仅仅是 dmg。）
2. **「双击启动」验收依赖图形会话**：验证用 `/usr/bin/open`（LaunchServices）拉起 `.app`，
   而 `open` 需要登录用户的 Aqua 会话。构建脚本会先用 `launchctl managername` 判断：
   - 有 Aqua 会话 → 真的拉起一次并断言接口可用；
   - 没有 → **明确跳过并打印原因**（而不是误报成构建失败）。

   无论哪种情况，脚本都会做「直接启动可执行文件 + 打完整接口矩阵 + 校验 `codesign --verify --deep --strict`」，
   所以「应用能不能跑、签名有没有效」在 CI 上是被真实验证过的。

### 如果你想连 Windows 版一起自动构建

本次只加了 macOS 工作流（按需求）。要顺带构建 Windows 版，在同一仓库再加一个
`runs-on: windows-latest` 的 job，执行 `npm run build:win` 并把 `release/*_Windows.zip` 一起上传即可 ——
`check:paths` / `build-release.mjs` 都已经能在 Windows runner 上跑。

## 6. 用户安装流程

1. 双击下载的 `.dmg`。
2. 把 `AI教育智能体` 拖到右侧的「应用程序」文件夹。
3. 在「启动台」或「应用程序」里点击 `AI教育智能体`。
4. 浏览器自动打开智能体界面（不出现终端窗口，也不占用 Dock）。
5. 首次使用时在网页右上角「设置」里填写自己的 DeepSeek API Key。

### 首次打开被系统拦住（重要，必须告知用户）

本项目**没有 Apple 开发者证书**，因此无法做公证（notarize）。用户第一次打开时 macOS 会提示
「无法验证开发者」或「无法检查其是否包含恶意软件」。解决办法（应用内 `使用说明.txt` 也写了）：

- **推荐**：在「应用程序」里按住 `Control` 点击应用 → 选择「打开」→ 弹窗里再点一次「打开」。
- 或者：先双击一次，然后到「系统设置 → 隐私与安全性」点击「仍要打开」。

只有在提示「已损坏，无法打开」时（极少见，通常是下载中断导致签名损坏）才需要：

```bash
xattr -dr com.apple.quarantine /Applications/AI教育智能体.app
```

这是未签名 / 未公证软件的固有代价。要彻底消除，需要 Apple Developer Program 会员资格
（99 美元/年）并使用 Developer ID 证书签名 + 公证，那是另一项独立工作，不影响本项目的功能。

### 应用包的几个有意选择

| 选择 | 原因 |
| --- | --- |
| `LSUIElement = true`（后台型应用，不占 Dock、无菜单栏） | 与 Windows 版「无窗口、无托盘、只开浏览器」的体验一致；也避免非 Cocoa 进程收不到 Apple 事件导致 `Cmd+Q` 无效 |
| 数据写在 `~/Library/Application Support/AI教育智能体` | ① 写入应用包内部会破坏代码签名；② macOS 的既定约定；③ 用户直接从 DMG 运行时会被 App Translocation 挂到只读随机路径，写在包内的数据每次启动都会「消失」 |
| ad-hoc 签名（`codesign --sign -`） | 没有开发者证书时唯一可用的签名方式，保证 Apple 芯片能启动该二进制 |
| 不使用 Hardened Runtime | Hardened Runtime 下 V8 需要额外 entitlements（`allow-jit` 等），ad-hoc 场景下没有收益，只会引入启动失败风险 |
| `LSMinimumSystemVersion = 11.0` | 与 Node 22+ 支持的最低 macOS 版本一致 |
| `CFBundleIdentifier = ai-edu-agent.portable` | Apple 要求一个稳定的反向域名式标识；项目没有正式域名，这里用不含组织主张的标识，不虚构公司信息 |

---

## 7. 架构（Intel / Apple 芯片）说明

默认 `universal`：脚本分别生成 arm64 与 x64 两份二进制 → 各自验证（架构 / SEA 分节 / fuse / 签名）
→ 用 `/usr/bin/lipo -create` 合成通用二进制 → 组装**一个** `.app` → 自检 → **一个** `.dmg`。

如果 `lipo` 不可用或合成结果不符合预期（不是双架构、或缺 SEA 分节），脚本会**自动降级**为分别输出
`..._macOS_arm64.dmg` 与 `..._macOS_x64.dmg`，并在输出里明确说明，同时在「使用说明.txt」里告诉用户
如何按自己的芯片选择。降级不会产出「看起来成功但其实跑不起来」的包。

> 需要知道的背景：Node 官方 CI 目前对 macOS 的 SEA 只覆盖 arm64，**x64 未被测试覆盖**
> （见 Node 文档 “Platform support” 一节）。因此 x64 这份不能只靠静态断言，
> `build:mac` 会对每个架构都真启动一次并打接口（含 LaunchServices 启动），失败即中断构建。

---

## 8. 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| `macOS 发行版只能在 macOS 上构建` | 在 Windows/Linux 上执行了 `build:mac`。请到 Mac 上构建。 |
| `缺少系统工具：/usr/bin/codesign` | 系统不完整或被裁剪；`codesign` 属于 macOS 自带组件。 |
| 下载 node 运行时失败 / 很慢 | 用 `npm run build:mac:cn` 走国内镜像，或 `--node-binary=<路径>` 指定本地二进制。 |
| `node 运行时 SHA-256 校验失败` | 下载被中间设备改写或镜像不同步；重试或换镜像。**不要**用 `--offline` 绕过校验后手工塞文件。 |
| `ad-hoc 签名失败` | 看脚本打印的 `codesign` stderr；常见于二进制被其他进程占用或磁盘空间不足。 |
| 构建机第一次运行 `.app` 被拦 | 构建产物是本机生成的，通常没有 quarantine 标记；若被拦，`Control` + 点击 → 打开。 |
| 用户在 Intel Mac 上打不开 | 确认给的是 `arm64` 还是 `x64`/`universal`；`arm64` 版在 Intel 机器上无法运行（反之 Rosetta 可运行 x64）。 |
| 打开后浏览器没反应 | 看 `~/Library/Application Support/AI教育智能体/logs/app.log`；常见原因是默认浏览器注册异常（脚本有 Safari 兜底）。 |
| 端口被占用 | 启动器会自动顺延（默认 8765 起）。也可用 `--port=xxxx` 指定（打开终端属于排查手段，不是用户必需步骤）。 |

### GitHub Actions 上失败时

先看**哪一步**变红，然后按下面顺序定位（工作流已经把这些信息都打印出来了）：

| 变红的步骤 | 最可能的原因 | 处理 |
| --- | --- | --- |
| `Setup Node.js` | 网络/缓存问题 | 重新运行；必要时把 `node-version` 换成具体的 `22.x` |
| `Install app dependencies` / `Install packaging ...` | lockfile 与 package.json 不同步（`npm ci` 会因为不同步直接报错） | 在本机跑一次 `npm install` 更新 lockfile 并提交 |
| `Cross-platform self-checks` | 目录规则 / 图标 / plist 的断言不过 —— 这是**代码问题**，不是环境问题 | 看该步骤输出，`check:paths` 与 `check:mac-assets` 都可在本机复现 |
| `Build macOS .app and .dmg` | 见下面四类 | 看该步骤输出 + `Diagnostics on failure` 打印的 `app.log` |
| `Verify build output` | 构建没产出 dmg | 实际是上一步失败了，看上面的日志 |

`Build macOS .app and .dmg` 里最常见的四类问题：

1. **Node SEA 兼容性**：报 `SEA blob 生成失败` 或 `fuse 没有翻开`。
   用到的 `node` 与下载的 darwin 二进制版本必须一致（脚本用 `process.versions.node` 保证），
   且 `useSnapshot` / `useCodeCache` 必须为 false（跨平台注入的硬要求）。
2. **codesign**：报 `ad-hoc 签名失败` / `签名校验失败`。
   构建脚本会先 `codesign --remove-signature` 再注入再重签；若报错请把 `codesign` 的 stderr 一起发出来。
3. **hdiutil**：报 `hdiutil create 失败`。多为磁盘空间或卷名冲突；重跑通常可解决。
4. **lipo**：合成通用包失败时脚本会**自动降级**为分别输出 arm64 / x64 两个 DMG（日志里会写明），
   这不算失败；只有连分架构也失败才会中断。

`Show runner environment` 步骤会打印 `uname -m`、`node -v`、`launchctl managername`、
以及 `codesign / hdiutil / lipo / plutil / ditto` 是否存在 —— 报错时把这一段一起发出来即可定位。

---

## 9. 构建期与运行期的边界（不可破坏）

- 发行包内**不含** `node_modules`、`.env*`、源码、构建脚本。
- 发行包内**不含**任何真实 API Key（构建脚本会扫描文本与二进制并断言）。
- 发行包内**不含**开发机绝对路径（构建脚本会断言）。
- 应用包内是**首次启动状态**：没有 `app.db`、`settings.json`、`app.log`。
- 启动器只监听 `127.0.0.1`，不申请管理员权限、不写系统偏好设置、不安装服务、不开机自启。
