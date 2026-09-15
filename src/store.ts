import { create } from "zustand";
import { applyTheme, loadTheme } from "./themes";
import type {
  AgentSession,
  BudgetStatus,
  PendingCommand,
  PolicyDecision,
  Task,
  Toast,
  ToastKind,
  ViewId,
} from "./types";

interface AppState {
  view: ViewId;
  setView: (v: ViewId) => void;

  theme: string;
  setTheme: (id: string) => void;

  // 跨视图跳转:带一个焦点参数(如从总览点任务 → tasks 视图并选中)
  focusTaskId: string | null;
  focusSessionId: string | null;
  goTask: (taskId: string) => void;
  goSession: (sessionId: string) => void;
  clearFocus: () => void;

  tasks: Task[];
  setTasks: (t: Task[]) => void;
  upsertTask: (t: Task) => void;

  sessions: AgentSession[];
  setSessions: (s: AgentSession[]) => void;
  upsertSession: (s: AgentSession) => void;

  // 海关实时态
  pending: PendingCommand[];
  addPending: (p: PendingCommand) => void;
  removePending: (id: string) => void;
  setPending: (p: PendingCommand[]) => void;

  decisions: PolicyDecision[];
  addDecision: (d: PolicyDecision) => void;
  setDecisions: (d: PolicyDecision[]) => void;

  budgets: Record<string, BudgetStatus>;
  setBudget: (sessionId: string, b: BudgetStatus) => void;

  toasts: Toast[];
  toast: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 1;

const initialTheme = loadTheme();
applyTheme(initialTheme);

export const useStore = create<AppState>((set) => ({
  view: "overview",
  setView: (view) => set({ view, focusTaskId: null, focusSessionId: null }),

  theme: initialTheme,
  setTheme: (id) => {
    applyTheme(id);
    set({ theme: id });
  },

  focusTaskId: null,
  focusSessionId: null,
  goTask: (taskId) => set({ view: "tasks", focusTaskId: taskId }),
  goSession: (sessionId) => set({ view: "console", focusSessionId: sessionId }),
  clearFocus: () => set({ focusTaskId: null, focusSessionId: null }),

  tasks: [],
  setTasks: (tasks) => set({ tasks }),
  upsertTask: (t) =>
    set((s) => ({
      tasks: s.tasks.some((x) => x.id === t.id)
        ? s.tasks.map((x) => (x.id === t.id ? t : x))
        : [t, ...s.tasks],
    })),

  sessions: [],
  setSessions: (sessions) => set({ sessions }),
  upsertSession: (sn) =>
    set((s) => ({
      sessions: s.sessions.some((x) => x.id === sn.id)
        ? s.sessions.map((x) => (x.id === sn.id ? sn : x))
        : [sn, ...s.sessions],
    })),

  pending: [],
  addPending: (p) => set((s) => ({ pending: [p, ...s.pending.filter((x) => x.id !== p.id)] })),
  removePending: (id) => set((s) => ({ pending: s.pending.filter((x) => x.id !== id) })),
  setPending: (pending) => set({ pending }),

  decisions: [],
  addDecision: (d) =>
    set((s) => ({ decisions: [d, ...s.decisions.filter((item) => item.id !== d.id)].slice(0, 500) })),
  setDecisions: (decisions) => set({ decisions }),

  budgets: {},
  setBudget: (sessionId, b) => set((s) => ({ budgets: { ...s.budgets, [sessionId]: b } })),

  toasts: [],
  toast: (message, kind = "info") =>
    set((s) => {
      const id = toastSeq++;
      setTimeout(() => useStore.getState().dismissToast(id), 4200);
      return { toasts: [...s.toasts, { id, kind, message }] };
    }),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
