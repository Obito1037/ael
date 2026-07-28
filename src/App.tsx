import { useEffect, type ReactElement } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Boxes,
  FileCheck2,
  Fingerprint,
  Gauge,
  LayoutGrid,
  ScrollText,
  Settings as SettingsIcon,
  ShieldAlert,
  TerminalSquare,
} from "lucide-react";
import { useStore } from "./store";
import { ipc, isTauri } from "./lib/ipc";
import { cx } from "./lib/format";
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

const NAV: { id: ViewId; label: string; icon: any; group?: string }[] = [
  { id: "overview", label: "总览", icon: LayoutGrid },
  { id: "tasks", label: "任务 · 证据链", icon: ScrollText },
  { id: "console", label: "Agents 控制台", icon: TerminalSquare },
  { id: "gate", label: "海关", icon: ShieldAlert },
  { id: "briefs", label: "Review Brief", icon: FileCheck2 },
  { id: "blame", label: "行级溯源", icon: Fingerprint },
  { id: "memory", label: "经验库", icon: Boxes },
  { id: "adr", label: "活文档 ADR", icon: Gauge },
  { id: "settings", label: "设置", icon: SettingsIcon },
];

const VIEWS: Record<ViewId, () => ReactElement> = {
  overview: Overview,
  tasks: Tasks,
  console: Console,
  gate: Gate,
  briefs: Briefs,
  blame: Blame,
  memory: Memory,
  adr: Adr,
  settings: SettingsView,
};

export default function App() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const pending = useStore((s) => s.pending);
  const Active = VIEWS[view];

  // 初始加载 + 治理事件桥
  useEffect(() => {
    const store = useStore.getState();
    ipc.listTasks({ limit: 200 }).then(store.setTasks).catch(() => {});
    ipc.listAgentSessions().then(store.setSessions).catch(() => {});
    ipc.gateListPending().then(store.setPending).catch(() => {});
    ipc.gateListDecisions({ limit: 100 }).then(store.setDecisions).catch(() => {});

    if (!isTauri()) return;
    const unlisten: Array<Promise<() => void>> = [
      listen<PendingCommand>("gate://pending", (e) => {
        useStore.getState().addPending(e.payload);
        useStore.getState().toast(`海关扣留命令:${e.payload.commandText}`, "warning");
      }),
      listen<PolicyDecision>("gate://decision", (e) => {
        useStore.getState().addDecision(e.payload);
        useStore.getState().removePending(e.payload.id);
      }),
      listen<BudgetPayload>("gate://budget", (e) => {
        useStore.getState().setBudget(e.payload.sessionId, e.payload.budget);
        if (e.payload.budget.breakerTripped)
          useStore.getState().toast("会话 token 预算已熔断", "error");
      }),
      listen<SignatureHitPayload>("guard://signature-hit", (e) => {
        useStore
          .getState()
          .toast(`签名命中失败库(历史 ${e.payload.occurrences} 次):${e.payload.guardRule}`, "warning");
      }),
      listen<SessionStatusPayload>("agent://session-status", (e) => {
        useStore.getState().upsertSession(e.payload.session);
      }),
    ];
    return () => {
      unlisten.forEach((p) => p.then((f) => f()).catch(() => {}));
    };
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-ink">
      {/* 侧栏 */}
      <aside className="flex w-[228px] shrink-0 flex-col border-r border-ink/10 bg-panel/60">
        <div className="flex items-center gap-2.5 px-5 py-[18px]">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange font-mono text-[13px] text-bg">
            ▣
          </span>
          <div className="leading-none">
            <div className="font-display text-[15px] font-bold tracking-wide text-ink">AEL</div>
            <div className="mt-0.5 font-mono text-[9px] tracking-[0.3em] text-ink/35">治理层 · 2.0</div>
          </div>
        </div>

        <nav className="mt-2 flex-1 space-y-0.5 px-3">
          {NAV.map(({ id, label, icon: Icon }) => {
            const active = view === id;
            const badge = id === "gate" && pending.length > 0 ? pending.length : null;
            return (
              <button
                key={id}
                onClick={() => setView(id)}
                className={cx(
                  "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors",
                  active
                    ? "bg-ink/[0.05] text-ink"
                    : "text-ink/50 hover:bg-ink/[0.03] hover:text-ink/80",
                )}
              >
                <Icon className={cx("h-[17px] w-[17px]", active ? "text-orange" : "text-ink/40")} />
                <span className="flex-1 text-left">{label}</span>
                {badge != null && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red px-1 font-mono text-[10px] font-bold text-white">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-ink/10 px-3 py-3">
          <ThemePicker />
          <p className="px-2 font-mono text-[9.5px] leading-relaxed tracking-wide text-ink/30">
            本地优先 · 隐私不外传
            <br />
            黑匣子 · 海关 · 账本
          </p>
        </div>
      </aside>

      {/* 主内容 */}
      <main className="grid-backdrop relative flex-1 overflow-y-auto">
        <div className="relative z-10 mx-auto max-w-[1180px] px-8 py-9 animate-fade-in" key={view}>
          <Active />
        </div>
      </main>

      <Toasts />
    </div>
  );
}
