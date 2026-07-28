import { useEffect, useMemo, useState } from "react";
import { ArrowRight, FileCheck2, Fingerprint, Gauge, ShieldAlert } from "lucide-react";
import { useStore } from "../store";
import { ipc } from "../lib/ipc";
import {
  ACTION_LABEL,
  VERDICT_LABEL,
  cx,
  shortDate,
  taskStatusTone,
  TASK_STATUS_LABEL,
  timeAgo,
  verdictTone,
} from "../lib/format";
import { Badge, Kicker, PageTitle, Panel, Stat } from "../ui";
import type { AdrRecord } from "../types";

export function Overview() {
  const tasks = useStore((s) => s.tasks);
  const pending = useStore((s) => s.pending);
  const decisions = useStore((s) => s.decisions);
  const goTask = useStore((s) => s.goTask);
  const setView = useStore((s) => s.setView);
  const [adrs, setAdrs] = useState<AdrRecord[]>([]);
  const [briefCount, setBriefCount] = useState(0);

  useEffect(() => {
    ipc.listAdrs().then(setAdrs).catch(() => {});
    // brief 数 = 已验证任务数(每个都能编译一页 brief)
    ipc.listTasks({ limit: 500 }).then((t) => setBriefCount(t.length)).catch(() => {});
  }, []);

  const blockedToday = useMemo(
    () => decisions.filter((d) => d.verdict === "denied" || d.verdict === "auto_denied").length,
    [decisions],
  );

  const recentTasks = tasks.slice(0, 6);
  const recentDecisions = decisions.slice(0, 6);

  const cards = [
    { icon: ShieldAlert, label: "已拦截命令", value: blockedToday, tone: "red" as const, to: "gate" as const, hint: "海关裁决账本" },
    { icon: Gauge, label: "待人工裁决", value: pending.length, tone: "orange" as const, to: "gate" as const, hint: "扣在裁决线上" },
    { icon: FileCheck2, label: "可编译 Brief", value: briefCount, tone: "blue" as const, to: "briefs" as const, hint: "一页审阅证据" },
    { icon: Fingerprint, label: "活文档 ADR", value: adrs.length, tone: "green" as const, to: "adr" as const, hint: "为什么这么写" },
  ];

  return (
    <div>
      <Kicker badge="AEL 2.0">本地优先 · AI 编码治理层 · 黑匣子 + 海关 + 账本</Kicker>
      <PageTitle sub="让 AI 写的每一行代码可信 · 可控 · 可追责 · 可理解。一个经验层内核,四个行业级出口。">
        总览
      </PageTitle>

      {/* 四出口状态卡 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <button key={c.label} onClick={() => setView(c.to)} className="text-left">
              <Panel className="h-full p-5 transition-colors hover:border-ink/20">
                <div className="flex items-center justify-between">
                  <Icon className={cx("h-5 w-5", `text-${c.tone}`)} />
                  <ArrowRight className="h-3.5 w-3.5 text-ink/25" />
                </div>
                <div className="mt-5">
                  <Stat value={c.value} label={c.label} tone={c.tone} />
                </div>
                <div className="mt-2 font-mono text-[10px] tracking-wide text-ink/30">{c.hint}</div>
              </Panel>
            </button>
          );
        })}
      </div>

      {/* 四条北极星 */}
      <Panel className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 p-5 sm:grid-cols-2">
        {[
          ["1.0", "同一个错误,第二次不再犯"],
          ["1.0", "换 Agent 接手,不必重讲上下文"],
          ["2.0", "千行 AI diff,审阅 ≤ 5 分钟"],
          ["2.0", "任意一行代码,3 秒追到决策现场"],
        ].map(([tag, text]) => (
          <div key={text} className="flex items-baseline gap-3 text-[13px]">
            <span className="font-display text-[13px] font-bold text-orange">{tag}</span>
            <span className="text-ink/70">{text}</span>
          </div>
        ))}
      </Panel>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr]">
        {/* 最近任务 */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-mono text-[11px] tracking-kicker text-ink/45">RECENT TASKS · 最近任务</h2>
            <button onClick={() => setView("tasks")} className="text-[12px] text-ink/45 hover:text-orange">
              全部 →
            </button>
          </div>
          <Panel className="divide-y divide-ink/[0.07]">
            {recentTasks.length === 0 && (
              <div className="px-5 py-8 text-center text-[13px] text-ink/35">还没有任务</div>
            )}
            {recentTasks.map((t) => (
              <button
                key={t.id}
                onClick={() => goTask(t.id)}
                className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-ink/[0.02]"
              >
                <span className="font-mono text-[11px] text-ink/35">{t.id.slice(0, 8)}</span>
                <span className="flex-1 truncate text-[13.5px] text-ink/85">{t.title}</span>
                <Badge tone={taskStatusTone[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge>
                <span className="w-16 text-right font-mono text-[10.5px] text-ink/30">{timeAgo(t.updatedAt)}</span>
              </button>
            ))}
          </Panel>
        </section>

        {/* 最近裁决 */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-mono text-[11px] tracking-kicker text-ink/45">GATE LEDGER · 最近裁决</h2>
            <button onClick={() => setView("gate")} className="text-[12px] text-ink/45 hover:text-orange">
              账本 →
            </button>
          </div>
          <Panel className="divide-y divide-ink/[0.07]">
            {recentDecisions.length === 0 && (
              <div className="px-5 py-8 text-center text-[13px] text-ink/35">海关暂无裁决记录</div>
            )}
            {recentDecisions.map((d) => (
              <div key={d.id} className="px-5 py-3">
                <div className="flex items-center gap-2">
                  <Badge tone={verdictTone[d.verdict]}>{VERDICT_LABEL[d.verdict]}</Badge>
                  <span className="font-mono text-[10.5px] text-ink/35">{ACTION_LABEL[d.action]} · {d.ruleId}</span>
                  <span className="ml-auto font-mono text-[10px] text-ink/25">{shortDate(d.createdAt)}</span>
                </div>
                <code className="mt-1.5 block truncate font-mono text-[11.5px] text-ink/60">$ {d.commandText}</code>
              </div>
            ))}
          </Panel>
        </section>
      </div>
    </div>
  );
}
