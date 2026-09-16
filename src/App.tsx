import { useEffect, useMemo, useState, type ReactElement } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  BookOpenText,
  FileCheck2,
  Fingerprint,
  History,
  Network,
  Menu,
  MoreHorizontal,
  Plus,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  X,
} from "lucide-react";
import { useStore } from "./store";
import { ipc, isTauri } from "./lib/ipc";
import { cx, humanTokens, timeAgo } from "./lib/format";
import type {
  BudgetPayload,
  PendingCommand,
  PolicyDecision,
  SessionStatusPayload,
  SignatureHitPayload,
  ViewId,
} from "./types";
import { Toasts } from "./components/Toasts";
import { ThemePicker } from "./components/ThemePicker";
import { Overview } from "./views/Overview";
import { Tasks } from "./views/Tasks";
import { Console } from "./views/Console";
import { Gate } from "./views/Gate";
import { Briefs } from "./views/Briefs";
import { Blame } from "./views/Blame";
import { Memory } from "./views/Memory";
import { Adr } from "./views/Adr";
import { SettingsView } from "./views/Settings";
import { AgentHub } from "./views/AgentHub";

type NavItem = {
  id: ViewId;
  label: string;
  icon: typeof Plus;
  description?: string;
};

const NAV: NavItem[] = [
  { id: "console", label: "工作台", icon: TerminalSquare, description: "当前 Agent 会话" },
  { id: "memory", label: "记忆", icon: Sparkles, description: "复用、纠错与遗忘" },
  { id: "agents", label: "Agent 中心", icon: Network, description: "Provider、配置与 MCP" },
  { id: "tasks", label: "任务历史", icon: History, description: "活动与证据链" },
  { id: "briefs", label: "Review", icon: FileCheck2, description: "收尾证据" },
  { id: "adr", label: "决策", icon: BookOpenText, description: "活文档 ADR" },
  { id: "blame", label: "来源链", icon: Fingerprint, description: "代码行溯源" },
];

const VIEW_META: Record<ViewId, { title: string; note: string }> = {
  overview: { title: "开始一件事", note: "智创 OPC · 新任务" },
  tasks: { title: "任务", note: "活动与证据" },
  console: { title: "修复 Windows 构建失败", note: "智创 OPC · Codex" },
  agents: { title: "Agent 中心", note: "Provider、配置与 MCP" },
  gate: { title: "安全", note: "待裁决命令与策略" },
  briefs: { title: "Review", note: "任务收尾证据" },
  blame: { title: "来源链", note: "提交、任务与决策" },
  memory: { title: "记忆", note: "复用、纠错与遗忘" },
  adr: { title: "决策", note: "活文档 ADR" },
  settings: { title: "设置", note: "本地数据与安全" },
};

const VIEWS: Record<ViewId, () => ReactElement> = {
  overview: Overview,
  tasks: Tasks,
  console: Console,
  agents: AgentHub,
  gate: Gate,
  briefs: Briefs,
  blame: Blame,
  memory: Memory,
  adr: Adr,
  settings: SettingsView,
};

export default function App() {
  const view = useStore((state) => state.view);
  const setView = useStore((state) => state.setView);
  const goTask = useStore((state) => state.goTask);
  const tasks = useStore((state) => state.tasks);
  const pending = useStore((state) => state.pending);
  const sessions = useStore((state) => state.sessions);
  const budgets = useStore((state) => state.budgets);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const Active = VIEWS[view];
  const meta = VIEW_META[view];

  const running = useMemo(
    () => sessions.filter((session) => ["starting", "running", "waiting", "blocked"].includes(session.status)),
    [sessions],
  );
  const activeBudget = running[0] ? budgets[running[0].id] : undefined;
  const recentTasks = useMemo(
    () =>
      [...tasks]
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, 50),
    [tasks],
  );

  useEffect(() => {
    const store = useStore.getState();
    ipc.listTasks({ limit: 200 }).then(store.setTasks).catch(() => {});
    ipc.listAgentSessions().then(store.setSessions).catch(() => {});
    ipc.gateListPending().then(store.setPending).catch(() => {});
    ipc.gateListDecisions({ limit: 100 }).then(store.setDecisions).catch(() => {});

    if (!isTauri()) return;
    const unlisten: Array<Promise<() => void>> = [
      listen<PendingCommand>("gate://pending", (event) => {
        useStore.getState().addPending(event.payload);
        useStore.getState().toast(`一条命令需要确认：${event.payload.commandText}`, "warning");
      }),
      listen<PolicyDecision>("gate://decision", (event) => {
        useStore.getState().addDecision(event.payload);
        ipc.gateListPending().then(useStore.getState().setPending).catch(() => {});
      }),
      listen<BudgetPayload>("gate://budget", (event) => {
        useStore.getState().setBudget(event.payload.sessionId, event.payload.budget);
        if (event.payload.budget.breakerTripped) {
          useStore.getState().toast("会话上下文预算已到上限", "error");
        }
      }),
      listen<SignatureHitPayload>("guard://signature-hit", (event) => {
        useStore
          .getState()
          .toast(`命中失败记忆（历史 ${event.payload.occurrences} 次）：${event.payload.guardRule}`, "warning");
      }),
      listen<SessionStatusPayload>("agent://session-status", (event) => {
        useStore.getState().upsertSession(event.payload.session);
      }),
    ];
    return () => unlisten.forEach((promise) => promise.then((dispose) => dispose()).catch(() => {}));
  }, []);

  const navigate = (next: ViewId) => {
    setView(next);
    setDrawerOpen(false);
  };

  return (
    <div className="app-shell h-screen w-screen overflow-hidden bg-bg text-ink">
      <header className="app-topbar-wrap">
        <div className="app-topbar">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => setDrawerOpen(true)} className="icon-button h-10 w-10" aria-label="打开导航">
              <Menu className="h-[18px] w-[18px]" strokeWidth={1.55} />
            </button>
            <button type="button" onClick={() => navigate("overview")} className="font-serif text-[22px] tracking-[0.045em] text-ink">
              AEL
            </button>
          </div>

          {view === "console" && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 max-w-[46%] -translate-x-1/2 -translate-y-1/2 text-center">
              <div className="truncate text-[17px] font-semibold leading-tight text-ink">{meta.title}</div>
              <div className="mt-0.5 truncate text-[12px] text-ink/46">{meta.note}</div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="top-token-pill">{activeBudget?.enabled ? humanTokens(activeBudget.usedTokens) : "本地"}</span>
            <button type="button" onClick={() => navigate(running.length > 0 ? "console" : "tasks")} className="top-status-pill">
              <span className={cx("h-2 w-2 rounded-full", running.length > 0 ? "bg-orange" : "bg-green")} />
              {running.length > 0 ? "运行中" : "已就绪"}
            </button>
            <button type="button" onClick={() => navigate(pending.length > 0 ? "gate" : "settings")} className="icon-button h-10 w-10" aria-label="更多">
              <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={1.55} />
            </button>
          </div>
        </div>
      </header>

      <main className="app-main min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1200px] px-5 pb-24 pt-6 sm:px-7 lg:px-8" key={view}>
          <div className="animate-fade-in"><Active /></div>
        </div>
      </main>

      {pending.length > 0 && view !== "gate" && (
        <button type="button" onClick={() => navigate("gate")} className="safety-float glass-surface">
          <ShieldCheck className="h-4 w-4 text-orange" />
          <span>一条命令需要确认</span>
          <span className="font-medium text-orange">查看</span>
        </button>
      )}

      {drawerOpen && (
        <div className="nav-drawer-layer" role="presentation">
          <button type="button" className="nav-drawer-backdrop" aria-label="关闭导航" onClick={() => setDrawerOpen(false)} />
          <aside className="nav-drawer glass-surface">
            <div className="nav-drawer-header flex items-center justify-between px-5 pt-5">
              <div>
                <div className="font-serif text-[30px] tracking-[0.05em]">AEL</div>
                <div className="mt-0.5 text-[13px] text-ink/42">智创 OPC · 本地记忆工作台</div>
              </div>
              <button type="button" onClick={() => setDrawerOpen(false)} className="icon-button h-9 w-9" aria-label="关闭导航">
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="px-4 pt-5">
              <button type="button" onClick={() => navigate("overview")} className="drawer-new-task">
                <Plus className="h-4 w-4" /> 新建任务
              </button>
            </div>

            <div className="nav-drawer-scroll">
              <nav className="mt-4 space-y-1 px-3">
                {NAV.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => navigate(item.id)}
                      className={cx("drawer-nav-row", view === item.id && "is-active")}
                    >
                      <Icon className="h-5 w-5" strokeWidth={1.6} />
                      <span className="min-w-0 flex-1 truncate text-left text-[16px] text-ink/78">{item.label}</span>
                    </button>
                  );
                })}
              </nav>

              <div className="nav-section-label mx-3 mt-6">最近任务</div>
              <div className="mt-2 space-y-0.5 px-3">
                {recentTasks.length === 0 && <div className="px-3 py-4 text-[13px] text-ink/35">还没有任务</div>}
                {recentTasks.map((task) => (
                  <button
                    type="button"
                    key={task.id}
                    onClick={() => {
                      goTask(task.id);
                      setDrawerOpen(false);
                    }}
                    className="drawer-recent-row"
                  >
                    <span className={cx("mt-1.5 h-1.5 w-1.5 rounded-full", task.status === "in_progress" ? "bg-orange" : "bg-green")} />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-[15.5px] text-ink/72">{task.title}</span>
                      <span className="block text-[12px] text-ink/36">{timeAgo(task.updatedAt)}</span>
                    </span>
                  </button>
                ))}
                {tasks.length > recentTasks.length && (
                  <button type="button" onClick={() => navigate("tasks")} className="drawer-recent-more">
                    查看全部 {tasks.length} 个任务 →
                  </button>
                )}
              </div>
            </div>

            <div className="nav-drawer-footer mt-auto space-y-1 border-t border-line p-3">
              <button type="button" onClick={() => navigate("gate")} className="drawer-nav-row">
                <ShieldCheck className="h-5 w-5" />
                <span className="flex-1 text-left text-[15px]">安全</span>
                {pending.length > 0 && <span className="rounded-full bg-orange/[0.1] px-2 font-mono text-[9px] text-orange">{pending.length}</span>}
              </button>
              <button type="button" onClick={() => navigate("settings")} className="drawer-nav-row">
                <SettingsIcon className="h-5 w-5" />
                <span className="flex-1 text-left text-[15px]">设置</span>
              </button>
              <ThemePicker />
            </div>
          </aside>
        </div>
      )}

      <Toasts />
    </div>
  );
}
