import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  Check,
  CircleUserRound,
  MoreHorizontal,
  Play,
  Plus,
  Send,
  ShieldAlert,
  Square,
  Wrench,
  X,
} from "lucide-react";
import { useStore } from "../store";
import { ipc, isTauri } from "../lib/ipc";
import { SESSION_STATUS_LABEL, cx, humanTokens } from "../lib/format";
import { Badge, Button, Field, Panel, Spinner, inputCls } from "../ui";
import { cssColor } from "../themes";
import type {
  AgentProfile,
  AgentSession,
  ParsedEventPayload,
  Skill,
  SessionStatusPayload,
  TerminalChunk,
  TerminalChunkPayload,
} from "../types";

const sessionTone = (status: AgentSession["status"]) =>
  status === "running" ? "green" : status === "failed" ? "red" : status === "killed" || status === "exited" ? "ink" : "amber";

const xtermTheme = () => ({
  background: cssColor("--c-panel2"),
  foreground: cssColor("--c-ink"),
  cursor: cssColor("--c-accent"),
  selectionBackground: cssColor("--c-accent", 0.22),
  black: cssColor("--c-bg"),
  brightBlack: cssColor("--c-ink", 0.35),
});

const TERMINAL_UI_QUEUE_MAX_CHARS = 1_000_000;

export function Console() {
  const tasks = useStore((state) => state.tasks);
  const sessions = useStore((state) => state.sessions);
  const setSessions = useStore((state) => state.setSessions);
  const upsertSession = useStore((state) => state.upsertSession);
  const pending = useStore((state) => state.pending);
  const budgets = useStore((state) => state.budgets);
  const setBudget = useStore((state) => state.setBudget);
  const toast = useStore((state) => state.toast);
  const focusSessionId = useStore((state) => state.focusSessionId);
  const theme = useStore((state) => state.theme);

  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [active, setActive] = useState<AgentSession | null>(null);
  const [profileId, setProfileId] = useState("claude_code");
  const [taskId, setTaskId] = useState("");
  const [cwd, setCwd] = useState("");
  const [input, setInput] = useState("");
  const [launching, setLaunching] = useState(false);
  const [contextSkills, setContextSkills] = useState<Skill[]>([]);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const terminalWriteQueueRef = useRef<string[]>([]);
  const terminalWriteQueuedCharsRef = useRef(0);
  const terminalDroppedUiChunksRef = useRef(0);
  const terminalWriteFrameRef = useRef<number | null>(null);
  const parsedEventCountRef = useRef(0);
  const parsedEventTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activePending = useMemo(() => pending.filter((item) => !active || item.sessionId === active.id), [pending, active]);
  const budget = active ? budgets[active.id] : undefined;
  const selectedTask = tasks.find((task) => task.id === taskId) || tasks[0];
  const selectedProfile = profiles.find((profile) => profile.id === profileId);

  useEffect(() => {
    activeIdRef.current = active?.id ?? null;
  }, [active?.id]);

  useEffect(() => {
    ipc.detectAgents().then((items) => {
      setProfiles(items);
      const preferred = items.find((item) => item.id === profileId && item.available) || items.find((item) => item.available);
      if (preferred) setProfileId(preferred.id);
    }).catch(() => {});
    ipc.listAgentSessions().then(setSessions).catch(() => {});
  }, [setSessions]);

  useEffect(() => {
    if (!taskId && tasks[0]) setTaskId(tasks[0].id);
  }, [tasks, taskId]);

  useEffect(() => {
    if (!selectedTask) {
      setContextSkills([]);
      return;
    }
    ipc.searchSkills({ query: selectedTask.goal || selectedTask.title, status: "active", limit: 3 })
      .then(async (items) => {
        if (items.length > 0) {
          setContextSkills(items.map((item) => item.skill));
          return;
        }
        setContextSkills(await ipc.listSkills({ status: "active", limit: 3 }));
      })
      .catch(() => setContextSkills([]));
  }, [selectedTask?.id]);

  useEffect(() => {
    if (!focusSessionId) return;
    const session = sessions.find((item) => item.id === focusSessionId);
    if (session) void attach(session);
  }, [focusSessionId, sessions.length]);

  useEffect(() => {
    if (!hostRef.current || termRef.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.7,
      theme: xtermTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    fit.fit();
    terminal.writeln("\x1b[38;5;208mAEL\x1b[0m — 选择或启动一个 Agent 会话。");
    terminal.onData((data) => {
      const id = activeIdRef.current;
      if (id) ipc.sendAgentInput(id, data).catch(() => {});
    });
    termRef.current = terminal;
    fitRef.current = fit;
    const onResize = () => {
      fit.fit();
      const id = activeIdRef.current;
      if (id) ipc.resizeAgentTerminal(id, terminal.cols, terminal.rows).catch(() => {});
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      terminal.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme();
  }, [theme]);

  useEffect(() => {
    if (!isTauri()) return;
    const subscriptions = [
      listen<TerminalChunkPayload>("agent://terminal-chunk", (event) => {
        if (event.payload.sessionId === activeIdRef.current) queueChunk(event.payload.chunk);
      }),
      listen<SessionStatusPayload>("agent://session-status", (event) => {
        if (event.payload.sessionId === activeIdRef.current) setActive(event.payload.session);
      }),
      listen<ParsedEventPayload>("agent://parsed-event", (event) => {
        if (event.payload.sessionId !== activeIdRef.current) return;
        parsedEventCountRef.current += 1;
        if (parsedEventTimerRef.current) return;
        parsedEventTimerRef.current = setTimeout(() => {
          const count = parsedEventCountRef.current;
          parsedEventCountRef.current = 0;
          parsedEventTimerRef.current = null;
          toast(`证据入链：已记录 ${count} 条事件`, "info");
        }, 250);
      }),
    ];
    return () => {
      if (parsedEventTimerRef.current) clearTimeout(parsedEventTimerRef.current);
      if (terminalWriteFrameRef.current != null) cancelAnimationFrame(terminalWriteFrameRef.current);
      terminalWriteFrameRef.current = null;
      terminalWriteQueueRef.current = [];
      terminalWriteQueuedCharsRef.current = 0;
      terminalDroppedUiChunksRef.current = 0;
      subscriptions.forEach((promise) => promise.then((dispose) => dispose()).catch(() => {}));
    };
  }, [toast]);

  const writeChunk = (chunk: TerminalChunk) => {
    if (!termRef.current) return;
    if (chunk.direction === "system") termRef.current.write(`\x1b[38;5;208m${chunk.text}\x1b[0m`);
    else termRef.current.write(chunk.text);
  };

  const queueChunk = (chunk: TerminalChunk) => {
    const text = chunk.direction === "system" ? `\x1b[38;5;208m${chunk.text}\x1b[0m` : chunk.text;
    if (terminalWriteQueuedCharsRef.current + text.length > TERMINAL_UI_QUEUE_MAX_CHARS) {
      terminalDroppedUiChunksRef.current += 1;
      return;
    }
    terminalWriteQueueRef.current.push(text);
    terminalWriteQueuedCharsRef.current += text.length;
    if (terminalWriteFrameRef.current != null) return;
    terminalWriteFrameRef.current = requestAnimationFrame(() => {
      terminalWriteFrameRef.current = null;
      const terminal = termRef.current;
      if (!terminal) {
        terminalWriteQueueRef.current = [];
        terminalWriteQueuedCharsRef.current = 0;
        return;
      }
      const batch = terminalWriteQueueRef.current.join("");
      terminalWriteQueueRef.current = [];
      terminalWriteQueuedCharsRef.current = 0;
      const dropped = terminalDroppedUiChunksRef.current;
      terminalDroppedUiChunksRef.current = 0;
      if (dropped > 0) terminal.write(`\r\n\x1b[38;5;208m[AEL] UI 输出过载，已折叠 ${dropped} 个终端块。\x1b[0m\r\n`);
      if (batch) terminal.write(batch);
    });
  };

  const attach = async (session: AgentSession) => {
    setActive(session);
    setTaskId(session.taskId);
    try {
      const snapshot = await ipc.getAgentSnapshot(session.id);
      if (terminalWriteFrameRef.current != null) cancelAnimationFrame(terminalWriteFrameRef.current);
      terminalWriteFrameRef.current = null;
      terminalWriteQueueRef.current = [];
      terminalWriteQueuedCharsRef.current = 0;
      terminalDroppedUiChunksRef.current = 0;
      termRef.current?.clear();
      snapshot.chunks.forEach(writeChunk);
      fitRef.current?.fit();
      ipc.gateGetBudget(session.id).then((next) => setBudget(session.id, next)).catch(() => {});
    } catch {
      toast("读取会话记录失败。", "error");
    }
  };

  const launch = async () => {
    const task = selectedTask;
    const profile = selectedProfile;
    if (!task || !profile) return toast("请先选择任务和 Agent。", "warning");
    if (!profile.available && isTauri()) return toast(`未检测到 ${profile.displayName}。`, "warning");
    setLaunching(true);
    try {
      let initialPrompt: string | undefined;
      try {
        const context = await ipc.buildAgentStartupContext({ taskId: task.id, agentKind: profile.kind, profileId: profile.id });
        initialPrompt = context?.prompt;
      } catch {
        /* 浏览器预览允许无启动上下文 */
      }
      const session = await ipc.startAgentSession({
        taskId: task.id,
        profileId: profile.id,
        cwd: cwd.trim() || undefined,
        initialPrompt,
        autoIngest: true,
        rows: termRef.current?.rows,
        cols: termRef.current?.cols,
      });
      upsertSession(session);
      await attach(session);
      toast(`${profile.displayName} 已启动。`, "success");
    } catch {
      toast("启动 Agent 失败，请检查 CLI 和工作目录。", "error");
    } finally {
      setLaunching(false);
    }
  };

  const sendLine = async () => {
    if (!active || !input.trim()) return;
    try {
      await ipc.sendAgentInput(active.id, `${input}\r\n`);
      setInput("");
    } catch (error) {
      toast(error instanceof Error ? error.message : "发送输入失败，请检查 Agent 会话。", "error");
    }
  };

  const resolve = async (id: string, approve: boolean) => {
    try {
      await ipc.gateResolvePending(id, approve);
      useStore.getState().removePending(id);
      toast(approve ? "已放行。" : "已阻止。", approve ? "success" : "info");
    } catch {
      toast("裁决失败。", "error");
    }
  };

  const stop = async () => {
    if (!active) return;
    try {
      const session = await ipc.stopAgentSession(active.id);
      setActive(session);
      upsertSession(session);
      toast("Agent 会话已停止。", "info");
    } catch {
      toast("停止会话失败。", "error");
    }
  };

  const action = () => {
    if (!active) return void launch();
    if (input.trim()) return void sendLine();
    return void stop();
  };

  const live = active && !["exited", "killed", "failed"].includes(active.status);

  return (
    <div className="mx-auto grid max-w-[1104px] grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,720px)_360px]">
      <section className="min-w-0 pt-2">
        <div className="space-y-[18px] px-1 sm:px-2">
          <div className="flex items-start gap-3">
            <span className="icon-button mt-0.5 h-9 w-9"><CircleUserRound className="h-4 w-4" /></span>
            <div className="max-w-[612px] rounded-[18px] border border-line bg-panel2/54 px-4 py-2.5 text-[16px] leading-[1.7] text-ink/72">
              {selectedTask?.goal || "选择一项任务，让 Agent 开始工作。"}
            </div>
          </div>

          <div className="flex min-h-6 items-center gap-3 pl-1 text-[14.5px] text-ink/58">
            <span className="grid h-8 w-8 place-items-center rounded-full border border-green/22 bg-green/[0.055] text-green"><SparkleMark /></span>
            <span>{live ? "正在读取终端输出并记录证据…" : "已准备任务、相关记忆与安全约束。"}</span>
          </div>

          <Panel className="overflow-hidden bg-panel2/58">
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-panel text-ink/56"><Wrench className="h-4 w-4" /></span>
              <span className="font-serif text-[18px]">检查运行环境</span>
              <MoreHorizontal className="ml-auto h-4 w-4 text-ink/28" />
            </div>
            <div className="grid gap-x-4 gap-y-4 px-4 py-4 md:grid-cols-2">
              <Field label="绑定任务"><select value={taskId} onChange={(event) => setTaskId(event.target.value)} className={inputCls}>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></Field>
              <Field label="Agent"><select value={profileId} onChange={(event) => setProfileId(event.target.value)} className={inputCls}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName} · {profile.available ? "Ready" : "Missing"}</option>)}</select></Field>
              <Field label="工作目录"><input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder={selectedTask?.repoPath || "使用任务仓库"} className={cx(inputCls, "font-mono text-[13px]")} /></Field>
              <div className="flex items-end"><Button variant="ghost" onClick={launch} disabled={launching} className="w-full">{launching ? <Spinner /> : <Play className="h-3.5 w-3.5" />}{active ? "启动新会话" : "启动 Agent"}</Button></div>
            </div>
          </Panel>

          <Panel className="overflow-hidden bg-panel2/58">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="flex items-center gap-2"><span className={cx("h-2 w-2 rounded-full", live ? "bg-orange" : "bg-ink/18")} /><span className="font-mono text-[12.5px] text-ink/44">{active ? active.commandLine : "终端输出"}</span></div>
              {active && <Badge tone={sessionTone(active.status)}>{SESSION_STATUS_LABEL[active.status]}</Badge>}
            </div>
            <div className="xterm-host bg-panel2 px-1 py-1"><div ref={hostRef} className="h-[230px] w-full overflow-hidden rounded-lg" /></div>
          </Panel>

          {live && (
            <div className="flex items-center gap-3 rounded-xl bg-orange px-4 py-3 text-white shadow-[0_10px_24px_rgb(var(--c-accent)_/_0.18)]">
              <Spinner className="border-white/35 border-t-white" /><span className="text-[14px]">正在运行 {active.commandLine}</span>
              {budget?.enabled && <span className="ml-auto font-mono text-[12px] text-white/76">{humanTokens(budget.usedTokens)} / {humanTokens(budget.maxSessionTokens)}</span>}
            </div>
          )}

          {activePending.map((item) => (
            <div key={item.id} className="animate-slide-down rounded-xl border border-amber/25 bg-amber/[0.065] px-4 py-3">
              <div className="flex flex-wrap items-center gap-2"><ShieldAlert className="h-4 w-4 text-amber" /><span className="text-[11.5px] text-ink/68">一条命令需要确认</span><code className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink/42">{item.commandText}</code><Button variant="ghost" className="min-h-8 px-3 py-1" onClick={() => resolve(item.id, true)}><Check className="h-3 w-3" />放行</Button><Button variant="danger" className="min-h-8 px-3 py-1" onClick={() => resolve(item.id, false)}><X className="h-3 w-3" />阻止</Button></div>
            </div>
          ))}

          {sessions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {sessions.slice(0, 4).map((session) => <button type="button" key={session.id} onClick={() => void attach(session)} className={cx("rounded-lg border px-2.5 py-1.5 text-[9.5px]", active?.id === session.id ? "border-orange/30 bg-orange/[0.06] text-orange" : "border-line text-ink/38")}>{session.agentId} · {SESSION_STATUS_LABEL[session.status]}</button>)}
            </div>
          )}
        </div>

        <div className="glass-surface mt-6 flex min-h-[82px] items-center gap-3 rounded-[24px] px-3.5 py-2.5 shadow-[var(--shadow-float)]">
          <button type="button" className="icon-button h-9 w-9"><Plus className="h-[18px] w-[18px]" strokeWidth={1.4} /></button>
          <input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void sendLine()} disabled={!active} placeholder={active ? "继续告诉 AEL 要做什么…" : "启动 Agent 后继续指引…"} className="min-w-0 flex-1 border-0 bg-transparent px-1 text-[16px] leading-[1.6] text-ink outline-none placeholder:text-ink/30" />
          <select value={profileId} onChange={(event) => setProfileId(event.target.value)} className="rounded-xl border border-line bg-panel/54 px-3.5 py-2 text-[14px] text-ink/66 outline-none">{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}</option>)}</select>
          <button type="button" onClick={action} className="grid h-[38px] w-[38px] place-items-center rounded-full bg-orange text-white shadow-[0_8px_20px_rgb(var(--c-accent)_/_0.22)]" aria-label={active && !input.trim() ? "停止" : active ? "发送" : "启动"}>{launching ? <Spinner className="border-white/35 border-t-white" /> : active && !input.trim() ? <Square className="h-4 w-4" fill="currentColor" /> : active ? <Send className="h-4 w-4" /> : <Play className="h-4 w-4" fill="currentColor" />}</button>
        </div>
      </section>

      <aside className="glass-surface sticky top-4 overflow-hidden rounded-[24px] shadow-[var(--shadow-float)]">
        <div className="flex items-center justify-between border-b border-line px-5 py-4"><h2 className="font-serif text-[20px]">本次记忆</h2><span className="font-mono text-[12px] text-ink/38">{contextSkills.length}</span></div>
        <div className="space-y-3.5 p-4">
          {contextSkills.length === 0 ? <div className="rounded-[15px] bg-panel2/66 px-4 py-8 text-center text-[14px] leading-[1.7] text-ink/42">当前任务没有匹配到已启用记忆。</div> : contextSkills.map((skill) => (
            <div key={skill.id} className={cx("rounded-[15px] border-l-[3px] px-4 py-4", skill.freshness === "fresh" ? "border-l-green bg-green/[0.055]" : "border-l-orange bg-orange/[0.055]")}>
              <div className="flex items-start gap-2"><h3 className="min-w-0 flex-1 font-serif text-[16px] leading-snug text-ink/82">{skill.name}</h3><Badge tone={skill.freshness === "fresh" ? "green" : "orange"}>{skill.freshness === "fresh" ? "已验证" : "待重验"}</Badge></div>
              <p className="mt-2 line-clamp-2 text-[13.5px] leading-[1.7] text-ink/48">为何命中 · {skill.trigger}</p>
              <div className="mt-2 font-mono text-[12px] text-ink/36">来源 {skill.successCount + skill.failCount} · {skill.tags.slice(0, 2).join(" / ") || "全局"}</div>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => useStore.getState().setView("memory")} className="flex w-full items-center justify-between border-t border-line px-5 py-3.5 text-left text-[14px] text-ink/58 hover:bg-panel2/36"><span>查看注入依据</span><span>›</span></button>
        <div className="flex items-center justify-between border-t border-line px-5 py-4 text-[13px] text-ink/46"><span>上下文</span><span className="font-mono">{budget?.usedTokens ?? contextSkills.length * 220} / {budget?.maxSessionTokens ?? 8000} tokens</span></div>
      </aside>
    </div>
  );
}

function SparkleMark() {
  return <span className="font-serif text-[17px] leading-none">＊</span>;
}
