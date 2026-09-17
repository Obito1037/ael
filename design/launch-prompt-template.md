# 统一启动 Prompt 模板

> 目标:启动 Codex / Claude / Gemini 前,把 **Failure Guard 约束 + 相关 Skill + handover/证据 + repo 信息**
> 拼成一段统一的"启动上下文",让任何 agent 一上来就带着历史经验、避开旧坑、对齐工作树。
> 由 `build_launch_context(taskId, agentKind, profileId)` 生成(见 contracts/agent-commands.md),
> 数据来自现有 `check_failure_guard` + `search_skills` + `generate_handover_prompt` + task.repo。

## 设计原则

1. **约束前置**:Failure Guard 的硬约束放最前(最重要,且防止被后文淹没)。
2. **可执行而非叙事**:给规则、步骤、验证标准,不堆历史流水。
3. **预算可控**:整体目标 ≤ 设定 token 预算;超了按"压缩优先级"裁剪(见末尾),底线保留约束 + 目标 + repo。
4. **按 agent 微调**:同一份 Markdown 主体,按目标 CLI 调整外壳(见"按 agent 适配")。
5. **可追溯**:列出经验来源(Skill/Failure 名),便于 agent 决定信任度,也便于事后复盘。

## 模板(Markdown 主体,带占位符)

```
# 启动上下文 · {{task.title}}

## 0. 你的任务
- 目标:{{task.goal}}
- 标签:{{task.tags|join(", ")}}
- 当前状态:{{task.status}}

## 1. 必须遵守的约束(来自历史失败 · 违反=重复踩坑)
{{#each guard.constraints}}
- {{this}}
{{/each}}
{{^guard.constraints}}-(无命中约束){{/}}

## 2. 务必规避的坑(历史失败,已过相关度阈值)
{{#each guard.matchedFailures}}
- {{description}}(出现 {{occurrences}} 次)· 规避:{{guardRule}}
{{/each}}

## 3. 可复用的经验(Skill)
{{#each skills}}
- {{name}}:{{trigger}}
  {{body|firstSection}}        # 只放"约束/步骤/如何验证"的要点,正文可折叠
{{/each}}

## 4. 仓库与工作树(动手前对齐)
- 路径:{{task.repoPath}}
- 分支/提交:{{task.repoBranch}} @ {{task.repoCommit}}
- 请先把工作树对齐到该 commit/branch,再开始改动。

## 5. 此前进展与未决(若是接手)
{{handover.inTaskPitfallsAndDecisions}}   # 复用 generate_handover_prompt 的"坑与决策"段
{{handover.openQuestions}}

## 6. 工作纪律
- 每完成一步,用一句话记录:做了什么 / 遇到的错 / 如何修 / 如何验证(这些会回流成新的 Skill/Failure)。
- 命中上面的约束时,显式说明你是怎么遵守的。
- 完成后给出验证结果(命令 + 预期产物)。
```

## 渲染示例(claude_code,Tauri 构建任务)

```
# 启动上下文 · 构建 Tauri 应用(首次)

## 0. 你的任务
- 目标:在 Windows 上首次构建 Tauri 2 桌面应用
- 标签:tauri, windows, build
- 当前状态:in_progress

## 1. 必须遵守的约束(来自历史失败 · 违反=重复踩坑)
- 遇到「linker `link.exe` not found」时:安装 VS Build Tools 并勾选 C++ 桌面开发

## 2. 务必规避的坑(历史失败,已过相关度阈值)
- 链接器找不到(出现 2 次)· 规避:构建前确认装了 VS C++ 工具链

## 3. 可复用的经验(Skill)
- Tauri 2 Windows 构建缺少 C++ Build Tools:Windows 首次 tauri build 报 link.exe not found
  约束:构建前确认装了 VS Build Tools;装完重开终端让 PATH 生效。验证:产出 .msi 即成功。

## 4. 仓库与工作树(动手前对齐)
- 路径:D:/repo  · 分支/提交:main @ abc123
- 请先把工作树对齐到该 commit/branch,再开始改动。

## 6. 工作纪律
- 每完成一步,用一句话记录:做了什么 / 遇到的错 / 如何修 / 如何验证。
- 命中约束时显式说明如何遵守。完成后给出验证结果。
```

## 按 agent 适配(同主体,换外壳)

| agent | 注入方式 | 外壳处理 |
|---|---|---|
| claude_code | 作为首条用户消息;或写入 `CLAUDE.md`/`--append-system-prompt` | 保留 Markdown 原样,Claude 对 md 友好 |
| codex | 作为首条输入;或项目 `AGENTS.md` | 同 Markdown;约束段可加 "Treat section 1 as hard constraints" |
| gemini | 首条输入;或 `GEMINI.md` | 同 Markdown |
| shell/其他 | 作为提示文件路径或 stdin 首段 | 纯文本,去掉 md 标记可选 |

外壳由各 adapter 负责;主体内容完全一致,保证经验注入口径统一。

## Token 预算与压缩优先级

`build_launch_context` 估算 token;超 `tokenBudget` 时按此顺序裁剪(调 `compress_context(mode='budget')`):

1. 先压第 3 节 Skill 正文(只留 trigger + 约束一行);
2. 再压第 5 节历史进展(摘要化);
3. 再砍第 2 节失败到 Top-N;
4. **永不删**:第 0(目标)、第 1(硬约束)、第 4(repo 对齐)——这三段是底线。

## 与现有代码的对接点

- 第 1/2 节 ← `check_failure_guard(goal, tags)` 的 `constraints` / `matchedFailures`。
- 第 3 节 ← `search_skills(goal+tags)` 的 active Skill(取 trigger + body 首节)。
- 第 4 节 ← `tasks.repoPath/repoBranch/repoCommit`。
- 第 5 节 ← `generate_handover_prompt` 的"坑与决策 / 未决问题"段。
- 即:本模板 = 已有四个能力的**组合器**,不需要新引擎,只需 `build_launch_context` 做拼装 + 预算裁剪。
