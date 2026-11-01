import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, FolderOpen, GitBranch, Sparkles, TerminalSquare, Play } from "lucide-react";
import { useStore } from "../store";
import { ipc } from "../lib/ipc";
import { cx, TASK_STATUS_LABEL, taskStatusTone, timeAgo } from "../lib/format";
import { Badge, Button, Empty, Field, Modal, Panel, Spinner, inputCls } from "../ui";
import type { AgentProfile, GuardResult, RankedSkill } from "../types";

export function Overview() {
  const tasks = useStore((state) => state.tasks);
  const goTask = useStore((state) => state.goTask);
  const setView = useStore((state) => state.setView);
  const upsertTask = useStore((state) => state.upsertTask);
  const toast = useStore((state) => state.toast);

  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [branch, setBranch] = useState("main");
  const [agentId, setAgentId] = useState("");
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [memoryCounts, setMemoryCounts] = useState({ active: 0, stale: 0 });
  const [preview, setPreview] = useState<RankedSkill[]>([]);
  const [guard, setGuard] = useState<GuardResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const mountedRef = useRef(false);
  const previewingRef = useRef(false);
  const creatingRef = useRef(false);
  const previewTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    ipc.listSkills({ limit: 200 }).then((skills) => {
      if (!active) return;
      setMemoryCounts({
        active: skills.filter((skill) => skill.status === "active").length,
        stale: skills.filter((skill) => skill.freshness === "needs_revalidation").length,
      });
    }).catch(() => {});
    ipc.detectAgents().then((profiles) => {
      if (!active) return;
      setAgents(profiles);
      const firstAvailable = profiles.find((profile) => profile.available);
      if (firstAvailable) setAgentId(firstAvailable.id);
    }).catch(() => {});
    return () => { active = false; mountedRef.current = false; };
  }, []);

  const openPreview = async () => {
    if (previewingRef.current || creatingRef.current) return;
    if (!goal.trim()) return toast("先写下任务目标，AEL 才能判断哪些记忆相关。", "warning");
    previewTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previewingRef.current = true;
    setPreviewing(true);
    try {
      const [skills, nextGuard] = await Promise.all([
        ipc.searchSkills({ query: goal.trim(), status: "active", limit: 4 }),
        ipc.checkFailureGuard(goal.trim()),
      ]);
      if (!mountedRef.current) return;
      setPreview(skills);
      setGuard(nextGuard);
      setPreviewOpen(true);
    } catch {
      if (mountedRef.current) toast("暂时无法获取记忆匹配结果。", "error");
    } finally {
      previewingRef.current = false;
      if (mountedRef.current) setPreviewing(false);
    }
  };

  const createTask = async () => {
    if (!goal.trim() || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const fullGoal = acceptance.trim() ? `${goal.trim()}\n\n验收条件：${acceptance.trim()}` : goal.trim();
      const task = await ipc.createTask({
        title: title.trim() || goal.trim().slice(0, 42),
        goal: fullGoal,
        agentId: agentId || undefined,
        repoPath: repoPath.trim() || undefined,
        repoBranch: branch.trim() || undefined,
        tags: [],
      });
      if (!mountedRef.current) return;
      upsertTask(task);
      setPreviewOpen(false);
      toast("任务创建成功。", "success");
      goTask(task.id);
    } catch {
      if (mountedRef.current) toast("创建任务失败。", "error");
    } finally {
      creatingRef.current = false;
      if (mountedRef.current) setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-[720px]">
      <button type="button" className="overview-demo-entry" onClick={() => setView("demo")}>
        <span className="overview-demo-icon"><Play size={17} /></span>
        <span><strong>先体验一次记忆学习与复用</strong><small>从解决问题到下一次召回，亲手决定哪些经验值得留下。</small></span>
        <ArrowRight size={17} />
      </button>
      <Panel className="overflow-hidden bg-panel/94 shadow-[var(--shadow-soft)]">
        <div className="border-b border-line px-7 py-6 text-center">
          <h1 className="font-serif text-[26px] font-normal leading-[1.25] tracking-[-0.02em] text-ink">开始一件事</h1>
          <p className="mt-2 text-[13px] leading-[1.7] text-ink/46">写下目标，审阅相关经验，再创建任务。</p>
        </div>

        <fieldset disabled={previewing || creating} className="min-w-0 space-y-[18px] px-7 py-6">
          <Field label="任务名称">
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：修复 Windows 构建失败" className={inputCls} />
          </Field>
          <Field label="目标">
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              rows={3}
              placeholder="描述要解决的问题和不能破坏的边界…"
              className={cx(inputCls, "resize-none font-serif text-[16px] leading-[1.7]")}
            />
          </Field>
          <Field label="项目路径">
            <div className="relative">
              <FolderOpen className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-ink/30" />
              <input value={repoPath} onChange={(event) => setRepoPath(event.target.value)} placeholder="D:\\workspace\\project" className={cx(inputCls, "pl-10 font-mono text-[13px]")} />
            </div>
          </Field>

          <div className="grid gap-4 border-t border-line pt-5 md:grid-cols-2">
            <Field label="Agent">
              <select value={agentId} onChange={(event) => setAgentId(event.target.value)} className={inputCls}>
                <option value="">启动时再选择</option>
                {agents.map((agent) => <option key={agent.id} value={agent.id} disabled={!agent.available}>{agent.displayName} · {agent.available ? "Ready" : "Missing"}</option>)}
              </select>
            </Field>
            <div className="space-y-2" aria-label="记忆匹配说明">
              <p className="text-[13.5px] font-medium text-ink/52">记忆匹配</p>
              <p className="text-[12.5px] leading-relaxed text-ink/46">启动时根据任务匹配，实际注入以启动上下文为准。</p>
            </div>
          </div>
          <details className="border-t border-line pt-4">
            <summary className="cursor-pointer text-[13px] text-ink/52">可选设置 · 验收条件与分支</summary>
            <div className="mt-4 space-y-4">
              <Field label="验收条件">
                <textarea value={acceptance} onChange={(event) => setAcceptance(event.target.value)} rows={2}
                  placeholder="例如：构建成功，测试通过，不引入新的平台回归" className={cx(inputCls, "resize-none")} />
              </Field>
              <Field label="分支">
                <div className="relative">
                  <GitBranch className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-ink/30" />
                  <input value={branch} onChange={(event) => setBranch(event.target.value)} className={cx(inputCls, "pl-10 font-mono text-[13px]")} />
                </div>
              </Field>
            </div>
          </details>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line bg-panel2/36 px-7 py-5">
          <button type="button" onClick={() => setView("memory")} className="flex items-center gap-2.5 text-left">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-green/[0.09] text-green"><Sparkles className="h-3.5 w-3.5" /></span>
            <span><span className="block text-[14.5px] text-ink/68">找到 {memoryCounts.active} 条可用记忆</span><span className="block text-[12px] text-ink/40">{memoryCounts.stale} 条需要重验 · 创建前可审阅</span></span>
          </button>
          <Button variant="primary" onClick={openPreview} disabled={previewing || creating} className="min-w-[150px]">
            {previewing ? <Spinner /> : <ArrowRight className="h-4 w-4" />}{previewing ? "匹配中…" : "创建任务"}
          </Button>
        </div>
      </Panel>

      <section className="mt-7">
        <div className="mb-2 flex items-center justify-between px-1 text-[12px] tracking-[0.08em] text-ink/42"><span>最近任务</span><button type="button" onClick={() => setView("tasks")} className="tracking-normal hover:text-orange">全部 →</button></div>
        {tasks.length === 0 ? <Empty>还没有任务。</Empty> : (
          <Panel className="divide-y divide-line overflow-hidden">
            {tasks.slice(0, 4).map((task) => (
              <button type="button" key={task.id} onClick={() => goTask(task.id)} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-panel2/42">
                <span className="min-w-0 flex-1"><span className="block truncate text-[15.5px] text-ink/74">{task.title}</span><span className="mt-0.5 block font-mono text-[12px] text-ink/36">{task.repoPath || "本地任务"} · {timeAgo(task.updatedAt)}</span></span>
                <Badge tone={taskStatusTone[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>
                <ArrowRight className="h-3.5 w-3.5 text-ink/20" />
              </button>
            ))}
          </Panel>
        )}
      </section>

      {previewOpen && (
        <Modal title="这次带上什么" onClose={() => setPreviewOpen(false)} returnFocusTo={previewTriggerRef.current} wide>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_250px]">
            <div>
              <div className="mb-3 flex items-center justify-between"><span className="text-[12px] tracking-[0.04em] text-ink/50">相关记忆 · {preview.length}</span><span className="text-[12px] text-ink/40">审阅匹配结果</span></div>
              {preview.length === 0 ? <Empty>没有找到足够相关的长期记忆。</Empty> : (
                <div className="space-y-2.5">
                  {preview.map(({ skill, score }) => (
                    <div key={skill.id} className="rounded-xl bg-panel2/74 px-4 py-3.5">
                      <div className="flex items-start gap-3"><span className="mt-0.5 grid h-5 w-5 place-items-center rounded-md bg-green/[0.11] text-green"><Check className="h-3 w-3" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-[12.5px] font-medium text-ink/80">{skill.name}</span><Badge tone={skill.freshness === "fresh" ? "green" : "amber"}>{skill.freshness === "fresh" ? "已验证" : "待重验"}</Badge></div><p className="mt-1.5 text-[10.5px] text-ink/46">为什么召回：{skill.trigger}</p><div className="mt-2 flex gap-4 font-mono text-[9px] text-ink/32"><span>匹配 {Math.round(score * 100)}%</span><span>证据 +{skill.successCount} / -{skill.failCount}</span></div></div></div>
                    </div>
                  ))}
                </div>
              )}
              {(guard?.matchedFailures.length || 0) > 0 && <div className="mt-5"><div className="mb-2 text-[12px] text-ink/50">关联失败记录</div>{guard?.matchedFailures.map((failure) => <div key={failure.id} className="mb-2 rounded-xl bg-red/[0.055] px-4 py-3 text-[11px] text-red">{failure.description}<span className="mt-1 block font-mono text-[9px] text-ink/32">{failure.guardRule}</span></div>)}</div>}
            </div>
            <aside className="rounded-xl bg-panel2/62 p-4"><h3 className="font-serif text-[18px]">匹配摘要</h3><p className="mt-3 text-[12px] leading-relaxed text-ink/46">启动时根据任务匹配，实际注入以启动上下文为准。</p><div className="mt-4 space-y-3 text-[12px]"><div className="flex justify-between"><span className="text-ink/40">相关记忆</span><span className="tabular-nums">{preview.length}</span></div><div className="flex justify-between"><span className="text-ink/40">关联失败</span><span className="tabular-nums">{guard?.matchedFailures.length || 0}</span></div></div><Button variant="primary" className="mt-5 w-full" onClick={createTask} disabled={creating}>{creating ? <Spinner /> : <TerminalSquare className="h-4 w-4" />}{creating ? "创建中…" : "确认并开始"}</Button><Button variant="subtle" className="mt-2 w-full" onClick={() => setPreviewOpen(false)} disabled={creating}>返回</Button></aside>
          </div>
        </Modal>
      )}
    </div>
  );
}
