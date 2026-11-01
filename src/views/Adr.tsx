import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Hammer } from "lucide-react";
import { useStore } from "../store";
import { ipc } from "../lib/ipc";
import { ADR_STATUS_LABEL, cx, shortDate } from "../lib/format";
import { Badge, Button, Empty, Kicker, PageTitle, Panel, Spinner } from "../ui";
import type { AdrRecord, AdrStatus, Task } from "../types";

const adrTone: Record<AdrStatus, "amber" | "green" | "ink"> = {
  proposed: "amber",
  accepted: "green",
  superseded: "ink",
};

const adrCode = (n: number) => `ADR-${String(n).padStart(4, "0")}`;

export function Adr() {
  const tasks = useStore((s) => s.tasks);
  const toast = useStore((s) => s.toast);

  const [filter, setFilter] = useState<string>(""); // "" = 全部
  const [adrs, setAdrs] = useState<AdrRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"compile" | "export" | null>(null);

  const load = async (taskId: string) => {
    setLoading(true);
    try {
      const list = await ipc.listAdrs(taskId || undefined);
      setAdrs(list);
      setSelectedId((prev) => (list.some((a) => a.id === prev) ? prev : list[0]?.id ?? null));
    } catch {
      toast("读取 ADR 失败。", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(filter);
  }, [filter]);

  const selectedTask: Task | undefined = useMemo(
    () => tasks.find((t) => t.id === filter),
    [tasks, filter],
  );

  const selected = useMemo(
    () => adrs.find((a) => a.id === selectedId) ?? null,
    [adrs, selectedId],
  );

  const compile = async () => {
    if (!filter) return toast("请先在过滤器中选定一个任务。", "warning");
    setBusy("compile");
    try {
      await ipc.compileAdrs(filter);
      await load(filter);
      toast("已编译当前任务的 ADR。", "success");
    } catch {
      toast("编译 ADR 失败。", "error");
    } finally {
      setBusy(null);
    }
  };

  const exportAll = async () => {
    if (!filter) return toast("请先在过滤器中选定一个任务。", "warning");
    setBusy("export");
    try {
      const paths = await ipc.exportAdrs(filter, selectedTask?.repoPath);
      toast(
        paths.length
          ? `已导出 ${paths.length} 篇 ADR → ${paths[0]}${paths.length > 1 ? " 等" : ""}`
          : "没有可导出的 ADR。",
        paths.length ? "success" : "info",
      );
    } catch {
      toast("导出 ADR 失败。", "error");
    } finally {
      setBusy(null);
    }
  };

  const taskTitle = (taskId?: string) =>
    taskId ? tasks.find((t) => t.id === taskId)?.title ?? taskId : "—";

  return (
    <div>
      <Kicker badge="活文档 ADR">从任务事件编译出的架构选择</Kicker>
      <PageTitle sub="把为什么这样做留在代码旁边，并保留背景、决定和影响。">
        决策
      </PageTitle>

      {/* 顶部工具条 */}
      <Panel className="mb-6 flex flex-wrap items-center gap-3 p-4">
        <span className="font-mono text-[11px] tracking-kicker text-ink/45">任务过滤</span>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-lg border border-ink/12 bg-panel2 px-3 py-2 text-[13px] text-ink focus:border-orange/50"
        >
          <option value="" className="bg-panel">全部任务</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id} className="bg-panel">
              {t.title}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={compile} disabled={!filter || busy !== null}>
            {busy === "compile" ? <Spinner /> : <Hammer className="h-4 w-4" />}
            编译当前任务 ADR
          </Button>
          <Button variant="primary" onClick={exportAll} disabled={!filter || busy !== null}>
            {busy === "export" ? <Spinner /> : <Download className="h-4 w-4" />}
            导出
          </Button>
        </div>
      </Panel>

      {/* master-detail */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* 左:ADR 列表 */}
        <section>
          <h2 className="mb-3 font-mono text-[11px] tracking-kicker text-ink/45">
            ADR LIST · {adrs.length} 篇
          </h2>
          <Panel className="divide-y divide-ink/[0.07]">
            {loading && (
              <div className="flex items-center gap-2 px-5 py-8 text-[13px] text-ink/40">
                <Spinner /> 加载中…
              </div>
            )}
            {!loading && adrs.length === 0 && (
              <div className="p-4">
                <Empty>decision 事件在 finalize 时会自动编译为 ADR。</Empty>
              </div>
            )}
            {!loading &&
              adrs.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={cx(
                    "flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors",
                    selectedId === a.id ? "bg-ink/[0.03]" : "hover:bg-ink/[0.02]",
                  )}
                >
                  <span className="mt-0.5 font-mono text-[10.5px] text-ink/35">{adrCode(a.number)}</span>
                  <span className="flex-1 truncate text-[13.5px] text-ink/85">{a.title}</span>
                  <Badge tone={adrTone[a.status]}>{ADR_STATUS_LABEL[a.status]}</Badge>
                </button>
              ))}
          </Panel>
        </section>

        {/* 右:详情 */}
        <section>
          <h2 className="mb-3 font-mono text-[11px] tracking-kicker text-ink/45">DECISION RECORD · 决策详情</h2>
          {!selected ? (
            <Empty className="py-16">
              <FileText className="mx-auto mb-3 h-6 w-6 text-ink/25" />
              从左侧选择一篇 ADR 查看背景 · 决策 · 影响。
            </Empty>
          ) : (
            <Panel className="p-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-[12px] text-orange">{adrCode(selected.number)}</span>
                <Badge tone={adrTone[selected.status]}>{ADR_STATUS_LABEL[selected.status]}</Badge>
                <span className="ml-auto font-mono text-[10.5px] text-ink/30">{shortDate(selected.createdAt)}</span>
              </div>
              <h3 className="mt-2 font-sans text-[19px] font-bold leading-snug text-ink">{selected.title}</h3>

              <dl className="mt-5 space-y-5">
                <div>
                  <dt className="mb-1.5 font-mono text-[10.5px] tracking-kicker text-ink/45">来源任务</dt>
                  <dd className="text-[13px] text-ink/70">{taskTitle(selected.taskId)}</dd>
                </div>

                <div>
                  <dt className="mb-1.5 font-mono text-[10.5px] tracking-kicker text-ink/45">背景 · CONTEXT</dt>
                  <dd className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink/80">
                    {selected.context || "—"}
                  </dd>
                </div>

                <div className="rounded-lg border border-orange/25 bg-orange/[0.04] p-4">
                  <dt className="mb-1.5 font-mono text-[10.5px] tracking-kicker text-orange">决策 · DECISION</dt>
                  <dd className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink/90">
                    {selected.decision || "—"}
                  </dd>
                </div>

                <div>
                  <dt className="mb-1.5 font-mono text-[10.5px] tracking-kicker text-ink/45">影响 · CONSEQUENCES</dt>
                  <dd className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink/80">
                    {selected.consequences || "—"}
                  </dd>
                </div>

                {selected.filePath && (
                  <div>
                    <dt className="mb-1.5 font-mono text-[10.5px] tracking-kicker text-ink/45">文件路径</dt>
                    <dd className="break-all font-mono text-[12px] text-ink/55">{selected.filePath}</dd>
                  </div>
                )}
              </dl>
            </Panel>
          )}
        </section>
      </div>
    </div>
  );
}
