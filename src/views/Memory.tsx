import { useEffect, useMemo, useState } from "react";
import { Compass, Radar, Sparkles, Wrench } from "lucide-react";
import { useStore } from "../store";
import { ipc } from "../lib/ipc";
import { SKILL_STATUS_LABEL, cx } from "../lib/format";
import { Badge, Button, Chip, Empty, Field, Kicker, Meter, PageTitle, Panel, Spinner, inputCls } from "../ui";
import type { AgentRecommendation, Failure, Skill } from "../types";

const freshnessLabel: Record<Skill["freshness"], string> = {
  fresh: "保鲜",
  needs_revalidation: "待重验",
};
const freshnessTone: Record<Skill["freshness"], "green" | "amber"> = {
  fresh: "green",
  needs_revalidation: "amber",
};

export function Memory() {
  const toast = useStore((s) => s.toast);

  const [skills, setSkills] = useState<Skill[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [checking, setChecking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // 智能路由
  const [goal, setGoal] = useState("");
  const [tags, setTags] = useState("");
  const [recs, setRecs] = useState<AgentRecommendation[]>([]);
  const [routing, setRouting] = useState(false);

  const loadSkills = () => ipc.listSkills({ limit: 100 }).then(setSkills).catch(() => {});
  const loadFailures = () => ipc.listFailures({ limit: 100 }).then(setFailures).catch(() => {});

  useEffect(() => {
    loadSkills();
    loadFailures();
  }, []);

  const maxScore = useMemo(
    () => recs.reduce((m, r) => Math.max(m, r.score), 0) || 1,
    [recs],
  );

  const runFreshness = async () => {
    setChecking(true);
    try {
      const { downgraded } = await ipc.runFreshnessCheck();
      toast(`保鲜检查完成:降级 ${downgraded} 条`, downgraded > 0 ? "warning" : "success");
      await loadSkills();
    } catch {
      toast("保鲜检查失败。", "error");
    } finally {
      setChecking(false);
    }
  };

  const activate = async (id: string) => {
    setBusyId(id);
    try {
      await ipc.updateSkillStatus(id, "active");
      toast("已确认转为已启用。", "success");
      await loadSkills();
    } catch {
      toast("状态更新失败。", "error");
    } finally {
      setBusyId(null);
    }
  };

  const revalidate = async (id: string) => {
    setBusyId(id);
    try {
      await ipc.revalidateSkill(id);
      toast("经验已重验,恢复保鲜。", "success");
      await loadSkills();
    } catch {
      toast("重验失败。", "error");
    } finally {
      setBusyId(null);
    }
  };

  const route = async () => {
    if (!goal.trim()) return toast("请先描述目标。", "warning");
    setRouting(true);
    try {
      const tagList = tags.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean);
      const r = await ipc.recommendAgents(goal.trim(), tagList.length ? tagList : undefined);
      setRecs(r);
      if (r.length === 0) toast("暂无匹配的 Agent 推荐。", "info");
    } catch {
      toast("路由推荐失败。", "error");
    } finally {
      setRouting(false);
    }
  };

  return (
    <div>
      <Kicker badge="经验层">经验库 · 同一个错误第二次不再犯 · 换 Agent 不必重讲</Kicker>
      <PageTitle sub="沉淀成功经验(Skills)与失败教训(Failures),并据历史战绩为下一个目标智能路由最合适的 Agent。">
        经验库
      </PageTitle>

      {/* ① Skills */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-mono text-[11px] tracking-kicker text-ink/45">
            <Sparkles className="h-3.5 w-3.5 text-orange" /> SKILLS · 成功经验
          </h2>
          <Button variant="ghost" className="px-3 py-1.5 text-[12px]" onClick={runFreshness} disabled={checking}>
            {checking ? <Spinner /> : <Radar className="h-3.5 w-3.5" />}
            保鲜检查
          </Button>
        </div>

        {skills.length === 0 ? (
          <Empty>还没有沉淀任何经验。任务验证通过后会自动生成草案。</Empty>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {skills.map((sk) => (
              <Panel key={sk.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[14px] font-semibold leading-snug text-ink/90">{sk.name}</h3>
                  <Badge tone={freshnessTone[sk.freshness]}>{freshnessLabel[sk.freshness]}</Badge>
                </div>

                <p className="line-clamp-2 font-mono text-[11.5px] leading-relaxed text-ink/45">
                  触发:{sk.trigger}
                </p>

                {sk.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {sk.tags.map((t) => (
                      <Chip key={t}>{t}</Chip>
                    ))}
                  </div>
                )}

                <div className="mt-auto flex items-center justify-between border-t border-ink/[0.07] pt-3">
                  <div className="flex items-center gap-3 font-mono text-[11px]">
                    <span className="text-green">+{sk.successCount}</span>
                    <span className="text-red">-{sk.failCount}</span>
                    <span className="text-ink/35">{SKILL_STATUS_LABEL[sk.status]}</span>
                  </div>
                  {sk.status === "draft" && (
                    <Button
                      variant="primary"
                      className="px-3 py-1.5 text-[11.5px]"
                      onClick={() => activate(sk.id)}
                      disabled={busyId === sk.id}
                    >
                      {busyId === sk.id ? <Spinner /> : null} 确认转 active
                    </Button>
                  )}
                  {sk.freshness === "needs_revalidation" && sk.status !== "draft" && (
                    <Button
                      variant="ghost"
                      className="px-3 py-1.5 text-[11.5px]"
                      onClick={() => revalidate(sk.id)}
                      disabled={busyId === sk.id}
                    >
                      {busyId === sk.id ? <Spinner /> : null} 已重验
                    </Button>
                  )}
                </div>
              </Panel>
            ))}
          </div>
        )}
      </section>

      {/* ② Failures */}
      <section className="mt-10">
        <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] tracking-kicker text-ink/45">
          <Wrench className="h-3.5 w-3.5 text-red" /> FAILURES · 失败教训
        </h2>

        {failures.length === 0 ? (
          <Empty>暂无失败记录。踩过的坑会在这里结成护栏。</Empty>
        ) : (
          <Panel className="divide-y divide-ink/[0.07]">
            {failures.map((f) => (
              <div key={f.id} className="px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-[11px] text-ink/35">{f.signature.slice(0, 8)}</span>
                  {f.occurrences > 1 && (
                    <Badge tone="orange">惯犯 ×{f.occurrences}</Badge>
                  )}
                  <code className="ml-auto truncate font-mono text-[10.5px] text-ink/40">{f.guardRule}</code>
                </div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">{f.description}</p>
                {(f.rootCause || f.fix) && (
                  <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {f.rootCause && (
                      <p className="text-[12px] leading-relaxed text-ink/50">
                        <span className="font-mono text-[10px] tracking-wide text-red">根因 </span>
                        {f.rootCause}
                      </p>
                    )}
                    {f.fix && (
                      <p className="text-[12px] leading-relaxed text-ink/50">
                        <span className="font-mono text-[10px] tracking-wide text-green">修复 </span>
                        {f.fix}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </Panel>
        )}
      </section>

      {/* ③ 智能路由 */}
      <section className="mt-10">
        <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] tracking-kicker text-ink/45">
          <Compass className="h-3.5 w-3.5 text-blue" /> SMART ROUTING · 智能路由
        </h2>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
          <Panel className="space-y-3 p-4">
            <Field label="目标 Goal">
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="描述下一个任务的目标…"
                rows={3}
                className={cx(inputCls, "resize-none")}
              />
            </Field>
            <Field label="标签 Tags" hint="逗号或空格分隔">
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="rust, sqlite, tauri"
                className={inputCls}
              />
            </Field>
            <Button variant="primary" className="w-full" onClick={route} disabled={routing}>
              {routing ? <Spinner /> : <Compass className="h-4 w-4" />}
              {routing ? "推荐中…" : "推荐 Agent"}
            </Button>
          </Panel>

          <div>
            {recs.length === 0 ? (
              <Empty className="h-full">输入目标并推荐,按历史战绩排序候选 Agent。</Empty>
            ) : (
              <div className="space-y-3">
                {recs.map((r) => (
                  <Panel key={r.agentKind} className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[14px] font-semibold text-ink/90">{r.agentKind}</span>
                      <span className="font-mono text-[11px] text-ink/40">
                        <span className="text-green">+{r.successCount}</span>{" "}
                        <span className="text-red">-{r.failCount}</span>{" "}
                        <span className="text-ink/30">· {r.taskCount} 次</span>
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-center gap-3">
                      <div className="flex-1">
                        <Meter ratio={r.score / maxScore} tone="orange" />
                      </div>
                      <span className="w-12 text-right font-mono text-[12px] tabular-nums text-orange">
                        {r.score.toFixed(1)}
                      </span>
                    </div>
                    {r.reasons.length > 0 && (
                      <ul className="mt-3 space-y-1">
                        {r.reasons.map((reason, i) => (
                          <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-ink/55">
                            <span className="text-orange">·</span>
                            {reason}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
