# 项目地图（Agent 版）

## 项目目标

构建一个**可公网访问的网页版 AI 教育智能体**，产品定位：

> 一个链接即可访问的独立智能体。

- 用户打开 `https://xxx.pages.dev` 即可使用，无需安装任何软件、无需注册登录。
- 用户**自带 DeepSeek API Key**（首次使用时在网页内填写），模型 Token 成本由用户自己的账户承担。
- 运营方固定成本为 0：纯静态前端（Cloudflare Pages）+ 无状态转发 Worker（Cloudflare Workers）。
- 第一版不含账号系统、不含云端数据库、不含云端聊天记录。

## 技术路线

```
用户浏览器
  ↓  React Web App（UI / 会话管理 / 模式切换 / 本地历史 / 设置）
  ↓  Cloudflare Worker（/api/chat，无状态转发 + CORS + 流式透传）
  ↓  DeepSeek API（OpenAI-Compatible /chat/completions, stream: true）
  ↓  SSE 流式返回，前端逐 chunk 渲染
```

- 聊天历史：IndexedDB（浏览器本地，刷新/重开仍在，跨用户互相隔离）
- 用户偏好：localStorage（模式、Base URL、Model 等非敏感项）
- API Key：默认 sessionStorage；用户主动勾选「在此设备记住」后才存 localStorage
- Worker 不保存任何 Key 与聊天内容，不写日志，不使用 KV / D1

## 目录职责（规划，随阶段落地）

```
demo/
├─ index.html                # 前端入口 HTML
├─ vite.config.ts            # Vite 配置（React + Tailwind 插件、@ 别名）
├─ tsconfig*.json            # TypeScript 严格模式配置
├─ .env.development          # 本地开发端点（指向 localhost:8787 Worker）
├─ .env.production           # 生产端点（部署 Worker 后填写）
├─ public/_redirects         # Cloudflare Pages SPA 回退，避免刷新 404
├─ src/
│  ├─ config/                # 品牌与 API 配置（app.ts / api.ts）
│  ├─ types/                 # 公共类型（chat / conversation / settings）
│  ├─ prompts/               # 教师 / 学生 System Prompt 与 getSystemPrompt()
│  ├─ db/                    # IndexedDB 封装（idb）
│  ├─ services/              # chatApi（SSE 解析）、storage（Key 与偏好读写）
│  ├─ hooks/                 # useChat / useApiSettings / useConversations
│  ├─ components/            # layout / chat / settings / history / common
│  └─ App.tsx                # 组装层，只做组合不写业务
├─ worker/                   # Cloudflare Worker（独立 package.json + wrangler.toml）
└─ project_memory/           # 项目长期记忆
```

## 关键约束（不可违反）

1. 源码、仓库、Cloudflare 环境变量中**永远不出现真实 API Key**。
2. Worker 只做无状态转发：不持久化、不写日志、不回显 Key、错误信息中脱敏。
3. Worker 必须做 Base URL 白名单校验，防止 SSRF。
4. 聊天历史只存 `user` / `assistant`，System Prompt 在调用时动态插入。
5. 必须实现真正的 SSE 流式输出，并处理跨 chunk 截断的 JSON（使用 buffer 按行解析）。
6. 产品名称、品牌统一在 `src/config/app.ts`，不在组件中硬编码。

## 实施阶段（每阶段验证通过后再进入下一阶段）

1. 项目骨架（React 页面可运行）
2. 静态 UI（模拟消息）
3. API 设置（Key 输入与保存）
4. Cloudflare Worker 建立
5. DeepSeek 非流式请求打通
6. 改为 Streaming
7. 网页接入 Streaming
8. 教师 / 学生 Prompt
9. IndexedDB 历史记录
10. 新建 / 删除 / 重命名对话
11. 错误处理完善
12. 移动端适配
13. 生产 Build
14. Cloudflare Pages + Worker 部署
