# UI 信息架构 · 多 Agent 控制台(给 Antigravity / "agy")

> 在现有 5 个界面(任务 / Skill 库 / 失败模式 / 接手导出 / 设置,见 design/screens.md)之上,
> 新增"执行层"的五大区:**Agents / Sessions / Config / Locks / Handover**。
> 本文只定信息架构(导航、每区的对象、核心视图、动作、状态),不画像素。对应后端见 contracts/agent-commands.md。

## 顶层导航(左侧)

```
AEL
├─ 任务 Tasks         (已有:经验记录主线)
├─ Agents            ★ 注册的 agent 种类 + 配置档(Profile)
├─ Sessions          ★ 正在跑/跑过的 agent 会话(终端 + 上下文)
├─ Config            ★ Provider/Profile/MCP 配置(统一兼容层)
├─ Locks             ★ 资源锁:谁在改哪个仓库/工作树
├─ Handover          接手包导出/导入 + 统一启动 Prompt 预览
├─ Skill 库          (已有)
├─ 失败模式 Guard     (已有)
└─ 设置 Settings      (已有 + CLI 检测/数据目录)
```

关系一句话:**在某个 Task 里,选一个 Agent + Profile → 启动一个 Session(占用相关 Lock)→ 过程落成证据链 → 受阻/完成时走 Handover。**

---

## 1. Agents

**是什么**:可用的 agent "种类"(claude_code / codex / gemini / shell)及其能力与默认 Profile。区分"定义"和"实例"——实例就是 Session。

- 列表:每个 agent 卡片 = 图标 + 名称 + 是否已安装(CLI 检测)+ 版本 + 默认 Profile + 能力标签(支持 MCP / 流式 / 1M 上下文…)。
- 详情:可执行路径、启动命令模板、支持的 Profile 列表、健康检查("诊断")。
- 动作:检测安装、设默认 Profile、新建 Session(跳到 Sessions)、打开对应 Config。
- 空状态:"未检测到 Claude/Codex/Gemini CLI,去 设置 安装或填可执行路径。"

## 2. Sessions(执行层核心)

**是什么**:一次 agent 运行 = 一个 PTY 会话。这里就是"调用终端、读上下文消息"落地的地方。

- 列表:会话卡片 = agent + Profile + 关联 Task + 状态徽章 + 起止时间 + 当前上下文用量(tokens/字符,估算)。
- 状态机:`starting → running → waiting_input → paused → exited(success/error) → archived`。
- 详情(主视图):
  - **终端面板**:实时输出(PTY),可滚动/搜索/复制;底部输入框发指令(stdin);按钮:中断(Ctrl-C)、停止、重启、清屏。
  - **上下文面板**:当前会话上下文大小 + "压缩"动作(三种,见下);压缩历史可查看。
  - **证据流**:右侧实时显示从输出归一出的事件(step/error/fix/…),一键"确认入库"到关联 Task 的证据链。
  - **关联**:绑定的 Task / 占用的 Locks / 注入的启动 Prompt(可展开看)。
- 动作:启动(选 agent+profile+repo+task)、发送输入、中断/停止、压缩上下文、归档、导出为 handover、把某段输出标记为 error/decision。
- "压缩上下文"三入口(对应你确认的"以上都要"):
  1. 长输出**摘要入库**(写证据链/handover 前压成要点);
  2. 跨 agent 传递时**压到目标 token 预算**;
  3. 给新 agent **注入压缩版历史**(= 增强版 handover Prompt)。

## 3. Config(Provider / Profile / MCP)

**是什么**:统一管理"用谁家服务"的兼容层。详见 provider 配置清单。

- 三个子页:**Providers**(供应商:name/key/endpoint/model/API格式)、**Profiles**(Provider×App 的具体配置 + env 覆盖)、**MCP Servers**(统一清单,激活时按各 CLI 格式下发)。
- 列表:Provider 卡片 = 名称 + 目标 App(claude/codex/gemini/universal)+ 模型 + 是否激活 + 备注;支持搜索/排序/复制/删除。
- 详情:表单(预设下拉自动填 endpoint)+ JSON/TOML 高级编辑 + "测试连通"(/v1/models 探测)。
- 动作:新建(预设/自定义)、激活(env 覆盖 or 写入 CLI 文件,二选一,默认 env 覆盖不动用户文件)、测试、设默认、导入(deeplink/备份)。
- 安全:Key 脱敏显示;冲突检测条(环境里已有同名变量时提示)。

## 4. Locks(多 agent 不互相踩)

**是什么**:运行期资源锁,防止两个 agent 同时改同一仓库/工作树/文件(把 design 里"别同时改同一个文件"的纪律变成运行期强制)。

- 列表:每条 = 资源(repo/worktree/branch/路径)+ scope(repo/worktree/path)+ 持有者(session/agent)+ 关联 Task + 获取时间 + 状态(held/stale)。
- 动作:手动获取/释放、**强制释放**(带确认,处理崩溃残留锁)、查看冲突(谁在等)。
- 交互约定:启动 Session 选了 repo → 自动尝试获取锁;拿不到 → 阻止启动并提示"X 正在占用,可排队/强制"。Session 结束自动释放。
- 顶部说明条:"锁用于避免多个 agent 同时改同一工作树。"

## 5. Handover

**是什么**:已有接手包能力 + 新的"统一启动 Prompt"。详见 design/launch-prompt-template.md。

- 导出弹窗(已有):勾选包含项 + 实时预览接手 Prompt + 导出 zip。
- 新增:**启动上下文预览**——选 Task + 目标 agent + Profile,实时拼出"Failure Guard + Skill + handover + repo"的统一启动 Prompt,可"复制"或"直接用它启动一个 Session"。
- 导入:选 handover.zip → 在本地重建 Task/证据链(已有)。

---

## 跨区状态与实时性(给前端的技术约定)

- **实时**:Sessions 的终端输出与状态、Locks 变化,走 Tauri 事件流(后端 emit,前端订阅),不要轮询。命令只负责发起动作与拉快照。
- **错误形状**:统一 `AelError { code, message }`(沿用现有契约)。
- **分页**:列表统一 `{ limit?, offset? }`(沿用现有契约)。
- **大小写**:IPC 入出参 camelCase(沿用现有契约)。
- **空/加载/错误**:每个列表三态都要有占位;终端面板要有"会话已退出"的终态展示与重启入口。

## 与已有信息架构的衔接

- Task 详情页新增"运行"动作 → 选 agent+profile → 起 Session;Session 的证据流确认后即并入该 Task 的证据链 → finalize 仍照旧出 Skill/Failure。
- 这样"执行层(Agents/Sessions/Config/Locks)"喂数据,"经验层(Tasks/Skill/Guard/Handover)"消费数据,闭环不变,只是把"人手敲事件"换成"agent 实跑自动产事件"。
