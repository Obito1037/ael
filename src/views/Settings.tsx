import { useEffect, useState, type ReactNode } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  Database,
  DatabaseBackup,
  FolderOpen,
  HardDrive,
  Palette,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useStore } from "../store";
import { ipc } from "../lib/ipc";
import { cx } from "../lib/format";
import { THEMES } from "../themes";
import { Badge, Button, PageTitle, Panel, Spinner, inputCls } from "../ui";
import type { AgentProfile, RetrievalMode, Settings } from "../types";

type SettingsSection = "general" | "memory" | "agents" | "safety";

const RETRIEVAL_LABEL: Record<RetrievalMode, string> = {
  keyword: "关键词",
  hybrid: "混合（关键词 + 向量）",
};

function SettingRow({ icon, label, hint, children }: { icon: ReactNode; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[58px] grid-cols-[24px_minmax(150px,1fr)_minmax(220px,1.2fr)] items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
      <span className="text-ink/34">{icon}</span>
      <span><span className="block text-[11.5px] text-ink/66">{label}</span>{hint && <span className="block text-[9.5px] text-ink/30">{hint}</span>}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SettingsView() {
  const toast = useStore((state) => state.toast);
  const theme = useStore((state) => state.theme);
  const setTheme = useStore((state) => state.setTheme);
  const tasks = useStore((state) => state.tasks);
  const [section, setSection] = useState<SettingsSection>("general");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [backing, setBacking] = useState(false);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    ipc.getSettings().then((next) => { setSettings(next); setForm(next); }).catch(() => toast("读取设置失败。", "error"));
    void detect();
  }, []);

  const detect = async () => {
    setDetecting(true);
    try { setAgents(await ipc.detectAgents()); }
    catch { toast("探测 Agent 失败。", "error"); }
    finally { setDetecting(false); }
  };

  const patch = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm((current) => current ? { ...current, [key]: value } : current);
  const dirty = !!form && !!settings && (form.dataDir !== settings.dataDir || form.maxBackups !== settings.maxBackups || form.retrievalMode !== settings.retrievalMode || form.guardMinScore !== settings.guardMinScore);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const next = await ipc.setSettings(form);
      setSettings(next);
      setForm(next);
      toast("设置已保存。", "success");
    } catch { toast("保存设置失败。", "error"); }
    finally { setSaving(false); }
  };

  const backup = async () => {
    setBacking(true);
    try { const { path } = await ipc.backupNow(); toast(`已备份至 ${path}`, "success"); }
    catch { toast("备份失败。", "error"); }
    finally { setBacking(false); }
  };

  const exportHandover = async () => {
    const task = tasks[0];
    if (!task) return toast("还没有可导出的任务。", "warning");
    setExporting(true);
    try {
      const { path } = await ipc.exportHandover(task.id, { events: true, skills: true, failures: true });
      toast(`交接包已生成：${path}`, "success");
    } catch { toast("交接包生成失败。", "error"); }
    finally { setExporting(false); }
  };

  const readyAgents = agents.filter((agent) => agent.available).length;

  return (
    <div>
      <PageTitle sub="本地数据、记忆召回、Agent 适配器与启动安全集中在一个安静的控制面。">设置</PageTitle>

      <Panel className="overflow-hidden">
        <div className="grid min-h-[620px] grid-cols-1 lg:grid-cols-[150px_minmax(0,1fr)_300px]">
          <nav className="border-b border-line bg-panel2/38 p-3 lg:border-b-0 lg:border-r">
            {([
              ["general", "通用", Palette],
              ["memory", "记忆", Search],
              ["agents", "Agents", Bot],
              ["safety", "安全", ShieldCheck],
            ] as const).map(([id, label, Icon]) => (
              <button type="button" key={id} onClick={() => setSection(id)} className={cx("flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-[11.5px]", section === id ? "bg-orange/[0.08] text-orange" : "text-ink/48 hover:bg-panel2")}>
                <Icon className="h-3.5 w-3.5" /><span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="min-w-0 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div><h2 className="font-serif text-[20px]">{section === "general" ? "通用设置" : section === "memory" ? "记忆设置" : section === "agents" ? "Agent 适配器" : "安全设置"}</h2><p className="mt-1 text-[10px] text-ink/32">所有更改都会明确保存在本地。</p></div>
              {dirty && <Badge tone="amber">未保存</Badge>}
            </div>

            <div className="overflow-hidden rounded-xl border border-line bg-panel2/28">
              {section === "general" && (
                <>
                  <SettingRow icon={<Palette className="h-3.5 w-3.5" />} label="外观" hint="立即生效">
                    <select value={theme} onChange={(event) => setTheme(event.target.value)} className={inputCls}>{THEMES.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.kind === "light" ? "浅色" : "深色"}</option>)}</select>
                  </SettingRow>
                  <SettingRow icon={<FolderOpen className="h-3.5 w-3.5" />} label="本地数据目录" hint="重启后生效">
                    <input value={form?.dataDir || ""} onChange={(event) => patch("dataDir", event.target.value)} className={cx(inputCls, "font-mono text-[10px]")} />
                  </SettingRow>
                  <SettingRow icon={<DatabaseBackup className="h-3.5 w-3.5" />} label="备份、导出与导入">
                    <div className="flex items-center justify-end gap-2"><span className="text-[10px] text-ink/36">保留 {form?.maxBackups ?? 0} 份</span><input type="number" min={0} value={form?.maxBackups ?? 0} onChange={(event) => patch("maxBackups", Math.max(0, Number(event.target.value) || 0))} className={cx(inputCls, "w-20 text-center")} /><Button variant="ghost" onClick={backup} disabled={backing}>{backing ? <Spinner /> : "立即备份"}</Button></div>
                  </SettingRow>
                </>
              )}

              {section === "memory" && (
                <>
                  <SettingRow icon={<Search className="h-3.5 w-3.5" />} label="检索模式" hint="长期记忆召回方式">
                    <select value={form?.retrievalMode || "keyword"} onChange={(event) => patch("retrievalMode", event.target.value as RetrievalMode)} className={inputCls}>{(Object.keys(RETRIEVAL_LABEL) as RetrievalMode[]).map((mode) => <option key={mode} value={mode}>{RETRIEVAL_LABEL[mode]}</option>)}</select>
                  </SettingRow>
                  <SettingRow icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Guard 命中阈值" hint="低分历史失败不会触发建议">
                    <div className="flex items-center gap-3"><input type="range" min={0} max={1} step={0.05} value={form?.guardMinScore ?? 0} onChange={(event) => patch("guardMinScore", Number(event.target.value))} className="h-1.5 flex-1 accent-orange" /><span className="w-10 font-mono text-[11px] text-orange">{(form?.guardMinScore ?? 0).toFixed(2)}</span></div>
                  </SettingRow>
                  <SettingRow icon={<Database className="h-3.5 w-3.5" />} label="上下文预算" hint="当前由运行时策略管理"><span className="block text-right font-mono text-[10.5px] text-ink/48">8,000 tokens</span></SettingRow>
                  <SettingRow icon={<RefreshCw className="h-3.5 w-3.5" />} label="衰减与重验" hint="依赖或模型变化时自动降权"><span className="block text-right text-[10.5px] text-green">已启用</span></SettingRow>
                </>
              )}

              {section === "agents" && (
                <>
                  {agents.map((agent) => (
                    <SettingRow key={agent.id} icon={<Bot className="h-3.5 w-3.5" />} label={agent.displayName} hint={agent.path || agent.executable}>
                      <div className="flex items-center justify-end gap-3"><span className="font-mono text-[9.5px] text-ink/34">{agent.version || "版本未知"}</span><Badge tone={agent.available ? "green" : "red"}>{agent.available ? "Ready" : "Missing"}</Badge><ChevronRight className="h-3.5 w-3.5 text-ink/20" /></div>
                    </SettingRow>
                  ))}
                  {agents.length === 0 && <div className="px-5 py-10 text-center text-[11px] text-ink/36">尚未检测到 Agent CLI。</div>}
                </>
              )}

              {section === "safety" && (
                <>
                  <SettingRow icon={<ShieldCheck className="h-3.5 w-3.5" />} label="信任等级" hint="危险操作仍需人工确认"><span className="block text-right text-[10.5px] text-ink/52">中</span></SettingRow>
                  <SettingRow icon={<ShieldCheck className="h-3.5 w-3.5" />} label="提示注入防护"><span className="block text-right text-[10.5px] text-green">On</span></SettingRow>
                  <SettingRow icon={<RefreshCw className="h-3.5 w-3.5" />} label="启动前自检"><span className="block text-right text-[10.5px] text-green">On</span></SettingRow>
                  <SettingRow icon={<HardDrive className="h-3.5 w-3.5" />} label="执行策略" hint="policy.toml"><button type="button" onClick={() => useStore.getState().setView("gate")} className="flex w-full items-center justify-end gap-2 text-[10.5px] text-orange">打开策略与命令试判 <ChevronRight className="h-3.5 w-3.5" /></button></SettingRow>
                </>
              )}
            </div>

            <div className="mt-5 flex items-center gap-2">
              <Button variant="primary" onClick={save} disabled={!dirty || saving}>{saving ? <Spinner /> : <Save className="h-3.5 w-3.5" />}{saving ? "保存中…" : "保存设置"}</Button>
              {section === "agents" && <Button variant="ghost" onClick={detect} disabled={detecting}>{detecting ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}重新探测</Button>}
              {section === "agents" && <Button variant="primary" onClick={() => useStore.getState().setView("agents")}><Bot className="h-3.5 w-3.5" />打开 Agent 中心</Button>}
            </div>
          </div>

          <aside className="border-t border-line bg-panel2/22 p-5 lg:border-l lg:border-t-0">
            <h3 className="font-serif text-[18px]">交接状态</h3>
            <div className="mt-5 space-y-3">
              {[
                ["数据库", true, "正常"],
                ["最新备份", true, "已配置"],
                ["Adapters", readyAgents === agents.length && agents.length > 0, `${readyAgents} / ${agents.length} 就绪`],
                ["执行策略", true, "已配置"],
              ].map(([label, ok, value]) => (
                <div key={String(label)} className="flex items-center gap-2 text-[10.5px]"><span className={cx("grid h-4 w-4 place-items-center rounded-full", ok ? "bg-green/[0.1] text-green" : "bg-amber/[0.1] text-amber")}>{ok ? <Check className="h-2.5 w-2.5" /> : "!"}</span><span className="flex-1 text-ink/52">{label}</span><span className={ok ? "text-green" : "text-amber"}>{value}</span></div>
              ))}
            </div>
            <div className="mt-6 rounded-xl bg-panel px-4 py-3 text-[10px] leading-relaxed text-ink/40">建议在交接 Agent 前运行自检，确认本地数据库、适配器和策略都能被目标环境读取。</div>
            <Button variant="ghost" className="mt-5 w-full" onClick={detect} disabled={detecting}>{detecting ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}运行自检</Button>
            <Button variant="primary" className="mt-2 w-full" onClick={exportHandover} disabled={exporting || tasks.length === 0}>{exporting ? <Spinner /> : null}{exporting ? "生成中…" : "生成交接包"}</Button>
          </aside>
        </div>
      </Panel>
    </div>
  );
}
