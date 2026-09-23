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

Impact: 需要批量文本替换时使用 `pwsh`（PowerShell 7）或显式指定 `-Encoding utf8`；命令行的编码问题也写入 README 排查章节（12.5）。

## API Key 的存储位置是单一事实来源

Decision: 同一个 API Key 只允许存在于一个存储位置：勾选「记住此设备」→ localStorage，否则 → sessionStorage；写入前先清空两处。`ApiSettings.rememberApiKey` 不独立持久化，始终由「Key 实际存放在哪」推导。

Reason: 避免出现「复选框勾了但 Key 其实只在 sessionStorage」或相反的不一致状态；这类不一致会直接造成用户对隐私承诺的不信任。

Impact: 不要新增第三条 Key 存储路径；任何读取 Key 的代码都必须经过 `src/services/storage.ts` 的 `loadApiKey()`；设置界面必须如实展示 `keyStorage`。

## 刷新后按上次模式打开对应会话

Decision: `useConversations(initialMode)` 接收当前模式，初始化时选择「最近更新且模式一致」的会话。

Reason: 模式偏好持久化在 localStorage，而会话默认选中最近一条；两者不一致会导致刷新后顶部显示学生模式、正文却是教师会话。

Impact: 阶段 9 / 10 接入 IndexedDB 后应改为持久化 `activeConversationId` 并由会话推导模式，但「模式与内容必须一致」这一约束要保留。
