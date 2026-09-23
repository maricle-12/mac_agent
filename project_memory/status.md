# 当前状态

## 总体进度

**阶段 9 / 14 —— 已完成并验证通过（等待用户确认后进入阶段 10）**

## 阶段 1 ~ 8 ✅

骨架 / 静态 UI / API 设置持久化 / Worker / 非流式转发与测试连接 / SSE 解析与流式验证 /
前端真实流式 / 教师学生 Prompt。详见 `decision.md`。

## 阶段 9：IndexedDB 历史记录 ✅

- `src/db/indexedDb.ts`（新增）：
  - 数据库 `ai-edu-agent`，表 `conversations`，`keyPath: 'id'` + `updatedAt` 索引；
  - 一个会话（含 messages）作为一条记录整体存取；
  - `listConversations` / `getConversation` / `putConversation` / `deleteConversation` /
    `clearConversations`；隐私模式下全部降级为静默无操作，绝不抛异常；
  - `requestPersistentStorage()`：申请持久化存储，降低聊天记录被回收的概率；
  - `estimateStorageUsage()`（暂未在 UI 使用）。
- `src/hooks/useConversations.ts` 重写为 IndexedDB 持久化，**对外接口保持不变**：
  - 首屏异步加载，`ready` 标记避免闪一下空状态；
  - 写库**按会话节流 400ms**（流式增量频繁，避免每个 token 都写盘）；
  - 新建 / 删除**立即落库**；`pagehide` / `visibilitychange` 时冲刷待写入内容；
  - `activeId` 持久化到 `preferences.activeConversationId`，刷新回到上次会话；
  - 暴露 `storageAvailable` 用于提示隐私模式不可用。
- **删除 `src/mocks/mockData.ts` 与整个 `src/mocks/`**：全新用户从空状态 + 欢迎引导开始
  （符合需求文档 §11 / §22，不再有假会话和假回答）。
- 设置弹窗新增「本地数据」区块：显示对话数量、IndexedDB 不可用提示、
  **「清除本地聊天记录」**（二次确认，对应需求文档 §35）。
- `App.tsx`：未 `ready` 时显示「正在读取本地记录…」，清除聊天记录走 ConfirmDialog。

## 验证结果（全部通过）

- `npm run build`：零 TypeScript 错误。
- `npm run check:ui`（**23 项**）：
  - dev（`http://localhost:5173`）：**23/23 通过**；
  - **生产构建**（用被 gitignore 的 `.env.production.local` 指向本地 Worker，
    跑的是压缩后的真实产物）：**23/23 通过**；
  - 端点仍为占位符时：13 通过 + 10 项按预期 SKIP。
  - 新增 4 项持久化验证：
    1. 首屏（空库）显示欢迎引导 + 空状态，而不是假数据；
    2. **刷新后会话与消息仍在** —— 断言会话数量不变、刷新后回到上次活跃会话、
       消息内容/表格/块级公式/代码块全部保留；
    3. 删除会话后刷新**不会复活**，且会话数量正确减一（直接读 IndexedDB 校验）；
    4. 「清除本地聊天记录」后侧边栏清空，**刷新后仍为空**，且清除后仍可正常新建对话。
- `npm run check:sse`：30/30；`cd worker && check`：38/38。
- 无 `console.error`、无未捕获异常；两条预期内的 401 网络日志已显式容忍。

## 过程中修掉的问题（都是测试/harness 问题，产品代码无缺陷）

1. **harness 重复计数**：移动端用例打开侧边栏抽屉后没有关闭，抽屉虽然 `md:hidden`
   但仍在 DOM 中，导致其后所有「会话数量」统计翻倍（5 个会话数成 10），
   一度误判为「刷新丢了 5 个会话」。已让统计只计入可见元素，并在移动端用例结束时关闭抽屉。
2. 删除用例只点了菜单里的「删除」，漏点确认弹窗里的「删除」（两者文案相同，需要点两次）。
3. `evaluate()` 改为 `(async () => {...})()` 包装，使页面表达式内可以使用 `await`
   （便于直接读 IndexedDB 校验），这是个通用能力提升。

## 当前状态

- 后台任务：`pwsh-30`（前端 dev 5173）、`pwsh-35`（wrangler dev 8787）。
- 会话历史已完整持久化在浏览器；示例数据已移除，全新环境从空状态开始。
- 真实流式链路仍建议用户用 `npm run check:stream` 或浏览器亲自确认一次。

## 下一步（阶段 10：新建 / 删除 / 重命名对话）

大部分 UI 已在阶段 2 实现并被阶段 9 的用例覆盖（新建、⋯ 菜单、重命名弹窗、删除确认）。
本阶段补齐与打磨：
1. 补一条「重命名」的自动化用例（输入新标题 → 保存 → 刷新后仍是新标题）；
2. 标题为空 / 全空格时的处理；超长标题截断展示；
3. 删除当前会话后自动选中相邻会话（当前是 activeId 置空 → 空状态，可优化为选中下一条）；
4. 会话列表空状态、加载态文案统一；
5. 确认「切换模式建新对话」与「删除」不会产生空会话堆积（可考虑删除空会话的清理策略）。

## 风险与限制

- 真实流式链路尚未由代理亲自跑通（无 Key）。
- `.env.production` 仍是占位符，阶段 14 必须替换。
- 重命名与「删除后自动选中相邻会话」尚未有自动化用例覆盖。
