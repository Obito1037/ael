import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { ChatComposer } from "open-claude-ui";
import "@xterm/xterm/css/xterm.css";
import { Check, CircleUserRound, Play, ShieldAlert, Square, Wrench, X } from "lucide-react";
import { useStore } from "../store";
import { ipc, isTauri } from "../lib/ipc";
import { replayTerminalChunks, TerminalWriter } from "../lib/terminalWriter";
import { MemoryEvidence } from "../components/MemoryEvidence";
import { SESSION_STATUS_LABEL, cx, humanTokens } from "../lib/format";
import { Badge, Button, Field, Panel, Spinner, inputCls } from "../ui";
import { cssColor } from "../themes";
import type { AgentProfile, AgentSession, ParsedEventPayload, Skill, SessionStatusPayload, TerminalChunk, TerminalChunkPayload } from "../types";

const isLive = (session: AgentSession | null) => !!session && !["exited", "killed", "failed"].includes(session.status);
const sessionTone = (status: AgentSession["status"]) => status === "running" ? "green" : status === "failed" ? "red" : status === "killed" || status === "exited" ? "ink" : "amber";
const xtermTheme = () => ({
  background: cssColor("--c-panel2"), foreground: cssColor("--c-ink"),
  cursor: cssColor("--c-accent"), selectionBackground: cssColor("--c-accent", 0.22),
  black: cssColor("--c-bg"), brightBlack: cssColor("--c-ink", 0.35),
});
const chunkText = (chunk: TerminalChunk) => chunk.direction === "system" ? `\x1b[38;5;208m${chunk.text}\x1b[0m` : chunk.text;

export function Console() {
  const tasks = useStore((state) => state.tasks);
  const sessions = useStore((state) => state.sessions);
  const setSessions = useStore((state) => state.setSessions);
  const upsertSession = useStore((state) => state.upsertSession);
  const pending = useStore((state) => state.pending);
  const budgets = useStore((state) => state.budgets);
  const setBudget = useStore((state) => state.setBudget);
  const setConsoleContext = useStore((state) => state.setConsoleContext);
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
  const [attaching, setAttaching] = useState(false);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [contextSkills, setContextSkills] = useState<Skill[]>([]);
  const [snapshotNotice, setSnapshotNotice] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const writerRef = useRef<TerminalWriter | null>(null);
  const mountedRef = useRef(false);
  const activeRef = useRef<AgentSession | null>(null);
  const epochRef = useRef(0);
  const lastSeqRef = useRef(0);
  const snapshotPendingRef = useRef(false);
  const bufferedRef = useRef<TerminalChunk[]>([]);
  const bufferedCharsRef = useRef(0);
  const bufferedDroppedRef = useRef(0);
  const inputRef = useRef("");
  const draftsRef = useRef<Record<string, string>>({});
  const launchingRef = useRef(false);
  const sendingRef = useRef(false);
  const stoppingRef = useRef(false);
  const parsedEventCountRef = useRef(0);
  const parsedEventTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activePending = useMemo(() => pending.filter((item) => active && item.sessionId === active.id), [pending, active]);
  const budget = active ? budgets[active.id] : undefined;
  const selectedTask = tasks.find((task) => task.id === taskId) || tasks[0];
  const selectedProfile = profiles.find((profile) => profile.id === profileId);
  const live = isLive(active);
  const canSend = live && !attaching && !stopping && active?.taskId === selectedTask?.id && active?.profileId === profileId;

  const changeInput = (value: string) => {
    inputRef.current = value;
    if (activeRef.current) draftsRef.current[activeRef.current.id] = value;
    setInput(value);
  };

  const acceptChunk = (chunk: TerminalChunk) => {
    if (!mountedRef.current || chunk.sessionId !== activeRef.current?.id) return;
    if (snapshotPendingRef.current) {
      if (bufferedCharsRef.current + chunk.text.length <= 1_048_576 && bufferedRef.current.length < 2_048) {
        bufferedRef.current.push(chunk);
        bufferedCharsRef.current += chunk.text.length;
      } else bufferedDroppedRef.current += 1;
      return;
    }
    if (chunk.seq <= lastSeqRef.current) return;
    lastSeqRef.current = chunk.seq;
    writerRef.current?.enqueue(chunkText(chunk));
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      epochRef.current += 1;
      activeRef.current = null;
      snapshotPendingRef.current = false;
      bufferedRef.current = [];
      bufferedCharsRef.current = 0;
      bufferedDroppedRef.current = 0;
      if (parsedEventTimerRef.current) clearTimeout(parsedEventTimerRef.current);
      parsedEventTimerRef.current = null;
      parsedEventCountRef.current = 0;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    ipc.detectAgents().then((items) => {
      if (cancelled) return;
      setProfiles(items);
      if (!activeRef.current) setProfileId((current) => (items.find((item) => item.id === current && item.available) || items.find((item) => item.available))?.id || current);
    }).catch(() => {});
    ipc.listAgentSessions().then((items) => { if (!cancelled) setSessions(items); }).catch(() => {});
    return () => { cancelled = true; };
  }, [setSessions]);

  useEffect(() => { if (!taskId && tasks[0]) setTaskId(tasks[0].id); }, [tasks, taskId]);
  useEffect(() => {
    setConsoleContext(selectedTask?.id || null, selectedProfile?.displayName || active?.agentId || null);
  }, [selectedTask?.id, selectedProfile?.displayName, active?.agentId, setConsoleContext]);

  useEffect(() => {
    let cancelled = false;
    setContextSkills([]);
    if (selectedTask) {
      ipc.searchSkills({ query: selectedTask.goal || selectedTask.title, status: "active", limit: 3 })
        .then((items) => { if (!cancelled) setContextSkills(items.map((item) => item.skill)); })
        .catch(() => { if (!cancelled) setContextSkills([]); });
    }
    return () => { cancelled = true; };
  }, [selectedTask?.id, selectedTask?.goal, selectedTask?.title]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let resizeFrame: number | null = null;
    const terminal = new Terminal({ cursorBlink: true, convertEol: true, fontFamily: '\"Cascadia Code\", \"JetBrains Mono\", Consolas, monospace', fontSize: 12.5, lineHeight: 1.7, scrollback: 5_000, theme: xtermTheme() });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    const writer = new TerminalWriter(
      (text, done) => { if (!disposed) terminal.write(text, done); },
      () => { if (!disposed) terminal.reset(); },
    );
    termRef.current = terminal;
    writerRef.current = writer;
    writer.enqueue("\x1b[38;5;208mAEL3\x1b[0m — 选择或启动一个 Agent 会话。\r\n");
    const inputSubscription = terminal.onData((data) => {
      const session = activeRef.current;
      if (!disposed && isLive(session) && !snapshotPendingRef.current && !stoppingRef.current) {
        ipc.sendAgentInput(session!.id, data).catch(() => { if (!disposed) toast("终端输入发送失败，请检查会话状态。", "error"); });
      }
    });
    const resize = () => {
      if (disposed || resizeFrame !== null) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        if (disposed || !host.isConnected || host.clientWidth === 0 || host.clientHeight === 0) return;
        fit.fit();
        const session = activeRef.current;
        if (isLive(session)) ipc.resizeAgentTerminal(session!.id, terminal.cols, terminal.rows).catch(() => {});
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    window.addEventListener("resize", resize);
    resize();
    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("resize", resize);
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      writer.dispose();
      inputSubscription.dispose();
      if (writerRef.current === writer) writerRef.current = null;
      if (termRef.current === terminal) termRef.current = null;
      terminal.dispose();
    };
  }, [toast]);

  useEffect(() => { if (termRef.current) termRef.current.options.theme = xtermTheme(); }, [theme]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const subscriptions = [
      listen<TerminalChunkPayload>("agent://terminal-chunk", (event) => { if (!cancelled) acceptChunk(event.payload.chunk); }),
      listen<SessionStatusPayload>("agent://session-status", (event) => {
        if (cancelled || event.payload.sessionId !== activeRef.current?.id) return;
        activeRef.current = event.payload.session;
        setActive(event.payload.session);
      }),
      listen<ParsedEventPayload>("agent://parsed-event", (event) => {
        if (cancelled || event.payload.sessionId !== activeRef.current?.id) return;
        parsedEventCountRef.current += 1;
        if (parsedEventTimerRef.current) return;
        parsedEventTimerRef.current = setTimeout(() => {
          const count = parsedEventCountRef.current;
          parsedEventCountRef.current = 0;
          parsedEventTimerRef.current = null;
          if (!cancelled && count) toast(`证据入链：已记录 ${count} 条事件`, "info");
        }, 250);
      }),
    ].map((subscription) => subscription.catch(() => undefined));
    return () => {
      cancelled = true;
      subscriptions.forEach((subscription) => { void subscription.then((dispose) => dispose?.()).catch(() => {}); });
    };
  }, [toast]);

  const detach = () => {
    epochRef.current += 1;
    if (activeRef.current) draftsRef.current[activeRef.current.id] = inputRef.current;
    activeRef.current = null;
    snapshotPendingRef.current = false;
    bufferedRef.current = [];
    bufferedCharsRef.current = 0;
    bufferedDroppedRef.current = 0;
    lastSeqRef.current = 0;
    setActive(null);
    setAttaching(false);
    setSnapshotNotice(null);
    inputRef.current = "";
    setInput("");
    writerRef.current?.reset();
    writerRef.current?.enqueue("当前未连接会话。选择或启动会话后继续。\r\n");
    if (parsedEventTimerRef.current) clearTimeout(parsedEventTimerRef.current);
    parsedEventTimerRef.current = null;
    parsedEventCountRef.current = 0;
  };

  const attach = async (session: AgentSession) => {
    const epoch = ++epochRef.current;
    if (activeRef.current) draftsRef.current[activeRef.current.id] = inputRef.current;
    activeRef.current = session;
    snapshotPendingRef.current = true;
    bufferedRef.current = [];
    bufferedCharsRef.current = 0;
    bufferedDroppedRef.current = 0;
    lastSeqRef.current = 0;
    setActive(session);
    setTaskId(session.taskId);
    setProfileId(session.profileId);
    setCwd(session.cwd);
    inputRef.current = draftsRef.current[session.id] || "";
    setInput(inputRef.current);
    setAttaching(true);
    setSnapshotNotice(null);
    writerRef.current?.reset();
    try {
      const snapshot = await ipc.getAgentSnapshot(session.id);
      if (!mountedRef.current || epoch !== epochRef.current || activeRef.current?.id !== session.id) return;
      const buffered = bufferedRef.current;
      const dropped = bufferedDroppedRef.current;
      snapshotPendingRef.current = false;
      bufferedRef.current = [];
      bufferedCharsRef.current = 0;
      bufferedDroppedRef.current = 0;
      replayTerminalChunks(snapshot.chunks, buffered, session.id, acceptChunk);
      const notice = snapshot.truncated
        ? `仅回放最近 ${snapshot.chunks.length} 个输出片段${snapshot.firstSeq != null && snapshot.lastSeq != null ? `（序号 ${snapshot.firstSeq}–${snapshot.lastSeq}）` : ""}；完整记录仍保存在本机。`
        : "";
      const overflowNotice = dropped ? `加载期间另有 ${dropped} 个实时片段未显示，可重新选择会话查看近期输出。` : "";
      setSnapshotNotice(notice || overflowNotice ? `${notice}${overflowNotice}` : null);
      // A terminal status event received during the request is newer than its snapshot.
      if (activeRef.current === session && snapshot.session) {
        activeRef.current = snapshot.session;
        setActive(snapshot.session);
      }
      const terminal = termRef.current;
      if (terminal && isLive(activeRef.current)) {
        void ipc.resizeAgentTerminal(session.id, terminal.cols, terminal.rows).catch(() => {});
      }
      ipc.gateGetBudget(session.id).then((next) => { if (mountedRef.current && epoch === epochRef.current) setBudget(session.id, next); }).catch(() => {});
    } catch {
      if (!mountedRef.current || epoch !== epochRef.current) return;
      snapshotPendingRef.current = false;
      const chunks = bufferedRef.current;
      const dropped = bufferedDroppedRef.current;
      bufferedRef.current = [];
      bufferedCharsRef.current = 0;
      bufferedDroppedRef.current = 0;
      replayTerminalChunks([], chunks, session.id, acceptChunk);
      if (dropped) setSnapshotNotice(`加载期间有 ${dropped} 个实时片段未显示；完整记录仍保存在本机。`);
      writerRef.current?.enqueue("\r\n会话历史读取失败，可重新选择此会话重试。\r\n");
      toast("读取会话记录失败。", "error");
    } finally {
      if (mountedRef.current && epoch === epochRef.current) setAttaching(false);
    }
  };

  useEffect(() => {
    if (!focusSessionId || activeRef.current?.id === focusSessionId) return;
    const session = sessions.find((item) => item.id === focusSessionId);
    if (session) void attach(session);
  }, [focusSessionId, sessions]);

  const selectTask = (id: string) => {
    if (id === selectedTask?.id) return;
    useStore.getState().clearFocus();
    const hadSession = !!activeRef.current;
    detach();
    setTaskId(id);
    setCwd("");
    if (hadSession) toast("已切换任务。原会话仍保留在会话列表中。", "info");
  };
  const selectProfile = (id: string) => {
    if (id === profileId) return;
    useStore.getState().clearFocus();
    detach();
    setProfileId(id);
  };

  const launch = async () => {
    if (launchingRef.current) return;
    const task = selectedTask;
    const profile = selectedProfile;
    if (!task || !profile) return toast("请先选择任务和 Agent。", "warning");
    if (!profile.available) return toast(`未检测到 ${profile.displayName}。`, "warning");
    useStore.getState().clearFocus();
    const epoch = epochRef.current;
    launchingRef.current = true;
    setLaunching(true);
    try {
      const context = await ipc.buildAgentStartupContext({ taskId: task.id, agentKind: profile.kind, profileId: profile.id });
      if (!mountedRef.current || epoch !== epochRef.current) return;
      const session = await ipc.startAgentSession({ taskId: task.id, profileId: profile.id, cwd: cwd.trim() || task.repoPath || undefined, initialPrompt: context?.prompt, autoIngest: true, rows: termRef.current?.rows, cols: termRef.current?.cols });
      upsertSession(session);
      if (!mountedRef.current || epoch !== epochRef.current) return;
      await attach(session);
      if (mountedRef.current) toast(`${profile.displayName} 已启动。`, "success");
    } catch (error) {
      if (mountedRef.current) toast(error instanceof Error ? error.message : "启动 Agent 失败，请检查 CLI 和工作目录。", "error");
    } finally {
      launchingRef.current = false;
      if (mountedRef.current) setLaunching(false);
    }
  };

  const sendLine = async () => {
    const session = activeRef.current;
    const text = inputRef.current;
    if (!isLive(session) || !session || snapshotPendingRef.current || stoppingRef.current || sendingRef.current || !text.trim() || session.taskId !== selectedTask?.id || session.profileId !== profileId) return;
    sendingRef.current = true;
    setSending(true);
    try {
      await ipc.sendAgentInput(session.id, `${text}\r\n`);
      if (draftsRef.current[session.id] === text) draftsRef.current[session.id] = "";
      if (!mountedRef.current || activeRef.current?.id !== session.id) return;
      // A -> B -> A can change the view epoch while this exact draft is in flight.
      // Clear only the submitted text, never a newer draft or another session's input.
      if (inputRef.current === text) changeInput("");
      // Browser previews have no Tauri event bus; read back only the new mock chunks.
      if (!isTauri()) {
        const epoch = epochRef.current;
        void ipc.getAgentSnapshot(session.id).then((snapshot) => {
          if (mountedRef.current && epoch === epochRef.current) snapshot.chunks.forEach(acceptChunk);
        }).catch(() => {});
      }
    } catch (error) {
      if (mountedRef.current) toast(error instanceof Error ? error.message : "发送失败，输入已保留。", "error");
      throw error;
    } finally {
      sendingRef.current = false;
      if (mountedRef.current) setSending(false);
    }
  };

  const resolve = async (id: string, approve: boolean) => {
    try {
      await ipc.gateResolvePending(id, approve);
      useStore.getState().removePending(id);
      if (mountedRef.current) toast(approve ? "已放行。" : "已阻止。", approve ? "success" : "info");
    } catch { if (mountedRef.current) toast("裁决失败。", "error"); }
  };

  const stop = async () => {
    const current = activeRef.current;
    if (!isLive(current) || !current || stoppingRef.current) return;
    stoppingRef.current = true;
    setStopping(true);
    try {
      const session = await ipc.stopAgentSession(current.id);
      upsertSession(session);
      if (!mountedRef.current) return;
      if (activeRef.current?.id === session.id) { activeRef.current = session; setActive(session); }
      toast("Agent 会话已停止。", "info");
    } catch { if (mountedRef.current) toast("停止会话失败。", "error"); }
    finally { stoppingRef.current = false; if (mountedRef.current) setStopping(false); }
  };

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
            <span>{live ? "正在读取终端输出并记录证据…" : "启动前将根据当前任务匹配记忆与安全约束。"}</span>
          </div>

          <Panel className="overflow-hidden bg-panel2/58">
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-panel text-ink/56"><Wrench className="h-4 w-4" /></span>
              <span className="font-serif text-[18px]">检查运行环境</span>
            </div>
            <div className="grid gap-x-4 gap-y-4 px-4 py-4 md:grid-cols-2">
              <Field label="绑定任务"><select value={taskId} aria-label="绑定任务" onChange={(event) => selectTask(event.target.value)} disabled={launching} className={inputCls}>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></Field>
              <Field label="Agent"><select value={profileId} aria-label="Agent" onChange={(event) => selectProfile(event.target.value)} disabled={launching} className={inputCls}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName} · {profile.available ? "Ready" : "Missing"}</option>)}</select></Field>
              <Field label="工作目录"><input value={cwd} onChange={(event) => setCwd(event.target.value)} disabled={launching} aria-label="工作目录" placeholder={selectedTask?.repoPath || "使用任务仓库"} className={cx(inputCls, "font-mono text-[13px]")} /></Field>
              <div className="flex items-end"><Button variant="ghost" onClick={launch} disabled={launching || attaching || !selectedTask || !selectedProfile?.available} className="w-full">{launching ? <Spinner /> : <Play className="h-3.5 w-3.5" />}{active ? "启动新会话" : "启动 Agent"}</Button></div>
            </div>
          </Panel>

          <Panel className="overflow-hidden bg-panel2/58">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="flex min-w-0 items-center gap-2"><span className={cx("h-2 w-2 rounded-full", live ? "bg-orange" : "bg-ink/18")} /><span className="truncate font-mono text-[12.5px] text-ink/44">{attaching ? "正在读取会话记录…" : active ? active.commandLine : "终端输出"}</span></div>
              {active && <Badge tone={sessionTone(active.status)}>{SESSION_STATUS_LABEL[active.status]}</Badge>}
            </div>
            {snapshotNotice && <p role="status" data-testid="terminal-snapshot-notice" className="border-b border-line bg-amber/[0.06] px-4 py-2 text-[12px] leading-relaxed text-ink/60">{snapshotNotice}</p>}
            <div className="xterm-host bg-panel2 px-1 py-1"><div ref={hostRef} className="h-[230px] w-full overflow-hidden rounded-lg" /></div>
          </Panel>

          {live && active && (
            <div className="flex items-center gap-3 rounded-xl bg-orange px-4 py-3 text-white shadow-[0_10px_24px_rgb(var(--c-accent)_/_0.18)]">
              <Spinner className="border-white/35 border-t-white" /><span className="min-w-0 truncate text-[14px]">正在运行 {active.commandLine}</span>
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
              {sessions.map((session) => <button type="button" key={session.id} disabled={launching} aria-label={`查看会话 ${session.id}`} title={tasks.find((task) => task.id === session.taskId)?.title || session.taskId} onClick={() => { useStore.getState().clearFocus(); void attach(session); }} className={cx("rounded-lg border px-2.5 py-1.5 text-[9.5px]", active?.id === session.id ? "border-orange/30 bg-orange/[0.06] text-orange" : "border-line text-ink/38")}>{session.agentId} · {SESSION_STATUS_LABEL[session.status]}</button>)}
            </div>
          )}
        </div>

        <div className="mt-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink/55">
            <span>{active ? `当前会话 · ${active.agentId} · ${active.id.slice(-8)}` : "尚未连接会话"}</span>
            {live && <Button variant="danger" className="min-h-8 px-3 py-1" onClick={stop} disabled={stopping}><Square className="h-3 w-3" />{stopping ? "正在停止…" : "停止会话"}</Button>}
          </div>
          <ChatComposer
            value={input} onChange={changeInput} onSend={sendLine}
            disabled={!canSend} isSending={sending} aria-label="会话消息" sendLabel="发送消息"
            placeholder={!active ? "启动或选择会话后继续指引…" : !live ? "会话已结束，启动新会话后继续…" : attaching ? "正在连接会话…" : "继续描述任务，Enter 发送，Shift + Enter 换行"}
            footer={<span className="text-[11px] text-ink/45">{active && !live ? "已结束的会话仅供查看" : "Enter 发送 · Shift + Enter 换行"}</span>}
          />
        </div>
      </section>

      <aside className="glass-surface sticky top-4 overflow-hidden rounded-[24px] shadow-[var(--shadow-float)]">
        <MemoryEvidence skills={contextSkills} onOpenMemory={() => useStore.getState().setView("memory")} />
        <div className="flex items-center justify-between border-t border-line px-5 py-4 text-[13px] text-ink/46"><span>上下文</span><span className="font-mono">{budget?.enabled ? `${budget.usedTokens} / ${budget.maxSessionTokens} tokens` : "尚无使用统计"}</span></div>
      </aside>
    </div>
  );
}

function SparkleMark() {
  return <span className="font-serif text-[17px] leading-none">＊</span>;
}
