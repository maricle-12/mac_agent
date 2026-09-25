# 附录：把项目部署到 Cloudflare（可选，已不再使用）

> **这份文档不再是本项目的交付路径。**
>
> 本项目现在的产品形态是**免安装的本地桌面应用**：Windows 解压后双击 `启动智能体.exe`，
> macOS 打开 dmg 拖进「应用程序」后点击启动。前后端都跑在用户自己的电脑上（本地服务只监听 127.0.0.1），
> **不需要任何服务器、不需要 Cloudflare、不需要部署**。
>
> 这里保留的内容是项目早期「纯静态前端 + 无状态转发 Worker」的公网部署方式，作为历史记录与可选方案：
> 如果你确实想提供一个公网链接给不方便安装软件的用户，可以直接照做 —— 代码本身仍然支持这种方式
> （`worker/` 与 `.env.production` 都还在，前端也能照常构建成静态站点）。
>
> 注意：其中涉及账号/域名/邮箱的具体信息已做脱敏处理。

---

## 14. Cloudflare 部署步骤（从零开始，含新手注意事项）

> 目标：最后你会得到一个公网链接，例如 `https://ai-edu-agent.pages.dev`，
> 任何人打开它、填入自己的 DeepSeek API Key 就能用。
>
> **部署顺序很重要**：先部署 Worker（拿到它的地址），再部署前端（需要填入该地址），
> 最后回到 Worker 把前端域名加入白名单。总共约 15 分钟。

### 14.0 你需要准备什么

| 需要 | 费用 | 说明 |
| --- | --- | --- |
| 一台电脑 | — | Windows / macOS 都可以 |
| Node.js | 免费 | 见 14.1 |
| Git | 免费 | 见 14.2，仅「方式 A」需要 |
| Cloudflare 账号 | 免费 | 见 14.4，只需邮箱 |
| GitHub 账号 | 免费 | **可选**，只有「方式 A」需要 |
| DeepSeek API Key | 按量付费 | 由**每个使用者自己**提供，部署者不需要 |

> 不需要：VPS、云服务器、数据库、Docker、Python、Coze、Dify。

### 14.1 安装 Node.js

1. 打开 <https://nodejs.org/zh-cn>，下载 **LTS** 版本（本机开发环境用的是 22 / 24）。
2. 一路「下一步」安装完成。
3. 打开终端（Windows 按 `Win + R` 输入 `cmd`），执行：

```bash
node -v
npm -v
```

看到版本号即成功。**版本要求：Node ≥ 20.19（推荐 22 或更高）** —— 这是 Vite 8 的硬性要求，
版本过低会在 Cloudflare 构建时报语法错误。

### 14.2 安装 Git（仅「方式 A」需要）

1. 打开 <https://git-scm.com/downloads> 下载并安装。
2. 验证：`git --version`

### 14.3 下载项目并本地跑通

**先本地跑通，再去部署** —— 本地能跑，部署 99% 也能跑；本地跑不通，部署只会更难查。

```bash
# 1) 进入项目目录（把路径换成你自己的）
cd demo

# 2) 安装依赖（约 1 分钟）
npm install

# 3) 启动前端
npm run dev
```

浏览器打开 <http://localhost:5173>。**再开一个终端**启动 Worker：

```bash
cd demo/worker
npm install          # 首次需要
npm run dev          # 启动在 http://127.0.0.1:8787
```

验证 Worker：浏览器打开 <http://127.0.0.1:8787/api/health> 应返回 `{"ok":true,...}`。

回到网页 → 右上角「设置」→ 填入你的 DeepSeek API Key → 点「测试连接」→
看到绿色**「连接成功」**就说明 `页面 → Worker → DeepSeek` 整条链路是通的。

> **第 7 点：前端如何连接本地 Worker？**
> 前端读的是 `.env.development` 里的 `VITE_API_ENDPOINT`，默认已写成
> `http://localhost:8787/api/chat`。改了 `.env.*` 必须**重启** `npm run dev` 才生效。
> 如果 Worker 换了端口，`worker/wrangler.toml` 的 `[dev] port` 与这里的地址必须一致。

### 14.4 注册 Cloudflare

1. 打开 <https://dash.cloudflare.com/sign-up>，用邮箱注册并验证。
2. 登录后进入 Dashboard。**不需要**添加域名，也不需要付费。

### 14.5 部署 Worker（第 11、12 点）

```bash
cd demo/worker
npx wrangler login        # 首次：会打开浏览器让你授权，点 Allow
npx wrangler deploy
```

成功后会输出类似：

```
Uploaded ai-edu-agent-api
Deployed ai-edu-agent-api triggers
  https://ai-edu-agent-api.<你的子域>.workers.dev
```

**把这一行地址记下来**，下一步要用。它对应的接口是
`https://ai-edu-agent-api.<你的子域>.workers.dev/api/chat`。

验证：浏览器打开 `https://ai-edu-agent-api.<你的子域>.workers.dev/api/health`，
应返回 `{"ok":true,...}`。

> 如果想改 Worker 名字，修改 `worker/wrangler.toml` 第一行的 `name`。
> 该名字决定最终域名，改名后记得重新记地址。

### 14.6 部署前端到 Cloudflare Pages（第 9、10 点）

有两种方式，**方式 B 更简单**（不需要 GitHub），推荐新手先用 B。

#### 方式 B：直接上传（推荐，最快）

```bash
cd demo
npm run build                                  # 生成 dist/
npx wrangler pages deploy dist --project-name ai-edu-agent
```

首次执行会让你选择/创建一个 Pages 项目，之后会输出访问地址，形如
`https://ai-edu-agent.pages.dev`。**把前端地址记下来**，下一步要用。

#### 方式 A：连接 GitHub（适合以后想自动部署）

1. 把代码推到 GitHub（先 `git remote add origin <你的仓库>`，再 `git push -u origin main`）。
   > ⚠️ 推送前确认 `.env.local` / `.dev.vars` 没有被提交（`.gitignore` 已处理），
   > 项目里也**不应该有任何真实 API Key**。
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**。
3. 选择你的仓库，然后填写构建配置：

| 配置项 | 值 |
| --- | --- |
| Framework preset | `None`（或 Vite） |
| Build command | `npm run build` |
| Build output directory | `dist` |
| 环境变量 `NODE_VERSION` | `22` |

> `NODE_VERSION=22` **很重要**：Pages 构建镜像的默认 Node 可能低于 Vite 8 要求的 20.19。
> 项目里已放了 `.node-version` 与 `.nvmrc`（内容都是 `22`）作为兜底，
> 但显式设置环境变量最稳妥。

4. 点 **Save and Deploy**。完成后同样会得到 `https://<项目名>.pages.dev`。

### 14.7 把 Worker 地址告诉前端（第 13 点）

前端需要知道 Worker 的地址。**推荐用 Pages 环境变量**（不用改代码、不用提交）：

1. Cloudflare Dashboard → **Workers & Pages** → 选中你的 Pages 项目 →
   **Settings** → **Environment variables**（生产环境 Production）。
2. 新增一条：

| 变量名 | 值 |
| --- | --- |
| `VITE_API_ENDPOINT` | `https://ai-edu-agent-api.<你的子域>.workers.dev/api/chat` |

3. 回到 **Deployments** → 对最新一次部署点 **Retry deployment**（必须重新构建才生效，
   因为 Vite 是在构建时把该变量写进产物的）。

> **已验证**：Cloudflare Pages 的环境变量会**覆盖**仓库里的 `.env.production`，
> 所以不需要去改那个占位符，也不需要再提交一次代码。

<details>
<summary>替代做法：直接改 <code>.env.production</code>（需要提交并重新部署）</summary>

```bash
# 编辑 demo/.env.production，把占位符换成你的真实地址
VITE_API_ENDPOINT=https://ai-edu-agent-api.<你的子域>.workers.dev/api/chat
```

```bash
npm run build
npx wrangler pages deploy dist --project-name ai-edu-agent
```

该地址会出现在前端产物里（这是正常的、公开的信息），但**绝不要**把 API Key 写进任何 `.env` 文件。
</details>

### 14.8 配置 CORS 白名单（第 14 点，最容易漏的一步）

Worker 默认只允许本地端口访问。现在要把它改成允许你的 Pages 域名，否则网页会报
`blocked by CORS policy`。

编辑 `demo/worker/wrangler.toml`：

```toml
[vars]
ALLOWED_ORIGINS = "https://ai-edu-agent.pages.dev,https://*.ai-edu-agent.pages.dev"
```

⚠️ **两个都要写**：

- `https://ai-edu-agent.pages.dev` —— 正式域名（apex）；
- `https://*.ai-edu-agent.pages.dev` —— 每次推送产生的预览域名。

通配符 `*.x.pages.dev` **不包含** `x.pages.dev` 本身，只写通配符会导致正式域名被拒。

本地端口（5173 / 4173 / 4180）在生产环境可以删掉，只留 Pages 域名更安全。
如果以后还要在本地连线上 Worker，再把它们加回去。

然后重新部署 Worker：

```bash
cd demo/worker
npx wrangler deploy
```

### 14.9 最终测试（第 15 点）

在**手机浏览器**或另一台电脑上打开 `https://ai-edu-agent.pages.dev`，依次确认：

1. 页面能打开，左侧 / 顶部显示「AI 教育智能体」；
2. 首次进入显示欢迎引导与「配置 DeepSeek API」按钮；
3. 填入自己的 DeepSeek API Key → 点「测试连接」→ 显示绿色**「连接成功」**；
4. 输入「帮我设计一节小学二年级数学《分类与整理》课程」→ 回答**逐字出现**（流式）；
5. 生成过程中点「停止生成」→ 已输出内容保留；
6. 点「重新生成」→ 重新流式输出，且问题不会变成两条；
7. **按 F5 刷新** → 聊天记录仍在；
8. 关闭浏览器标签页再打开 → 历史仍在（若勾选了「在此设备记住 API Key」，无需重新输入）；
9. 悬停（手机上一直可见）会话的「⋯」→ 重命名 / 删除都可用；
10. 设置里「清除本地聊天记录」→ 确认 → 列表清空。

### 14.10 以后如何更新

| 改动内容 | 需要做什么 |
| --- | --- |
| 改前端（UI / Prompt / 逻辑） | `npm run build` → `npx wrangler pages deploy dist --project-name ai-edu-agent`（方式 A 则只需 push） |
| 改 Worker（转发逻辑 / 白名单） | `cd worker && npx wrangler deploy` |
| 改产品名称 / 副标题 | 只改 `src/config/app.ts` 后重新部署前端 |
| 改 System Prompt | 只改 `src/prompts/*.ts` 后重新部署前端（新请求立即生效） |
| 改品牌配色 | 只改 `src/index.css` 的 `@theme` 后重新部署前端 |

### 14.11 本次部署实录（真实地址与踩到的坑）

本项目已按上述流程部署完成，实际使用的值如下，可作为对照：

| 项 | 值 |
| --- | --- |
| Cloudflare 账号 | `<你的 Cloudflare 账号邮箱>` 的账号 |
| workers.dev 子域名 | `edu-demo-2026`（首选 `edu-demo` 已被占用） |
| Worker 名 / 地址 | `ai-edu-agent-api` → https://ai-edu-agent-api.edu-demo-2026.workers.dev |
| Pages 项目 / 地址 | `ai-edu-agent` → https://ai-edu-agent.pages.dev |
| `ALLOWED_ORIGINS` | `https://ai-edu-agent.pages.dev,https://*.ai-edu-agent.pages.dev` + 本地端口 |

**踩到的 6 个坑（都已解决，你可能会遇到其中的某些）**：

1. **没有 workers.dev 子域名 → 部署直接失败**
   报 `You need to register a workers.dev subdomain before publishing to workers.dev`。
   这是**账号级一次性设置**，去 Workers & Pages 首页（或 API）注册即可。
   子域名全 Cloudflare 唯一，`edu-demo` 就被占用了。

2. **新注册的子域名的 DNS 需要等一会儿**
   刚注册完立即访问会失败（本机解析甚至返回了错误的 IP）。
   等约 1 分钟即正常，wrangler 输出的地址本身是对的。

3. **本地 git 分支名会影响部署环境**
   本地分支是 `master`，而项目生产分支是 `main`，直接 `wrangler pages deploy` 会部署成
   **Preview**（`master.xxx.pages.dev`）。要上生产域名必须显式指定：

   ```bash
   npx wrangler pages deploy dist --project-name ai-edu-agent --branch main --commit-dirty=true
   ```

4. **`[vars]` 改动后边缘生效有延迟**
   改完 `ALLOWED_ORIGINS` 重新部署，`/api/health` 里的 `allowedOrigins` 可能还要
   半分钟到一分钟才变。不要以为没生效就反复改。

5. **国内网络访问 `*.workers.dev` / `*.pages.dev` 需要代理**
   本机直连被阻断，必须走代理才能打开。这一点对**你的用户**同样成立 ——
   见 16.18。

6. **懒加载的公式分块在慢网络下会「晚一步」**
   首屏不含 KaTeX（这是体积优化），刷新后若第一眼就要渲染带公式的历史消息，
   会先看到一瞬间的原始 `$$...$$`。已通过「浏览器空闲时预取公式分块」缓解
   （`MarkdownRenderer.tsx` 的 `prefetchMathChunk`），首屏体积不受影响。

### 14.12 部署后的验证结果

| 验证 | 方式 | 结果 |
| --- | --- | --- |
| 前端可访问 | `curl https://ai-edu-agent.pages.dev` | ✅ HTTP 200 |
| Worker 健康检查 | `GET /api/health` | ✅ `{"ok":true,...,"allowedOrigins":8}` |
| Pages 域名预检 | `OPTIONS /api/chat` + `Origin: https://ai-edu-agent.pages.dev` | ✅ 204 + 正确的 ACAO |
| 未授权来源被拒 | `Origin: https://evil.example.com` | ✅ 403 `origin_not_allowed` |
| 真实上游转发 | 假 Key POST（非流式与流式） | ✅ 401 `invalid_api_key` + 中文提示，Key 脱敏为 `****0000` |
| SSRF 防护 | `baseUrl: https://evil.example.com` | ✅ 400 `base_url_not_allowed` |
| Worker 全量自检 | `node worker/test/worker-check.mjs <线上地址>` | ✅ **38/38 通过** |
| 前端全量检查 | 无头浏览器打公网链接（走代理） | ✅ **28/28 通过** |
