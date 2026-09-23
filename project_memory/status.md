# 当前状态

## 总体进度

**阶段 12 / 14 —— 已完成并验证通过（等待用户确认后进入阶段 13）**

## 阶段 1 ~ 11 ✅

骨架 / 静态 UI / API 设置持久化 / Worker / 非流式转发与测试连接 / SSE 解析与流式验证 /
前端真实流式 / 教师学生 Prompt / IndexedDB 历史记录 / 会话管理 / 错误处理。详见 `decision.md`。

## 阶段 12：移动端适配 ✅

### 修掉的 3 个真实移动端问题

1. **手机上无法重命名 / 删除会话（真实功能不可用）**
   会话行的「⋯」按钮原本是 `opacity-0 group-hover:opacity-100` —— 触屏没有 hover，
   在手机上它永远不出现，用户根本无法管理会话。
   现改为：**窄屏（<768px）一律常显**，桌面端（≥768px 且具备 hover）才收起做悬停显示。
   刻意不用 `@media (hover: none)` 作为唯一依据 —— 实测 CDP 的 hover 媒体特性模拟
   与真实机型上报都不够可靠，把「能否管理会话」交给它是危险的。
2. **软键盘遮挡输入框**
   - `index.html` viewport 增加 `interactive-widget=resizes-content`；
   - `#root` 高度改为 `100dvh`（带 `100%` 回退），键盘弹出时外壳随之收缩；
   - `body` 设 `overflow: hidden`，应用自管滚动区，顺带消除 iOS 橡皮筋。
3. **触摸目标过小**
   统统提到 ≥36px：会话「⋯」(36)、顶部菜单 (36)、发送 (36)、停止生成 (≥36)、
   附件 (≥36)、弹窗关闭 (36)、侧边栏底部「API 设置 / 关于」(≥36)、代码复制 (≥32)。
   同时给按钮加 `touch-action: manipulation` 并去除 tap 高亮，消除移动端 300ms 延迟。

### 其他移动端处理

- **安全区**：`.header-safe`（顶部 `env(safe-area-inset-top)`，高度用 `calc` 补足）、
  `.composer-safe`（底部 `max(1rem, env(safe-area-inset-bottom))`）、`.drawer-safe`（横屏左刘海）。
- **防 iOS 字号膨胀**：`-webkit-text-size-adjust: 100%`。
- **长文本溢出**：用户气泡补 `break-words`；代码块与表格已有横向滚动。
- **触屏可达性**：附件按钮补 `title`（悬停提示在触屏上不可见，长按才有意义）。

## 验证结果（全部通过）

- `npm run build`：零 TypeScript 错误。
- `npm run check:ui`（**28 项**）：
  - dev：**28/28 通过**；
  - **生产构建**（`.env.production.local` 指向本地 Worker）：**28/28 通过**。
  - 移动端用例覆盖 4 种尺寸，每档断言：无横向溢出、输入区不超出视口底部、
    顶部栏高度、整页滚动已禁用、外壳高度与视口一致、手机折叠 / 平板常驻；
    另含抽屉内点击目标 ≥36px、**窄屏「⋯」按钮 opacity 必须为 1**。
- `npm run check:sse`：30/30；`cd worker && check`：38/38。
- 无 `console.error`、无未捕获异常。

## 过程中的两个教训（都很典型）

1. **两个 dev 服务器进程意外退出，导致一次全量检查 26 项失败**，报「#root 未渲染」。
   确认产品代码无问题。经验：全量失败且 #root 不存在时，**先确认服务器还活着**，
   不要一头扎进代码里找 bug。
2. **测试步骤提前失败会污染后续所有用例**：移动端用例在触屏断言处抛错后，
   既没有还原视口（停在 390×844），也没有关闭抽屉，
   于是后续用例在手机视口下运行 —— 桌面侧边栏不可见、会话数量统计为 0，
   报出 7 项「失败」，全部是连锁误报。
   已把移动端检查包进 `try/finally`，**无论成功失败都还原视口与媒体特性并关闭抽屉**。

## 当前状态

- 后台任务：`pwsh-1`（前端 dev 5173）、`pwsh-2`（wrangler dev 8787）。
- 移动端已覆盖 360/390/414 手机与 768 平板，含安全区、软键盘、触摸目标。

## 下一步（阶段 13：生产 Build 验收）

1. 逐条核对需求文档 §40：`npm run build` 无 TypeScript 错误、无明显 console 错误、
   刷新 SPA 页面不 404（`public/_redirects` 已有，需在类 Pages 环境下验证）；
2. 包体积优化：当前 JS ~700 kB（gzip ~213 kB），主要是 KaTeX；
   考虑把 Markdown/KaTeX 相关代码做动态 import 分包，并收紧
   `build.chunkSizeWarningLimit`；
3. 检查构建产物中不含任何密钥、不含 sourcemap；
4. 复核 `.gitignore`、产物目录结构、Cloudflare Pages 需要的文件（`_redirects`）；
5. 用 preview 跑完整 ui-check 作为「构建产物冒烟」（已是常规手段）。

## 风险与限制

- 真实流式链路尚未由代理亲自跑通（无 Key），建议用户跑一次 `npm run check:stream`。
- `.env.production` 仍是占位符，阶段 14 必须替换。
- 真机（iOS Safari / Android Chrome）未验证，仅用视口模拟与媒体特性模拟。
- 包体积偏大（KaTeX），阶段 13 处理。
