import { useEffect, useState } from "react";
import { Check, DatabaseBackup, HardDriveDownload, RefreshCw, Save, Terminal } from "lucide-react";
import { useStore } from "../store";
import { ipc } from "../lib/ipc";
import { cx } from "../lib/format";
import { THEMES } from "../themes";
import { Badge, Button, Field, Kicker, PageTitle, Panel, Spinner, inputCls } from "../ui";
import type { AgentProfile, RetrievalMode, Settings } from "../types";

const RETRIEVAL_LABEL: Record<RetrievalMode, string> = {
  keyword: "关键词(BM25)",
  hybrid: "混合(关键词 + 语义)",
};

export function SettingsView() {
  const toast = useStore((s) => s.toast);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [backing, setBacking] = useState(false);

  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    ipc
      .getSettings()
      .then((s) => {
        setSettings(s);
        setForm(s);
      })
      .catch(() => toast("读取设置失败。", "error"));
    detect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const detect = async () => {
    setDetecting(true);
    try {
      setAgents(await ipc.detectAgents());
    } catch {
      toast("探测 Agent 失败。", "error");
    } finally {
      setDetecting(false);
    }
  };

  const patch = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const dirty =
    !!form &&
    !!settings &&
    (form.dataDir !== settings.dataDir ||
      form.maxBackups !== settings.maxBackups ||
      form.retrievalMode !== settings.retrievalMode ||
      form.guardMinScore !== settings.guardMinScore);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const next = await ipc.setSettings({
        dataDir: form.dataDir,
        maxBackups: form.maxBackups,
        retrievalMode: form.retrievalMode,
        guardMinScore: form.guardMinScore,
      });
      setSettings(next);
      setForm(next);
      toast("设置已保存。", "success");
    } catch {
      toast("保存设置失败。", "error");
    } finally {
      setSaving(false);
    }
  };

  const backup = async () => {
    setBacking(true);
    try {
      const { path } = await ipc.backupNow();
      toast(`已备份至 ${path}`, "success");
    } catch {
      toast("备份失败。", "error");
    } finally {
      setBacking(false);
    }
  };

  return (
    <div>
      <Kicker badge="本地优先">数据留在本机 · 经验层内核 + 四出口配置</Kicker>
      <PageTitle sub="AEL 的一切都落在本地 SQLite。这里调整数据落盘、备份策略、检索模式与 Guard 灵敏度,并探测可用的 Agent CLI。">
        设置
      </PageTitle>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* 左:表单 */}
        <div className="space-y-6">
          <Panel className="space-y-4 p-5">
            <h3 className="font-mono text-[11px] tracking-kicker text-ink/45">外观 · APPEARANCE</h3>
            <p className="-mt-1 text-[12px] text-ink/45">像 VSCode 一样切换配色。选择立即生效并记住到下次启动。</p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {THEMES.map((t) => {
                const active = t.id === theme;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={cx(
                      "group rounded-lg border p-2.5 text-left transition-all",
                      active ? "border-orange/60 bg-orange/[0.05]" : "border-ink/10 hover:border-ink/25",
                    )}
                  >
                    <div
                      className="relative flex h-14 items-center gap-1.5 overflow-hidden rounded-md px-2.5"
                      style={{ background: t.swatch[0] }}
                    >
                      <span className="h-6 w-6 rounded" style={{ background: t.swatch[1] }} />
                      <span className="h-6 w-3 rounded" style={{ background: t.swatch[2] }} />
                      <span className="ml-auto text-[11px] font-bold" style={{ color: t.swatch[3] }}>
                        Aa
                      </span>
                      {active && (
                        <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-orange">
                          <Check className="h-3 w-3 text-bg" />
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[12.5px] text-ink/85">{t.name}</span>
                      <span className="font-mono text-[9.5px] text-ink/35">{t.kind === "light" ? "浅色" : "深色"}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Panel>

          <Panel className="space-y-5 p-5">
            <h3 className="font-mono text-[11px] tracking-kicker text-ink/45">存储与备份 · STORAGE</h3>

            <Field label="数据目录" hint="改动下次启动生效">
              <input
                value={form?.dataDir ?? ""}
                onChange={(e) => patch("dataDir", e.target.value)}
                placeholder="~/.ael"
                disabled={!form}
                className={cx(inputCls, "font-mono text-[12px]")}
              />
            </Field>

            <Field label="最大备份数" hint="超过后滚动删除最旧的备份文件">
              <input
                type="number"
                min={0}
                value={form?.maxBackups ?? 0}
                onChange={(e) => patch("maxBackups", Math.max(0, Number(e.target.value) || 0))}
                disabled={!form}
                className={cx(inputCls, "w-40 tabular-nums")}
              />
            </Field>
          </Panel>

          <Panel className="space-y-5 p-5">
            <h3 className="font-mono text-[11px] tracking-kicker text-ink/45">检索与 Guard · RETRIEVAL</h3>

            <Field label="检索模式" hint="经验层召回 Skill / Failure 的方式">
              <select
                value={form?.retrievalMode ?? "keyword"}
                onChange={(e) => patch("retrievalMode", e.target.value as RetrievalMode)}
                disabled={!form}
                className={inputCls}
              >
                {(Object.keys(RETRIEVAL_LABEL) as RetrievalMode[]).map((m) => (
                  <option key={m} value={m} className="bg-panel">
                    {RETRIEVAL_LABEL[m]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Guard 命中阈值" hint="低于该分数的历史失败不再触发拦截建议">
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={form?.guardMinScore ?? 0}
                  onChange={(e) => patch("guardMinScore", Number(e.target.value))}
                  disabled={!form}
                  className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-panel2 accent-orange"
                />
                <span className="w-12 text-right font-mono text-[13px] tabular-nums text-orange">
                  {(form?.guardMinScore ?? 0).toFixed(2)}
                </span>
              </div>
            </Field>
          </Panel>

          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={save} disabled={!dirty || saving}>
              {saving ? <Spinner /> : <Save className="h-4 w-4" />}
              {saving ? "保存中…" : "保存设置"}
            </Button>
            <Button variant="ghost" onClick={backup} disabled={backing}>
              {backing ? <Spinner /> : <DatabaseBackup className="h-4 w-4" />}
              立即备份
            </Button>
            {dirty && <span className="font-mono text-[10.5px] text-amber">有未保存的改动</span>}
          </div>
        </div>

        {/* 右:Agent 探测 */}
        <Panel className="h-fit p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-mono text-[11px] tracking-kicker text-ink/45">AGENT 探测</h3>
            <Button variant="subtle" className="px-2 py-1 text-[12px]" onClick={detect} disabled={detecting}>
              {detecting ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
              重新探测
            </Button>
          </div>

          <div className="space-y-2">
            {agents.length === 0 && !detecting && (
              <p className="rounded-lg border border-dashed border-ink/12 px-4 py-8 text-center text-[12px] text-ink/40">
                未检测到任何 Agent CLI
              </p>
            )}
            {agents.map((a) => (
              <div key={a.id} className="rounded-lg border border-ink/10 bg-panel2/40 px-3.5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[13px] text-ink/85">
                    <Terminal className="h-3.5 w-3.5 text-ink/35" />
                    {a.displayName}
                  </span>
                  <Badge tone={a.available ? "green" : "red"}>{a.available ? "READY" : "MISSING"}</Badge>
                </div>
                <div className="mt-2 space-y-0.5 pl-6 font-mono text-[10.5px] text-ink/40">
                  {a.version && <div className="truncate">v{a.version}</div>}
                  <div className="truncate">{a.path || a.executable}</div>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-4 flex items-start gap-2 border-t border-ink/[0.07] pt-4 text-[11px] leading-relaxed text-ink/35">
            <HardDriveDownload className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            MISSING 表示未在 PATH 中找到该 CLI。安装后点「重新探测」即可在控制台启动会话。
          </p>
        </Panel>
      </div>
    </div>
  );
}
