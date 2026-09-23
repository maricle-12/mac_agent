# 当前状态

## 总体进度

**阶段 13 / 14 —— 已完成并验证通过（等待用户确认后进入阶段 14，即最后的部署）**

## 阶段 1 ~ 12 ✅

骨架 / 静态 UI / API 设置持久化 / Cloudflare Worker / 非流式转发与测试连接 /
SSE 解析与流式验证 / 前端真实流式 / 教师学生 Prompt / IndexedDB 历史记录 /
会话管理 / 错误处理 / 移动端适配。设计取舍见 `decision.md`。

## 阶段 13：生产 Build 验收 ✅

### 1. 包体积优化（真实收益）

把公式相关依赖拆成**按需加载**分块（`MarkdownRenderer.tsx` 用 `React.lazy` 动态导入
`MathMarkdown.tsx`，且只在内容里出现 `$` 时才走这条路）：

| 产物 | 优化前 | 优化后 |
| --- | --- | --- |
| 首屏 JS | 715 kB（gzip 219 kB） | **443 kB（gzip 137 kB）** |
| 首屏 CSS | 61 kB（gzip 14.9 kB） | **31 kB（gzip 6.7 kB）** |
| 按需分块 | — | MathMarkdown 274 kB（gzip 83 kB）+ CSS 30 kB（gzip 8 kB） |

首屏 gzip 从约 234 kB 降到 **约 144 kB（-38%）**；没有公式的对话完全不下载 KaTeX。
同时移除了之前为 KaTeX 放开的 `chunkSizeWarningLimit`，回到默认 500 kB 且无警告；
KaTeX 的 CSS 也从 `main.tsx` 移入懒加载分块。

### 2. SPA 回退验证（新增工具）

新增 `scripts/preview-pages.mjs`（`npm run preview:pages`，端口 4180）：
**类 Cloudflare Pages 的本地静态服务器**，会读取 `dist/_redirects` 并按 Pages 语义处理。
`vite preview` 不实现该规则，所以此前无法验证「刷新深层路径不 404」。实测：

```
/                     -> 200 text/html      含 #root
/some/deep/route      -> 200 text/html      含 #root
/conversations/abc123 -> 200 text/html      含 #root
/favicon.svg          -> 200 image/svg+xml
```

### 3. 构建产物检查

- ✅ 无 sourcemap（`dist/**/*.map` 为空）
- ✅ 无任何 `sk-...` 形态密钥
- ✅ `dist/_redirects`、`dist/index.html`、`dist/favicon.svg` 齐全
- ✅ 产物中无 `.env` 文件

## 验证结果（全部通过）

- `npm run build`：零 TypeScript 错误、无 chunk 体积警告。
- `npm run check:ui`（**28 项**）：
  - dev（5173）：**28/28 通过**；
  - **生产构建 + 类 Pages 服务器**（4180）：**28/28 通过**。
- `cd worker && npm run check`：**38/38 通过**。
- `npm run check:sse`：**30/30 通过**。
- 无 `console.error`、无未捕获异常。

## 过程中的一个插曲（CORS 白名单按预期生效）

用新的 4180 端口跑生产构建时，前两个依赖 Worker 的用例失败，报
「blocked by CORS policy: No 'Access-Control-Allow-Origin' header」——
这正是 Worker 的来源白名单在正常工作（4180 当时不在名单里）。
已把 4180 作为合法的本地预览端口加入 `worker/wrangler.toml`，并在注释里说明
「生产环境可以删掉本地端口，只保留 Pages 域名更安全」。
顺带确认：预检被拒时前端会走本地 `network_error` 分支，给出
「请确认 Worker 已启动，且当前网页域名在 ALLOWED_ORIGINS 中」这类可操作提示。

## 当前状态

- 后台任务：`pwsh-1`（dev 5173）、`pwsh-2`（wrangler dev 8787）、`pwsh-6`（preview:pages 4180）。
- README 章节已重新编号（1~15），交叉引用已同步。
- 临时文件 `.env.production.local` 仅用于本地验证，已确认未被 git 跟踪。

## 下一步（阶段 14：Cloudflare Pages + Worker 部署 —— 最后一步）

1. 把 README 第 14 章补成面向新手的完整教程：
   安装 Node / Git → 下载代码 → `npm install` → 本地运行 → Worker 本地运行 →
   前端如何连本地 Worker → 注册 Cloudflare → 创建 Pages 项目 → 部署前端 →
   创建 / 部署 Worker → 修改 `VITE_API_ENDPOINT` 并重新构建 → 配置 CORS 白名单 → 最终验证；
2. 补齐「最终验收清单」（对应需求文档 §52 的 24 条）；
3. **部署本身需要用户的 Cloudflare 账号，代理无法代劳** —— 阶段 14 交付的是
   完整可执行教程 + 逐条检查清单，并要求用户回传真实公网链接的验证结果；
4. 复核 `.gitignore` 与提交内容，确保不含任何密钥与本地验证用的 `.env.*.local`。

## 风险与限制

- 真实流式链路尚未由代理亲自跑通（无 Key），建议用户执行一次 `npm run check:stream`。
- `.env.production` 仍是占位符，部署 Worker 后必须替换并重新构建。
- 公网部署与真机（iOS / Android）验证只能由用户完成。
