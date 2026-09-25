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

## 部署推荐用 Pages 环境变量而不是改 .env.production

Decision: 部署教程以「在 Cloudflare Pages 设置 `VITE_API_ENDPOINT` 环境变量并重新部署」为推荐路径，改 `.env.production` 并提交作为替代方案。

Reason: 已实测（设置进程环境变量后构建，产物中只出现该值、不出现 `.env.production` 的占位符）——Vite 的进程环境变量**优先于** `.env` 文件。因此用 Pages 环境变量无需改代码、无需再提交一次。

Impact: 本地 `npm run build` 仍产出占位符（这是期望行为，本地构建不应硬编码线上地址）；教程里必须提醒：**环境变量改动后必须在 Pages 上重新部署**，否则不会生效。

## Pages 域名白名单必须同时写 apex 与通配符

Decision: 部署教程明确要求 `ALLOWED_ORIGINS` 同时写 `https://<项目>.pages.dev` 与 `https://*.<项目>.pages.dev`。

Reason: 通配符 `*.x.pages.dev` 按标准语义**不匹配** `x.pages.dev` 本身。只写通配符会导致正式域名被 CORS 拒绝，而错误现象是一个难以定位的 `blocked by CORS policy`。

Impact: 若要改动来源匹配逻辑，必须先确认这条约定与文档同步更新；新增其他「容易写漏」的配置项时，也应在教程里显式写出正反例。

## 公式分块懒加载 + 空闲预取

Decision: `MathMarkdown`（remark-math + rehype-katex + KaTeX，约 274 kB）用 `React.lazy` 按需加载，**并在浏览器空闲时后台预取一次**（`MarkdownRenderer.tsx` 的 `prefetchMathChunk`）。

Reason: 懒加载让首屏 gzip 从 234 kB 降到 144 kB；但纯懒加载会在「刷新后第一眼就要渲染带公式的历史消息」时先显示一瞬间的原始 `$$...$$` —— 这个问题在本地网络看不出来，**公网部署后跑检查才暴露**（用例「刷新后块级公式丢失」失败）。空闲预取既保住首屏体积，又让真正需要时已经在缓存里。

Impact: 不要去掉 `prefetchMathChunk`，否则慢网络下公式会“晚一步”；也不要把 KaTeX 重新并入主包（会退回 234 kB 首屏）。ui-check 中该断言已改为「等待公式渲染到位」（区分正在下载与真的丢失）。

## 部署后必须对公网地址重跑一遍验证

Decision: 部署完成后，用 `ui-check.mjs` 直接打公网链接（配合 `CHROME_PROXY`）跑一遍，并把 `worker/test/worker-check.mjs` 指向线上 Worker 跑一遍。

Reason: 实测证明这一步不可省 —— 本地 28/28 全绿的情况下，公网首跑就暴露了一个真实缺陷（懒加载分块在慢网络下导致公式晚渲染）。本地网络与真实网络在延迟、DNS、代理上的差异会掩盖这类问题。

Impact: 以后任何影响加载顺序或体积的改动（新增依赖、改分包策略），都要在公网重跑一次验收，不能只看本地结果。

## 国内可访问性是产品的硬约束

Decision: 在 README 16.18 明确写出「`workers.dev` / `pages.dev` 在中国大陆访问不稳定甚至被阻断」，并给出应对顺序（先绑自定义域名，其次考虑换托管）。

Reason: 本机直连实测失败、走代理才正常；而产品目标是「用户打开一个链接就能用」，目标用户是大陆教师与学生。不写清楚会让人误以为部署完就万事大吉。

Impact: 后续若用户反馈「打不开」，第一顺位怀疑对象是可访问性而不是代码；绑定自定义域名后必须用手机 4G（不走代理）实测。

**2026-09 更新**：这条硬约束**已经通过改变产品形态彻底解决** —— 交付方式改为本地免安装应用后，
程序完全跑在用户自己电脑上、不经过任何境外域名，可访问性问题不复存在。
该条目现在只对「可选的公网方案」仍然成立，保留作为历史依据（见下面的产品形态决策）。

## 依赖真实端点的自动化用例必须显式声明并跳过

Decision: `ui-check.mjs` 增加「探测转发端点是否已配置」用例；端点仍是占位符时，依赖真实请求的用例调用 `ctx.skip()` 并打印原因。

Reason: 生产构建在阶段 14 之前不可能有可用的 Worker 地址，把这些用例报成 FAIL 会掩盖真实问题，也让「全绿」失去意义。

Impact: 新增依赖外部服务的用例时，必须同时给出可判定的跳过条件与清晰的跳过原因。

## 便携版用 Node SEA 打包，不用 PyInstaller

Decision: Windows 免安装版的运行时选 Node SEA（`node.exe` + 注入 SEA blob + 改 PE 子系统为 GUI），
而不是「用 PyInstaller 打一个 Python 启动器」。

Reason: 本项目**根本没有 Python 后端** —— 后端是 `worker/src/index.ts`（Web Fetch API 风格的无状态转发）。
要套 PyInstaller 就必须用 Python 重写一遍转发、校验、CORS、SSRF 白名单与流式透传，
既违反「不重写现有功能」，也会让已经通过的 38 项 Worker 自检失去意义。
Node SEA 可以把「原封不动的 Worker 代码」跑在随包分发的 Node 运行时上，逻辑零分叉。

Impact: 构建期需要 Node（仅开发机）；发行包内 `启动智能体.exe` 自带运行时，用户机器不需要 Node。
以后换后端技术栈时，这个决策要重新评估。

## 用「Node http ↔ Fetch API 适配层」复用 Worker，而不是改造 Worker

Decision: 新增 `packaging/src/local-server.cjs`，把 Node 的 `IncomingMessage` 转成 `Request`、
把 `Response` 流式写回 `ServerResponse`，再交给 `worker.fetch(request, { ALLOWED_ORIGINS })`。
`worker/src/**` 一个字符都不改。

Reason: 同一份代码要同时服务两种部署形态（Cloudflare Worker / 本地便携版）。
适配层属于「启动器基础设施」，不是业务逻辑；把 Worker 改成同时兼容两者会污染安全边界（CORS、SSRF 白名单）。

Impact: 本地版天然继承 Worker 的全部安全行为（origin 白名单、512 KB 上限、Base URL 白名单、Key 脱敏）。
新增 `/api/local/info` 与 `/api/local/shutdown` 两个**启动器专属**接口时，也必须放在适配层，不放进 Worker。

## 端口必须可记忆，否则聊天记录会「看起来丢了」

Decision: 默认 8765，被占用则依次探测；成功端口写入 `config/port.txt`，下次启动优先复用。

Reason: 聊天记录与 API Key 存在浏览器里，而浏览器存储按 **origin（含端口）** 隔离。
如果每次启动都换端口，用户会以为历史记录丢失 —— 这是便携版最容易踩的坑。

Impact: 端口冲突后切到新端口的那一次，浏览器里确实是「空的历史」（origin 变了）。
要彻底消除只能改成服务端存储或固定 origin，属于产品级改动，不要顺手做。

## 发行版必须是 GUI 子系统（不出现控制台窗口）

Decision: SEA 注入后把 PE `OptionalHeader.Subsystem` 由 3（CONSOLE）改成 2（GUI）；
启动器自己接管日志（写 `logs/app.log`），启动失败时弹 Windows 对话框并指向日志文件。

Reason: 普通用户双击 exe 弹出黑色命令行窗口是「开发工具」的观感，不符合「软件产品」要求；
同时要求「不能静默失败」，所以必须有对话框兜底。

Impact: GUI 子系统下 `process.stdout/stderr` 无效，启动器启动时先替换 `console`（`AI_EDU_DEBUG=1` 可恢复输出）。
以后往启动器里加代码时不要依赖 `console.log` 做用户可见输出 —— 一律走 logger。

## 构建期依赖与运行期依赖严格分离

Decision: `packaging/package.json` 只放 esbuild 与 postject（构建期）；发行包里不含它们，
也不含 `node_modules`、`.env.*` 与源码。版本号以 `package.json` 为唯一来源，构建时校验
`src/config/app.ts` 的 `appConfig.version` 与之一致。

Reason: 「伪打包成功」最常见的原因是发行包偷偷依赖开发机的工具链或路径。
构建脚本里显式断言：启动器不含开发机绝对路径、前端不含 `workers.dev`、包内不含 API Key、
exe 为 GUI 子系统、版本号三处一致。

Impact: 新增构建期工具放进 `packaging/package.json`；新增发行期资源放进 `resources/`，
并在 `build-release.mjs` 的检查清单里补一条断言。

## 聊天历史改用本机 SQLite，浏览器不再是数据源

Decision: 便携版的聊天历史存在 `data/app.db`（SQLite），前端通过 `/api/local/conversations`
读写；浏览器 IndexedDB 只在一次性迁移时被读取一次，之后不再参与正式数据。

Reason: v1.0.0 把历史放在 IndexedDB，而浏览器存储按 **origin（含端口）** 隔离 ——
端口从 8765 变成 8766 时用户会看到「历史记录空了」，这是普通用户无法理解的缺陷。
数据放到本机文件后，历史与端口、浏览器、清缓存全部解耦。

Impact: 便携版的「正式聊天数据」只有一份真实来源（SQLite）。任何新增的会话/消息字段都要同时
改 SQLite 表结构与前端类型；不要再往 IndexedDB 里写正式数据（它只保留 UI 偏好与迁移暂存）。

## 用 Node 内置 `node:sqlite`，不引入任何 SQLite native 模块

Decision: 数据库用 Node 22.5+ 内置的 `node:sqlite`（`DatabaseSync`），不装 better-sqlite3 / sql.js。

Reason: native 模块（`.node`）在 Node SEA 里需要额外的二进制收集与路径处理，是「伪打包成功」
的高发区；WASM 方案则要每次落盘整个数据库。`node:sqlite` 编译在 node.exe 内，
**已实测在 SEA 打包后可直接读写 `data/app.db`**，零依赖、零打包风险。

Impact: 不要为了 ORM 或花哨 API 换成 native 驱动；数据库结构变更走 `meta.schema_version`
的增量迁移，不做破坏性重建。非 WAL 模式（保持单文件，便于用户直接备份 app.db）。

## API Key 移出浏览器，改由本机服务保存并在转发时注入

Decision: Key 存在 `config/settings.json`；浏览器只能通过 `GET /api/local/settings` 拿到
`{ configured, maskedApiKey }`；`/api/chat` 在适配层补齐 apiKey / baseUrl / model 后再交给未改动的 Worker。

Reason: 减少前端暴露面（不写进 bundle / localStorage / 日志），同时保持 Worker 的校验、
CORS、SSRF 白名单、流式透传逻辑一字不改。

Impact: 浏览器端不得再出现完整 Key —— 设置弹窗只显示 `sk-****abcd` + 「重新设置」；
保存新 Key 时服务端先用真实请求验证，验证不过就不保存（避免存下坏 Key）。
未来若加 DPAPI 加密，只改 `packaging/src/settings.cjs`，不要动接口形状。

## 旧数据只迁移、不删除，且只做一次

Decision: 首次启动若本机数据库为空且浏览器里有旧 IndexedDB 历史，则导入 SQLite；
成功后把 `indexeddb_migration_v1` 写进数据库 meta 表；**无论如何都不删除浏览器里的旧数据**，
迁移失败也不影响应用启动。

Reason: 用户的历史记录不能因为一次升级而丢失或产生重复；升级过程必须可重入、可回退。

Impact: 迁移逻辑必须保持「只在数据库为空时导入」「失败不写完成标记」「不清理 IndexedDB」三条。

## EXE 必须有产品图标与版本资源，但不虚构公司信息

Decision: 用 `packaging/scripts/icon.mjs`（纯 JS 光栅化 favicon.svg + 自写 PNG/ICO 编码）
生成 16/24/32/48/64/128/256 七种尺寸的 `app.ico`；用 resedit 写入 RT_ICON 与 RT_VERSION。
CompanyName 与 LegalCopyright 留空。

Reason: 普通用户软件的「属性 → 详细信息」不能是空的；项目里没有正式公司名与版权声明，
按需求不杜撰。图标从既有品牌素材生成，不重新设计品牌。

Impact: 换品牌图形只需改 `public/favicon.svg` 与 `icon.mjs` 里的常量；
版本号统一以 `package.json` 为准，构建时校验 `src/config/app.ts` 与 EXE 版本资源一致。

## ui-check 必须感知「便携版 / 网页版」两种存储模式

Decision: `scripts/ui-check.mjs` 增加 `detectLocalMode()`，对与存储相关的 6 个用例分支处理：
便携版验证「Key 不在浏览器任何存储里」，网页版保持原有 sessionStorage / localStorage 断言；
读取持久化结果的 `DB_DUMP_EXPR` 也按模式改走 `/api/local/conversations`。

Reason: 同一套 UI 现在有两种数据来源，若测试只认 IndexedDB，便携版会被误报为失败，
「全绿」也就失去意义。

Impact: 以后新增与存储相关的 UI 用例，必须先判断模式，两种模式都要给出可判定的断言。

## macOS 继续用 Node SEA，不引入 Electron / Tauri / PyInstaller

Decision: macOS 版继续复用现有的 Node SEA 打包线（`node` 官方 darwin 二进制 + 注入同一份
平台无关的 SEA blob），只把可执行文件从 PE 换成 Mach-O、把交付物从 ZIP 换成 `.app` + `.dmg`。
不把项目改写成 Electron / Tauri，也不用 PyInstaller。

Reason: 本项目**根本没有 Python 后端、也没有第二份 UI**：后端是 `worker/src/index.ts`（Fetch API 风格），
前端是已经构建好的静态资源，启动器已经写好了单实例、端口探测、健康检查、打开浏览器、
本机 SQLite、Key 服务端化。改成 Electron 等于把「启动器 + 本地服务」重写一遍，
并把 87.8 MB 的发行包换成 150 MB+ 的 Chromium，同时让已有的三套自动化检查（Worker 38 项、
ui-check 27 项、便携版自检 25 项）全部失去对应的被测对象。SEA 路线的逻辑分叉为零。

Impact: 平台差异被限制在三处 —— `packaging/src/paths.cjs`（目录规则）、
`packaging/src/win.cjs` / `mac.cjs` + `platform.cjs`（系统集成）、两个构建脚本的
「可执行文件生成 + 交付格式」。新增平台时照这个形状再加一份实现，不要动 `worker/` 与 `src/`。

## macOS 打包的最后几步只能在 Mac 上做（工具链限制，不是实现取舍）

Decision: `npm run build:mac` 只在 macOS 上运行；Windows 侧不做「交叉出一个 dmg」的尝试。
把「平台无关的步骤」全部前置到任意机器都能跑，并在 Windows 上为 macOS 规则写自检脚本。

Reason: 两条硬约束 ——
① SEA 注入必然使原签名失效，而 **Apple 芯片要求所有二进制都有有效签名**，
   必须用 `/usr/bin/codesign` 重做 ad-hoc 签名；
② `.dmg` 是 Apple 的 UDIF 格式，只有 `/usr/bin/hdiutil` 能生成正式可挂载的压缩镜像。
这两者都不是靠写 JavaScript 能绕过的。相反，`postject` 的 Mach-O 注入、图标、Info.plist、
目录规则、blob 生成都是平台无关的，可以在 Windows 上先验一遍。

Impact: 以后不要在 Windows 上追求「生成 dmg」（例如引入 libdmg-hfsplus 或第三方 dmg 库）——
产出的镜像行为与 `hdiutil` 不一致，且仍然过不了 codesign 那一关。
需要交付 macOS 包时，在一台 Mac（或云 Mac）上跑 `npm run build:mac` 即可，
依赖与步骤见 `packaging/MACOS.md`。

## macOS 用户数据放 Application Support，不写进应用包

Decision: macOS 上聊天数据库、配置、日志放在 `~/Library/Application Support/AI教育智能体/`；
前端资源仍然从应用包内读取。为此在 `paths.cjs` 中把「资源根目录」与「数据根目录」彻底分开，
并且 macOS 分支**即使应用包目录可写也不把数据写进包内**。

Reason: 三条都是硬伤 —— 写入应用包内部会破坏代码签名（Gatekeeper 与 `codesign --verify` 都会失败）；
macOS 的既定约定就是用户数据放 Application Support；用户直接从 dmg 里运行时会被 App Translocation
挂载到只读随机路径，写在包内的数据每次启动看起来都「消失了」。
Windows 版不受影响：那里的「数据与程序同目录」是可移植性的真实收益（拷走文件夹即带走数据）。

Impact: 两个平台的**存储行为**必须一致（同一份 SQLite、同一套 `/api/local/*`、Key 一样不出浏览器），
只有目录位置不同；不要把 macOS 也做成「数据在包内」来追求形式上的统一。
`dataModeLabel` 用于在日志里如实说明当前数据放在哪、为什么。

## macOS 应用采用 LSUIElement（后台型），不用 Dock 图标

Decision: `Info.plist` 设 `LSUIElement = true`：应用不出现在 Dock、没有菜单栏；
退出走网页里「关于 → 退出智能体」。

Reason: 与 Windows 版的体验对齐 —— Windows 那边是 GUI 子系统的 exe，双击后不出现窗口、
不出现托盘图标，只有浏览器界面。另外，非 Cocoa 进程收不到 Dock 发出的 Apple 事件（Quit），
`Cmd+Q` 会表现为「没反应」甚至被系统判定为无响应，给 Dock 图标只会带来误导。

Impact: 说明文本里必须写清「如何彻底关闭」。不要为了「让用户能在 Dock 里看到它」而改回前台应用。

## 采用 ad-hoc 签名 + 明确告知，不追求 Apple 公证

Decision: 用 `codesign --force --sign -` 做 ad-hoc 签名；不做 hardened runtime、不做公证（notarize）；
在应用内 `使用说明.txt` 与 `packaging/MACOS.md` 用中文写清「首次打开需要 右键 → 打开」，
以及出现「已损坏」时的 `xattr -dr com.apple.quarantine` 处理方式。

Reason: 没有 Apple Developer Program 会员资格（99 美元/年）就拿不到 Developer ID 证书，
公证无法进行。ad-hoc 是这种情况下唯一可用的签名方式，且**必须做**——
否则 Apple 芯片会直接杀掉进程。Hardened Runtime 反而会要求为 V8 配置
`allow-jit` 等 entitlements，在没有证书的前提下只增加启动失败风险。

Impact: 不要把「未签名/未公证」包装成「已解决」；也不要为了绕开 Gatekeeper 而尝试
`--no-quarantine`、修改系统设置之类的做法。若将来拿到证书，只需在 `build-mac.mjs` 的
签名步骤换成真实身份 + `notarytool`，其余流程不变。

## 路径计算与路径落地分离，让 macOS 规则可以在 Windows 上验证

Decision: `paths.cjs` 暴露 `planRoots({ platform, execPath, env, homeDir, writable, sea })`
做**纯计算**（不建目录、不写文件），`resolveRoots()` 在此基础上真正创建目录。
构建脚本里的 `paths-check.mjs` 用 `platform: 'darwin'` 把 macOS / Linux 的规则算一遍并断言。

Reason: 之前那次改动就踩过坑 ——「应用包内在 `Contents/MacOS`」被误判成需要再向上一级，
把资源根算成了 `Contents/MacOS`。这种错误在 Windows 上不可能通过「运行一下」发现，
但用纯函数 + 显式平台参数就能立刻暴露（实测该自检当场抓出了这个 bug）。

Impact: 以后新增平台或改目录规则，先在 `planRoots` 里实现并补 `paths-check.mjs` 的断言，
再去改构建脚本。`path.win32` / `path.posix` 必须按目标平台选择，不要用宿主机默认的 `path`。

## 启动器支持 `--port` / `--no-browser` / `--data-root`（命令行优先于环境变量）

Decision: 启动器扫描 argv 中形如 `--name` / `--name=value` 的项，优先级高于同名环境变量；
扫描方式不依赖 argv 的布局（原生 Mach-O 与 Node SEA 的 argv 长度不同）。

Reason: macOS 上要验证「用户双击启动」必须走 `/usr/bin/open`（LaunchServices），
而 `open` 对环境变量的转发不可靠，只能用 `--args` 传命令行参数。
同时这也给技术支持提供了一个「换个端口启动」的手段。

Impact: 普通用户双击时不带任何参数，行为与之前完全一致（这条必须保持）。
新增开关时同时支持同名环境变量，便于自动化脚本两种方式都能用。

## 平台无关的构建步骤只写一遍（packaging/scripts/lib/common.mjs）

Decision: 前端构建、Worker 打包、启动器打包、SEA blob 生成、版本一致性校验、安全扫描、
用户说明文本、命名常量全部放进 `packaging/scripts/lib/common.mjs`；
`build-release.mjs`（Windows）与 `build-mac.mjs`（macOS）只在「可执行文件生成 + 交付格式」上分叉。

Reason: 两套构建脚本各写一遍，最容易出现的是「改了 Windows 忘了改 macOS」：
版本号、安全扫描规则、说明文本、ZIP/ DMG 命名都会悄悄漂移。
共用一份还有个额外好处：`npm run build:win` 会顺带证明共用部分仍然可用。

Impact: 新增打包步骤时先判断它是否平台相关；平台无关的一律加到 `lib/common.mjs`。
两个构建脚本的步骤编号（`1/10` … `10/10`）保持对称，便于对照阅读。

## 构建只清理本平台自己的产物

Decision: Windows 构建删除 `release/AI教育智能体/` 与旧的 `*_Windows.zip`；
macOS 构建删除 `packaging/build-mac/` 的中间产物与旧的 `*_macOS*.dmg`。
两者都**不再** `rm -rf release/`。

Reason: 两个平台的交付物要能同时存在于 `release/`；构建 Windows 版不应该把已经做好的 `.dmg` 删掉。
另一点：`packaging/build-mac/node-cache/` 缓存的 Node 官方二进制要保留，
否则每换一个架构都要重新下载几十 MB。

Impact: 新增交付格式时，清理逻辑要精确到自己的文件名/目录，不要图省事清整个 `release/`。

## 通用包（universal）优先，失败自动降级为分架构 DMG

Decision: `--arch` 默认 `universal`：分别生成 arm64 与 x64 两份二进制并各自验证，
再用 `/usr/bin/lipo -create` 合成一个 `.app`，产出**一个** `.dmg`。
若 lipo 不可用或合成结果不是预期的双架构 Mach-O，则**自动降级**为分别输出
`..._macOS_arm64.dmg` 与 `..._macOS_x64.dmg`，并在输出与使用说明里说明。

Reason: 一个文件最省事（用户不必知道自己是 Intel 还是 Apple 芯片）；但
Node 官方 CI 对 macOS 的 SEA **只覆盖 arm64，x64 未被上游测试**，
所以不能假设「合并就一定行」——必须每步可判定，并在不行时给出可用的替代产物，
而不是产出一个「看起来成功但跑不起来」的包。

Impact: 任何关于架构的处理都不要跳过「逐架构真启动一次并打接口」这一步。
新增架构（例如未来的其他平台）时沿用同一形状：逐架构验证 → 合成 → 合成物再验证 → 不行就降级。

## 用 GitHub Actions 的 macOS Runner 代替本地 Mac

Decision: 在仓库里提供 `.github/workflows/build-mac.yml`（`runs-on: macos-latest`），
把原本「必须在 Mac 上做」的最后几步（ad-hoc 签名、出 dmg、真机验收）放到 GitHub 的 macOS Runner 上执行；
本地 Mac 构建能力（`npm run build:mac`）保留不变，两条路径共用同一份 `build-mac.mjs`。

Reason: 「必须 macOS」是工具链限制（`codesign` / `hdiutil`），不是「必须是你自己的 Mac」。
GitHub 的 `macos-latest` 就是 Apple 芯片的 macOS 机器，同时自带 Node 与全部系统工具，
正好把这条限制消掉；而且 CI 里跑的是同一份脚本、同一套断言，不存在「CI 版本和本地版本行为不一致」。

Impact: 以后 macOS 侧的任何改动都要保证「在 CI 上能跑通」，不能只在本地 Mac 上验证。
工作流里不引入 Apple Developer 账号与任何 Secret（只用 ad-hoc 签名），保持零成本与零凭证。

## CI 不能上传裸 .app，只能上传 .dmg / .zip

Decision: GitHub Actions 的 artifact 只上传 `release/*.dmg` 与 `release/*.zip`；
`.app.zip` 用 `/usr/bin/ditto -c -k --sequesterRsrc --keepParent` 生成，**绝不用 `zip` 命令**，
且构建脚本会把 zip 解压回临时目录复验 `codesign --verify --deep --strict`。

Reason: `upload-artifact` **不保留文件权限位**（官方文档明确说明），
裸 `.app` 目录经 artifact 中转后 Main executable 会丢掉可执行权限，用户解压后打不开；
而 `.dmg` / `.zip` 把权限与签名封在归档内部，用户解压/挂载后完全正常。
`zip` 命令会破坏 `.app` 的符号链接与扩展属性，只有 `ditto` 是 macOS 上正确的应用包打包方式。

Impact: 不要为了「让用户直接拿到 .app」而改成上传目录；新增任何交付格式时都要先问
「经过 artifact 中转后还能不能跑」，并把可验证的复验步骤写进构建脚本。

## 环境依赖的验收项要「显式跳过」，不能伪装成通过或失败

Decision: 两处环境相关的检查改成「明确跳过 + 打印原因」：
① `mac-assets-check.mjs` 中「用 Windows EXE 交叉验证 fuse 判定」在找不到 exe 时跳过
（这是跨平台自检，会跑在没有 Windows 产物的机器上）；
② `smoke-test.mjs` 的 LaunchServices「双击启动」验收，先用 `launchctl managername` 判断是否有 Aqua 图形会话，
没有就跳过并说明「请在带桌面的 Mac 上确认」。

Reason: ① 原本「文件不存在即判失败」会让 macOS runner 上的构建在自检阶段就整体失败 —— 明明环境和断言都没问题。
② `open` 依赖图形会话，无 GUI 的 CI 里失败并不能说明应用有问题；但如果**不做这项检查**，
又会丢掉「用户双击能不能启动」这个最关键的覆盖。
因此正确做法是：有能力就真验，没能力就明说跳过，并把「有能力时的等价验证」保留下来。

Impact: 这个项目里凡是有「环境前提」的断言，都必须写成三态（通过 / 失败 / 跳过并说明），
不允许用「恒真」把检查糊过去。跳过必须出现在输出里，让人看得见。

## 触发 CI 用 workflow_dispatch + push main，且上传步骤用 if: always()

Decision: 触发条件为 `workflow_dispatch`（手动）与 push 到 `main`；并发按分支去重；
产物上传步骤用 `if: always()` + `if-no-files-found: warn`，另有独立的 `Verify build output` 步骤
在「确实没产出 dmg」时明确报错。

Reason: 交付物不能因为「后段某个校验失败」就一起丢掉 —— 用户至少应该能拿到已经生成的文件去排查。
同时也不能让「什么都没产出」悄悄通过，所以把「有没有产物」和「上传产物」拆成两步，各自职责单一。

Impact: 新增工作流时保持这个形状：先严格断言，再无条件保存产物，失败时额外打印诊断信息。
不要把「产物校验」和「产物上传」合并成一步。

## 产品形态定为本地免安装应用；Cloudflare 部署降级为可选的历史方案

Decision: 本项目的交付形态是**本地免安装桌面应用**（Windows `启动智能体.exe` / macOS `AI教育智能体.app`），
前后端都跑在用户自己电脑上。**不再需要 Cloudflare**：不部署、不依赖任何云端服务、不需要域名与账号。
早期那条「纯静态前端 + 无状态转发 Worker」的公网部署线不再作为交付路径。

具体处理：

- README 开头、「整体架构」「核心产品原则」改写为「本地服务 + 浏览器界面」的形态，
  并修正了原先「数据存在浏览器 IndexedDB」等与本地版不符的描述。
- 原 README 第 14 章（283 行的 Cloudflare 从零部署教程）**归档**到
  `docs/legacy-cloudflare-deployment.md`，标注为可选历史方案；README 原位只留一个简短小节。
- 第 15 章验收清单里 6 条与本地版不符的条目（公网链接、IndexedDB、云端数据库、Key 持有方）已修正，
  云端条目标为「可选」；第 16 章顶部注明哪些小节只属于云端方案。
- `.env.production` 清空已部署的 Worker 地址；本地版走 `.env.portable`（同源 `/api/chat`）。
- 个人邮箱等身份信息从 README 与 `project_memory` 中清除（仓库已转为公开）。

Reason: ① 本地版没有可访问性问题（不必经过境外域名），也不需要任何账号与运维，
更符合「下载即用」的目标；② 仓库公开后，文档必须与实际交付物一致 ——
否则读者会以为必须先部署 Cloudflare 才能用；③ 已部署的地址与账号信息不再使用，留在公开仓库里只是噪音与暴露面。

Impact: **`worker/` 目录不能删** —— 它不是「只有 Cloudflare 才需要的东西」，
本地服务用的就是同一份 `worker/src/index.ts`（构建时由 esbuild 打包进可执行文件），
校验 / CORS / SSRF 白名单 / 流式透传逻辑全在里面。
以后新增文档时，默认把**本地免安装应用**当作唯一交付路径；提到云端方案时必须标明「可选」。

## Worker 产物位置是构建期的唯一固定约定，且必须能被静态断言

Decision: Worker 的打包产物**只能**落在 `<packaging>/build/worker.cjs`，由 `lib/common.mjs` 的
`WORKER_BUNDLE_RELPATH` / `workerBundlePath()` 单点声明；两个构建脚本都必须通过
`ensureWorkerBundle()` 生成它（禁止自己 `bundleWorker()` 到别的目录）。
`ensureWorkerBundle` 在产物缺失时自动补生成，失败时明确输出 `worker build failed`；
`bundleLauncher()` 内置前置检查，保证「打包启动器时 Worker 产物一定就位」。
`paths-check.mjs` 的 D 节用 9 条断言把这三条固化下来。

Reason: macOS 构建在 CI 上真实失败过：
`local-server.cjs` 里 `require('../build/worker.cjs')` 只认 `packaging/build/worker.cjs`，
而 `build-mac.mjs` 把产物写进了 `packaging/build-mac/worker.cjs`；esbuild 打包启动器时静态解析该 require，
于是报 `Could not resolve "../build/worker.cjs"`。Windows 构建「刚好」也写 `packaging/build/`，所以只有 macOS 会挂。
更糟的是这个错误**在开发机上不可能被发现**：Windows 路径碰巧一致、本机又早有历史产物残留，
而 `build-mac.mjs` 的平台守卫让整条 macOS 构建线在非 macOS 上根本跑不到。

Impact: ① 以后任何「构建期产物放在哪」的约定，都要写成一处常量 + 一条静态断言，
不允许靠「两个脚本各写一遍、碰巧一致」；② 断言必须**显式声明生成产物**，
不能写成「文件存在就算过」—— 那样在有残留产物的机器上会假装通过；
③ 平台守卫会掩盖整条平台专属流程，因此**每个平台专属构建线都要提供「跑前半段」的预检入口**
（macOS 侧即 `npm run check:mac-build` = `build-mac.mjs --preflight`），
让与平台无关的步骤在任何机器上都能验证。
