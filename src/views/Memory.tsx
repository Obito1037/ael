import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveRestore,
  Check,
  ChevronRight,
  CircleAlert,
  Compass,
  History,
  Inbox,
  Library,
  RefreshCw,
  Search,
  ScanSearch,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useStore } from "../store";
import { ipc } from "../lib/ipc";
import { cx, shortDate } from "../lib/format";
import { Badge, Button, Chip, Empty, Field, Meter, Modal, PageTitle, Panel, Spinner, inputCls } from "../ui";
import type { AgentRecommendation, Failure, FailureCandidate, HistoryConversation, HistoryMessage, HistoryScanSummary, Skill, SkillCandidate, SkillStatus } from "../types";

type MemoryTab = "library" | "inbox" | "health" | "routing" | "history";
type LibraryFilter = "all" | "active" | "needs_revalidation" | "deprecated";
const HISTORY_PAGE_SIZE = 30;
function historyErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return fallback;
}

const TABS: { id: MemoryTab; label: string; icon: typeof Library }[] = [
  { id: "library", label: "记忆库", icon: Library },
  { id: "inbox", label: "待确认", icon: Inbox },
  { id: "health", label: "健康与遗忘", icon: History },
  { id: "routing", label: "Agent 路由", icon: Compass },
  { id: "history", label: "历史扫描", icon: ScanSearch },
];

function confidence(skill: Skill) {
  const total = skill.successCount + skill.failCount;
  if (total === 0) return { label: "未验证", tone: "amber" as const };
  const ratio = skill.successCount / total;
  if (ratio >= 0.82 && skill.successCount >= 3) return { label: "高可信", tone: "green" as const };
  if (ratio >= 0.55) return { label: "中等", tone: "orange" as const };
  return { label: "低可信", tone: "red" as const };
}

function SkillRow({
  skill,
  selected,
  onSelect,
}: {
  skill: Skill;
  selected: boolean;
  onSelect: () => void;
}) {
  const trust = confidence(skill);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cx(
        "grid w-full grid-cols-[minmax(0,1fr)_88px_76px_76px_20px] items-center gap-3 px-4 py-3 text-left transition-colors",
        selected ? "bg-panel2/92" : "hover:bg-panel2/48",
      )}
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", skill.status === "active" ? "bg-green" : skill.status === "draft" ? "bg-orange" : "bg-ink/20")} />
          <span className="truncate text-[12.5px] font-medium text-ink/78">{skill.name}</span>
        </span>
        <span className="mt-1 block truncate pl-3.5 text-[10.5px] text-ink/38">{skill.trigger}</span>
      </span>
      <span className="truncate font-mono text-[9.5px] text-ink/34">{skill.tags.slice(0, 2).join(" / ") || "全局"}</span>
      <Badge tone={trust.tone} className="justify-center">{trust.label}</Badge>
      <span className={cx("text-right text-[10px]", skill.freshness === "fresh" ? "text-green" : "text-amber")}>
        {skill.freshness === "fresh" ? "新鲜" : "待重验"}
      </span>
      <ChevronRight className="h-3.5 w-3.5 text-ink/20" />
    </button>
  );
}

export function Memory() {
  const toast = useStore((state) => state.toast);
  const goTask = useStore((state) => state.goTask);
  const [tab, setTab] = useState<MemoryTab>("library");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [checking, setChecking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exportingSkillId, setExportingSkillId] = useState<string | null>(null);
  const [forgetTarget, setForgetTarget] = useState<Skill | null>(null);

  const [goal, setGoal] = useState("");
  const [tags, setTags] = useState("");
  const [recs, setRecs] = useState<AgentRecommendation[]>([]);
  const [routing, setRouting] = useState(false);
  const [historySummary, setHistorySummary] = useState<HistoryScanSummary | null>(null);
  const [historyConversations, setHistoryConversations] = useState<HistoryConversation[]>([]);
  const [historyMessages, setHistoryMessages] = useState<HistoryMessage[]>([]);
  const [historySelection, setHistorySelection] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(() => Boolean(ipc.activeHistoryJob()));
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(() => ipc.lastHistoryJobError());
  const [historyVersion, setHistoryVersion] = useState(0);
  const [skillCandidates, setSkillCandidates] = useState<SkillCandidate[]>([]);
  const [failureCandidates, setFailureCandidates] = useState<FailureCandidate[]>([]);
  const [candidateBusyId, setCandidateBusyId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const historyRequestRef = useRef(0);
  const libraryRequestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      historyRequestRef.current += 1;
      libraryRequestRef.current += 1;
    };
  }, []);

  const loadHistory = async () => {
    const request = ++historyRequestRef.current;
    try {
      const [summary, conversations, nextSkillCandidates, nextFailureCandidates] = await Promise.all([
        ipc.getHistoryScanSummary(),
        ipc.listHistoryConversations({ limit: 200 }),
        ipc.listSkillCandidates(),
        ipc.listFailureCandidates(),
      ]);
      if (!mountedRef.current || request !== historyRequestRef.current) return;
      setHistorySummary(summary);
      setHistoryConversations(conversations);
      setHistorySelection((current) => conversations.some((item) => item.id === current) ? current : conversations[0]?.id || null);
      setSkillCandidates(nextSkillCandidates);
      setFailureCandidates(nextFailureCandidates);
      setHistoryVersion((version) => version + 1);
    } catch (error) {
      if (!mountedRef.current || request !== historyRequestRef.current) return;
      setHistoryError(historyErrorMessage(error, "历史索引加载失败。"));
    }
  };

  useEffect(() => {
    const job = ipc.activeHistoryJob();
    if (!job) return;
    let cancelled = false;
    setHistoryBusy(true);
    void job.promise.then(() => {
      if (!cancelled) void loadHistory();
    }).catch((error: unknown) => {
      if (!cancelled) setHistoryError(historyErrorMessage(error, "后台历史处理失败。"));
    }).finally(() => {
      if (!cancelled) setHistoryBusy(false);
    });
    return () => { cancelled = true; };
  }, []);

  const runHistoryScan = async () => {
    if (ipc.activeHistoryJob()) return;
    setHistoryBusy(true);
    setHistoryError(null);
    try {
      const summary = await ipc.scanHistory();
      if (!mountedRef.current) return;
      setHistorySummary(summary);
      await loadHistory();
      const skipped = Object.values(summary.sourceCounts).some((source) => (source.skippedFiles ?? 0) > 0 || (source.skippedLines ?? 0) > 0);
      toast(`${skipped ? "扫描完成，部分记录未索引" : "扫描完成"}：${summary.conversations} 个会话、${summary.messages} 条消息。`, skipped ? "warning" : "success");
    } catch (error) {
      if (mountedRef.current) setHistoryError(historyErrorMessage(error, "历史扫描失败，已有索引仍保留。"));
    } finally {
      if (mountedRef.current) setHistoryBusy(false);
    }
  };

  const extractCandidates = async () => {
    if (ipc.activeHistoryJob()) return;
    setHistoryBusy(true);
    setHistoryError(null);
    try {
      const result = await ipc.extractHistoryCandidates();
      if (!mountedRef.current) return;
      await loadHistory();
      toast(`提炼完成：${result.skillCandidates} 条技能候选、${result.failureCandidates} 条失败候选；仍需人工审阅。`, "success");
    } catch (error) {
      if (mountedRef.current) setHistoryError(historyErrorMessage(error, "候选提炼失败。"));
    } finally {
      if (mountedRef.current) setHistoryBusy(false);
    }
  };

  const distillCandidates = async () => {
    if (ipc.activeHistoryJob()) return;
    setHistoryBusy(true);
    setHistoryError(null);
    try {
      const result = await ipc.distillHistoryCandidates({ profileId: "codex" });
      if (!mountedRef.current) return;
      await loadHistory();
      toast(`ACP 提炼完成：${result.skillCandidates} 条技能候选、${result.failureCandidates} 条失败候选；仍需人工审阅。`, "success");
    } catch (error) {
      if (mountedRef.current) setHistoryError(historyErrorMessage(error, "ACP 提炼失败，请确认本机 Agent 已登录。"));
    } finally {
      if (mountedRef.current) setHistoryBusy(false);
    }
  };

  const reviewSkillCandidate = async (candidate: SkillCandidate, action: "promote" | "reject") => {
    setCandidateBusyId(candidate.id);
    try {
      if (action === "promote") {
        await ipc.promoteSkillCandidate(candidate.id);
        toast("已转为待确认 Skill；它尚未进入 active 召回。", "success");
      } else {
        await ipc.updateSkillCandidateStatus(candidate.id, "rejected");
        toast("已拒绝该技能候选。", "info");
      }
      await loadHistory();
    } catch {
      toast("候选审阅操作失败。", "error");
    } finally {
      setCandidateBusyId(null);
    }
  };

  const reviewFailureCandidate = async (candidate: FailureCandidate, action: "promote" | "reject") => {
    setCandidateBusyId(candidate.id);
    try {
      if (action === "promote") {
        await ipc.promoteFailureCandidate(candidate.id);
        toast("已转入失败库并可供 Failure Guard 检索。", "success");
      } else {
        await ipc.updateFailureCandidateStatus(candidate.id, "rejected");
        toast("已拒绝该失败候选。", "info");
      }
      await loadHistory();
    } catch {
      toast("候选审阅操作失败。", "error");
    } finally {
      setCandidateBusyId(null);
    }
  };

  const load = async () => {
    const request = ++libraryRequestRef.current;
    try {
      const [nextSkills, nextFailures] = await Promise.all([
        ipc.listSkills({ limit: 300 }),
        ipc.listFailures({ limit: 300 }),
      ]);
      if (!mountedRef.current || request !== libraryRequestRef.current) return;
      setSkills(nextSkills);
      setFailures(nextFailures);
      setSelectedId((current) => current || nextSkills[0]?.id || null);
    } catch {
      if (!mountedRef.current || request !== libraryRequestRef.current) return;
      toast("记忆库加载失败。", "error");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (tab !== "history") return;
    void loadHistory();
  }, [tab]);

  useEffect(() => {
    let cancelled = false;
    setHistoryMessages([]);
    if (!historySelection) {
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    ipc.listHistoryMessages(historySelection, { limit: HISTORY_PAGE_SIZE, offset: historyOffset })
      .then((messages) => { if (!cancelled) setHistoryMessages(messages); })
      .catch((error: unknown) => {
        if (!cancelled) setHistoryError(historyErrorMessage(error, "消息预览加载失败。"));
      }).finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [historySelection, historyOffset, historyVersion]);

  const historyTotal = historyConversations.find((item) => item.id === historySelection)?.messageCount ?? 0;
  const historySources = Object.values(historySummary?.sourceCounts ?? {});
  const skippedHistoryFiles = historySources.reduce((sum, source) => sum + (source.skippedFiles ?? 0), 0);
  const skippedHistoryLines = historySources.reduce((sum, source) => sum + (source.skippedLines ?? 0), 0);

  const drafts = useMemo(() => skills.filter((skill) => skill.status === "draft"), [skills]);
  const active = useMemo(() => skills.filter((skill) => skill.status === "active"), [skills]);
  const archived = useMemo(() => skills.filter((skill) => skill.status === "deprecated"), [skills]);
  const stale = useMemo(() => skills.filter((skill) => skill.freshness === "needs_revalidation"), [skills]);
  const harmful = useMemo(
    () => skills.filter((skill) => skill.failCount > 0 && skill.failCount >= skill.successCount),
    [skills],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return skills.filter((skill) => {
      if (filter === "active" && skill.status !== "active") return false;
      if (filter === "deprecated" && skill.status !== "deprecated") return false;
      if (filter === "needs_revalidation" && skill.freshness !== "needs_revalidation") return false;
      if (!needle) return true;
      return [skill.name, skill.trigger, skill.body, ...skill.tags].some((value) => value.toLowerCase().includes(needle));
    });
  }, [filter, query, skills]);

  const selected = skills.find((skill) => skill.id === selectedId) || filtered[0] || null;
  const healthScore = Math.max(0, Math.round(100 - stale.length * 5 - harmful.length * 9 - drafts.length * 2));

  const updateStatus = async (skill: Skill, status: SkillStatus, message: string) => {
    setBusyId(skill.id);
    try {
      await ipc.updateSkillStatus(skill.id, status);
      toast(message, "success");
      await load();
    } catch {
      toast("状态更新失败。", "error");
    } finally {
      setBusyId(null);
    }
  };

  const runFreshness = async () => {
    setChecking(true);
    try {
      const { downgraded } = await ipc.runFreshnessCheck();
      toast(downgraded > 0 ? `${downgraded} 条记忆需要重新验证。` : "所有已启用记忆都在保鲜期内。", downgraded > 0 ? "warning" : "success");
      await load();
    } catch {
      toast("保鲜检查失败。", "error");
    } finally {
      setChecking(false);
    }
  };

  const revalidate = async (skill: Skill) => {
    setBusyId(skill.id);
    try {
      await ipc.revalidateSkill(skill.id);
      toast("记忆已重验并恢复召回权重。", "success");
      await load();
    } catch {
      toast("重验失败。", "error");
    } finally {
      setBusyId(null);
    }
  };

  const exportSkill = async (skill: Skill) => {
    setExportingSkillId(skill.id);
    try {
      const result = await ipc.exportSkill(skill.id, ["codex", "claude-code"]);
      toast(result.message, result.publishedByCli ? "success" : "info");
    } catch {
      toast("Skill 导出失败。", "error");
    } finally {
      setExportingSkillId(null);
    }
  };

  const route = async () => {
    if (!goal.trim()) return toast("请先描述目标。", "warning");
    setRouting(true);
    try {
      const tagList = tags.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
      const result = await ipc.recommendAgents(goal.trim(), tagList.length ? tagList : undefined);
      setRecs(result);
      if (result.length === 0) toast("没有足够历史证据做 Agent 推荐。", "info");
    } catch {
      toast("Agent 路由失败。", "error");
    } finally {
      setRouting(false);
    }
  };

  const maxScore = useMemo(() => recs.reduce((max, item) => Math.max(max, item.score), 0) || 1, [recs]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle sub="让可靠经验被高效复用；让错误、过时和无关内容逐步降权，并能安全退出召回。">
          记忆
        </PageTitle>
        <Button variant="ghost" onClick={runFreshness} disabled={checking} className="mb-7">
          {checking ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
          运行保鲜检查
        </Button>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-1 rounded-xl bg-panel2/72 p-1.5">
        {TABS.map((item) => {
          const Icon = item.icon;
          const count = item.id === "inbox" ? drafts.length : item.id === "health" ? stale.length + harmful.length : null;
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => setTab(item.id)}
              className={cx(
                "flex items-center gap-2 rounded-lg px-3.5 py-2 text-[11.5px] transition-colors",
                tab === item.id ? "bg-panel text-ink shadow-[0_1px_4px_rgb(var(--c-ink)_/_0.05)]" : "text-ink/46 hover:text-ink/74",
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.7} />
              {item.label}
              {count != null && count > 0 && <span className="rounded-full bg-orange/[0.1] px-1.5 font-mono text-[9px] text-orange">{count}</span>}
            </button>
          );
        })}
      </div>

      {tab === "library" && (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-ink/28" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索内容、触发条件、来源或标签"
                className={cx(inputCls, "pl-9")}
              />
            </div>
            <div className="flex items-center rounded-lg border border-line bg-panel p-1">
              {([
                ["all", "全部"],
                ["active", "已启用"],
                ["needs_revalidation", "待重验"],
                ["deprecated", "已停止"],
              ] as const).map(([id, label]) => (
                <button
                  type="button"
                  key={id}
                  onClick={() => setFilter(id)}
                  className={cx("rounded-md px-2.5 py-1.5 text-[10.5px]", filter === id ? "bg-panel2 text-ink/76" : "text-ink/38")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid min-h-[520px] grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Panel className="overflow-hidden">
              <div className="grid grid-cols-[minmax(0,1fr)_88px_76px_76px_20px] gap-3 border-b border-line bg-panel2/42 px-4 py-2 text-[9.5px] tracking-[0.08em] text-ink/34">
                <span>记忆内容</span><span>范围</span><span>可信度</span><span className="text-right">新鲜度</span><span />
              </div>
              {filtered.length === 0 ? (
                <div className="p-4"><Empty>没有匹配的记忆。</Empty></div>
              ) : (
                <div className="divide-y divide-line">
                  {filtered.map((skill) => (
                    <SkillRow key={skill.id} skill={skill} selected={selected?.id === skill.id} onSelect={() => setSelectedId(skill.id)} />
                  ))}
                </div>
              )}
              <div className="border-t border-line px-4 py-2.5 text-[9.5px] text-ink/30">共 {filtered.length} 条 · 已启用 {active.length} · 已停止 {archived.length}</div>
            </Panel>

            {selected ? (
              <Panel className="h-fit overflow-hidden">
                <div className="border-b border-line px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-serif text-[19px] leading-snug text-ink">记忆详情</h2>
                    <Badge tone={selected.status === "active" ? "green" : selected.status === "draft" ? "orange" : "ink"}>
                      {selected.status === "active" ? "已启用" : selected.status === "draft" ? "待确认" : "已停止召回"}
                    </Badge>
                  </div>
                  <p className="mt-3 text-[13px] font-medium leading-relaxed text-ink/78">{selected.name}</p>
                </div>
                <div className="space-y-5 px-5 py-4">
                  <div>
                    <div className="text-[9.5px] tracking-[0.1em] text-ink/32">触发条件</div>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink/58">{selected.trigger}</p>
                  </div>
                  <div>
                    <div className="text-[9.5px] tracking-[0.1em] text-ink/32">记忆正文</div>
                    <p className="mt-1.5 whitespace-pre-wrap rounded-xl bg-panel2/68 p-3 text-[11.5px] leading-relaxed text-ink/62">{selected.body}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-[10.5px]">
                    <div className="rounded-lg bg-panel2/52 p-3"><span className="block text-ink/32">使用结果</span><span className="mt-1 block font-mono text-green">helped {selected.successCount}</span><span className="font-mono text-red">harmful {selected.failCount}</span></div>
                    <div className="rounded-lg bg-panel2/52 p-3"><span className="block text-ink/32">版本</span><span className="mt-1 block font-mono text-ink/62">v{selected.version}</span><span className="text-ink/38">{shortDate(selected.updatedAt)}</span></div>
                  </div>
                  <div>
                    <div className="text-[9.5px] tracking-[0.1em] text-ink/32">来源链</div>
                    <div className="mt-2 space-y-2 border-l border-line pl-3 text-[10.5px] text-ink/48">
                      <div>任务 · {selected.sourceTaskId ? selected.sourceTaskId.slice(0, 8) : "未记录"}</div>
                      <div>Agent · {selected.originAgent || "未记录"}</div>
                      <div>模型 · {selected.originModel || "未记录"}</div>
                    </div>
                    {selected.sourceTaskId && (
                      <button type="button" onClick={() => goTask(selected.sourceTaskId!)} className="mt-2 text-[10.5px] text-orange hover:underline">
                        查看来源任务 →
                      </button>
                    )}
                  </div>
                  {selected.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{selected.tags.map((tag) => <Chip key={tag}>{tag}</Chip>)}</div>}
                </div>
                <div className="flex flex-wrap gap-2 border-t border-line bg-panel2/36 px-5 py-4">
                  {selected.status === "draft" && (
                    <Button variant="primary" onClick={() => updateStatus(selected, "active", "已确认，这条记忆现在可以被召回。") } disabled={busyId === selected.id}>
                      {busyId === selected.id ? <Spinner /> : <Check className="h-3.5 w-3.5" />} 确认
                    </Button>
                  )}
                  {selected.freshness === "needs_revalidation" && selected.status === "active" && (
                    <Button variant="ghost" onClick={() => revalidate(selected)} disabled={busyId === selected.id}>重新验证</Button>
                  )}
                  {selected.status === "active" && (
                    <Button variant="ghost" onClick={() => exportSkill(selected)} disabled={exportingSkillId === selected.id}>
                      {exportingSkillId === selected.id ? <Spinner /> : <ArchiveRestore className="h-3.5 w-3.5" />}导出 SKILL.md
                    </Button>
                  )}
                  {selected.status === "active" && (
                    <Button variant="danger" onClick={() => setForgetTarget(selected)}>停止召回</Button>
                  )}
                  {selected.status === "deprecated" && (
                    <Button variant="ghost" onClick={() => updateStatus(selected, "active", "这条记忆已恢复召回。") } disabled={busyId === selected.id}>
                      <ArchiveRestore className="h-3.5 w-3.5" /> 恢复
                    </Button>
                  )}
                </div>
              </Panel>
            ) : (
              <Empty className="h-fit">选择一条记忆查看来源与使用结果。</Empty>
            )}
          </div>
        </div>
      )}

      {tab === "inbox" && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Panel className="overflow-hidden">
            <div className="border-b border-line bg-panel2/42 px-5 py-3">
              <h2 className="font-serif text-[18px]">决定什么值得被长期记住</h2>
              <p className="mt-1 text-[10.5px] text-ink/38">草案不会自动进入长期召回；需要人工确认或停止。</p>
            </div>
            {drafts.length === 0 ? (
              <div className="p-4"><Empty>没有待确认候选。新的任务收尾后，原子记忆草案会出现在这里。</Empty></div>
            ) : (
              <div className="divide-y divide-line">
                {drafts.map((skill) => (
                  <button type="button" key={skill.id} onClick={() => setSelectedId(skill.id)} className={cx("w-full px-5 py-4 text-left hover:bg-panel2/42", selectedId === skill.id && "bg-panel2/72")}>
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-orange/[0.09] text-orange"><Sparkles className="h-3.5 w-3.5" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-[12.5px] font-medium text-ink/76">{skill.name}</span><span className="mt-1 block text-[10.5px] leading-relaxed text-ink/40">{skill.trigger}</span></span>
                      <Badge tone={confidence(skill).tone}>{confidence(skill).label}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Panel>
          {selected?.status === "draft" ? (
            <Panel className="h-fit p-5">
              <div className="text-[9.5px] tracking-[0.1em] text-ink/32">提炼结果</div>
              <h2 className="mt-2 font-serif text-[19px] leading-snug">{selected.name}</h2>
              <p className="mt-3 rounded-xl bg-panel2/68 p-3 text-[11.5px] leading-relaxed text-ink/58">{selected.body}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-[10px] text-ink/42">
                <span>来源 {selected.sourceTaskId?.slice(0, 8) || "未记录"}</span><span>版本 v{selected.version}</span>
                <span>Agent {selected.originAgent || "未记录"}</span><span>模型 {selected.originModel || "未记录"}</span>
              </div>
              <div className="mt-5 flex gap-2">
                <Button variant="primary" className="flex-1" onClick={() => updateStatus(selected, "active", "候选记忆已确认。") } disabled={busyId === selected.id}>确认</Button>
                <Button variant="danger" onClick={() => setForgetTarget(selected)}>拒绝</Button>
              </div>
            </Panel>
          ) : (
            <Empty className="h-fit">选择候选，检查提炼结果和来源。</Empty>
          )}
        </div>
      )}

      {tab === "health" && (
        <div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <Panel className="p-6">
              <div className="mx-auto grid h-28 w-28 place-items-center rounded-full" style={{ background: `conic-gradient(rgb(var(--c-green)) ${healthScore}%, rgb(var(--c-green) / 0.11) 0)` }}>
                <div className="grid h-[92px] w-[92px] place-items-center rounded-full bg-panel"><span className="font-serif text-[32px] text-green">{healthScore}</span></div>
              </div>
              <p className="mt-4 text-center font-serif text-[18px]">记忆健康</p>
              <p className="mt-1 text-center text-[10.5px] leading-relaxed text-ink/38">分数来自新鲜度、失败次数和待确认积压。</p>
              <Button variant="ghost" onClick={runFreshness} disabled={checking} className="mt-5 w-full">{checking ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}重新评估</Button>
            </Panel>

            <Panel className="overflow-hidden">
              <div className="border-b border-line px-5 py-4"><h2 className="font-serif text-[18px]">需要处理</h2></div>
              <div className="divide-y divide-line">
                {[
                  { icon: RefreshCw, label: "需要重验", count: stale.length, note: "代码、依赖或模型环境可能已经变化", tone: "text-amber", action: () => { setFilter("needs_revalidation"); setTab("library"); } },
                  { icon: ShieldAlert, label: "可能有害", count: harmful.length, note: "失败次数已经接近或超过成功次数", tone: "text-red", action: () => setTab("library") },
                  { icon: Inbox, label: "待确认", count: drafts.length, note: "尚未获得进入长期召回的许可", tone: "text-orange", action: () => setTab("inbox") },
                  { icon: ArchiveRestore, label: "已停止召回", count: archived.length, note: "保留来源与内容，需要时可以恢复", tone: "text-ink/42", action: () => { setFilter("deprecated"); setTab("library"); } },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <button type="button" key={item.label} onClick={item.action} className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-panel2/42">
                      <span className={cx("grid h-9 w-9 place-items-center rounded-full bg-panel2", item.tone)}><Icon className="h-4 w-4" strokeWidth={1.7} /></span>
                      <span className="min-w-0 flex-1"><span className="block text-[12.5px] text-ink/72">{item.label}</span><span className="mt-0.5 block text-[10.5px] text-ink/36">{item.note}</span></span>
                      <span className="font-serif text-[22px] text-ink/54">{item.count}</span><ChevronRight className="h-3.5 w-3.5 text-ink/20" />
                    </button>
                  );
                })}
              </div>
            </Panel>
          </div>

          <section className="mt-7">
            <div className="mb-3 flex items-center gap-2 text-[10.5px] tracking-[0.1em] text-ink/38"><CircleAlert className="h-3.5 w-3.5 text-red" />失败教训 · {failures.length}</div>
            {failures.length === 0 ? (
              <Empty>暂无失败记录。</Empty>
            ) : (
              <Panel className="divide-y divide-line overflow-hidden">
                {failures.map((failure) => (
                  <div key={failure.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_180px_80px] md:items-center">
                    <div><div className="text-[12.5px] font-medium text-ink/72">{failure.description}</div><div className="mt-1 text-[10.5px] text-ink/38">{failure.rootCause || "根因尚未补充"}</div></div>
                    <code className="truncate font-mono text-[9.5px] text-ink/36">{failure.guardRule}</code>
                    <Badge tone={failure.occurrences > 1 ? "red" : "amber"} className="justify-center">出现 {failure.occurrences} 次</Badge>
                  </div>
                ))}
              </Panel>
            )}
          </section>
        </div>
      )}

      {tab === "history" && (
        <div>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-serif text-[20px]">本机历史扫描</h2>
              <p className="mt-1 max-w-[680px] text-[10.5px] leading-relaxed text-ink/40">
                只读取本机历史文件并建立可检索副本；不会修改源文件、调用网络或上传内容。扫描完成后，候选技能和失败模式仍需单独提炼并人工确认。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="subtle" onClick={distillCandidates} disabled={historyBusy}>
                {historyBusy ? <Spinner /> : <Sparkles className="h-3.5 w-3.5" />}
                {historyBusy ? "处理中…" : "ACP AI 提炼"}
              </Button>
              <Button variant="ghost" onClick={extractCandidates} disabled={historyBusy}>
                {historyBusy ? <Spinner /> : <Sparkles className="h-3.5 w-3.5" />}
                {historyBusy ? "处理中…" : "提炼候选"}
              </Button>
              <Button variant="primary" onClick={runHistoryScan} disabled={historyBusy}>
                {historyBusy ? <Spinner /> : <ScanSearch className="h-3.5 w-3.5" />}
                {historyBusy ? "后台处理中…" : "扫描本机历史"}
              </Button>
            </div>
          </div>

          {historyBusy && <p role="status" className="mb-4 text-[12px] text-ink/60">正在后台处理历史；可以切换页面，返回后将继续显示结果。请勿重复启动。</p>}
          {historyError && <div role="alert" className="mb-4 rounded-xl border border-red/20 bg-red/5 p-4 text-[12px] text-red">{historyError}</div>}
          {(skippedHistoryFiles > 0 || skippedHistoryLines > 0) && (
            <details className="mb-4 rounded-xl border border-orange/25 bg-orange/5 p-4 text-[12px] text-ink/70">
              <summary className="cursor-pointer font-medium">部分记录未索引：跳过 {skippedHistoryFiles} 个文件 / 表、{skippedHistoryLines} 行记录</summary>
              <p className="mt-2">源文件未修改。超限文件保留原有索引；无效或超过 4 MiB 的单行不会进入本次索引。以下每个来源最多显示 20 条原因。</p>
              <ul className="mt-2 space-y-1 break-all">{historySources.flatMap((source) => source.warnings ?? []).map((warning, index) => <li key={index}>{warning}</li>)}</ul>
            </details>
          )}

          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["文件", historySummary?.filesSeen ?? 0],
              ["会话", historySummary?.conversations ?? historyConversations.length],
              ["消息", historySummary?.messages ?? 0],
              ["新候选", historySummary?.newCandidates ?? 0],
            ].map(([label, value]) => (
              <Panel key={label} className="p-4">
                <div className="text-[9.5px] tracking-[0.08em] text-ink/32">{label}</div>
                <div className="mt-2 font-serif text-[26px] leading-none text-ink/72">{value}</div>
              </Panel>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
            <Panel className="overflow-hidden">
              <div className="border-b border-line bg-panel2/42 px-5 py-3">
                <h3 className="font-serif text-[18px]">已索引会话</h3>
                <p className="mt-1 text-[10.5px] text-ink/38">按最近更新时间排序；源路径仅作为溯源信息展示。</p>
              </div>
              {historyConversations.length === 0 ? (
                <div className="p-5"><Empty>还没有历史索引。点击“扫描本机历史”开始。</Empty></div>
              ) : (
                <div className="divide-y divide-line">
                  {historyConversations.map((conversation) => (
                    <button
                      type="button"
                      key={conversation.id}
                      onClick={() => { setHistorySelection(conversation.id); setHistoryOffset(0); setHistoryError(null); }}
                      className={cx("w-full px-5 py-4 text-left hover:bg-panel2/42", historySelection === conversation.id && "bg-panel2/72")}
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-orange/[0.09] text-orange">
                          <History className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-medium text-ink/76">{conversation.title || "未命名会话"}</span>
                          <span className="mt-1 block truncate font-mono text-[9.5px] text-ink/36">{conversation.sourceAgent} · {conversation.sourceSessionId}</span>
                          <span className="mt-1 block truncate text-[10px] text-ink/32">{conversation.sourcePath}</span>
                        </span>
                        <span className="shrink-0 text-right text-[10px] text-ink/38">{conversation.messageCount} 条<br />{shortDate(conversation.updatedAt)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Panel>

            <Panel className="overflow-hidden">
              <div className="border-b border-line bg-panel2/42 px-5 py-3">
                <h3 className="font-serif text-[18px]">消息预览</h3>
                <p className="mt-1 text-[10.5px] text-ink/38">每页 {HISTORY_PAGE_SIZE} 条，每条预览最多 4000 字；完整内容保留在本机索引。不自动启用 Skill。</p>
              </div>
              {!historySelection ? (
                <Empty className="m-5">选择一个会话查看。</Empty>
              ) : historyLoading ? (
                <div role="status" className="flex items-center gap-2 p-5 text-[12px] text-ink/50"><Spinner />加载消息预览…</div>
              ) : historyMessages.length === 0 ? (
                <Empty className="m-5">该会话没有可展示的文本消息。</Empty>
              ) : (
                <div className="max-h-[500px] divide-y divide-line overflow-y-auto">
                  {historyMessages.map((message) => (
                    <div key={message.id} className="px-5 py-4">
                      <div className="flex items-center justify-between gap-3 text-[9.5px] text-ink/34">
                        <span className="font-mono">{message.role} · {message.kind}</span>
                        <span>{shortDate(message.createdAt)}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink/62">{message.text}</p>
                    </div>
                  ))}
                </div>
              )}
              {historySelection && historyTotal > 0 && (
                <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
                  <Button variant="ghost" disabled={historyLoading || historyOffset === 0} onClick={() => setHistoryOffset((offset) => Math.max(0, offset - HISTORY_PAGE_SIZE))}>上一页</Button>
                  <span className="text-[10.5px] text-ink/45">{historyOffset + 1}–{Math.min(historyOffset + HISTORY_PAGE_SIZE, historyTotal)} / {historyTotal} 条</span>
                  <Button variant="ghost" disabled={historyLoading || historyOffset + HISTORY_PAGE_SIZE >= historyTotal} onClick={() => setHistoryOffset((offset) => offset + HISTORY_PAGE_SIZE)}>下一页</Button>
                </div>
              )}
            </Panel>
          </div>

          <section className="mt-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-serif text-[19px]">候选经验 · 人工质量门</h3>
                <p className="mt-1 text-[10.5px] text-ink/38">候选包含来源消息和质量分；“转为待确认”后仍要在记忆库二次确认，拒绝不会删除原始证据。</p>
              </div>
              <div className="font-mono text-[10px] text-ink/38">技能 {skillCandidates.filter((item) => item.status === "candidate").length} · 失败 {failureCandidates.filter((item) => item.status === "candidate").length}</div>
            </div>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Panel className="overflow-hidden">
                <div className="border-b border-line bg-panel2/42 px-5 py-3"><h4 className="font-serif text-[17px]">SkillCandidate</h4></div>
                {skillCandidates.filter((item) => item.status === "candidate").length === 0 ? (
                  <div className="p-5"><Empty>暂无技能候选。扫描后再点击“提炼候选”。</Empty></div>
                ) : (
                  <div className="divide-y divide-line">
                    {skillCandidates.filter((item) => item.status === "candidate").map((candidate) => (
                      <div key={candidate.id} className="px-5 py-4">
                        <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="text-[12.5px] font-medium text-ink/74">{candidate.name}</div><div className="mt-1 text-[10.5px] leading-relaxed text-ink/42">{candidate.triggerText}</div></div><Badge tone={candidate.confidence >= 0.7 ? "green" : "amber"}>{Math.round(candidate.confidence * 100)}%</Badge></div>
                        <p className="mt-3 line-clamp-3 text-[10.5px] leading-relaxed text-ink/50">{candidate.steps.join("\n")}</p>
                        <div className="mt-3 flex items-center justify-between gap-2"><span className="font-mono text-[9.5px] text-ink/32">来源 {candidate.sourceMessages.length} 条 · {candidate.createdByAgent || "本地提炼"}</span><span className="flex gap-2"><Button variant="subtle" onClick={() => reviewSkillCandidate(candidate, "reject")} disabled={candidateBusyId === candidate.id}>拒绝</Button><Button variant="primary" onClick={() => reviewSkillCandidate(candidate, "promote")} disabled={candidateBusyId === candidate.id}>{candidateBusyId === candidate.id ? <Spinner /> : <Check className="h-3.5 w-3.5" />}转为待确认</Button></span></div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel className="overflow-hidden">
                <div className="border-b border-line bg-panel2/42 px-5 py-3"><h4 className="font-serif text-[17px]">FailureCandidate</h4></div>
                {failureCandidates.filter((item) => item.status === "candidate").length === 0 ? (
                  <div className="p-5"><Empty>暂无失败候选。扫描后再点击“提炼候选”。</Empty></div>
                ) : (
                  <div className="divide-y divide-line">
                    {failureCandidates.filter((item) => item.status === "candidate").map((candidate) => (
                      <div key={candidate.id} className="px-5 py-4">
                        <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="text-[12.5px] font-medium text-ink/74">{candidate.description}</div><code className="mt-1 block truncate font-mono text-[9.5px] text-ink/38">{candidate.guardRule}</code></div><Badge tone="red">{Math.round(candidate.confidence * 100)}%</Badge></div>
                        <div className="mt-3 flex items-center justify-between gap-2"><span className="font-mono text-[9.5px] text-ink/32">来源错误 {candidate.sourceErrors.length} 条 · 验证 {candidate.verification.length} 条</span><span className="flex gap-2"><Button variant="subtle" onClick={() => reviewFailureCandidate(candidate, "reject")} disabled={candidateBusyId === candidate.id}>拒绝</Button><Button variant="primary" onClick={() => reviewFailureCandidate(candidate, "promote")} disabled={candidateBusyId === candidate.id || candidate.verification.length === 0}>{candidateBusyId === candidate.id ? <Spinner /> : <Check className="h-3.5 w-3.5" />}转入失败库</Button></span></div>
                        {candidate.verification.length === 0 && <p className="mt-2 text-[10px] text-red/70">缺少验证证据，不能进入 Failure Guard；请保留为候选或拒绝。</p>}
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          </section>

          {historySummary && (
            <Panel className="mt-5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[9.5px] tracking-[0.08em] text-ink/32">最近一次扫描</div>
                  <div className="mt-1 text-[11px] text-ink/55">{shortDate(historySummary.endedAt)} · 扫描 ID {historySummary.id}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.values(historySummary.sourceCounts).map((source) => (
                    <Chip key={source.sourceAgent}>{source.sourceAgent} · {source.sessions} 会话 / {source.messages} 消息</Chip>
                  ))}
                </div>
              </div>
            </Panel>
          )}
        </div>
      )}

      {tab === "routing" && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <Panel className="h-fit space-y-4 p-5">
            <h2 className="font-serif text-[19px]">用历史证据选择 Agent</h2>
            <p className="text-[10.5px] leading-relaxed text-ink/38">推荐只基于已记录的成功与失败，不把模型名称当作能力证明。</p>
            <Field label="任务目标">
              <textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={4} placeholder="描述下一个任务…" className={cx(inputCls, "resize-none")} />
            </Field>
            <Field label="标签" hint="用逗号或空格分隔">
              <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="rust, tauri, windows" className={inputCls} />
            </Field>
            <Button variant="primary" onClick={route} disabled={routing} className="w-full">{routing ? <Spinner /> : <Compass className="h-4 w-4" />}{routing ? "正在推荐…" : "生成推荐"}</Button>
          </Panel>
          {recs.length === 0 ? (
            <Empty className="min-h-[260px]">输入目标后，AEL 会按历史任务结果说明推荐理由。</Empty>
          ) : (
            <Panel className="divide-y divide-line overflow-hidden">
              {recs.map((rec, index) => (
                <div key={rec.agentKind} className="px-5 py-4">
                  <div className="flex items-center gap-3"><span className="font-serif text-[22px] text-ink/28">0{index + 1}</span><span className="flex-1 text-[13px] font-medium text-ink/76">{rec.agentKind}</span><span className="font-mono text-[10px] text-ink/38">+{rec.successCount} / -{rec.failCount} · {rec.taskCount} 次</span></div>
                  <div className="mt-3 flex items-center gap-3"><Meter ratio={rec.score / maxScore} tone="orange" /><span className="w-10 text-right font-mono text-[10px] text-orange">{rec.score.toFixed(1)}</span></div>
                  {rec.reasons.length > 0 && <p className="mt-2 text-[10.5px] leading-relaxed text-ink/40">{rec.reasons.join(" · ")}</p>}
                </div>
              ))}
            </Panel>
          )}
        </div>
      )}

      {forgetTarget && (
        <Modal title="停止召回这条记忆？" onClose={() => setForgetTarget(null)}>
          <p className="text-[13px] font-medium text-ink/76">{forgetTarget.name}</p>
          <div className="mt-4 rounded-xl bg-panel2/72 p-4 text-[11px] leading-relaxed text-ink/50">
            停止后，它不会再进入新任务的记忆召回。内容、来源和历史结果仍会保留，你可以随时恢复。这不是永久删除。
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-[10.5px]">
            <div className="rounded-lg border border-line p-3"><span className="block text-ink/34">可能影响</span><span className="mt-1 block text-ink/64">标签 {forgetTarget.tags.join(" / ") || "全局"} 的后续任务</span></div>
            <div className="rounded-lg border border-line p-3"><span className="block text-ink/34">可恢复性</span><span className="mt-1 block text-green">保留全部来源链</span></div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="subtle" onClick={() => setForgetTarget(null)}>返回</Button>
            <Button
              variant="danger"
              disabled={busyId === forgetTarget.id}
              onClick={async () => {
                const target = forgetTarget;
                await updateStatus(target, "deprecated", "已停止召回；这条记忆仍可恢复。");
                setForgetTarget(null);
              }}
            >
              {busyId === forgetTarget.id ? <Spinner /> : <ShieldAlert className="h-3.5 w-3.5" />}
              确认停止召回
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
