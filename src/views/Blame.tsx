import { useEffect, useMemo, useState } from "react";
import { ClipboardCopy, Fingerprint, GitCommit, RefreshCw, Search } from "lucide-react";
import { useStore } from "../store";
import { ipc } from "../lib/ipc";
import {
  ACTOR_LABEL,
  actorTone,
  cx,
  shortDate,
  TASK_STATUS_LABEL,
  taskStatusTone,
  timeAgo,
} from "../lib/format";
import { Badge, Button, Empty, Field, Kicker, PageTitle, Panel, Spinner, inputCls } from "../ui";
import type { BlameReport, CommitLink, TaskEvent } from "../types";

type TimelineRow = TaskEvent & { _lane: "ai" | "human" | "guard" };

export function Blame() {
  const tasks = useStore((s) => s.tasks);
  const toast = useStore((s) => s.toast);

  const [repoPath, setRepoPath] = useState("");
  const [file, setFile] = useState("");
  const [line, setLine] = useState("1");
  const [report, setReport] = useState<BlameReport | null>(null);
  const [tracing, setTracing] = useState(false);

  const [ledgerTaskId, setLedgerTaskId] = useState("");
  const [links, setLinks] = useState<CommitLink[]>([]);
  const [scanning, setScanning] = useState(false);
  const [loadingLinks, setLoadingLinks] = useState(false);

  // 默认取第一个带仓库路径的任务
  useEffect(() => {
    if (!repoPath) {
      const withRepo = tasks.find((t) => t.repoPath)?.repoPath;
      if (withRepo) setRepoPath(withRepo);
    }
    if (!ledgerTaskId && tasks[0]) setLedgerTaskId(tasks[0].id);
  }, [tasks, repoPath, ledgerTaskId]);

  const timeline = useMemo<TimelineRow[]>(() => {
    if (!report) return [];
    const rows: TimelineRow[] = [
      ...report.decisions.map((e) => ({ ...e, _lane: "ai" as const })),
      ...report.humanConfirmations.map((e) => ({ ...e, _lane: "human" as const })),
      ...report.guardEvents.map((e) => ({ ...e, _lane: "guard" as const })),
    ];
    return rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [report]);

  const trace = async () => {
    if (!repoPath.trim() || !file.trim()) return toast("请填写仓库路径与文件。", "warning");
    const ln = parseInt(line, 10);
    if (!Number.isFinite(ln) || ln < 1) return toast("行号需为正整数。", "warning");
    setTracing(true);
    try {
      const r = await ipc.blameLine(repoPath.trim(), file.trim(), ln);
      setReport(r);
    } catch {
      toast("行级溯源失败,请检查路径与行号。", "error");
    } finally {
      setTracing(false);
    }
  };

  const loadLinks = async (taskId: string) => {
    if (!taskId) return;
    setLoadingLinks(true);
    try {
      setLinks(await ipc.listCommitLinks(taskId));
    } catch {
      toast("读取提交账本失败。", "error");
    } finally {
      setLoadingLinks(false);
    }
  };

  useEffect(() => {
    if (ledgerTaskId) loadLinks(ledgerTaskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerTaskId]);

  const scan = async () => {
    if (!repoPath.trim()) return toast("请先填写仓库路径。", "warning");
    setScanning(true);
    try {
      const found = await ipc.scanRepoCommits(repoPath.trim());
      toast(`扫描完成,发现 ${found.length} 条带溯源标记的提交。`, "success");
      if (ledgerTaskId) loadLinks(ledgerTaskId);
    } catch {
      toast("扫描仓库提交失败。", "error");
    } finally {
      setScanning(false);
    }
  };

  const copyTrailer = async () => {
    if (!ledgerTaskId) return;
    try {
      const { trailer } = await ipc.generateCommitTrailer(ledgerTaskId);
      await navigator.clipboard.writeText(trailer);
      toast("Commit trailer 已复制到剪贴板。", "success");
    } catch {
      toast("生成 commit trailer 失败。", "error");
    }
  };

  return (
    <div>
      <Kicker badge="行级溯源">提交、任务、会话与决策</Kicker>
      <PageTitle sub="从一行代码回到它的提交、任务、Agent 会话和人工确认。">
        来源链
      </PageTitle>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* 左:行级溯源 */}
        <div className="space-y-5">
          <Panel className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1fr_1fr_88px_auto] sm:items-end">
            <Field label="仓库路径">
              <input value={repoPath} onChange={(e) => setRepoPath(e.target.value)} placeholder="D:/repo" className={inputCls} />
            </Field>
            <Field label="文件">
              <input value={file} onChange={(e) => setFile(e.target.value)} placeholder="src/main.rs" className={inputCls} />
            </Field>
            <Field label="行号">
              <input value={line} onChange={(e) => setLine(e.target.value)} inputMode="numeric" className={inputCls} />
            </Field>
            <Button variant="primary" onClick={trace} disabled={tracing}>
              {tracing ? <Spinner /> : <Search className="h-4 w-4" />}
              溯源
            </Button>
          </Panel>

          {!report && <Empty>输入文件与行号,点「溯源」定位这行代码背后的决策现场。</Empty>}

          {report && (
            <>
              {/* commit 卡片 */}
              <Panel className="p-5">
                <div className="flex items-center gap-2">
                  <GitCommit className="h-4 w-4 text-orange" />
                  <span className="font-mono text-[11px] tracking-kicker text-ink/45">SOURCE COMMIT · 承接提交</span>
                  <Badge tone={report.linked ? "green" : "ink"} className="ml-auto">
                    {report.linked ? "已链接治理层" : "未链接"}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <code className="font-mono text-[15px] font-bold text-ink">
                    {report.commitHash ? report.commitHash.slice(0, 8) : "无提交记录"}
                  </code>
                  <span className="text-[13.5px] text-ink/80">{report.commitSubject || "—"}</span>
                </div>
                <p className="mt-1.5 font-mono text-[11px] text-ink/40">
                  {report.file}:{report.line}
                  {report.commitAuthor && <span className="ml-2 text-ink/50">· {report.commitAuthor}</span>}
                </p>
              </Panel>

              {!report.linked && (
                <Empty>
                  这行代码尚未与 AEL 任务链接 —— 该提交没有携带 AEL-Task trailer。用右侧「复制 commit trailer」把提交并入治理层。
                </Empty>
              )}

              {/* 任务卡片 */}
              {report.task && (
                <Panel className="p-5">
                  <div className="flex items-center gap-2">
                    <Fingerprint className="h-4 w-4 text-blue" />
                    <span className="font-mono text-[11px] tracking-kicker text-ink/45">LINKED TASK · 承接任务</span>
                    <Badge tone={taskStatusTone[report.task.status]} className="ml-auto">
                      {TASK_STATUS_LABEL[report.task.status]}
                    </Badge>
                  </div>
                  <h3 className="mt-3 text-[15px] font-bold text-ink">{report.task.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink/55">{report.task.goal}</p>
                </Panel>
              )}

              {/* 决策现场时间线 */}
              <section>
                <h2 className="mb-3 font-mono text-[11px] tracking-kicker text-ink/45">DECISION SCENE · 决策现场 · 责任链</h2>
                <Panel className="p-4">
                  {timeline.length === 0 ? (
                    <div className="py-6 text-center text-[12.5px] text-ink/35">这行代码没有留下决策证据。</div>
                  ) : (
                    <ol className="relative space-y-3 pl-4">
                      <span className="absolute bottom-1 left-[3px] top-2 w-px bg-ink/10" />
                      {timeline.map((e) => (
                        <li key={e.id} className="relative">
                          <span className={cx("absolute -left-4 top-1.5 h-1.5 w-1.5 rounded-full", `bg-${actorTone[e.actor]}`)} />
                          <div className="flex items-center gap-2">
                            <Badge tone={actorTone[e.actor]}>{ACTOR_LABEL[e.actor]}</Badge>
                            <span className="ml-auto font-mono text-[10px] text-ink/30">{shortDate(e.createdAt)}</span>
                          </div>
                          <p className="mt-1 text-[13px] text-ink/80">{e.summary}</p>
                          {e.detail && <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink/45">{e.detail}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                </Panel>
              </section>

              {/* ADR + 会话 */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <section>
                  <h2 className="mb-3 font-mono text-[11px] tracking-kicker text-ink/45">ADR · 活文档</h2>
                  <Panel className="divide-y divide-ink/[0.07]">
                    {report.adrs.length === 0 && <div className="px-4 py-6 text-center text-[12.5px] text-ink/35">无相关 ADR</div>}
                    {report.adrs.map((a) => (
                      <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="font-mono text-[11px] text-orange">ADR-{String(a.number).padStart(3, "0")}</span>
                        <span className="flex-1 truncate text-[13px] text-ink/80">{a.title}</span>
                      </div>
                    ))}
                  </Panel>
                </section>

                <section>
                  <h2 className="mb-3 font-mono text-[11px] tracking-kicker text-ink/45">SESSIONS · 涉及会话</h2>
                  <Panel className="divide-y divide-ink/[0.07]">
                    {report.sessions.length === 0 && <div className="px-4 py-6 text-center text-[12.5px] text-ink/35">无关联会话</div>}
                    {report.sessions.map((s) => (
                      <div key={s.id} className="px-4 py-3">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10.5px] text-ink/45">{s.agentId}</span>
                          <span className="font-mono text-[10px] text-ink/30">{shortDate(s.startedAt)} → {s.endedAt ? shortDate(s.endedAt) : "…"}</span>
                        </div>
                        <code className="mt-1 block truncate font-mono text-[11.5px] text-ink/60">{s.commandLine}</code>
                      </div>
                    ))}
                  </Panel>
                </section>
              </div>
            </>
          )}
        </div>

        {/* 右:commit 溯源账本 */}
        <div className="space-y-4">
          <Panel className="space-y-3 p-4">
            <h3 className="font-mono text-[11px] tracking-kicker text-ink/45">COMMIT LEDGER · 提交溯源账本</h3>
            <Field label="选择任务">
              <select value={ledgerTaskId} onChange={(e) => setLedgerTaskId(e.target.value)} className={inputCls}>
                {tasks.length === 0 && <option value="">暂无任务</option>}
                {tasks.map((t) => (
                  <option key={t.id} value={t.id} className="bg-panel">
                    {t.title}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={scan} disabled={scanning || !repoPath.trim()}>
                {scanning ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
                扫描仓库提交
              </Button>
              <Button variant="ghost" className="flex-1" onClick={copyTrailer} disabled={!ledgerTaskId}>
                <ClipboardCopy className="h-3.5 w-3.5" />
                复制 trailer
              </Button>
            </div>
          </Panel>

          <Panel className="divide-y divide-ink/[0.07]">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="font-mono text-[10.5px] tracking-kicker text-ink/45">已链接提交</span>
              {loadingLinks && <Spinner />}
            </div>
            {!loadingLinks && links.length === 0 && (
              <div className="px-4 py-8 text-center text-[12.5px] text-ink/35">
                该任务还没有链接提交。写代码时带上 AEL-Task trailer,或点「扫描仓库提交」自动回填。
              </div>
            )}
            {links.map((c) => (
              <div key={c.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <code className="font-mono text-[12px] font-bold text-ink/85">{c.commitHash.slice(0, 8)}</code>
                  {c.author && <span className="font-mono text-[10px] text-ink/40">{c.author}</span>}
                  <span className="ml-auto font-mono text-[10px] text-ink/30">{timeAgo(c.committedAt || c.createdAt)}</span>
                </div>
                {c.subject && <p className="mt-1 truncate text-[12.5px] text-ink/70">{c.subject}</p>}
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}
