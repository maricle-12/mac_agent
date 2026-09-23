# 决策记录

## 采用「静态前端 + 无状态转发 Worker」架构

Decision: 前端为纯静态 SPA 部署到 Cloudflare Pages；模型调用通过独立 Cloudflare Worker 转发，Worker 不持有任何用户密钥、不存储任何数据。

Reason: 满足「运营方固定成本为 0」与「用户自带 API Key」的产品原则，同时避开浏览器直连第三方 API 的 CORS 限制。

Impact: 任何需要服务端状态的功能（账号、云端历史、计费）都不能在不引入新基础设施的前提下实现；Worker 必须保持无状态，禁止引入 KV / D1 / 日志持久化。

## 用户 API Key 由用户输入，绝不进入源码或环境变量

Decision: API Key 只能由用户在网页「API 设置」中输入；默认存 sessionStorage，用户主动勾选「在此设备记住 API Key」后才写 localStorage。

Reason: 满足用户明确的安全要求，避免 Key 泄露到 GitHub、前端产物或 Cloudflare 环境变量。

Impact: 禁止新增 `VITE_DEEPSEEK_API_KEY` 之类的注入方式；`.gitignore` 必须排除 `.env.local` / `.dev.vars`；Worker 错误信息与日志中不得出现 Key。

## 第一版不做账号系统与云端数据库

Decision: 不实现注册、登录、付费、云端聊天记录；历史记录只存浏览器 IndexedDB。

Reason: 用户明确要求第一版排除这些能力，且它们都会破坏「零成本 + 零运维」原则。

Impact: 换设备/换浏览器不会同步历史，需在 UI 与 README 中明确告知；数据模型需为未来可能的同步留出字段（id / updatedAt）。

## 聊天历史只存 user / assistant，System Prompt 动态插入

Decision: IndexedDB 中不写入 system 消息；每次请求时按当前模式动态拼接 `getSystemPrompt(mode)`。

Reason: 修改 Prompt 后新请求立即生效，避免历史中固化旧 Prompt 造成上下文混乱。

Impact: `src/prompts/` 是唯一的 Prompt 来源；切换模式时必须新建会话，避免同一会话内 Prompt 突变。

## 使用 TypeScript 5.9 而非 7.x

Decision: 依赖锁定 `typescript ^5.9.3`。

Reason: TS 7（原生编译器）刚成为 latest，生态工具兼容性尚未充分验证；本项目要求 `npm run build` 必须零类型错误，优先稳定性。

Impact: 升级 TypeScript 需单独作为一个任务验证 `tsc -b` 与编辑器行为。

## 使用 Tailwind CSS v4（CSS-first 配置）

Decision: 采用 `@tailwindcss/vite` 插件 + `@import 'tailwindcss'` + `@theme` 定义设计令牌，不生成 `tailwind.config.js`。

Reason: v4 是当前主线版本，与 Vite 集成最简单，且设计令牌集中在 `src/index.css`，品牌改色只需改一处。

Impact: 不要再添加 PostCSS 配置；新增颜色/字体令牌写在 `src/index.css` 的 `@theme` 块中。

## 前端通过 VITE_API_ENDPOINT 指定 Worker 地址

Decision: 开发环境指向 `http://localhost:8787/api/chat`，生产环境指向 `https://<worker>.workers.dev/api/chat`；缺失时回退同源 `/api/chat`。

Reason: 用户明确要求该变量名；文件化配置便于新手按 README 逐步替换。

Impact: 部署 Worker 后必须修改 `.env.production` 并重新构建 Pages；该变量只允许放端点，不允许放任何密钥。

## Hook 接口先于存储实现确定，避免 UI 层返工

Decision: 阶段 2 就用 `useConversations` / `useChat` 承载会话增删改与发送逻辑，底层先用内存 + 模拟数据实现。

Reason: UI 组件只依赖 Hook 的对外接口；阶段 7（真实流式）与阶段 9 / 10（IndexedDB）只替换 Hook 内部实现，`components/` 与 `App.tsx` 基本无需改动。

Impact: 后续替换存储或传输层时，必须先保持 `ConversationStore` 与 `UseChatResult` 的接口兼容；如需变更接口，应同步检查所有调用点。

## 块级公式在渲染前做字符串规范化

Decision: 新增 `src/utils/markdown.ts` 的 `normalizeMarkdown()`，把独占一行的 `$$...$$` 转成 `$$` 换行的块级形式，并在 `MarkdownRenderer` 中统一调用。

Reason: `remark-math` 只有在 `$$` 单独成行时才生成块级公式节点（实测：同行 `$$...$$` 会被解析为 `inlineMath`）。DeepSeek 等模型经常输出同行写法，若不规范化，用户会看到公式被挤在行内。

Impact: 不要绕过 `MarkdownRenderer` 直接使用 `react-markdown`；新增 Markdown 预处理逻辑统一放在 `src/utils/markdown.ts`。

## 文字处理规则：禁止用 Windows PowerShell 5.1 改写源码

Decision: 源码文件（尤其含中文的 UTF-8 文件）一律使用编辑器 / 文件工具修改，禁止用 PowerShell 的 `Get-Content` + `Set-Content` 做文本替换。

Reason: 本机默认 shell 是 Windows PowerShell 5.1，`Set-Content` 默认使用 ANSI 编码，实测会把 `src/mocks/mockData.ts` 的中文写成乱码，导致读取失败、必须重建文件。

Impact: 需要批量文本替换时使用 `pwsh`（PowerShell 7）或显式指定 `-Encoding utf8`；命令行的编码问题也写入 README 排查章节（15.5）。
例外：如需用 PowerShell 批量替换，可用 `[System.IO.File]::ReadAllText/WriteAllText` 搭配显式 `UTF8Encoding($false)` —— 这是安全的（实测通过），危险的是 `Set-Content` 的默认 ANSI 编码。

## API Key 的存储位置是单一事实来源

Decision: 同一个 API Key 只允许存在于一个存储位置：勾选「记住此设备」→ localStorage，否则 → sessionStorage；写入前先清空两处。`ApiSettings.rememberApiKey` 不独立持久化，始终由「Key 实际存放在哪」推导。

Reason: 避免出现「复选框勾了但 Key 其实只在 sessionStorage」或相反的不一致状态；这类不一致会直接造成用户对隐私承诺的不信任。

Impact: 不要新增第三条 Key 存储路径；任何读取 Key 的代码都必须经过 `src/services/storage.ts` 的 `loadApiKey()`；设置界面必须如实展示 `keyStorage`。

## 刷新后按上次模式打开对应会话

Decision: `useConversations(initialMode)` 接收当前模式，初始化时选择「最近更新且模式一致」的会话。

Reason: 模式偏好持久化在 localStorage，而会话默认选中最近一条；两者不一致会导致刷新后顶部显示学生模式、正文却是教师会话。

Impact: 阶段 9 / 10 接入 IndexedDB 后应改为持久化 `activeConversationId` 并由会话推导模式，但「模式与内容必须一致」这一约束要保留。

## Worker 的安全边界：origin 白名单 + 上游 origin 白名单

Decision: Worker 用两层白名单——`ALLOWED_ORIGINS`（谁可以调用它，防被别的站点当免费代理）与 `ALLOWED_BASE_URL_ORIGINS`（它能请求谁，防 SSRF）。Base URL 还要求 https、禁止 URL 内携带凭据 / 查询串 / hash / 非标准端口。

Reason: 用户明确要求「不要开放危险 Proxy」「必须对 Base URL 做安全校验」「生产不要用 `Access-Control-Allow-Origin: *`」。

Impact: 接入新的 OpenAI 兼容服务必须显式修改 `worker/src/config.ts` 的白名单并重新部署；不要为了方便放开为 `*`。

## 来源被拒时仍然回显 CORS 头

Decision: `origin_not_allowed`（403）的响应会回显请求方的 `Access-Control-Allow-Origin`，让前端能读到这条错误。

Reason: 否则浏览器只会给出一个无法定位的 CORS 报错，新手用户完全不知道要去改 `ALLOWED_ORIGINS`。

Impact: 该分支只返回错误说明、不含任何数据，因此不构成信息泄露；但**只有这一条错误分支**可以回显未授权来源，其余所有响应必须严格按白名单处理。

## Worker 只透传上游的 Content-Type

Decision: 流式透传时只复制 `Content-Type`，不复制 `Content-Encoding`、`Content-Length` 等头。

Reason: Workers 的 `fetch` 已经自动解压上游 body，若同时透传 `Content-Encoding`，浏览器会尝试二次解压导致响应损坏。

Impact: 后续若改为直接转发原始字节，必须重新审视这套头处理逻辑。

## 前端只通过 chatApi.ts 访问模型

Decision: 所有对 Worker 的请求都必须经过 `src/services/chatApi.ts`；错误统一转成 `ApiRequestError`，UI 只展示 `message`，原始信息进 `detail`。

Reason: 保证错误文案一致、Key 处理一致、未来接入流式与重试时只有一处需要改。

Impact: 不要在任何组件里直接 `fetch(apiConfig.endpoint)`；新增接口能力（流式、标题生成、未来的 Embedding）都先加到 chatApi。

## 自动化检查中的「预期失败请求」显式声明

Decision: `ui-check.mjs` 中会故意产生 4xx 的用例必须调用 `ctx.tolerateNetworkError()` 声明；harness 按计数容忍，预期外的网络错误仍然判失败。需要外部依赖（Worker / 真实端点）的用例用 `ctx.skip()` 显式跳过并打印原因。

Reason: 若直接忽略所有 `network:` 日志，会漏掉真正的基础设施故障；若不做容忍，则每次正常跑错误分支都会污染结果。同理，生产构建在阶段 14 前端点仍是占位符，把这种情况报成 FAIL 会掩盖真实问题。

Impact: 新增涉及失败分支或外部依赖的用例时，必须显式声明容忍或跳过，不允许放宽容忍范围。

## SSE 必须用行缓冲 + 流式解码器解析

Decision: 前端解析 SSE 只能使用 `src/services/sseStream.ts` 的 `createSseParser`；内部用「残余字符串 + 新 chunk」按 `\n` 切行，并用 `new TextDecoder('utf-8')` + `decode(chunk, { stream: true })` 解码。

Reason: 网络 chunk 与 SSE 事件边界无关，一个 JSON 会被切开；一个中文字符（3 字节 UTF-8）也会被切开，逐块独立解码会产出 U+FFFD 替换字符。用户明确要求「不能简单 `chunk.split('\n')` 然后假设每个 chunk 都是完整 JSON」。

Impact: 禁止在别处重新实现 SSE 解析；`npm run check:sse` 必须保持全绿（含逐字节与随机切分用例）。后续新增解析特性（例如新的 delta 字段）先补用例再改实现。

## 客户端断开必须传导到上游

Decision: Worker 在 `request.signal` 触发 `abort` 时调用 `controller.abort()`，中断上游 fetch。

Reason: 用户点「停止生成」或关闭页面后，若上游请求继续，用户仍会为不再需要的 token 付费 —— 这与「Token 成本由用户承担」的产品原则直接冲突。

Impact: 不要为了「简化」而移除该监听；新增任何上游调用（未来的标题生成、Embedding）同样要传播取消信号。

## 流式增量用 rAF 合并刷新

Decision: `useChat` 把增量累积到闭包变量，用 `requestAnimationFrame` 合并写入 React state，而不是每收到一个 delta 就 setState。

Reason: 每个 delta 都触发一次重渲染意味着一次完整的 Markdown + KaTeX 重解析；长回答时明显卡顿。rAF 合并把刷新率限制在每帧一次。

Impact: 不要在 SSE 回调里直接 setState；结束时必须先取消待执行的帧再写入最终内容，避免最后一帧覆盖最终值。

## Vite 监听必须排除子项目目录

Decision: `vite.config.ts` 的 `server.watch.ignored` 排除 `worker/`、`screenshots/`、`project_memory/`。

Reason: `worker/` 是独立子项目（有自己的 tsconfig 与 node_modules）；实测 Vite 会因它的 tsconfig 变化清缓存并强制整页刷新，曾导致一次自动化检查整体误报「#root 未渲染」，排查成本很高。

Impact: 新增任何子项目目录都要同步加入该列表；否则会出现「改 A 目录导致 B 页面刷新」的诡异现象。

## Prompt 只能通过 getSystemPrompt(mode) 获取

Decision: 所有 Prompt 集中在 `src/prompts/`，对外只有 `index.ts` 的 `getSystemPrompt(mode)` 一个出口；组件与 Hook 不得直接 import `teacher.ts` / `student.ts` 的常量。

Reason: 用户明确要求「前端不要直接知道完整 Prompt 内容」；单一出口让调整 Prompt 不需要改任何 UI 代码，也便于未来扩展成多 Agent。

Impact: 新增 Agent 时在 `basePrompts` 补一项并放宽 `AgentMode` 联合类型，不要另开取用路径。Prompt 内容属于核心资产，改动应视为产品改动（需要重新验证两种模式的注入断言）。

## System Prompt 动态插入，不写入本地历史

Decision: System Prompt 在每次请求时由 `buildRequestMessages` 拼接到 messages 最前，绝不写入 IndexedDB / 本地历史。

Reason: 用户明确要求「System Prompt 不需要写入 IndexedDB 每条消息，调用 API 时动态插入当前模式对应 System Prompt，这样修改 Prompt 后新请求可以自动使用新版 Prompt」。

Impact: 不要为了「省一次拼接」而把 system 消息持久化；ui-check 中有「连续两条消息后 system 仍只有一条」的回归断言，必须保持通过。

## IndexedDB 写库按会话节流，但新建与删除立即落库

Decision: `useConversations` 的所有改动先更新 React 状态（界面即时响应），再按会话节流 400ms 写入 IndexedDB；新建会话与删除会话走立即写入/删除；`pagehide` / `visibilitychange` 时冲刷待写入内容。

Reason: 流式输出期间增量更新非常频繁，若每次更新都写库会造成大量无谓的磁盘写入；但新建会话若延迟写入，「刚建好就刷新」会丢失。

Impact: 新增会话级写操作时，先判断它属于「高频可节流」（如流式内容）还是「低频必须立即落库」（如创建、删除、清空）；不要绕过这套机制直接调 `putConversation` 之外的新路径。

## 全新用户从空状态开始，不预置示例会话

Decision: 删除 `src/mocks/` 与全部模拟会话/模拟回答；IndexedDB 为空时显示欢迎引导 + 空状态。

Reason: 需求文档 §11 要求新建会话时显示欢迎界面、§22 要求首次进入显示友好的欢迎引导。预置假会话会让用户误以为这些是真实历史，也会让「首次使用体验」无法被验证。

Impact: 不要为了「让界面看起来热闹」而恢复种子数据；空状态与欢迎引导是必须保持的首次体验，ui-check 有断言覆盖。

## 删除当前会话后必须自动选中相邻会话；新建时复用空白会话

Decision: `remove()` 在删除当前会话时自动选中相邻会话（优先下一条，其次上一条）；`create()` 在已存在同模式空白会话时直接复用而不新建。

Reason: 前者避免用户删完当前会话后被丢进空白页（「我是不是把数据删错了」的错觉）；后者避免反复点「新建对话」在持久化历史里堆出一串空记录 —— 历史是持久化的，垃圾记录不会自己消失。

Impact: 这两条是会话管理的产品行为约定，不要为了「逻辑更简单」而退回「置空 activeId」或「每次都新建」。

## 生产构建的验证方式：临时 .env.production.local 指向本地 Worker

Decision: 验证生产构建时，创建被 gitignore 的 `.env.production.local` 把 `VITE_API_ENDPOINT` 指向本地 Worker，跑完整自动化检查，验证后删除该文件。

Reason: `.env.production` 在阶段 14 之前是占位符，此时依赖 Worker 的用例只能 SKIP，等于没有覆盖压缩后的真实产物；而直接用 `.env.production` 写本地地址又会误提交。

Impact: 每次改动影响面较大时（例如升级依赖、改构建配置），部署前应做一次这样的生产构建全量检查。

## 安全网必须被实际触发验证一次

Decision: 错误边界（ErrorBoundary）实现后，临时在组件中注入一个渲染期 `throw`，用生产构建确认兜底页真的出现，验证后立刻还原并删除临时脚本。

Reason: 「加了 try/catch」和「异常真的被兜住」是两件事。错误边界只在渲染期异常时生效，平时永远不会被触发，因此不做一次真实触发就无法确认它是否接对了位置（例如包错层级、被 StrictMode 影响）。

Impact: 任何「永远不会在日常使用中触发」的防护（错误边界、降级分支、兜底超时）都应至少被实际触发验证一次，并在记忆里记录验证方式；临时注入的代码必须在同一次任务内还原并确认无残留。

## 流式中断必须保留已生成内容

Decision: 流式过程中连接中断时，保留已经生成的内容，并以「生成过程中连接中断，已保留已生成的内容」提示，而不是清空消息或整条变红。

Reason: 长回答可能已经生成大半，因为网络抖动全部丢弃对用户是纯粹的损失；需求文档 §26 要求「Streaming 中途断开」时页面不崩溃、聊天记录中显示友好错误消息。

Impact: 任何改动流式异常处理的代码，都必须保持「部分内容可见 + 友好提示 + 可重新生成」这三条同时成立，ui-check 有对应断言。

## 移动端可达性不依赖 hover 能力判断

Decision: 会话行的「⋯」按钮在**窄屏（<768px）下始终显示**；只有「宽屏 + 具备 hover」的桌面环境才收起做悬停显示。软键盘适配用 `100dvh` + viewport 的 `interactive-widget=resizes-content`，而不是 `100vh`。

Reason: 触屏没有 hover，`opacity-0 group-hover:opacity-100` 会让手机上**根本无法重命名或删除会话**（真实功能不可用）。而 `@media (hover: none)` 的可靠性不足：实测 CDP 的媒体特性模拟不生效，不同浏览器/机型上报也不一致，把「能否管理会话」交给它风险太高。同理 `100vh` 在移动端等于最大视口高度，键盘弹出时不会收缩。

Impact: 新增任何「悬停才出现」的交互，都必须同时提供窄屏常显或点击展开的替代路径；触摸目标尺寸按 ≥36px 设计，不要依赖媒体查询放大。

## 自动化步骤必须自己还原全局状态

Decision: `ui-check.mjs` 中会改变视口、媒体特性、侧边栏抽屉等全局状态的用例，必须用 `try/finally` 保证结束时还原。

Reason: 实测一次移动端用例在断言处提前抛错后，视口停留在 390×844、抽屉仍未关闭，导致后续 7 个用例在手机视口下运行 —— 桌面侧边栏不可见、会话统计为 0，全部误报为失败，排查成本很高。

Impact: 任何修改全局环境（视口、模拟媒体、打开抽屉/弹窗、切换模式）的用例都要有还原逻辑；新增此类用例时先写 `try/finally` 再写断言。

## 全量检查失败时先确认基础设施

Decision: 当一次检查出现大面积失败、且首屏报「#root 未渲染」时，先确认 dev server / Worker 是否仍在运行，再去读代码。

Reason: 实测两个后台 dev 进程意外退出时，一次性 26 项用例全部失败并报「#root 未渲染」，与产品代码无关；这类「全量崩」的特征与真实的代码级回归完全不同。

Impact: 排查顺序固定为：服务器是否存活 → 页面能否渲染 → 再定位具体用例。不要从断言细节入手。

## 依赖真实端点的自动化用例必须显式声明并跳过

Decision: `ui-check.mjs` 增加「探测转发端点是否已配置」用例；端点仍是占位符时，依赖真实请求的用例调用 `ctx.skip()` 并打印原因。

Reason: 生产构建在阶段 14 之前不可能有可用的 Worker 地址，把这些用例报成 FAIL 会掩盖真实问题，也让「全绿」失去意义。

Impact: 新增依赖外部服务的用例时，必须同时给出可判定的跳过条件与清晰的跳过原因。
