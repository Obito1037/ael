# AHP · Agent Handover Protocol(开放交换标准 v2)

> handover.zip 从「换人续做的打包」升级为**溯源与责任凭证 + 开放交换格式**。
> 接手方不限于另一个人或另一个 CLI —— 也包括「下一代模型」:模型升级时,长任务无损迁移续跑。

## 1. 传输形态

一个 zip 文件,布局:

```text
handover.zip
├── manifest.json        # 唯一必需文件,schema 见 §2
├── handover_prompt.md   # 人类/Agent 可直接阅读的接手 Prompt(manifest.handover_prompt 的落盘副本)
├── brief.md             # (可选)Review Brief —— 一页审阅证据
└── evidence/            # (可选)按 evidence_ref 引用的原始证据文件
```

消费方**只应依赖 manifest.json**;其余文件是给人读的便利副本。

## 2. manifest.json(schema_version = 2)

顶层字段(snake_case;`additionalProperties: false`):

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `schema_version` | int | ✓ | 本规范为 `2`。消费方遇到更高版本应拒绝而非猜测 |
| `ahp_version` | string | ✓ | `"AHP/2.0"` 协议标识 |
| `generated_at` | string | ✓ | ISO-8601 UTC |
| `generated_by` | string? | | 产生方 agent id |
| `ael_version` | string? | | 打包工具版本 |
| `task` | Task | ✓ | 见 §2.1 |
| `events` | Event[] | ✓ | 完整证据链(可为空数组) |
| `relevant_skills` | object[] | | 相关经验(Skill 原样序列化) |
| `relevant_failures` | object[] | | 必须规避的历史失败 |
| `open_questions` | string[] | | 未决问题 |
| `provenance` | Provenance | ✓(v2 新增) | 责任与溯源凭证,见 §2.2 |
| `handover_prompt` | string | ✓ | 读完即可接手的完整 Prompt |

### 2.1 Task

```json
{
  "id": "uuid", "title": "...", "goal": "...", "status": "in_progress",
  "agent_id": "claude_code",
  "tags": ["build", "windows"],
  "repo_state": { "path": "D:/repo", "branch": "fix/win", "commit": "abc123" }
}
```

### 2.2 Event(v2 扩展)

在 v1 的 `seq / kind / summary / detail / evidence_ref` 之上新增:

| 字段 | 说明 |
|---|---|
| `actor` | `ai` \| `human` \| `guard` \| `system` —— 责任切分:「AI 提议」与「人类确认」共用同一份账本 |
| `session_id` | 产生该证据的 Agent 会话(可空) |
| `anchor_file` / `anchor_lines` | 行级锚点(如 `src/build.rs` / `"12-40"`),Agent Blame 用 |

### 2.3 Provenance(v2 新增 · 责任凭证)

```json
{
  "sessions": [
    { "id": "uuid", "agent_id": "claude_code", "command_line": "claude",
      "started_at": "...", "ended_at": "...", "exit_code": 0 }
  ],
  "policy_decisions": [
    { "rule_id": "destructive_fs", "action": "hold", "verdict": "denied",
      "command_text": "rm -rf ~/repo", "decided_by": "human", "created_at": "..." }
  ],
  "commits": [
    { "repo_path": "D:/repo", "commit_hash": "abc123", "subject": "fix: ..." }
  ],
  "adrs": [
    { "number": 23, "title": "链接器探测下沉到 build.rs", "status": "accepted" }
  ]
}
```

语义:接手方(人、审计者、或下一代模型)凭 provenance 能回答——
**谁发起、AI 建议了什么、人接受了什么、网关拦了什么、代码落在了哪些 commit。**

## 3. 兼容性规则

- v2 消费方 MUST 接受 v1 包(缺 `provenance`/`ahp_version` 时按空处理)。
- v1 消费方读 v2 包:未知字段一律忽略(v1 实现如严格校验会拒收,故导出方可用 `--compat v1` 降级导出;AEL 默认导 v2)。
- 字段只增不改不删;破坏性变更必须 bump `schema_version`。

## 4. 接手方义务(协议语义)

1. 先读 `relevant_failures` 的 guard_rule,作为硬约束执行。
2. 对齐 `task.repo_state`(branch/commit)后再动工作树。
3. 每做一步,把过程写回证据链(保持账本连续)。
4. 不重复 `events` 里已验证过的工作;不推翻 `adrs` 里已接受的决策(除非显式记录新决策取代)。
