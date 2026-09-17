# AEL · Dwell-inspired 高保真设计提示词

视觉参考仅用于内部设计方向；外部项目名称与链接统一记录在 README.md，本文不保留项目引用。

本方案只迁移通用视觉原则：暖纸材质、宋体与系统无衬线的对比、克制留白、局部液态玻璃、实色内容行、陶土橙与鼠尾草语义色。不要复制参考项目的名称、宠物、文案、图标、插画、HTML、CSS 或其他资产。

## 统一母提示词

```text
High-fidelity native desktop product UI for AEL, an original local-first AI memory compiler. AEL helps coding agents efficiently reuse reliable memories and deliberately forget wrong, irrelevant, stale or harmful memories.

Translate the distinctive visual language of the reference interface extremely closely in palette, spacing rhythm, typography contrast, liquid-glass construction, editorial calm and sheet behavior, while keeping all AEL identity, information architecture, copy and assets original.

No browser chrome. 1536×960, light theme. Warm cream paper canvas #FAF9F5, paper #FFFFFF, oatmeal panel #F0EEE6, divider #E8E5DC, ink #2B2A27, muted #8A867C, terracotta #C96442, sage #96B08F, sage track #E7EDE2, blush #F8E5DE, amber #E3A13A, danger #C04A3D. No cool-blue interface.

Use Songti SC / Noto Serif SC / Georgia only for the AEL wordmark, page titles and short editorial sentences. Use Apple system / Segoe UI / PingFang SC / Noto Sans SC for controls and body copy. Use Cascadia Code / SF Mono only for paths, code, hashes and token counts.

Content rows are solid warm surfaces with 14–18px radii and hairline separators. Liquid glass appears only on floating top chrome, bottom composer, menus, modal sheets and toasts: translucent warm-white gradient, blur around 24px, saturation around 1.7, delicate inner top highlight, faint inner lower shade, very soft exterior shadow, 20–24px radius. Never glassify every card.

Keep a desktop developer-tool information architecture: 232px left navigation, calm central reading/work column, optional 340–390px contextual inspector. Large negative space, one visual focus per screen, short legible Chinese copy, 1.5px generic outline icons, truthful pending/verified/failed/stale states. Content changes between pages; the visual component family remains identical.
```

## 01 · 核心工作台

```text
Create one full-screen AEL active-task workbench using the shared style.

Floating glass header: left circular menu and serif AEL wordmark; center title “修复 Windows 构建失败”, subtitle “智创 OPC · Codex”; right token pill “18.4k”, terracotta status dot “运行中”, circular overflow icon.

Main 760px work column: one user request “请定位打包失败的根因，并保留可复用的修复经验。”; one understated assistant reasoning line; one solid oatmeal tool card “检查构建环境” with Node 20.18.1, Tauri 2.1 and path D:\desktop\智创OPC源码\ael; one warm code-diff card with a small “已验证” badge; one terracotta activity pill “正在运行 pnpm tauri build”. Keep the stream airy.

Open a 390px right-side floating glass sheet titled “本次记忆”. Add three solid rows: “Windows 路径必须保留反斜杠” / 高可信; “Tauri 打包前先检查 CLI 版本” / 已验证; “旧的 Node 18 处理方案” / 可能过期. Every row shows why it matched, source count and checkbox. Footer: “上下文 1,240 / 8,000 tokens”.

Bottom-center 720px liquid-glass composer: plus button, placeholder “继续告诉 AEL 要做什么…”, model pill “Codex”, circular terracotta stop button. Above it show an inline safety bar “一条命令需要确认” with “查看” and “阻止”.
```

## 02 · 01–04 流程页设计板

```text
Create a 2×2 contact sheet of four equally sized 16:10 AEL desktop screenshots. Use the exact shared shell and style. Caption panels “01 新建任务”, “02 核心工作台”, “03 注入预览”, “04 任务历史”.

01 新建任务: centered paper sheet, serif title “开始一件事”, fields for task name, goal, acceptance criteria and repository path; quiet rows for branch, Agent, environment and memory policy; line “找到 3 条可能有用的记忆”; one clay action “创建任务”. No hero.

02 核心工作台: compact active task thread, tool rows, diff, “12 项测试通过”, right memory inspector and glass composer.

03 注入预览: full-height editorial sheet titled “这次带上什么”; token ring “1,240 / 8,000”; selected atomic memory rows with checkboxes, scope, evidence, confidence, cost and “为什么召回”; muted “本次不带” section for stale “旧的 Node 18 处理方案”; actions “返回” and “确认并开始”.

04 任务历史: serif title “任务”; search; filters “全部 / 运行中 / 已完成 / 已归档”; date-grouped flat list rows with title, repo, Agent, outcome and state dot; selected row reveals “继续 / Review / 归档”.
```

## 03 · 05–08 证据与记忆页设计板

```text
Create a 2×2 contact sheet of four equally sized 16:10 AEL desktop screenshots. Caption panels “05 活动与证据”, “06 Review”, “07 待确认候选”, “08 记忆库”.

05 活动与证据: task tabs “概览 / 活动 / Review / 决策 / 提交”, with 活动 selected; editorial vertical timeline with narrow dates and events 人工 / Agent / 命令 / 测试 / Diff / Guard; paths, commit chip, one expanded command result; right inspector “本任务记忆” showing 使用 3 / 生成 2 / helpful outcome.

06 Review: changed-file list, clean warm code diff, one inline review note, sage row “12 项测试通过 · 构建成功”, evidence summary for 目标 / 修复 / 验证 / 风险, actions “需修改 / 接受 / 收尾沉淀”. Do not imitate a dense IDE.

07 待确认候选: atomic candidate rows with type, claim, trigger, scope, evidence count, confidence and duplicate warning; one candidate expands into an inset sheet comparing “原始片段” and “提炼结果”; actions “编辑 / 合并 / 拒绝 / 确认”.

08 记忆库: search, filters 类型 / 范围 / 状态 / 新鲜度; dense master list rather than cards; every row shows claim, repo/module scope, confidence, last used, evidence, helped/harmful and freshness; selected row opens slim detail inspector with trigger, scope, source, recent use and actions 固定 / 编辑 / 隔离.
```

## 04 · 09–12 来源、遗忘与设置设计板

```text
Create a 2×2 contact sheet of four equally sized 16:10 AEL desktop screenshots. Caption panels “09 记忆详情 · 来源链”, “10 健康与遗忘”, “11 遗忘预览 · 冲突处理”, “12 启动安全 · 设置交接”.

09 记忆详情 · 来源链: memory claim “Windows 路径必须保留反斜杠”; metadata type / scope / confidence / freshness / injection policy; provenance timeline source task → src/main.rs / 8d31a4f → Codex → 12 tests passed → three helpful later uses; sections 触发条件 / 适用边界 / 替代关系 / 冲突; actions 固定 / 编辑 / 隔离.

10 健康与遗忘: sage-only semantic accent; serif title “记忆健康”, sentence “留下有用的，也允许过时的退场。”; small health ring 82 and seven tiny day bars; actionable rows 过期 4 / 低效用 7 / 重复 3 / 矛盾 2 / 未验证 6 / 有害 1; rule row and “查看清理建议”. No giant KPI.

11 遗忘预览 · 冲突处理: centered sheet “先看清影响，再决定遗忘”; compare memory A and B with evidence, scope, dates and outcomes; mark B “较新证据”; actions 保留 A / 保留 B / 合并 / 标记被替代 / 隔离; impact preview lists future tasks that stop retrieving it, estimated token saving and “可在 30 天内恢复”; toast “已停止召回 · 撤销”. Never present irreversible deletion.

12 启动安全 · 设置交接: left settings navigation 通用 / 记忆 / Agents / 安全; grouped rows for local data, backup/import/export, retrieval mode, context budget, Codex Ready, Claude Code Missing, trust, prompt-injection defense and startup self-check; right checklist “交接状态”; actions “运行自检” and “生成交接包”.
```

## 统一负面提示词

```text
no Claude, Anthropic, OpenAI or ChatGPT logo; no copied pet, companion character, house wording, exact icon asset, sticky-note tape, receipt, stamp or illustration from the reference; no generic AI brain, robot, sparkle, orbit or neural-network graphic; no neon purple-blue gradient; no cool gray SaaS dashboard; no glass on every card; no bento KPI grid; no huge statistic cards; no marketing landing page; no oversized hero; no rainbow badges; no pill overload; no thick borders; no heavy shadows; no 3D illustration; no mobile phone mockup; no VS Code clone; no unreadable lorem ipsum; no fake charts; no detached floating panels; no inconsistent navigation; no irreversible-delete drama.
```

## 验收清单

- 任务必须形成新建 → 注入预览 → 执行 → 证据 → Review → 沉淀闭环。
- 记忆注入要说明召回原因、证据、新鲜度和 token 成本；不能静默携带。
- 长期记忆候选必须人工确认，草案不能自动进入 active。
- 每条记忆至少显示触发条件、来源任务、Agent/模型、版本、成功/失败次数和新鲜度。
- 遗忘默认映射为停止召回或归档，并且可以恢复；不能假装物理删除。
- 内容面是实色纸张，玻璃只出现在悬浮层。
- 不把后端尚未支持的编辑、合并、冲突谱系或逐条注入勾选画成真实可用按钮。
