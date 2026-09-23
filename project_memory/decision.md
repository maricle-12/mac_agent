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
