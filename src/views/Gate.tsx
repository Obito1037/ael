import { useEffect, useMemo, useState } from "react";
import { Check, FlaskConical, Save, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useStore } from "../store";
import { ipc } from "../lib/ipc";
import {
  ACTION_LABEL,
  VERDICT_LABEL,
  cx,
  shortDate,
  verdictTone,
} from "../lib/format";
import { Badge, Button, Empty, Kicker, PageTitle, Panel, Spinner, Stat, inputCls } from "../ui";
import type { PolicyAction, PolicyVerdict } from "../types";

const actionTone: Record<PolicyAction, "green" | "amber" | "red"> = {
  allow: "green",
  warn: "amber",
  hold: "amber",
  deny: "red",
};

export function Gate() {
  const pending = useStore((s) => s.pending);
  const removePending = useStore((s) => s.removePending);
  const decisions = useStore((s) => s.decisions);
  const setDecisions = useStore((s) => s.setDecisions);
  const toast = useStore((s) => s.toast);

  const [policy, setPolicy] = useState("");
  const [policyErr, setPolicyErr] = useState<string | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);

  const [probe, setProbe] = useState("");
  const [probing, setProbing] = useState(false);
  const [verdict, setVerdict] = useState<PolicyVerdict | null>(null);

  useEffect(() => {
    ipc.gateListDecisions({ limit: 100 }).then(setDecisions).catch(() => {});
    ipc.gateGetPolicyText().then(setPolicy).catch(() => {});
  }, [setDecisions]);

  const stats = useMemo(() => {
    let passed = 0;
    let blocked = 0;
    for (const d of decisions) {
      if (d.verdict === "denied" || d.verdict === "auto_denied") blocked++;
      else passed++;
    }
    return { passed, blocked };
  }, [decisions]);

  const resolve = async (id: string, approve: boolean) => {
    setResolving(id);
    try {
      const decision = await ipc.gateResolvePending(id, approve);
      removePending(id);
      useStore.getState().addDecision(decision);
      toast(approve ? "已放行,命令写入 Shell。" : "已拦截,命令未进入 Shell。", approve ? "success" : "info");
    } catch {
      toast("裁决失败。", "error");
    } finally {
      setResolving(null);
    }
  };

  const savePolicy = async () => {
    setSavingPolicy(true);
    setPolicyErr(null);
    try {
      await ipc.gateSetPolicyText(policy);
      toast("policy.toml 已保存并生效。", "success");
    } catch (e) {
      setPolicyErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPolicy(false);
    }
  };

  const test = async () => {
    if (!probe.trim()) return;
    setProbing(true);
    try {
      const v = await ipc.gateTestCommand(probe.trim());
      setVerdict(v);
    } catch {
      toast("试判失败。", "error");
    } finally {
      setProbing(false);
    }
  };

  return (
    <div>
      <Kicker badge="运行时安全">待确认命令、裁决记录与策略</Kicker>
      <PageTitle sub="危险命令在进入 Shell 前等待你的决定；每次放行或阻止都有记录。">
        安全
      </PageTitle>

      {/* 顶部统计 */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <Panel className="p-5">
          <Stat value={pending.length} label="待人工裁决" tone="orange" />
        </Panel>
        <Panel className="p-5">
          <Stat value={stats.passed} label="账本 · 已放行" tone="green" />
        </Panel>
        <Panel className="p-5">
          <Stat value={stats.blocked} label="账本 · 已拦截" tone="red" />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* 待裁决队列 */}
        <section>
          <h2 className="mb-3 font-mono text-[11px] tracking-kicker text-ink/45">PENDING QUEUE · 待裁决队列</h2>
          {pending.length === 0 ? (
            <Empty>裁决线清空 · 暂无扣留命令</Empty>
          ) : (
            <div className="space-y-3">
              {pending.map((p) => (
                <Panel key={p.id} className="animate-slide-down border-red/30 p-4">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-red" />
                    <span className="font-mono text-[11px] tracking-wide text-red">POLICY GATE</span>
                    <Badge tone="red" className="ml-auto">{p.ruleId}</Badge>
                  </div>
                  <code className="mt-2.5 block break-all font-mono text-[12.5px] text-ink/90">$ {p.commandText}</code>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink/50">{p.reason}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      variant="primary"
                      className="px-4 py-1.5 text-[12px]"
                      disabled={resolving === p.id}
                      onClick={() => resolve(p.id, true)}
                    >
                      {resolving === p.id ? <Spinner /> : <Check className="h-3.5 w-3.5" />} 放行
                    </Button>
                    <Button
                      variant="danger"
                      className="px-4 py-1.5 text-[12px]"
                      disabled={resolving === p.id}
                      onClick={() => resolve(p.id, false)}
                    >
                      <X className="h-3.5 w-3.5" /> 拦截
                    </Button>
                    <span className="ml-auto font-mono text-[10px] text-ink/30">不处理则默认拦截</span>
                  </div>
                </Panel>
              ))}
            </div>
          )}

          {/* 命令试判器 */}
          <h2 className="mb-3 mt-8 font-mono text-[11px] tracking-kicker text-ink/45">COMMAND PROBE · 命令试判器</h2>
          <Panel className="space-y-3 p-4">
            <div className="flex gap-2">
              <input
                value={probe}
                onChange={(e) => setProbe(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && test()}
                placeholder="输入一条命令,预演海关裁决…"
                className={cx(inputCls, "flex-1 font-mono text-[12.5px]")}
              />
              <Button variant="primary" onClick={test} disabled={probing || !probe.trim()}>
                {probing ? <Spinner /> : <FlaskConical className="h-4 w-4" />} 试判
              </Button>
            </div>
            {verdict && (
              <div className="rounded-lg border border-ink/10 bg-panel2 p-3.5">
                <div className="flex items-center gap-2">
                  <Badge tone={actionTone[verdict.action]}>{ACTION_LABEL[verdict.action]}</Badge>
                  {verdict.ruleId && (
                    <span className="font-mono text-[10.5px] text-ink/40">规则 {verdict.ruleId}</span>
                  )}
                  <span className="ml-auto font-mono text-[10px] text-ink/30">
                    {verdict.matched ? "命中规则" : "未命中 · 默认放行"}
                  </span>
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-ink/60">{verdict.reason}</p>
              </div>
            )}
          </Panel>
        </section>

        {/* 裁决账本 */}
        <section>
          <h2 className="mb-3 font-mono text-[11px] tracking-kicker text-ink/45">GATE LEDGER · 裁决账本</h2>
          <Panel className="max-h-[320px] overflow-y-auto">
            {decisions.length === 0 ? (
              <div className="px-5 py-10 text-center text-[13px] text-ink/35">海关暂无裁决记录</div>
            ) : (
              <div className="divide-y divide-ink/[0.07]">
                {decisions.map((d) => (
                  <div key={d.id} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Badge tone={verdictTone[d.verdict]}>{VERDICT_LABEL[d.verdict]}</Badge>
                      <span className="font-mono text-[10.5px] text-ink/35">
                        {ACTION_LABEL[d.action]} · {d.ruleId}
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-ink/25">
                        {d.decidedBy === "human" ? "人工" : "策略"} · {shortDate(d.createdAt)}
                      </span>
                    </div>
                    <code className="mt-1.5 block truncate font-mono text-[11.5px] text-ink/60">$ {d.commandText}</code>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* policy.toml 编辑器 */}
          <div className="mb-3 mt-8 flex items-center justify-between">
            <h2 className="font-mono text-[11px] tracking-kicker text-ink/45">POLICY.TOML · 策略引擎</h2>
            <Button variant="primary" className="px-3.5 py-1.5 text-[12px]" onClick={savePolicy} disabled={savingPolicy}>
              {savingPolicy ? <Spinner /> : <Save className="h-3.5 w-3.5" />} 保存
            </Button>
          </div>
          <Panel className="p-3">
            <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] text-ink/30">
              <ShieldCheck className="h-3 w-3 text-green" /> 本地生效 · 网关热加载
            </div>
            <textarea
              value={policy}
              onChange={(e) => setPolicy(e.target.value)}
              spellCheck={false}
              className="h-[240px] w-full resize-none rounded-lg border border-ink/12 bg-panel2 p-3 font-mono text-[12px] leading-relaxed text-ink/85 placeholder:text-ink/30 focus:border-orange/50"
              placeholder="# policy.toml"
            />
            {policyErr && (
              <p className="mt-2 font-mono text-[11.5px] leading-relaxed text-red">保存失败:{policyErr}</p>
            )}
          </Panel>
        </section>
      </div>
    </div>
  );
}
