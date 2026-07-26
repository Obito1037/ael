# Skill · 接手 Prompt 必须自带"决策与坑",不能只甩时间线

> Phase 3 联调时自举沉淀:验收场景 2(零上下文接手)暴露的接缝。

- **id**: draft-handover-self-sufficiency
- **status**: draft
- **version**: 1
- **tags**: handover, prompt, agent, integration
- **来源任务**: AEL Phase 3 联调 / 零上下文接手

## Trigger(何时适用)
生成给"另一个 Agent"的接手 Prompt 时;尤其任务执行到一半受阻、需要换人/换 Agent 继续。

## Body

### 根因
只把完整证据链按时序倒给接手者,信息是"全"的但不是"可用"的——接手 Agent 得自己从一长串事件里反推"为什么这么决定""哪些坑已经踩过"。零上下文接手会失败在这一步。

### 约束
- Prompt 里除了时间线,必须有一段**显式提炼**:本任务的 error→fix(坑+如何处理)与 decision(决策+理由)。
- 带上仓库对齐信息(path/branch/commit),否则接手者工作树对不齐。
- 末尾给"你的下一步",并要求接手者继续把过程追加成新事件(保持证据链不断)。

### 步骤
1. 渲染任务头(目标/状态/标签/仓库)。
2. 渲染完整证据链(可追溯)。
3. **额外**渲染"此前的坑与决策"提炼段(可用)。
4. 附历史失败约束 + 可复用 Skill + 未决问题。
5. 收尾给下一步指引。

### 验证
- 断言生成的 Prompt 同时包含:关键决策、决策理由、踩过的坑、坑的处理、仓库 commit、下一步。
- 把 Prompt 单独交给一个全新 Agent,它无需口头补充即可继续(见 tests/scenarios_tests.rs 场景 2 与 verify_scenarios.py 打印的实际 Prompt)。
