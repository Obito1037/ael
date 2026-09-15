# AEL 前端落地说明

## 已落地

- 暖纸浅色、亚麻浅色、暖炭深色和高对比主题。
- 桌面应用壳：可收起侧栏、最近任务、任务沉淀入口、安全状态、浮动玻璃顶栏。
- 新任务首页：目标、项目、分支、Agent、真实 Skill 搜索、Failure Guard 和注入预览。
- 记忆治理：记忆库、草案待确认、基础健康诊断、保鲜检查、重验、停止召回、恢复、失败教训和 Agent 推荐。
- 原 9 个页面的 Tauri invoke、事件监听、浏览器 mock 与跨页行为保持可用。
- Review 删除了固定的“40 分钟对 5 分钟”宣传数据，只展示真实 Brief 字段。
- Pending/Decision 独立 ID 时改为从后端刷新 pending 快照；Decision 在 Store 中按 ID 去重。

## 后端能力边界

当前可以真实操作：

- Skill draft → active。
- Skill active → deprecated，作为可逆的“停止召回”。
- Skill deprecated → active，恢复召回。
- freshness check 与 revalidate。
- 目标相关 Skill 搜索和 Failure Guard。
- 任务、证据、Agent 会话、安全裁决、Brief、ADR、commit ledger 和行级溯源。

当前只适合保留在概念设计稿，不能在前端伪装为可用：

- 编辑或合并 Skill 正文。
- 单条 Failure 的停用与恢复。
- 逐条勾选后把指定 Skill ID 传入启动上下文。
- 完整 usage 明细、真实 confidence、TTL、冲突和 supersedes 图谱。
- 精确计算遗忘对未来任务的影响范围。

## 主要文件

- `src/App.tsx`：新应用壳、导航、全局事件桥和安全状态。
- `src/index.css`：设计令牌、主题、玻璃材质、应用壳和响应式行为。
- `src/ui.tsx`：Panel、Button、Badge、Modal、PageTitle 等共享原语。
- `src/themes.ts`：暖纸主题注册与持久化。
- `src/views/Overview.tsx`：新任务与记忆注入预览。
- `src/views/Memory.tsx`：记忆库、Inbox、Health、可逆遗忘和 Agent 路由。
- `src/views/Console.tsx`：真实 Agent 工作台，保留 xterm 与 Tauri 事件。
- `src/views/Tasks.tsx`：任务历史和证据链。
- `src/views/Gate.tsx`：安全裁决、策略与命令试判。
- `src/views/Briefs.tsx`、`Adr.tsx`、`Blame.tsx`：Review、决策和来源链。
- `src/views/Settings.tsx`：本地数据、检索、Agents 和主题。
- `tests/e2e.spec.ts`：新 IA 的浏览器 mock 主流程冒烟测试。

## 验证

```powershell
npm run typecheck
npm run build

# Terminal 1
npm run dev -- --host 127.0.0.1

# Terminal 2
npx playwright test --reporter=line
```

生产构建仍会提示单个 JS chunk 大于 500 kB，主要来自 xterm 和当前同步页面入口；这是性能优化提示，不影响本次构建成功。后续可把 Console 和低频治理页面改成 `React.lazy` 分包。
