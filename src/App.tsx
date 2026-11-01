import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { listen } from "@tauri-apps/api/event";
import { FileCheck2, Network, Menu, Plus, Search, Settings as SettingsIcon, ShieldCheck, Sparkles, TerminalSquare, ArrowUpRight, FolderClock, PanelLeftClose, RotateCcw, Play } from "lucide-react";
import { CdsButton } from "open-claude-ui";
import { useStore } from "./store";
import { ipc, isTauri } from "./lib/ipc";
import { cx, humanTokens, timeAgo } from "./lib/format";
import type { BudgetPayload, PendingCommand, PolicyDecision, SessionStatusPayload, SignatureHitPayload, ViewId } from "./types";
import { Toasts } from "./components/Toasts";
import { ThemePicker } from "./components/ThemePicker";
import { ErrorBoundary } from "./components/ErrorBoundary";
const Overview = lazy(() => import("./views/Overview").then(module => ({ default: module.Overview })));
const Tasks = lazy(() => import("./views/Tasks").then(module => ({ default: module.Tasks })));
const Console = lazy(() => import("./views/Console").then(module => ({ default: module.Console })));
const Gate = lazy(() => import("./views/Gate").then(module => ({ default: module.Gate })));
const Memory = lazy(() => import("./views/Memory").then(module => ({ default: module.Memory })));
const SettingsView = lazy(() => import("./views/Settings").then(module => ({ default: module.SettingsView })));
const AgentHub = lazy(() => import("./views/AgentHub").then(module => ({ default: module.AgentHub })));
const Evidence = lazy(() => import("./views/Evidence").then(module => ({ default: module.Evidence })));
const Demo = lazy(() => import("./views/Demo").then(module => ({ default: module.Demo })));

const NAV = [
  { id: "console", label: "工作台", icon: TerminalSquare },
  { id: "tasks", label: "全部任务", icon: FolderClock },
  { id: "memory", label: "记忆", icon: Sparkles },
  { id: "evidence", label: "证据", icon: FileCheck2 },
] satisfies Array<{ id: ViewId; label: string; icon: typeof Plus }>;

const VIEW_META: Record<ViewId, { title: string; note: string }> = {
  overview: { title: "新建任务", note: "从一个清晰的目标开始" },
  demo: { title: "记忆学习与复用", note: "交互演示 · 独立于真实工作空间" },
  tasks: { title: "任务", note: "工作进度与执行记录" },
  evidence: { title: "证据", note: "Review、来源与决策" },
  console: { title: "工作台", note: "选择任务和 Agent 后开始" },
  integrations: { title: "集成", note: "连接本机开发工具" },
  gate: { title: "安全", note: "待确认操作与策略" },
  memory: { title: "记忆", note: "让有效经验进入下一次工作" },
  settings: { title: "设置", note: "本地数据与偏好" },
};
const VIEWS: Record<ViewId, ComponentType> = {
  overview: Overview, demo: Demo, tasks: Tasks, evidence: Evidence, console: Console,
  integrations: AgentHub, gate: Gate, memory: Memory, settings: SettingsView,
};

export default function App() {
  const view = useStore(state => state.view);
  const setView = useStore(state => state.setView);
  const goTask = useStore(state => state.goTask);
  const tasks = useStore(state => state.tasks);
  const pending = useStore(state => state.pending);
  const sessions = useStore(state => state.sessions);
  const budgets = useStore(state => state.budgets);
  const consoleTaskId = useStore(state => state.consoleTaskId);
  const consoleAgentLabel = useStore(state => state.consoleAgentLabel);
  const focusTaskId = useStore(state => state.focusTaskId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const Active = VIEWS[view] ?? Overview;
  const meta = VIEW_META[view] ?? VIEW_META.overview;
  const activeTask = tasks.find(task => task.id === consoleTaskId);
  const title = view === "console" ? activeTask?.title || "工作台" : meta.title;
  const subtitle = view === "console" ? consoleAgentLabel || meta.note : meta.note;
  const running = useMemo(() => sessions.filter(session => ["starting", "running", "waiting", "blocked"].includes(session.status)), [sessions]);
  const activeBudget = running[0] ? budgets[running[0].id] : undefined;
  const recentTasks = useMemo(() => [...tasks]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .filter(task => (task.title + " " + (task.repoPath || "")).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .slice(0, 50), [tasks, query]);

  useEffect(() => {
    // Shareable demo entry without leaving a stale #demo after exiting.
    if (view === "demo" && window.location.hash !== "#demo") window.history.replaceState(window.history.state, "", "#demo");
    else if (view !== "demo" && window.location.hash === "#demo") window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }, [view]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => { setWide(media.matches); if (media.matches) setDrawerOpen(false); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!drawerOpen || wide) return;
    const previous = document.activeElement as HTMLElement | null;
    sidebarRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [drawerOpen, wide]);
  useEffect(() => {
    let alive = true;
    const store = useStore.getState();
    setLoading(true);
    const requests = [
      { name: "任务", load: ipc.listTasks({ limit: 200 }).then(data => { if (alive) store.setTasks(data); }) },
      { name: "会话", load: ipc.listAgentSessions().then(data => { if (alive) store.setSessions(data); }) },
      { name: "待确认操作", load: ipc.gateListPending().then(data => { if (alive) store.setPending(data); }) },
      { name: "裁决记录", load: ipc.gateListDecisions({ limit: 100 }).then(data => { if (alive) store.setDecisions(data); }) },
    ];
    void Promise.allSettled(requests.map(request => request.load)).then(results => {
      if (!alive) return;
      setLoadErrors(results.flatMap((result, index) => result.status === "rejected" ? [requests[index].name] : []));
      setLoading(false);
    });
    return () => { alive = false; };
  }, [reloadKey]);
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    const subscriptions = [
      listen<PendingCommand>("gate://pending", event => {
        if (!alive) return;
        useStore.getState().addPending(event.payload);
        useStore.getState().toast("一条操作需要你的确认", "warning");
      }),
      listen<PolicyDecision>("gate://decision", event => {
        if (!alive) return;
        useStore.getState().addDecision(event.payload);
        void ipc.gateListPending().then(data => { if (alive) useStore.getState().setPending(data); }).catch(() => {});
      }),
      listen<BudgetPayload>("gate://budget", event => {
        if (alive) useStore.getState().setBudget(event.payload.sessionId, event.payload.budget);
      }),
      listen<SignatureHitPayload>("guard://signature-hit", () => {
        if (alive) useStore.getState().toast("检测到历史失败模式，请检查失败记忆。", "warning");
      }),
      listen<SessionStatusPayload>("agent://session-status", event => {
        if (alive) useStore.getState().upsertSession(event.payload.session);
      }),
    ].map(promise => promise.catch(() => () => {}));
    return () => { alive = false; subscriptions.forEach(promise => { void promise.then(dispose => dispose()); }); };
  }, []);
  const navigate = (next: ViewId) => { setView(next); setDrawerOpen(false); };
  const closeDrawer = () => { setDrawerOpen(false); menuRef.current?.focus(); };

  return <div className="app-shell h-screen w-screen overflow-hidden bg-bg text-ink">
    {!wide && drawerOpen && <button className="workspace-backdrop" type="button" aria-label="关闭导航背景" onClick={closeDrawer} />}
    <aside ref={sidebarRef} className={cx("nav-drawer workspace-sidebar", drawerOpen && "is-open")}
      aria-label="主导航" role={!wide ? "dialog" : undefined} aria-modal={!wide && drawerOpen ? true : undefined}
      inert={!wide && !drawerOpen} onKeyDown={event => {
        if (wide || !drawerOpen) return;
        if (event.key === "Escape") { event.preventDefault(); closeDrawer(); }
        if (event.key !== "Tab") return;
        const items = sidebarRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]');
        if (!items?.length) return;
        const first = items[0]; const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <div className="workspace-brand">
        <button type="button" onClick={() => navigate("overview")} aria-label="AEL3" className="workspace-brand-link">
          <span className="workspace-mark"><Sparkles size={18} strokeWidth={1.5} /></span><span>AEL<span className="workspace-version">3</span></span>
        </button>
        {!wide && <CdsButton size="icon" variant="ghost" aria-label="关闭导航" onClick={closeDrawer}><PanelLeftClose size={18} /></CdsButton>}
      </div>
      <div className="workspace-sidebar-body">
        <CdsButton className="workspace-new-task" variant="outline" onClick={() => navigate("overview")}><Plus size={17} /> 新建任务</CdsButton>
        <button type="button" className={cx("workspace-demo-entry", view === "demo" && "is-active")} aria-current={view === "demo" ? "page" : undefined} onClick={() => navigate("demo")}><Play size={15} /><span>体验记忆复用</span><ArrowUpRight size={14} /></button>
        <nav className="workspace-navigation" aria-label="工作空间">
          {NAV.map(item => {
            const Icon = item.icon;
            const selected = view === item.id;
            return <button key={item.id} type="button" onClick={() => navigate(item.id)} className={cx("workspace-nav-item", selected && "is-active")} aria-current={selected ? "page" : undefined}>
              <Icon size={18} strokeWidth={1.6} /><span>{item.label}</span>
              {item.id === "console" && running.length > 0 && <span className="nav-count">{running.length}</span>}
            </button>;
          })}
        </nav>
        <div className="workspace-recents-heading"><span>最近任务</span><span>{tasks.length}</span></div>
        <label className="workspace-search"><Search size={14} /><input aria-label="搜索任务" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索任务" /></label>
        <div className="workspace-recents" data-cds-scroll-fade>
          {recentTasks.map(task => <button type="button" key={task.id} onClick={() => { goTask(task.id); setDrawerOpen(false); }}
            className={cx("workspace-task", view === "tasks" && focusTaskId === task.id && "is-active")} title={task.title}>
            <span className={cx("task-status-dot", task.status === "in_progress" ? "is-running" : task.status === "failed" ? "is-failed" : "")} />
            <span className="min-w-0 flex-1"><span className="block truncate">{task.title}</span><span className="workspace-task-time">{timeAgo(task.updatedAt)}</span></span>
          </button>)}
          {recentTasks.length === 0 && <p className="px-2 py-4 text-xs leading-relaxed text-ink/45">{query ? "没有匹配的任务" : loading ? "正在加载任务…" : "创建任务后，会在这里显示。"}</p>}
        </div>
      </div>
      <div className="workspace-sidebar-footer">
        <button type="button" className={cx("workspace-nav-item", view === "integrations" && "is-active")} onClick={() => navigate("integrations")}><Network size={17} /><span>集成</span></button>
        <button type="button" className={cx("workspace-nav-item", view === "gate" && "is-active")} onClick={() => navigate("gate")}><ShieldCheck size={17} /><span>安全</span>{pending.length > 0 && <span className="nav-count">{pending.length}</span>}</button>
        <button type="button" className={cx("workspace-nav-item", view === "settings" && "is-active")} onClick={() => navigate("settings")}><SettingsIcon size={17} /><span>设置</span></button>
        <ThemePicker />
        <div className="workspace-local-note"><span className="task-status-dot" />{isTauri() ? "本地工作空间" : "浏览器预览 · 示例数据"}</div>
      </div>
    </aside>
    <div className="workspace-content" inert={!wide && drawerOpen}>
      <header className="workspace-topbar">
        {!wide && <button ref={menuRef} type="button" onClick={() => setDrawerOpen(true)} className="workspace-menu" aria-label="打开导航" aria-expanded={drawerOpen}><Menu size={20} /></button>}
        <div className="workspace-heading"><div className="workspace-title" title={title}>{title}</div><div className="workspace-subtitle">{subtitle}</div></div>
        {view === "demo" ? <span className="demo-mode-label"><span />模拟数据</span> : <div className="workspace-header-actions">
          {activeBudget?.enabled && <span className="top-token-pill">{humanTokens(activeBudget.usedTokens)}</span>}
          <button type="button" onClick={() => navigate(running.length ? "console" : "integrations")} className="workspace-status">
            <span className={cx("task-status-dot", running.length > 0 && "is-running")} />{loading ? "加载中" : running.length ? running.length + " 个会话" : loadErrors.length ? "部分数据未加载" : "已就绪"}
          </button>
        </div>}
      </header>
      {loadErrors.length > 0 && <div role="status" className="workspace-load-error"><span>{loadErrors.join("、")}加载失败，已有记录保持不变。</span><CdsButton size="sm" onClick={() => setReloadKey(key => key + 1)}><RotateCcw size={13} />重试</CdsButton></div>}
      <main className="app-main min-h-0 flex-1 overflow-y-auto" id="main-content">
        <div className={cx("workspace-view", view === "console" && "is-console", view === "demo" && "is-demo")}>
          <ErrorBoundary resetKey={view} onHome={() => navigate("overview")}>
            <Suspense fallback={<div role="status" className="py-16 text-center text-sm text-ink/50">正在打开页面…</div>}><Active key={view} /></Suspense>
          </ErrorBoundary>
        </div>
      </main>
    </div>
    {pending.length > 0 && view !== "gate" && <button type="button" onClick={() => navigate("gate")} className="safety-float">
      <ShieldCheck size={17} /><span>{view === "demo" ? "真实工作空间：" : ""}{pending.length} 条操作需要确认</span><ArrowUpRight size={16} />
    </button>}
    <Toasts />
  </div>;
}
