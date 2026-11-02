import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCopy, FileDown, Flag, Plus, Save } from "lucide-react";
import { useStore } from "../store";
import { ipc } from "../lib/ipc";
import {
  ACTOR_LABEL,
  EVENT_KIND_LABEL,
  SESSION_STATUS_LABEL,
  TASK_STATUS_LABEL,
  actorTone,
  cx,
  eventKindColor,
  shortDate,
  taskStatusTone,
  timeAgo,
} from "../lib/format";
import { Badge, Button, Chip, Empty, Field, Kicker, Modal, PageTitle, Panel, Spinner, inputCls } from "../ui";
import type { AgentSession, EventKind, FinalizeResult, Task, TaskEvent, TaskStatus } from "../types";

const TASK_STATUSES: TaskStatus[] = ["pending", "in_progress", "blocked", "verified", "failed", "abandoned"];
const STATUS_FILTERS: (TaskStatus | "all")[] = ["all", "in_progress", "blocked", "verified", "failed", "pending"];
const EVENT_KINDS: EventKind[] = ["step", "error", "fix", "verification", "decision", "note"];

// A task can be left and reopened while its mutation is pending. Keep one
// backend request per task; updating that task's record never changes selection.
const finalizingTasks = new Map<string, Promise<FinalizeResult>>();
function finalizeTaskOnce(taskId: string): Promise<FinalizeResult> {
  const existing = finalizingTasks.get(taskId);
  if (existing) return existing;
  const request = ipc.finalizeTask(taskId).then((result) => {
    useStore.getState().upsertTask(result.task);
    return result;
  });
  finalizingTasks.set(taskId, request);
  const release = () => { if (finalizingTasks.get(taskId) === request) finalizingTasks.delete(taskId); };
  void request.then(release, release);
  return request;
}

export function Tasks() {
  const tasks = useStore((s) => s.tasks);
  const setTasks = useStore((s) => s.setTasks);
  const setView = useStore((s) => s.setView);
  const focusTaskId = useStore((s) => s.focusTaskId);
  const clearFocus = useStore((s) => s.clearFocus);
  const toast = useStore((s) => s.toast);

  const [filter, setFilter] = useState<TaskStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [finalizeResult, setFinalizeResult] = useState<FinalizeResult | null>(null);

  const shown = useMemo(
    () => (filter === "all" ? tasks : tasks.filter((t) => t.status === filter)),
    [tasks, filter],
  );
  const selected = useMemo(() => shown.find((task) => task.id === selectedId) ?? shown[0] ?? null, [shown, selectedId]);
  const selectedTaskRef = useRef(selected?.id);
  selectedTaskRef.current = selected?.id;

  useEffect(() => {
    let cancelled = false;
    ipc.listTasks({ limit: 200 }).then((items) => { if (!cancelled) setTasks(items); })
      .catch(() => { if (!cancelled) toast("加载任务失败。", "error"); });
    return () => { cancelled = true; };
  }, [setTasks, toast]);

  // 尊重跨视图跳转的初始选中
  useEffect(() => {
    if (focusTaskId) {
      setFilter("all");
      setSelectedId(focusTaskId);
      setFinalizeResult(null);
      clearFocus();
    }
  }, [focusTaskId, clearFocus]);

  useEffect(() => {
    setFinalizeResult(null);
  }, [selected?.id]);

  return (
    <div>
      <Kicker badge="历史与证据">每个任务都有完整来源链</Kicker>
      <PageTitle sub="查看目标、仓库、Agent 会话和逐条证据；从这里继续、收尾或导出。">
        任务
      </PageTitle>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        {/* 左:列表 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-[11px] tracking-kicker text-ink/45">TASKS · {shown.length}</h3>
            <Button variant="primary" className="px-3 py-1.5 text-[12px]" onClick={() => setView("overview")}>
              <Plus className="h-3.5 w-3.5" /> 新建任务
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => { setFilter(f); setFinalizeResult(null); }}
                aria-pressed={filter === f}
                className={cx(
                  "rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] tracking-wide transition-colors",
                  filter === f
                    ? "border-orange/45 bg-orange/[0.06] text-orange"
                    : "border-ink/10 text-ink/45 hover:border-ink/25",
                )}
              >
                {f === "all" ? "全部" : TASK_STATUS_LABEL[f]}
              </button>
            ))}
          </div>

          <Panel className="divide-y divide-ink/[0.07]">
            {shown.length === 0 && <div className="px-5 py-8 text-center text-[13px] text-ink/35">{filter === "all" ? "还没有任务" : "当前筛选没有任务"}</div>}
            {shown.map((t) => (
              <button
                key={t.id}
                onClick={() => { setSelectedId(t.id); setFinalizeResult(null); }}
                aria-pressed={selected?.id === t.id}
                className={cx(
                  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                  selected?.id === t.id ? "bg-ink/[0.03]" : "hover:bg-ink/[0.02]",
                )}
              >
                <span className="font-mono text-[10.5px] text-ink/30">{t.id.slice(0, 6)}</span>
                <span className="flex-1 truncate text-[13px] text-ink/85">{t.title}</span>
                <Badge tone={taskStatusTone[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge>
              </button>
            ))}
          </Panel>
        </div>

        {/* 右:详情 */}
        <div>
          {!selected ? (
            <Empty className="py-20">选择左侧一个任务查看其证据链</Empty>
          ) : (
            <TaskDetail
              key={selected.id}
              task={selected}
              onFinalized={(r) => {
                if (selectedTaskRef.current === r.task.id) setFinalizeResult(r);
              }}
            />
          )}
        </div>
      </div>

      {finalizeResult && finalizeResult.task.id === selected?.id && <FinalizeModal result={finalizeResult} onClose={() => setFinalizeResult(null)} />}
    </div>
  );
}

// ── 详情面板 ─────────────────────────────────────────────────────

function TaskDetail({ task, onFinalized }: { task: Task; onFinalized: (r: FinalizeResult) => void }) {
  const toast = useStore((s) => s.toast);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(() => finalizingTasks.has(task.id));
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const mountedRef = useRef(false);
  const lifecycleRef = useRef(0);
  const refreshRequestRef = useRef(0);
  const finalizingRef = useRef(false);
  const exportingRef = useRef(false);
  const copyingRef = useRef(false);
  const onFinalizedRef = useRef(onFinalized);
  onFinalizedRef.current = onFinalized;

  const refresh = useCallback(async () => {
    const request = ++refreshRequestRef.current;
    const lifecycle = lifecycleRef.current;
    if (!mountedRef.current) return;
    setLoading(true);
    const [eventResult, sessionResult] = await Promise.allSettled([
      ipc.listEvents(task.id), ipc.listAgentSessions({ taskId: task.id }),
    ]);
    if (!mountedRef.current || lifecycle !== lifecycleRef.current || request !== refreshRequestRef.current) return;
    if (eventResult.status === "fulfilled") setEvents([...eventResult.value].sort((a, b) => a.seq - b.seq));
    else { setEvents([]); toast("加载证据链失败。", "error"); }
    if (sessionResult.status === "fulfilled") setSessions(sessionResult.value);
    else { setSessions([]); toast("加载关联会话失败。", "error"); }
    setLoading(false);
  }, [task.id, toast]);

  const observeFinalize = useCallback(async (request: Promise<FinalizeResult>) => {
    const lifecycle = lifecycleRef.current;
    finalizingRef.current = true;
    setBusy(true);
    try {
      const result = await request;
      if (!mountedRef.current || lifecycle !== lifecycleRef.current) return;
      onFinalizedRef.current(result);
      void refresh();
      toast("任务已收尾,已沉淀经验。", "success");
    } catch {
      if (mountedRef.current && lifecycle === lifecycleRef.current) toast("收尾失败。", "error");
    } finally {
      if (mountedRef.current && lifecycle === lifecycleRef.current) {
        finalizingRef.current = false;
        setBusy(false);
      }
    }
  }, [refresh, toast]);

  useEffect(() => {
    mountedRef.current = true;
    lifecycleRef.current += 1;
    void refresh();
    const existing = finalizingTasks.get(task.id);
    if (existing) void observeFinalize(existing);
    return () => {
      mountedRef.current = false;
      lifecycleRef.current += 1;
      refreshRequestRef.current += 1;
    };
  }, [task.id, refresh, observeFinalize]);

  const changeStatus = async (status: TaskStatus) => {
    try {
      useStore.getState().upsertTask(await ipc.updateTaskStatus(task.id, status));
      if (mountedRef.current) toast(`任务状态已改为${TASK_STATUS_LABEL[status]}。`, "success");
    } catch {
      if (mountedRef.current) toast("修改任务状态失败。", "error");
    }
  };

  const finalize = () => {
    if (finalizingRef.current) return;
    void observeFinalize(finalizeTaskOnce(task.id));
  };

  const exportBrief = async () => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      const { path } = await ipc.exportBrief(task.id);
      if (mountedRef.current) toast(`Brief 已导出:${path}`, "success");
    } catch {
      if (mountedRef.current) toast("导出 Brief 失败。", "error");
    } finally {
      exportingRef.current = false;
      if (mountedRef.current) setExporting(false);
    }
  };

  const copyTrailer = async () => {
    if (copyingRef.current) return;
    copyingRef.current = true;
    setCopying(true);
    try {
      const { trailer } = await ipc.generateCommitTrailer(task.id);
      if (!mountedRef.current) return;
      await navigator.clipboard.writeText(trailer);
      if (mountedRef.current) toast(`已复制 commit trailer:${trailer}`, "success");
    } catch {
      if (mountedRef.current) toast("复制 trailer 失败。", "error");
    } finally {
      copyingRef.current = false;
      if (mountedRef.current) setCopying(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* 头部 */}
      <Panel className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <Badge tone={taskStatusTone[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>
              <span className="font-mono text-[10.5px] text-ink/30">{task.id.slice(0, 8)}</span>
              <span className="font-mono text-[10px] text-ink/25">{timeAgo(task.updatedAt)}</span>
            </div>
            <h2 className="text-[19px] font-black leading-tight text-ink">{task.title}</h2>
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink/60">{task.goal}</p>
          </div>
        </div>

        {(task.repoPath || task.tags.length > 0) && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {task.repoPath && <RepoChip label="path" value={task.repoPath} />}
            {task.repoBranch && <RepoChip label="branch" value={task.repoBranch} />}
            {task.repoCommit && <RepoChip label="commit" value={task.repoCommit.slice(0, 10)} />}
            {task.tags.map((tag) => (
              <Chip key={tag}>#{tag}</Chip>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink/[0.07] pt-4">
          <select aria-label="任务状态" value={task.status} onChange={(event) => void changeStatus(event.target.value as TaskStatus)} disabled={busy} className="rounded-full border border-line bg-panel px-3 py-1.5 text-[12px] text-ink">
            {TASK_STATUSES.map((status) => <option key={status} value={status}>{TASK_STATUS_LABEL[status]}</option>)}
          </select>
          <Button variant="primary" className="px-3.5 py-1.5 text-[12px]" onClick={finalize} disabled={busy} title="只有已验证的任务才会生成经验草案">
            {busy ? <Spinner /> : <Flag className="h-3.5 w-3.5" />} 收尾任务
          </Button>
          <Button variant="ghost" className="px-3.5 py-1.5 text-[12px]" onClick={exportBrief} disabled={exporting}>
            <FileDown className="h-3.5 w-3.5" /> 导出 Brief
          </Button>
          <Button variant="ghost" className="px-3.5 py-1.5 text-[12px]" onClick={copyTrailer} disabled={copying}>
            <ClipboardCopy className="h-3.5 w-3.5" /> 复制 trailer
          </Button>
        </div>
      </Panel>

      {/* 追加证据 */}
      <AppendEvidence taskId={task.id} onAppended={refresh} />

      {/* 会话 */}
      <Panel className="p-4">
        <h3 className="mb-3 font-mono text-[11px] tracking-kicker text-ink/45">SESSIONS · 关联会话</h3>
        {sessions.length === 0 ? (
          <p className="py-3 text-center text-[12px] text-ink/35">{loading ? "正在加载关联会话…" : "此任务尚无 Agent 会话"}</p>
        ) : (
          <div className="space-y-1.5">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg border border-ink/10 px-3 py-2">
                <span className="font-mono text-[10.5px] text-ink/40">{s.agentId}</span>
                <span className="flex-1 truncate font-mono text-[11px] text-ink/50">{s.commandLine}</span>
                <Badge tone={s.status === "running" ? "green" : s.status === "failed" ? "red" : "ink"}>
                  {SESSION_STATUS_LABEL[s.status]}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* 证据链时间线 */}
      <Panel className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-mono text-[11px] tracking-kicker text-ink/45">EVIDENCE CHAIN · 证据链 · {events.length}</h3>
          {loading && <Spinner />}
        </div>
        {events.length === 0 ? (
          <Empty>{loading ? "正在加载证据链…" : "还没有证据。启动 Agent 或手动追加一条。"}</Empty>
        ) : (
          <ol className="relative space-y-4 border-l border-ink/10 pl-5">
            {events.map((ev) => (
              <li key={ev.id} className="relative">
                <span
                  className={cx(
                    "absolute -left-[27px] top-1 h-2.5 w-2.5 rounded-full border-2 border-bg bg-current",
                    eventKindColor[ev.kind],
                  )}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cx("font-mono text-[10.5px] tracking-wide", eventKindColor[ev.kind])}>
                    {EVENT_KIND_LABEL[ev.kind]}
                  </span>
                  <Badge tone={actorTone[ev.actor]}>{ACTOR_LABEL[ev.actor]}</Badge>
                  {ev.anchorFile && (
                    <span className="rounded border border-ink/10 bg-ink/[0.02] px-1.5 py-0.5 font-mono text-[10px] text-ink/50">
                      {ev.anchorFile}
                      {ev.anchorLines ? `:${ev.anchorLines}` : ""}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[10px] text-ink/25">
                    #{ev.seq} · {shortDate(ev.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-ink/85">{ev.summary}</p>
                {ev.detail && <p className="mt-0.5 text-[12px] leading-relaxed text-ink/45">{ev.detail}</p>}
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}

function RepoChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.02] px-2.5 py-0.5">
      <span className="font-mono text-[9.5px] uppercase tracking-kicker text-ink/35">{label}</span>
      <span className="font-mono text-[11px] text-ink/60">{value}</span>
    </span>
  );
}

// ── 追加证据表单 ─────────────────────────────────────────────────

function AppendEvidence({ taskId, onAppended }: { taskId: string; onAppended: () => void }) {
  const toast = useStore((s) => s.toast);
  const [kind, setKind] = useState<EventKind>("note");
  const [summary, setSummary] = useState("");
  const [detail, setDetail] = useState("");
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const save = async () => {
    if (savingRef.current) return;
    if (!summary.trim()) return toast("请填写摘要。", "warning");
    savingRef.current = true;
    setSaving(true);
    try {
      await ipc.appendEvent({
        taskId,
        kind,
        summary: summary.trim(),
        detail: detail.trim() || undefined,
        actor: "human",
      });
      if (!mountedRef.current) return;
      setSummary("");
      setDetail("");
      setKind("note");
      onAppended();
      toast("证据已入链。", "success");
    } catch {
      if (mountedRef.current) toast("追加证据失败。", "error");
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <Panel className="space-y-3 p-4">
      <h3 className="font-mono text-[11px] tracking-kicker text-ink/45">追加证据 · 人工</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
        <Field label="类型">
          <select value={kind} onChange={(e) => setKind(e.target.value as EventKind)} className={inputCls}>
            {EVENT_KINDS.map((k) => (
              <option key={k} value={k} className="bg-panel">
                {EVENT_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="摘要">
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="发生了什么"
            className={inputCls}
          />
        </Field>
      </div>
      <Field label="细节(可选)">
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={2}
          placeholder="补充上下文、原因或证据引用"
          className={cx(inputCls, "resize-none")}
        />
      </Field>
      <div className="flex justify-end">
        <Button variant="primary" className="px-4 py-1.5 text-[12px]" onClick={save} disabled={saving}>
          {saving ? <Spinner /> : <Save className="h-3.5 w-3.5" />} 保存
        </Button>
      </div>
    </Panel>
  );
}

// ── 收尾结果 Modal ───────────────────────────────────────────────

function FinalizeModal({ result, onClose }: { result: FinalizeResult; onClose: () => void }) {
  const { draftSkills, draftFailures, brief, adrs } = result;
  const summary = [
    { label: "沉淀 Skill 草案", value: draftSkills.length, tone: "green" as const },
    { label: "记录 Failure", value: draftFailures.length, tone: "red" as const },
    { label: "编入 ADR", value: adrs.length, tone: "blue" as const },
    { label: "证据事件", value: brief.stats.events, tone: "orange" as const },
  ];

  return (
    <Modal title="任务收尾 · 经验沉淀" onClose={onClose} wide>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {summary.map((s) => (
            <div key={s.label} className="rounded-lg border border-ink/10 bg-panel2 p-3.5">
              <div className={cx("font-display text-[28px] font-bold leading-none tabular-nums", `text-${s.tone}`)}>
                {s.value}
              </div>
              <div className="mt-1.5 text-[11.5px] text-ink/50">{s.label}</div>
            </div>
          ))}
        </div>

        {draftSkills.length > 0 && (
          <section>
            <h3 className="mb-2 font-mono text-[11px] tracking-kicker text-ink/45">SKILL 草案</h3>
            <div className="space-y-1.5">
              {draftSkills.map((sk) => (
                <div key={sk.id} className="rounded-lg border border-ink/10 px-3 py-2">
                  <p className="text-[13px] text-ink/85">{sk.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink/45">{sk.trigger}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {draftFailures.length > 0 && (
          <section>
            <h3 className="mb-2 font-mono text-[11px] tracking-kicker text-ink/45">FAILURE 护栏</h3>
            <div className="space-y-1.5">
              {draftFailures.map((f) => (
                <div key={f.id} className="rounded-lg border border-red/25 px-3 py-2">
                  <p className="text-[13px] text-ink/85">{f.description}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-red/70">{f.guardRule}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-2 font-mono text-[11px] tracking-kicker text-ink/45">REVIEW BRIEF · 摘要</h3>
          <div className="rounded-lg border border-ink/10 bg-panel2 p-3.5 text-[12.5px] leading-relaxed text-ink/60">
            <p>
              决策 {brief.decisions.length} · 修复 {brief.errorsFixed.length} · 验证 {brief.verifications.length} · 拦截{" "}
              {brief.interceptions.length}
            </p>
            {brief.risks.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-amber">
                {brief.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <div className="flex justify-end border-t border-ink/[0.07] pt-4">
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </Modal>
  );
}
