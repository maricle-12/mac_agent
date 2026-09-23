# 当前状态

## 总体进度

**14 / 14 阶段完成，并且已在真实 Cloudflare 账号上完成部署与公网验证。**

## 线上地址（可直接打开）

| 项 | 地址 |
| --- | --- |
| 前端（公网入口） | **https://ai-edu-agent.pages.dev** |
| Worker | https://ai-edu-agent-api.edu-demo-2026.workers.dev |
| Cloudflare 账号 | `2750366148@qq.com` 的账号 |
| workers.dev 子域名 | `edu-demo-2026`（首选 `edu-demo` 已被占用） |
| Pages 项目 | `ai-edu-agent`（Production 分支 `main`） |

## 公网验证结果（实际打线上服务，非本地模拟）

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

## ⚠️ 需要用户决策的重要限制

**`workers.dev` 与 `pages.dev` 在中国大陆访问不稳定甚至被阻断。**

本机实测：直连失败，必须走代理；走代理全部正常。这意味着**目标用户（大陆教师/学生）
可能打不开这个链接**，与「一个链接即可访问」的产品目标冲突。

可选方案（已写进 README 16.18）：
1. **绑定自定义域名**（推荐先试）—— 可访问性通常明显好于 `pages.dev`；
2. 换国内可直连的静态托管（会偏离需求文档指定的 Cloudflare）；
3. 只面向有代理的用户。

建议用户在绑好自定义域名后，用手机 4G（不走代理）实测一次。

## 尚未验证（如实记录）

| 项目 | 原因 |
| --- | --- |
| 真实 Key 的完整流式输出 | 代理无 DeepSeek Key。用户可用 `npm run check:stream` 或直接在浏览器问一句 |
| 真机 iOS / Android | 需要实体设备；本轮仅做了视口与媒体特性模拟 |
| 自定义域名下的可访问性 | 尚未绑定域名 |

## 环境注意事项

- 本机有**本地代理** `http://127.0.0.1:7897`（环境变量 `HTTP_PROXY` 等已设置）。
  - `wrangler` 会提示「Proxy environment variables detected」，属正常。
  - 无头浏览器验证公网链接时需 `CHROME_PROXY=http://127.0.0.1:7897`（已给
    `scripts/ui-check.mjs` 加了该支持）。
- 本地 git 分支为 `master`，但 Pages 生产分支是 `main` —— 部署上生产必须显式 `--branch main`。
- 临时脚本 `cf-subdomain.mjs`（注册 workers.dev 子域名用）放在系统临时目录，不在仓库内；
  它只打印 API 返回结果，不打印 Token。

## 后续可选优化

1. 绑定自定义域名（解决大陆可访问性，优先级最高）；
2. `react-markdown` 也可按需加载（约再省 40 kB gzip，代价是首屏渲染消息时闪一下）；
3. 学科工具 / 教学资源入口目前是「即将支持」占位；
4. 可扩展 Agent：`lessonPlan` / `examGenerator` / `errorAnalysis` / `research`
   （在 `src/prompts/index.ts` 的 `basePrompts` 中扩展）；
5. 文件上传 / 知识库 / RAG（第一版明确不做）。
