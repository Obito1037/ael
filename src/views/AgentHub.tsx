import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Check,
  CircleAlert,
  Database,
  ExternalLink,
  FileCode2,
  FolderOpen,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Terminal,
  WandSparkles,
} from "lucide-react";
import { ipc } from "../lib/ipc";
import { cx } from "../lib/format";
import { useStore } from "../store";
import { Badge, Button, PageTitle, Panel, Spinner } from "../ui";
import type { AgentConfigTarget, AgentProfile, McpServerConfig, ProviderConfig } from "../types";

function StatusCard({
  icon: Icon,
  title,
  value,
  detail,
  tone = "ink",
}: {
  icon: typeof Bot;
  title: string;
  value: string;
  detail: string;
  tone?: "green" | "orange" | "blue" | "ink";
}) {
  return (
    <div className="rounded-2xl border border-line bg-panel/70 p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-kicker text-ink/36">
        <Icon className={cx("h-3.5 w-3.5", tone === "green" ? "text-green" : tone === "orange" ? "text-orange" : tone === "blue" ? "text-blue" : "text-ink/42")} />
        {title}
      </div>
      <div className="mt-3 font-serif text-[20px] text-ink/78">{value}</div>
      <div className="mt-1 text-[10.5px] leading-5 text-ink/38">{detail}</div>
    </div>
  );
}

export function AgentHub() {
  const toast = useStore((state) => state.toast);
  const setView = useStore((state) => state.setView);
  const tasks = useStore((state) => state.tasks);
  const defaultCwd = useMemo(() => tasks.find((task) => task.repoPath)?.repoPath || "", [tasks]);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [targets, setTargets] = useState<AgentConfigTarget[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      const [nextProfiles, nextTargets, nextProviders, nextServers] = await Promise.all([
        ipc.detectAgents(),
        ipc.listAgentConfigTargets(defaultCwd || undefined),
        ipc.listProviders(),
        ipc.listMcpServers(),
      ]);
      setProfiles(nextProfiles);
      setTargets(nextTargets);
      setProviders(nextProviders);
      setServers(nextServers);
    } catch {
      toast("集成状态读取失败。", "error");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [defaultCwd]);

  const availableCount = profiles.filter((profile) => profile.available).length;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle sub="AEL 负责经验、证据与安全边界；原生 CLI 负责对话和执行。这里仅查看连接状态。">Agent 集成</PageTitle>
        <Button variant="ghost" onClick={() => void refresh()} disabled={busy}>
          {busy ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}刷新状态
        </Button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatusCard icon={Terminal} title="运行通道" value="ACP → PTY" detail="支持 ACP 的 Agent 优先走结构化会话，其余自动回退 PTY。" tone="orange" />
        <StatusCard icon={Bot} title="可用 Agent" value={`${availableCount}/${profiles.length || 0}`} detail="Codex、Claude Code 等由本机 CLI 登录状态决定。" tone="green" />
        <StatusCard icon={Database} title="本地配置" value={`${providers.length} 个 Provider`} detail="AEL 只显示状态，不把 Provider 配置作为核心工作流。" tone="blue" />
        <StatusCard icon={PlugZap} title="工具连接" value={`${servers.length} 个 MCP`} detail="MCP 由目标 Agent 管理；AEL 保留兼容入口和记录。" />
      </div>

      <Panel className="mt-5 overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <div className="flex items-center gap-2 text-[12px] font-medium text-ink/72"><ShieldCheck className="h-4 w-4 text-green" />运行边界</div>
          <p className="mt-1 text-[10.5px] leading-5 text-ink/40">AEL 不替代 Codex、Claude Code、Gemini 或 OpenCode；它把会话更新、工具输出和验证结果写入证据链，并在下一次启动时注入 Guard。</p>
        </div>
        <div className="grid gap-3 p-5 md:grid-cols-3">
          <div className="rounded-xl border border-green/16 bg-green/[0.035] p-4"><div className="flex items-center gap-2 text-[11px] text-green"><Check className="h-3.5 w-3.5" />认证归 Agent 所有</div><p className="mt-2 text-[10px] leading-5 text-ink/42">ACP 使用本机 Agent 的登录状态。AEL 不要求填写 API Key，也不把密钥写进任务、日志或交接包。</p></div>
          <div className="rounded-xl border border-orange/16 bg-orange/[0.035] p-4"><div className="flex items-center gap-2 text-[11px] text-orange"><Terminal className="h-3.5 w-3.5" />结构化优先</div><p className="mt-2 text-[10px] leading-5 text-ink/42">ACP 的消息、思考、工具更新和停止原因进入统一事件链；自定义命令才使用 PTY 兜底。</p></div>
          <div className="rounded-xl border border-blue/16 bg-blue/[0.035] p-4"><div className="flex items-center gap-2 text-[11px] text-blue"><WandSparkles className="h-3.5 w-3.5" />技能资产标准化</div><p className="mt-2 text-[10px] leading-5 text-ink/42">审核后的经验导出为标准 SKILL.md；检测到 skills CLI 时优先交给它分发，否则保留可移植文件。</p></div>
        </div>
      </Panel>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.82fr)]">
        <Panel className="p-5">
          <div className="flex items-center justify-between"><div><div className="text-[11px] font-medium text-ink/64">本机 Agent</div><div className="mt-1 text-[10px] text-ink/34">仅探测可执行文件，不修改 CLI 配置。</div></div><Bot className="h-4 w-4 text-ink/24" /></div>
          <div className="mt-4 space-y-2">
            {profiles.map((profile) => (
              <div key={profile.id} className="flex items-center gap-3 rounded-xl border border-line/70 bg-panel2/30 px-3 py-3">
                <span className={cx("grid h-8 w-8 place-items-center rounded-lg", profile.available ? "bg-green/[0.08] text-green" : "bg-panel2 text-ink/24")}><Bot className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-[11.5px] text-ink/70">{profile.displayName}<Badge tone={profile.available ? "green" : "ink"}>{profile.available ? "可用" : "未发现"}</Badge></div><div className="mt-1 truncate font-mono text-[9px] text-ink/32">{profile.path || profile.executable} · {profile.version || "版本未知"}</div></div>
                <span className="text-[9.5px] text-ink/34">{["codex", "claude_code", "gemini"].includes(profile.id) ? "ACP 优先" : "PTY"}</span>
              </div>
            ))}
            {profiles.length === 0 && <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[10.5px] text-ink/34">尚未探测到 Agent。</div>}
          </div>
        </Panel>

        <Panel className="p-5">
          <div className="flex items-center justify-between"><div><div className="text-[11px] font-medium text-ink/64">外部入口状态</div><div className="mt-1 text-[10px] text-ink/34">不在 AEL 内复制维护各 Agent 的配置。</div></div><ExternalLink className="h-4 w-4 text-ink/24" /></div>
          <div className="mt-4 space-y-2">
            <button type="button" onClick={() => setView("memory")} className="flex w-full items-center gap-3 rounded-xl border border-line/70 px-3 py-3 text-left hover:bg-panel2/40"><WandSparkles className="h-4 w-4 text-orange" /><span className="min-w-0 flex-1"><span className="block text-[11px] text-ink/68">历史与候选提炼</span><span className="mt-1 block text-[9.5px] text-ink/34">记忆 → 历史扫描 → 候选审核</span></span><ExternalLink className="h-3.5 w-3.5 text-ink/20" /></button>
            <button type="button" onClick={() => setView("evidence")} className="flex w-full items-center gap-3 rounded-xl border border-line/70 px-3 py-3 text-left hover:bg-panel2/40"><FileCode2 className="h-4 w-4 text-blue" /><span className="min-w-0 flex-1"><span className="block text-[11px] text-ink/68">Evidence / Handover</span><span className="mt-1 block text-[9.5px] text-ink/34">证据链、Finalize、交接包</span></span><ExternalLink className="h-3.5 w-3.5 text-ink/20" /></button>
            <div className="flex items-center gap-3 rounded-xl border border-line/70 px-3 py-3"><PlugZap className="h-4 w-4 text-ink/36" /><span className="min-w-0 flex-1"><span className="block text-[11px] text-ink/68">skills CLI</span><span className="mt-1 block text-[9.5px] text-ink/34">可用时优先调用；不可用时导出标准 SKILL.md</span></span><Badge tone="amber">按需探测</Badge></div>
            <div className="flex items-start gap-3 rounded-xl border border-amber/18 bg-amber/[0.035] px-3 py-3 text-[10px] leading-5 text-ink/44"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber" />Provider/MCP 深度编辑已从主界面降级。需要修改原生配置时，请使用对应 Agent 的官方工具；AEL 仅保留安全读写兼容层。</div>
          </div>
        </Panel>
      </div>

      <Panel className="mt-5 p-5">
        <div className="flex items-center gap-2 text-[11px] font-medium text-ink/64"><FolderOpen className="h-3.5 w-3.5 text-ink/40" />固定配置目标（只读状态）</div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {targets.slice(0, 8).map((target) => <div key={target.id} className="flex min-w-0 items-center gap-2 rounded-lg bg-panel2/35 px-3 py-2"><FileCode2 className="h-3.5 w-3.5 shrink-0 text-ink/28" /><span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-ink/42">{target.path}</span><Badge tone={target.exists ? "green" : "ink"}>{target.exists ? "存在" : "未创建"}</Badge></div>)}
          {targets.length === 0 && <div className="text-[10px] text-ink/34">暂无固定配置目标。</div>}
        </div>
      </Panel>
    </div>
  );
}
