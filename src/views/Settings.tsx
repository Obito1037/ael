import { useEffect, useRef, useState, type ReactNode } from "react";
import {
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
import { ipc, isTauri } from "../lib/ipc";
import { cx } from "../lib/format";
import { THEMES } from "../themes";
import { Badge, Button, PageTitle, Panel, Spinner, inputCls } from "../ui";
import type { RetrievalMode, Settings } from "../types";

type SettingsSection = "general" | "memory" | "safety";

const RETRIEVAL_LABEL: Record<RetrievalMode, string> = {
  keyword: "关键词",
  hybrid: "混合（关键词 + 规则相似度）",
};

function SettingRow({ icon, label, hint, children }: { icon: ReactNode; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[58px] grid-cols-[24px_minmax(0,1fr)] items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 md:grid-cols-[24px_minmax(0,1fr)_minmax(0,1.2fr)]">
      <span className="text-ink/34">{icon}</span>
      <span><span className="block text-[11.5px] text-ink/66">{label}</span>{hint && <span className="block text-[9.5px] text-ink/30">{hint}</span>}</span>
      <div className="col-span-2 min-w-0 md:col-span-1">{children}</div>
    </div>
  );
}

export function SettingsView() {
  const toast = useStore((state) => state.toast);
  const theme = useStore((state) => state.theme);
  const setTheme = useStore((state) => state.setTheme);
  const tasks = useStore((state) => state.tasks);
  const setTasks = useStore((state) => state.setTasks);
  const [section, setSection] = useState<SettingsSection>("general");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [backing, setBacking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [handoverTaskId, setHandoverTaskId] = useState("");
  const [handoverPath, setHandoverPath] = useState("");
  const [policyText, setPolicyText] = useState("");
  const [backupReady, setBackupReady] = useState(false);
  const mountedRef = useRef(false);
  const pendingRef = useRef({ save: false, backup: false, export: false, import: false });
  const desktop = isTauri();

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    ipc.getSettings().then((next) => { if (active) { setSettings(next); setForm(next); } }).catch(() => { if (active) toast("读取设置失败。", "error"); });
    ipc.gateGetPolicyText().then((text) => { if (active) setPolicyText(text); }).catch(() => { if (active) setPolicyText(""); });
    return () => { active = false; mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!handoverTaskId && tasks[0]) setHandoverTaskId(tasks[0].id);
  }, [handoverTaskId, tasks]);

  const patch = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm((current) => current ? { ...current, [key]: value } : current);
  const dirty = !!form && !!settings && (form.dataDir !== settings.dataDir || form.maxBackups !== settings.maxBackups || form.retrievalMode !== settings.retrievalMode || form.guardMinScore !== settings.guardMinScore);

  const save = async () => {
    if (!form || pendingRef.current.save) return;
    pendingRef.current.save = true;
    setSaving(true);
    const submitted = form;
    try {
      const next = await ipc.setSettings(submitted);
      if (!mountedRef.current) return;
      setSettings(next);
      setForm((current) => current === submitted ? next : current);
      toast(desktop ? "设置已保存。" : "本次演示设置已更新。", "success");
    } catch { if (mountedRef.current) toast("保存设置失败。", "error"); }
    finally { pendingRef.current.save = false; if (mountedRef.current) setSaving(false); }
  };

  const backup = async () => {
    if (pendingRef.current.backup) return;
    pendingRef.current.backup = true;
    setBacking(true);
    try { const { path } = await ipc.backupNow(); if (mountedRef.current) { setBackupReady(true); toast(`已备份至 ${path}`, "success"); } }
    catch (error) { if (mountedRef.current) toast(error instanceof Error ? error.message : "备份失败。", "error"); }
    finally { pendingRef.current.backup = false; if (mountedRef.current) setBacking(false); }
  };

  const exportHandover = async () => {
    if (pendingRef.current.export) return;
    const task = tasks.find((item) => item.id === handoverTaskId) || tasks[0];
    if (!task) return toast("还没有可导出的任务。", "warning");
    pendingRef.current.export = true;
    setExporting(true);
    try {
      const { path } = await ipc.exportHandover(task.id, { events: true, skills: true, failures: true });
      if (mountedRef.current) toast(desktop ? `交接包已生成：${path}` : path, "success");
    } catch { if (mountedRef.current) toast("交接资料生成失败。", "error"); }
    finally { pendingRef.current.export = false; if (mountedRef.current) setExporting(false); }
  };

  const importHandover = async () => {
    if (pendingRef.current.import) return;
    const path = handoverPath.trim();
    if (!path) return toast("请先粘贴 handover.zip 路径。", "warning");
    pendingRef.current.import = true;
    setImporting(true);
    try {
      const { taskId } = await ipc.importHandover(path);
      setTasks(await ipc.listTasks());
      if (!mountedRef.current) return;
      setHandoverTaskId(taskId);
      setHandoverPath("");
      toast(`交接包已导入，新任务：${taskId}`, "success");
    } catch (error) {
      if (mountedRef.current) toast(error instanceof Error ? error.message : "交接包导入失败。", "error");
    } finally {
      pendingRef.current.import = false;
      if (mountedRef.current) setImporting(false);
    }
  };

  return (
    <div>
      <PageTitle sub="管理本地数据、记忆召回与交接资料。Agent 连接状态统一在集成页查看。">设置</PageTitle>

      <Panel className="overflow-hidden">
        <div className="grid min-h-[620px] grid-cols-1 lg:grid-cols-[150px_minmax(0,1fr)_300px]">
          <nav className="border-b border-line bg-panel2/38 p-3 lg:border-b-0 lg:border-r">
            {([
              ["general", "通用", Palette],
              ["memory", "记忆", Search],
              ["safety", "安全", ShieldCheck],
            ] as const).map(([id, label, Icon]) => (
              <button type="button" key={id} onClick={() => setSection(id)} className={cx("flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-[11.5px]", section === id ? "bg-orange/[0.08] text-orange" : "text-ink/48 hover:bg-panel2")}>
                <Icon className="h-3.5 w-3.5" /><span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="min-w-0 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div><h2 className="font-serif text-[20px]">{section === "general" ? "通用设置" : section === "memory" ? "记忆设置" : "安全设置"}</h2><p className="mt-1 text-[10px] text-ink/32">{desktop ? "保存后应用到本地设置。" : "浏览器演示：除外观外，设置仅在本次预览中生效。"}</p></div>
              {dirty && <Badge tone="amber">未保存</Badge>}
            </div>

            <div className="overflow-hidden rounded-xl border border-line bg-panel2/28">
              {section === "general" && (
                <>
                  <SettingRow icon={<Palette className="h-3.5 w-3.5" />} label="外观" hint="立即生效">
                    <select value={theme} onChange={(event) => setTheme(event.target.value)} className={inputCls}>{THEMES.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.kind === "light" ? "浅色" : "深色"}</option>)}</select>
                  </SettingRow>
                  <SettingRow icon={<FolderOpen className="h-3.5 w-3.5" />} label="本地数据目录" hint={desktop ? "重启后生效" : "桌面版可配置；浏览器无法访问本地数据库"}>
                    <input aria-label="本地数据目录" disabled={!desktop || saving} value={form?.dataDir || ""} onChange={(event) => patch("dataDir", event.target.value)} className={cx(inputCls, "font-mono text-[10px]")} />
                  </SettingRow>
                  <SettingRow icon={<DatabaseBackup className="h-3.5 w-3.5" />} label="数据库备份" hint={desktop ? "备份保留在本机" : "需在桌面应用中备份真实数据库"}>
                    <div className="flex items-center justify-end gap-2"><span className="text-[10px] text-ink/36">保留 {form?.maxBackups ?? 0} 份</span><input aria-label="保留备份数" disabled={!desktop || saving} type="number" min={0} value={form?.maxBackups ?? 0} onChange={(event) => patch("maxBackups", Math.max(0, Number(event.target.value) || 0))} className={cx(inputCls, "w-20 text-center")} /><Button variant="ghost" onClick={backup} disabled={backing || !desktop} title={!desktop ? "请在桌面应用中备份本地数据库" : undefined}>{backing ? <Spinner /> : "立即备份"}</Button></div>
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
                  <SettingRow icon={<Database className="h-3.5 w-3.5" />} label="上下文预算" hint="由 policy.toml 的 budget 段控制"><span className="block text-right text-[10.5px] text-ink/48">以运行时策略为准</span></SettingRow>
                  <SettingRow icon={<RefreshCw className="h-3.5 w-3.5" />} label="衰减与重验" hint="当前提供手动重验入口"><span className="block text-right text-[10.5px] text-amber">需手动运行</span></SettingRow>
                </>
              )}

              {section === "safety" && (
                <>
                  <SettingRow icon={<ShieldCheck className="h-3.5 w-3.5" />} label="提示注入防护" hint="由运行时策略和 Agent 行为共同决定"><span className="block text-right text-[10.5px] text-ink/52">策略控制</span></SettingRow>
                  <SettingRow icon={<HardDrive className="h-3.5 w-3.5" />} label="执行策略" hint="policy.toml"><button type="button" onClick={() => useStore.getState().setView("gate")} className="flex w-full items-center justify-end gap-2 text-[10.5px] text-orange">打开策略与命令试判 <ChevronRight className="h-3.5 w-3.5" /></button></SettingRow>
                </>
              )}
            </div>

            <div className="mt-5 flex items-center gap-2">
              <Button variant="primary" onClick={save} disabled={!dirty || saving}>{saving ? <Spinner /> : <Save className="h-3.5 w-3.5" />}{saving ? "保存中…" : "保存设置"}</Button>
            </div>
          </div>

          <aside className="border-t border-line bg-panel2/22 p-5 lg:border-l lg:border-t-0">
            <h3 className="font-serif text-[18px]">数据与交接</h3>
            <div className="mt-5 space-y-3">
              {[
                [desktop ? "本地设置" : "演示设置", !!settings, settings ? "已读取" : "尚未读取"],
                ["数据库备份", backupReady, desktop ? backupReady ? "本次已生成" : "本次未备份" : "仅桌面版"],
                ["执行策略", policyText.trim().length > 0, policyText.trim() ? "已加载" : "未加载"],
              ].map(([label, ok, value]) => (
                <div key={String(label)} className="flex items-center gap-2 text-[10.5px]"><span className={cx("grid h-4 w-4 place-items-center rounded-full", ok ? "bg-green/[0.1] text-green" : "bg-amber/[0.1] text-amber")}>{ok ? <Check className="h-2.5 w-2.5" /> : "!"}</span><span className="flex-1 text-ink/52">{label}</span><span className={ok ? "text-green" : "text-amber"}>{value}</span></div>
              ))}
            </div>
            <div className="mt-6 rounded-xl bg-panel px-4 py-3 text-[11px] leading-relaxed text-ink/50">{desktop ? "交接包包含所选任务的事件、技能与失败记录。导入后生成独立任务。" : "可下载标记为 simulation 的 JSON 演示资料。该文件用于阅读，不是桌面交接 ZIP；备份和 ZIP 导入需在桌面版操作。"}</div>
            <div className="mt-4 space-y-2 border-t border-line pt-4">
              <select aria-label="交接任务" value={handoverTaskId} onChange={(event) => setHandoverTaskId(event.target.value)} className={inputCls} disabled={tasks.length === 0 || exporting}>
                {tasks.length === 0 && <option value="">没有可用任务</option>}
                {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
              </select>
              <Button variant="primary" className="w-full" onClick={exportHandover} disabled={exporting || tasks.length === 0}>{exporting ? <Spinner /> : null}{exporting ? "生成中…" : desktop ? "生成交接包" : "下载演示交接数据"}</Button>
              {desktop && <>
                <input aria-label="交接包路径" value={handoverPath} onChange={(event) => setHandoverPath(event.target.value)} placeholder="粘贴 handover.zip 路径" className={cx(inputCls, "font-mono text-[10px]")} />
                <Button variant="ghost" className="w-full" onClick={importHandover} disabled={importing || !handoverPath.trim()}>{importing ? <Spinner /> : null}{importing ? "导入中…" : "导入交接包"}</Button>
              </>}
            </div>
          </aside>
        </div>
      </Panel>
    </div>
  );
}
