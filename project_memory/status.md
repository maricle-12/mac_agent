# 当前状态

## 总体进度

**阶段 2 / 14 —— 已完成并验证通过（等待用户确认后进入阶段 3）**

## 已完成

### 阶段 1：项目骨架

- Vite 8 + React 19 + TypeScript 5.9（strict）+ Tailwind CSS v4。
- 配置层：`src/config/app.ts`（品牌）、`src/config/api.ts`（端点 / Provider / 上下文上限）。
- 公共类型、环境变量方案（仅端点，禁止 Key）、SPA 回退 `public/_redirects`。
- 已 `git init` 并完成首次提交。

### 阶段 2：完整静态 UI（含可交互的内存态）

- 布局：`AppLayout`（桌面固定侧边栏 / 移动端抽屉）、`Sidebar`、`Header`。
- 聊天：`ChatView`、`MessageList`（自动跟随滚动 + 回到底部）、`MessageBubble`
  （用户气泡 / AI 气泡 / 复制 / 重新生成）、`ChatInput`（多行自适应、Enter 发送、
  Shift+Enter 换行、输入法合成保护、停止生成、文件上传占位）、`EmptyState`
  （首次使用引导 + 双模式快捷卡片）。
- Markdown：`MarkdownRenderer` + `CodeBlock`（语言标签 + 复制），
  支持标题 / 列表 / 表格 / 引用 / 代码块 / 链接 / 行内与块级 KaTeX 公式。
- 弹窗：`Modal`、`ConfirmDialog`、`ApiSettingsModal`（表单 UI 完整，保存为内存态）、
  `AboutModal`。
- 历史记录 UI：`ConversationList` / `ConversationItem`（悬停 ⋯ 菜单、重命名、删除确认、
  模式徽标、相对时间）。
- 状态与业务：`useConversations`（增删改 + 模式更新，内存实现）、
  `useChat`（发送 / 停止 / 重新生成 / 输入 / 状态机）。
- 工具：`cn`、`id`、`clipboard`（含降级）、`time`、`title`（会话标题生成）、
  `markdown`（块级公式规范化）。
- 无障碍/健壮性：`data-testid` 布局钩子、`aria-label`、移动端无横向溢出。

## 验证结果（全部通过）

- `npm run build`：`tsc -b` 零类型错误，产出 `dist/`。
- `npm run check:ui`（新增的 12 项无头浏览器自动化检查，dev 与生产 preview 各跑一次）：
  首屏渲染 / Markdown 与公式 / 会话切换同步模式 / 空状态与快捷卡片 / 快捷卡片填词 /
  发送与思考态 / 重新生成不重复用户消息 / 停止生成 / API 设置弹窗 / 删除确认 /
  桌面布局验收（1920×1080、1440×900、1366×768）/ 移动端侧边栏抽屉。
- 三档桌面分辨率下：侧边栏 240~280px、正文 700~900px、无横向溢出、
  顶部栏与输入区固定、消息区独立滚动。
- 每次运行均无 `console.error`、无未捕获异常、无浏览器日志错误。
- 安全扫描：源码无 `sk-` 形态密钥，无 `VITE_*_API_KEY` 注入。

## 当前状态

- 目录：`H:\agent\demo`（工作区 `H:\agent`）
- 环境：Node v24.15.0 / npm 11.12.1 / git 2.54.0；构建与检查均已跑通。
- 后台 dev server job：`pwsh-30`（`http://localhost:5173`）。
- 依赖新增：`react-markdown`、`remark-gfm`、`remark-math`、`rehype-katex`、`katex`、`idb`。
- 生产包体积：JS 697 kB（gzip 213 kB）、CSS 59 kB（gzip 14 kB），
  其中 KaTeX 占主要部分；代码分割留到阶段 13。
- **临时实现**：`src/mocks/mockData.ts` 提供模拟会话与模拟回答；
  API Key 与设置仅存在于内存，刷新即丢失。

## 下一步（阶段 3：API 设置）

1. 新建 `src/services/storage.ts`：分离 `sessionStorage` / `localStorage` 两类 Key 存储，
   并用 `localStorage` 保存非敏感设置（provider / baseUrl / model / rememberApiKey）。
2. 新建 `src/hooks/useApiSettings.ts`：读取、保存、清除 API Key 与设置。
3. `App.tsx` 改为使用该 Hook；`ApiSettingsModal` 接入真实保存、清除与「记住此设备」。
4. 验证：输入 Key → 保存 → 刷新页面，未勾选时不保留、勾选后保留；清除按钮可用。
5. 「测试连接」仍需等待阶段 4 / 5 的 Worker 就绪。

## 风险与限制

- Worker 尚未创建（阶段 4），无法真实调用模型；`测试连接` 按钮当前禁用并标注原因。
- 无真实 DeepSeek API Key，阶段 5 之后需要用户提供 Key 才能做端到端联调。
- `.env.production` 中的 Worker 地址仍是占位符，部署前必须替换（阶段 14）。
- 会话历史目前只存在内存中，刷新即回到种子数据（阶段 9 修复）。
