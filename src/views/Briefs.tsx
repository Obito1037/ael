import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Download, FileText, Target } from "lucide-react";
import { useStore } from "../store";
import { ipc } from "../lib/ipc";
import {
  ACTOR_LABEL,
  VERDICT_LABEL,
  actorTone,
  cx,
  humanDuration,
  humanTokens,
  shortDate,
  taskStatusTone,
  TASK_STATUS_LABEL,
  verdictTone,
} from "../lib/format";
import { Badge, Button, Empty, Kicker, Meter, PageTitle, Panel, Spinner, Stat } from "../ui";
import type { ReviewBrief } from "../types";

/** 分节小标题 · mono 大字距 + 语义配色 */
function Section({
  code,
  zh,
  tone,
  count,
  children,
}: {
  code: string;
  zh: string;
  tone: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <Panel className="p-5">
      <div className="mb-3.5 flex items-center gap-2.5">
        <h3 className={cx("font-mono text-[11px] tracking-kicker", tone)}>{code}</h3>
        <span className="text-[11px] text-ink/35">{zh}</span>
        {count != null && <span className="ml-auto font-mono text-[10.5px] text-ink/30">{count}</span>}
      </div>
      {children}
    </Panel>
  );
}

export function Briefs() {
  const tasks = useStore((s) => s.tasks);
  const toast = useStore((s) => s.toast);
  const [taskId, setTaskId] = useState<string>("");
  const [brief, setBrief] = useState<ReviewBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showMd, setShowMd] = useState(false);

  // 默认选中第一个任务
  useEffect(() => {
    if (!taskId && tasks[0]) setTaskId(tasks[0].id);
  }, [tasks, taskId]);

  // 选中 → 编译 brief
  useEffect(() => {
    if (!taskId) return;
    let alive = true;
    setLoading(true);
    setShowMd(false);
    ipc
      .compileBrief(taskId)
      .then((b) => alive && setBrief(b))
      .catch(() => {
        if (alive) {
          setBrief(null);
          toast("编译 Review Brief 失败。", "error");
        }
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [taskId, toast]);

  const exportBrief = async () => {
    if (!taskId) return;
    setExporting(true);
    try {
      const { path } = await ipc.exportBrief(taskId);
      toast(`Brief 已导出 · ${path}`, "success");
    } catch {
      toast("导出失败。", "error");
    } finally {
      setExporting(false);
    }
  };

  // 审阅耗时对比:无 AEL 40 分钟 vs AEL ~5 分钟
  const aelRatio = useMemo(() => {
    const secs = brief?.stats.durationSecs;
    // 以 40 分钟(2400s)为满格基准,AEL 侧默认约 12.5%(5 分钟)
    if (!secs) return 0.125;
    return Math.min(1, Math.max(0.05, secs / 2400));
  }, [brief]);

  const s = brief?.stats;

  return (
    <div>
      <Kicker badge="出口 ①">Review Brief · 一页纸把千行 diff 压成审阅证据</Kicker>
      <PageTitle sub="不给你看 AI 写了什么,给你看它为什么这么写、撞过哪些错、怎么验证的。千行 diff,审阅 ≤ 5 分钟。">
        Review Brief
      </PageTitle>

      {/* 任务选择器 · chip 行 */}
      <Panel className="mb-6 p-4">
        <h3 className="mb-3 font-mono text-[11px] tracking-kicker text-ink/45">SELECT TASK · 选择任务</h3>
        {tasks.length === 0 ? (
          <p className="py-2 text-[12.5px] text-ink/40">还没有任务,先在「任务」里建一个。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tasks.map((t) => (
              <button
                key={t.id}
                onClick={() => setTaskId(t.id)}
                className={cx(
                  "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-[12.5px] transition-colors",
                  taskId === t.id
                    ? "border-orange/50 bg-orange/[0.06] text-ink"
                    : "border-ink/10 text-ink/65 hover:border-ink/25",
                )}
              >
                <span className="max-w-[220px] truncate">{t.title}</span>
                <Badge tone={taskStatusTone[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {loading && (
        <div className="flex items-center gap-2 py-16 text-[13px] text-ink/45">
          <Spinner /> 正在编译 Review Brief…
        </div>
      )}

      {!loading && !brief && tasks.length > 0 && (
        <Empty>选择上方任意任务以编译其 Review Brief。</Empty>
      )}

      {!loading && brief && (
        <div className="space-y-6">
          {/* 标题行 + 导出 */}
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={taskStatusTone[brief.status]}>{TASK_STATUS_LABEL[brief.status]}</Badge>
            <span className="text-[15px] font-semibold text-ink">{brief.title}</span>
            <span className="font-mono text-[10.5px] text-ink/30">编译于 {shortDate(brief.generatedAt)}</span>
            <Button variant="primary" className="ml-auto" onClick={exportBrief} disabled={exporting}>
              {exporting ? <Spinner /> : <Download className="h-4 w-4" />}
              导出 Markdown
            </Button>
          </div>

          {/* 统计条 */}
          {s && (
            <Panel className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-3 lg:grid-cols-6">
              <Stat value={s.events} label="证据事件" />
              <Stat value={s.sessions} label="Agent 会话" tone="blue" />
              <Stat value={humanTokens(s.tokensEst)} label="预估 tokens" tone="orange" />
              <Stat value={s.humanConfirmed} label="人工确认" tone="green" />
              <Stat value={s.aiProposed} label="AI 提议" tone="orange" />
              <Stat value={humanDuration(s.durationSecs)} label="全程耗时" />
            </Panel>
          )}

          {/* 审阅耗时对比 gauge */}
          <Panel className="p-5">
            <h3 className="mb-4 font-mono text-[11px] tracking-kicker text-ink/45">REVIEW COST · 审阅耗时对比</h3>
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-[12px]">
                  <span className="text-ink/55">无 AEL · 逐行读 diff</span>
                  <span className="font-mono text-red">~40:00</span>
                </div>
                <Meter ratio={1} tone="red" />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between text-[12px]">
                  <span className="text-ink/55">AEL · 一页 Brief</span>
                  <span className="font-mono text-green">~{humanDuration(brief.stats.durationSecs) === "—" ? "5:00" : Math.round(aelRatio * 40) + ":00"}</span>
                </div>
                <Meter ratio={aelRatio} tone="green" />
              </div>
            </div>
          </Panel>

          {/* GOAL · 蓝 */}
          <Section code="GOAL" zh="目标" tone="text-blue">
            <div className="flex gap-3">
              <Target className="mt-0.5 h-4 w-4 shrink-0 text-blue" />
              <p className="text-[13.5px] leading-relaxed text-ink/85">{brief.goal || "—"}</p>
            </div>
          </Section>

          {/* DECISIONS · 橙 */}
          <Section code="DECISIONS" zh="关键决策" tone="text-orange" count={brief.decisions.length}>
            {brief.decisions.length === 0 ? (
              <Empty>本任务未记录决策事件。</Empty>
            ) : (
              <ul className="space-y-3">
                {brief.decisions.map((d, i) => (
                  <li key={i} className="border-l-2 border-orange/40 pl-3.5">
                    <div className="flex items-center gap-2">
                      <Badge tone={actorTone[d.actor]}>{ACTOR_LABEL[d.actor]}</Badge>
                      <span className="text-[13.5px] text-ink/85">{d.summary}</span>
                    </div>
                    {d.reason && <p className="mt-1 text-[12.5px] leading-relaxed text-ink/50">{d.reason}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* ERRORS · 红 */}
          <Section code="ERRORS FIXED" zh="撞过的错 · 已修" tone="text-red" count={brief.errorsFixed.length}>
            {brief.errorsFixed.length === 0 ? (
              <Empty>全程没有踩坑,或未记录错误事件。</Empty>
            ) : (
              <ul className="space-y-3">
                {brief.errorsFixed.map((e, i) => (
                  <li key={i} className="rounded-lg border border-ink/10 bg-panel2 p-3.5">
                    <div className="flex items-start gap-2">
                      <span className="font-mono text-[12px] text-red">✗</span>
                      <span className="text-[13px] text-ink/85">{e.error}</span>
                      {e.recurrences > 1 && (
                        <Badge tone="amber" className="ml-auto shrink-0">
                          历史第 {e.recurrences} 次{e.signature ? ` · ${e.signature}` : ""}
                        </Badge>
                      )}
                    </div>
                    {e.fix && (
                      <div className="mt-2 flex items-start gap-2">
                        <span className="font-mono text-[12px] text-green">✓</span>
                        <span className="text-[12.5px] leading-relaxed text-ink/60">{e.fix}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* VERIFY · 绿 */}
          <Section code="VERIFICATIONS" zh="验证证据" tone="text-green" count={brief.verifications.length}>
            {brief.verifications.length === 0 ? (
              <Empty>没有验证记录 · 这份改动尚未被证明可信。</Empty>
            ) : (
              <ul className="space-y-2.5">
                {brief.verifications.map((v, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-0.5 font-mono text-[12px] text-green">✓</span>
                    <div className="min-w-0">
                      <p className="text-[13px] text-ink/85">{v.summary}</p>
                      {v.evidenceRef && (
                        <code className="mt-0.5 block truncate font-mono text-[11px] text-ink/40">{v.evidenceRef}</code>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* INTERCEPTIONS · faint */}
          <Section code="INTERCEPTIONS" zh="海关拦截" tone="text-ink/45" count={brief.interceptions.length}>
            {brief.interceptions.length === 0 ? (
              <Empty>本任务运行期间海关无拦截记录。</Empty>
            ) : (
              <ul className="space-y-2">
                {brief.interceptions.map((p) => (
                  <li key={p.id} className="flex items-center gap-2.5">
                    <Badge tone={verdictTone[p.verdict]}>{VERDICT_LABEL[p.verdict]}</Badge>
                    <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink/60">$ {p.commandText}</code>
                    <span className="font-mono text-[10px] text-ink/25">{p.ruleId}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* RISK · faint / 橙红提示 */}
          <Section code="RISKS" zh="遗留风险" tone="text-ink/45" count={brief.risks.length}>
            {brief.risks.length === 0 ? (
              <Empty>没有标记的遗留风险。</Empty>
            ) : (
              <ul className="space-y-2">
                {brief.risks.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2.5 rounded-lg border border-amber/30 bg-amber/[0.05] px-3.5 py-2.5"
                  >
                    <span className="mt-0.5 font-mono text-[12px] text-amber">!</span>
                    <span className="text-[13px] leading-relaxed text-ink/80">{r}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* 可折叠 markdown 预览 */}
          <Panel className="overflow-hidden">
            <button
              onClick={() => setShowMd((v) => !v)}
              className="flex w-full items-center gap-2.5 px-5 py-3.5 text-left transition-colors hover:bg-ink/[0.02]"
            >
              <FileText className="h-4 w-4 text-ink/40" />
              <span className="font-mono text-[11px] tracking-kicker text-ink/45">MARKDOWN 源</span>
              <ChevronDown className={cx("ml-auto h-4 w-4 text-ink/35 transition-transform", showMd && "rotate-180")} />
            </button>
            {showMd && (
              <pre className="max-h-[420px] overflow-auto border-t border-ink/10 bg-panel2 px-5 py-4 font-mono text-[11.5px] leading-relaxed text-ink/70">
                {brief.markdown || "(空)"}
              </pre>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
