import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  FileCode2,
  KeyRound,
  Plus,
  PlugZap,
  RefreshCw,
  Save,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import { ipc } from "../lib/ipc";
import { cx } from "../lib/format";
import { useStore } from "../store";
import { Badge, Button, Field, PageTitle, Panel, Spinner, inputCls } from "../ui";
import type {
  AgentConfigContent,
  AgentConfigTarget,
  McpServerConfig,
  ProviderConfig,
  ProviderTargetApp,
  TestProviderResult,
} from "../types";

type HubTab = "providers" | "configs" | "mcp";

const EMPTY_PROVIDER: ProviderConfig = {
  id: "",
  name: "",
  targetApp: "codex",
  model: "",
  endpoint: "",
  apiKey: "",
  isActive: true,
  notes: "",
};

const EMPTY_MCP: McpServerConfig = {
  id: "",
  name: "",
  command: "",
  args: [],
  env: {},
  isActive: true,
};

const APP_LABEL: Record<ProviderTargetApp, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  universal: "通用",
};

const agentLabel = (id: string) => ({ codex: "Codex", claude_code: "Claude Code", gemini: "Gemini CLI", opencode: "OpenCode" }[id] || id);

function SectionTabs({ tab, onChange }: { tab: HubTab; onChange: (tab: HubTab) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-panel2/60 p-1">
      {([
        ["providers", "Providers", ServerCog],
        ["configs", "配置文件", FileCode2],
        ["mcp", "MCP", PlugZap],
      ] as const).map(([id, label, Icon]) => (
        <button
          type="button"
          key={id}
          onClick={() => onChange(id)}
          className={cx(
            "flex h-8 items-center gap-2 rounded-lg px-3 text-[11px] transition-colors",
            tab === id ? "bg-panel text-ink shadow-[0_1px_0_rgb(var(--c-ink)_/_0.06)]" : "text-ink/42 hover:text-ink/70",
          )}
        >
          <Icon className="h-3.5 w-3.5" />{label}
        </button>
      ))}
    </div>
  );
}

export function AgentHub() {
  const toast = useStore((state) => state.toast);
  const tasks = useStore((state) => state.tasks);
  const [tab, setTab] = useState<HubTab>("providers");
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [provider, setProvider] = useState<ProviderConfig>(EMPTY_PROVIDER);
  const [providerBusy, setProviderBusy] = useState(false);
  const [testResult, setTestResult] = useState<TestProviderResult | null>(null);

  const defaultCwd = useMemo(() => tasks.find((task) => task.repoPath)?.repoPath || "", [tasks]);
  const [cwd, setCwd] = useState(defaultCwd);
  const [targets, setTargets] = useState<AgentConfigTarget[]>([]);
  const [config, setConfig] = useState<AgentConfigContent | null>(null);
  const [configBusy, setConfigBusy] = useState(false);

  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [server, setServer] = useState<McpServerConfig>(EMPTY_MCP);
  const [argsText, setArgsText] = useState("[]");
  const [envText, setEnvText] = useState("{}");
  const [mcpBusy, setMcpBusy] = useState(false);

  const loadProviders = async () => {
    const items = await ipc.listProviders();
    setProviders(items);
    setProvider((current) => items.find((item) => item.id === current.id) || items[0] || EMPTY_PROVIDER);
  };

  const loadTargets = async () => {
    const items = await ipc.listAgentConfigTargets(cwd || undefined);
    setTargets(items);
    if (config) {
      const current = items.find((item) => item.id === config.target.id);
      if (!current) setConfig(null);
    }
  };

  const loadServers = async () => {
    const items = await ipc.listMcpServers();
    setServers(items);
    setServer((current) => items.find((item) => item.id === current.id) || items[0] || EMPTY_MCP);
  };

  useEffect(() => {
    Promise.all([loadProviders(), loadTargets(), loadServers()]).catch(() => toast("Agent 中心数据读取失败。", "error"));
  }, []);

  useEffect(() => {
    if (!cwd && defaultCwd) setCwd(defaultCwd);
  }, [defaultCwd]);

  const selectServer = (next: McpServerConfig) => {
    setServer(next);
    setArgsText(JSON.stringify(next.args, null, 2));
    setEnvText(JSON.stringify(next.env, null, 2));
  };

  const saveProvider = async () => {
    if (!provider.name.trim()) return toast("请填写 Provider 名称。", "warning");
    setProviderBusy(true);
    try {
      await ipc.saveProvider(provider);
      await loadProviders();
      toast("Provider 已保存到本地数据库。", "success");
    } catch { toast("Provider 保存失败。", "error"); }
    finally { setProviderBusy(false); }
  };

  const testProvider = async () => {
    if (!provider.id) return toast("请先保存 Provider，再测试连接。", "warning");
    setProviderBusy(true);
    setTestResult(null);
    try { setTestResult(await ipc.testProvider(provider.id)); }
    catch { setTestResult({ success: false, message: "连接测试调用失败。" }); }
    finally { setProviderBusy(false); }
  };

  const openConfig = async (target: AgentConfigTarget) => {
    setConfigBusy(true);
    try { setConfig(await ipc.readAgentConfigTarget(target.id, cwd || undefined)); }
    catch { toast(`无法读取 ${target.description}。`, "error"); }
    finally { setConfigBusy(false); }
  };

  const saveConfig = async () => {
    if (!config) return;
    setConfigBusy(true);
    try {
      const result = await ipc.writeAgentConfigTarget(config.target.id, config.content, cwd || undefined, true);
      setConfig({ ...config, target: result.target });
      await loadTargets();
      toast(result.backupPath ? `已原子写入，并备份至 ${result.backupPath}` : `已原子写入 ${result.bytesWritten} 字节。`, "success");
    } catch { toast("配置写入失败，原文件未被主动删除。", "error"); }
    finally { setConfigBusy(false); }
  };

  const backupConfig = async () => {
    if (!config) return;
    setConfigBusy(true);
    try {
      const path = await ipc.backupAgentConfigTarget(config.target.id, cwd || undefined);
      toast(path ? `备份已创建：${path}` : "目标文件不存在，无需备份。", path ? "success" : "info");
    } catch { toast("配置备份失败。", "error"); }
    finally { setConfigBusy(false); }
  };

  const saveMcp = async () => {
    if (!server.name.trim() || !server.command.trim()) return toast("请填写 MCP 名称与命令。", "warning");
    setMcpBusy(true);
    try {
      const args = JSON.parse(argsText);
      const env = JSON.parse(envText);
      if (!Array.isArray(args) || !env || Array.isArray(env) || typeof env !== "object") throw new Error("shape");
      await ipc.saveMcpServer({ ...server, args: args.map(String), env: Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)])) });
      await loadServers();
      toast("MCP Server 已保存。", "success");
    } catch { toast("MCP 保存失败：args 必须是数组，env 必须是对象。", "error"); }
    finally { setMcpBusy(false); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle sub="统一管理 Agent 上游、原生配置与 MCP；切换工具时，AEL 的记忆层仍保持不变。">Agent 中心</PageTitle>
        <SectionTabs tab={tab} onChange={setTab} />
      </div>

      {tab === "providers" && (
        <Panel className="overflow-hidden">
          <div className="grid min-h-[610px] grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)]">
            <aside className="border-b border-line bg-panel2/28 p-4 lg:border-b-0 lg:border-r">
              <div className="flex items-center justify-between">
                <div><div className="text-[11px] font-medium text-ink/62">上游配置</div><div className="mt-1 text-[9.5px] text-ink/30">本机 SQLite · 不上传</div></div>
                <button type="button" onClick={() => { setProvider(EMPTY_PROVIDER); setTestResult(null); }} className="icon-button h-8 w-8" aria-label="新增 Provider"><Plus className="h-3.5 w-3.5" /></button>
              </div>
              <div className="mt-4 space-y-1.5">
                {providers.map((item) => (
                  <button key={item.id} type="button" onClick={() => { setProvider(item); setTestResult(null); }} className={cx("group flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left", provider.id === item.id ? "border-orange/22 bg-orange/[0.055]" : "border-transparent hover:border-line hover:bg-panel/60")}>
                    <span className={cx("grid h-8 w-8 place-items-center rounded-lg", item.isActive ? "bg-green/[0.08] text-green" : "bg-panel2 text-ink/28")}><Bot className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[11.5px] text-ink/72">{item.name}</span><span className="mt-0.5 block truncate font-mono text-[9px] text-ink/30">{APP_LABEL[item.targetApp]} · {item.model || "未指定模型"}</span></span>
                    <ChevronRight className="h-3.5 w-3.5 text-ink/18" />
                  </button>
                ))}
                {providers.length === 0 && <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[10.5px] text-ink/34">还没有 Provider。</div>}
              </div>
            </aside>

            <section className="p-6">
              <div className="flex items-start justify-between gap-3 border-b border-line pb-5">
                <div><h2 className="font-serif text-[21px]">{provider.id ? provider.name : "新增 Provider"}</h2><p className="mt-1 text-[10px] text-ink/34">沿用 CC Switch 的“每个工具独立配置，上层统一管理”模型。</p></div>
                <Badge tone={provider.isActive ? "green" : "ink"}>{provider.isActive ? "Enabled" : "Paused"}</Badge>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="名称"><input value={provider.name} onChange={(event) => setProvider({ ...provider, name: event.target.value })} className={inputCls} placeholder="例如 OpenAI Official" /></Field>
                <Field label="目标 Agent"><select value={provider.targetApp} onChange={(event) => setProvider({ ...provider, targetApp: event.target.value as ProviderTargetApp })} className={inputCls}>{(Object.keys(APP_LABEL) as ProviderTargetApp[]).map((id) => <option key={id} value={id}>{APP_LABEL[id]}</option>)}</select></Field>
                <Field label="Endpoint"><input value={provider.endpoint} onChange={(event) => setProvider({ ...provider, endpoint: event.target.value })} className={cx(inputCls, "font-mono text-[10.5px]")} placeholder="https://api.example.com" /></Field>
                <Field label="模型"><input value={provider.model} onChange={(event) => setProvider({ ...provider, model: event.target.value })} className={cx(inputCls, "font-mono text-[10.5px]")} placeholder="model-id" /></Field>
                <div className="sm:col-span-2"><Field label="API Key" hint="留空保存时会保留数据库里的旧密钥。"><div className="relative"><KeyRound className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink/24" /><input type="password" value={provider.apiKey} onChange={(event) => setProvider({ ...provider, apiKey: event.target.value })} className={cx(inputCls, "pl-9 font-mono text-[10.5px]")} placeholder="••••••••••••" /></div></Field></div>
                <div className="sm:col-span-2"><Field label="备注"><textarea value={provider.notes || ""} onChange={(event) => setProvider({ ...provider, notes: event.target.value })} className={cx(inputCls, "min-h-20 resize-y")} /></Field></div>
              </div>
              <label className="mt-4 flex items-center gap-2 text-[10.5px] text-ink/52"><input type="checkbox" checked={provider.isActive} onChange={(event) => setProvider({ ...provider, isActive: event.target.checked })} className="accent-orange" />允许该 Provider 出现在任务启动选择中</label>
              {testResult && <div className={cx("mt-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[10.5px]", testResult.success ? "border-green/20 bg-green/[0.05] text-green" : "border-red/20 bg-red/[0.05] text-red")}><CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{testResult.message}</span></div>}
              <div className="mt-6 flex gap-2"><Button variant="primary" onClick={saveProvider} disabled={providerBusy}>{providerBusy ? <Spinner /> : <Save className="h-3.5 w-3.5" />}保存</Button><Button variant="ghost" onClick={testProvider} disabled={providerBusy || !provider.id}><PlugZap className="h-3.5 w-3.5" />测试连接</Button></div>
            </section>
          </div>
        </Panel>
      )}

      {tab === "configs" && (
        <Panel className="overflow-hidden">
          <div className="grid min-h-[610px] grid-cols-1 lg:grid-cols-[330px_minmax(0,1fr)]">
            <aside className="border-b border-line bg-panel2/28 p-4 lg:border-b-0 lg:border-r">
              <Field label="项目目录（用于 AGENTS.md / CLAUDE.md）"><div className="flex gap-2"><input value={cwd} onChange={(event) => setCwd(event.target.value)} className={cx(inputCls, "font-mono text-[9.5px]")} /><button type="button" onClick={() => loadTargets().catch(() => toast("配置目标刷新失败。", "error"))} className="icon-button h-9 w-9 shrink-0"><RefreshCw className="h-3.5 w-3.5" /></button></div></Field>
              <div className="mt-5 space-y-1.5">
                {targets.map((target) => (
                  <button key={target.id} type="button" onClick={() => openConfig(target)} className={cx("flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left", config?.target.id === target.id ? "border-orange/22 bg-orange/[0.055]" : "border-transparent hover:border-line hover:bg-panel/60")}>
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-panel text-ink/38"><FileCode2 className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-[11.5px] text-ink/70">{agentLabel(target.agentId)} <Badge tone={target.exists ? "green" : "ink"}>{target.exists ? "Found" : "New"}</Badge></span><span className="mt-1 block truncate font-mono text-[8.5px] text-ink/28">{target.path}</span></span>
                  </button>
                ))}
              </div>
            </aside>
            <section className="flex min-h-[610px] min-w-0 flex-col p-6">
              {config ? <>
                <div className="flex items-start justify-between gap-3"><div><h2 className="font-serif text-[21px]">{config.target.description}</h2><p className="mt-1 break-all font-mono text-[9.5px] text-ink/32">{config.target.path}</p></div><Badge tone="blue">{config.target.format.toUpperCase()}</Badge></div>
                <div className="mt-5 flex items-center gap-2 rounded-xl border border-green/16 bg-green/[0.035] px-3 py-2.5 text-[10px] text-ink/48"><ShieldCheck className="h-3.5 w-3.5 text-green" />保存会先创建备份，再通过同目录临时文件原子替换。</div>
                <textarea value={config.content} onChange={(event) => setConfig({ ...config, content: event.target.value })} spellCheck={false} className="mt-4 min-h-[370px] flex-1 resize-none rounded-xl border border-line bg-[#25231f] p-4 font-mono text-[11px] leading-[1.7] text-[#eee9df] outline-none focus:border-orange/40" />
                <div className="mt-4 flex gap-2"><Button variant="primary" onClick={saveConfig} disabled={configBusy}>{configBusy ? <Spinner /> : <Save className="h-3.5 w-3.5" />}备份并保存</Button><Button variant="ghost" onClick={backupConfig} disabled={configBusy}>仅创建备份</Button></div>
              </> : <div className="grid flex-1 place-items-center text-center"><div><FileCode2 className="mx-auto h-7 w-7 text-ink/18" /><div className="mt-3 font-serif text-[19px] text-ink/60">选择一个配置文件</div><p className="mt-1 text-[10.5px] text-ink/32">只允许访问后端定义的固定目标，前端不能提交任意路径。</p></div></div>}
            </section>
          </div>
        </Panel>
      )}

      {tab === "mcp" && (
        <Panel className="overflow-hidden">
          <div className="grid min-h-[610px] grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)]">
            <aside className="border-b border-line bg-panel2/28 p-4 lg:border-b-0 lg:border-r">
              <div className="flex items-center justify-between"><div><div className="text-[11px] font-medium text-ink/62">MCP Servers</div><div className="mt-1 text-[9.5px] text-ink/30">统一工具连接</div></div><button type="button" onClick={() => { setServer(EMPTY_MCP); setArgsText("[]"); setEnvText("{}"); }} className="icon-button h-8 w-8" aria-label="新增 MCP"><Plus className="h-3.5 w-3.5" /></button></div>
              <div className="mt-4 space-y-1.5">{servers.map((item) => <button key={item.id} type="button" onClick={() => selectServer(item)} className={cx("flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left", server.id === item.id ? "border-orange/22 bg-orange/[0.055]" : "border-transparent hover:border-line hover:bg-panel/60")}><span className={cx("grid h-8 w-8 place-items-center rounded-lg", item.isActive ? "bg-green/[0.08] text-green" : "bg-panel text-ink/26")}><PlugZap className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-[11.5px] text-ink/72">{item.name}</span><span className="mt-0.5 block truncate font-mono text-[9px] text-ink/30">{item.command} {item.args.join(" ")}</span></span>{item.isActive && <Check className="h-3.5 w-3.5 text-green" />}</button>)}</div>
            </aside>
            <section className="p-6">
              <div className="border-b border-line pb-5"><h2 className="font-serif text-[21px]">{server.id ? server.name : "新增 MCP Server"}</h2><p className="mt-1 text-[10px] text-ink/34">保存连接定义；敏感环境变量仅留在本机。</p></div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="名称"><input value={server.name} onChange={(event) => setServer({ ...server, name: event.target.value })} className={inputCls} /></Field>
                <Field label="命令"><input value={server.command} onChange={(event) => setServer({ ...server, command: event.target.value })} className={cx(inputCls, "font-mono text-[10.5px]")} placeholder="npx / uvx / executable" /></Field>
                <div className="sm:col-span-2"><Field label="参数（JSON 数组）"><textarea value={argsText} onChange={(event) => setArgsText(event.target.value)} spellCheck={false} className={cx(inputCls, "min-h-24 resize-y font-mono text-[10.5px]")} /></Field></div>
                <div className="sm:col-span-2"><Field label="环境变量（JSON 对象）"><textarea value={envText} onChange={(event) => setEnvText(event.target.value)} spellCheck={false} className={cx(inputCls, "min-h-28 resize-y font-mono text-[10.5px]")} /></Field></div>
              </div>
              <label className="mt-4 flex items-center gap-2 text-[10.5px] text-ink/52"><input type="checkbox" checked={server.isActive} onChange={(event) => setServer({ ...server, isActive: event.target.checked })} className="accent-orange" />启用此 MCP Server</label>
              <div className="mt-6"><Button variant="primary" onClick={saveMcp} disabled={mcpBusy}>{mcpBusy ? <Spinner /> : <Save className="h-3.5 w-3.5" />}保存 MCP</Button></div>
            </section>
          </div>
        </Panel>
      )}
    </div>
  );
}
