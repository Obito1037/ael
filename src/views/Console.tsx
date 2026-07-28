import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Check, Play, Send, ShieldAlert, Square, X } from "lucide-react";
import { useStore } from "../store";
import { ipc, isTauri } from "../lib/ipc";
import {
  SESSION_STATUS_LABEL,
  cx,
  humanTokens,
} from "../lib/format";
import { Badge, Button, Field, Kicker, Meter, PageTitle, Panel, Spinner, inputCls } from "../ui";
import { cssColor } from "../themes";
import type {
  AgentProfile,
  AgentSession,
  ParsedEventPayload,
  TerminalChunk,
  TerminalChunkPayload,
} from "../types";

const sessionTone = (s: AgentSession["status"]) =>
  s === "running" ? "green" : s === "failed" ? "red" : s === "killed" || s === "exited" ? "ink" : "amber";

// 从当前主题的 CSS 变量派生 xterm 配色,换主题时同步。
const xtermTheme = () => ({
  background: cssColor("--c-panel2"),
  foreground: cssColor("--c-ink"),
  cursor: cssColor("--c-accent"),
  selectionBackground: cssColor("--c-accent", 0.28),
  black: cssColor("--c-bg"),
  brightBlack: cssColor("--c-ink", 0.35),
});

export function Console() {
  const tasks = useStore((s) => s.tasks);
  const sessions = useStore((s) => s.sessions);
  const setSessions = useStore((s) => s.setSessions);
  const upsertSession = useStore((s) => s.upsertSession);
  const pending = useStore((s) => s.pending);
  const budgets = useStore((s) => s.budgets);
  const setBudget = useStore((s) => s.setBudget);
  const toast = useStore((s) => s.toast);
  const focusSessionId = useStore((s) => s.focusSessionId);
  const theme = useStore((s) => s.theme);

  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [active, setActive] = useState<AgentSession | null>(null);
  const [profileId, setProfileId] = useState("claude_code");
  const [taskId, setTaskId] = useState("");
  const [cwd, setCwd] = useState("");
  const [input, setInput] = useState("");
  const [launching, setLaunching] = useState(false);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activeIdRef = useRef<string | null>(null);

  const activePending = useMemo(
    () => pending.filter((p) => !active || p.sessionId === active.id),
    [pending, active],
  );
  const budget = active ? budgets[active.id] : undefined;

  useEffect(() => {
    activeIdRef.current = active?.id ?? null;
  }, [active?.id]);

  useEffect(() => {
    ipc.detectAgents().then(setProfiles).catch(() => {});
    ipc.listAgentSessions().then(setSessions).catch(() => {});
  }, [setSessions]);

  useEffect(() => {
    if (!taskId && tasks[0]) setTaskId(tasks[0].id);
  }, [tasks, taskId]);

  useEffect(() => {
    if (focusSessionId) {
      const s = sessions.find((x) => x.id === focusSessionId);
      if (s) attach(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSessionId, sessions.length]);

  // xterm 初始化
  useEffect(() => {
    if (!hostRef.current || termRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"JetBrains Mono", Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.35,
      theme: xtermTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    term.writeln("\x1b[38;5;208mAEL 黑匣子记录仪\x1b[0m — 选择或启动一个 Agent 会话以附着终端。");
    term.onData((data) => {
      const id = activeIdRef.current;
      if (id) ipc.sendAgentInput(id, data).catch(() => {});
    });
    termRef.current = term;
    fitRef.current = fit;
    const onResize = () => {
      fit.fit();
      const id = activeIdRef.current;
      if (id) ipc.resizeAgentTerminal(id, term.cols, term.rows).catch(() => {});
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // 换主题时同步 xterm 配色
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme();
  }, [theme]);

  // 终端流 + 解析事件
  useEffect(() => {
    if (!isTauri()) return;
    const subs = [
      listen<TerminalChunkPayload>("agent://terminal-chunk", (e) => {
        if (e.payload.sessionId === activeIdRef.current) writeChunk(e.payload.chunk);
      }),
      listen<ParsedEventPayload>("agent://parsed-event", (e) => {
        if (e.payload.sessionId === activeIdRef.current)
          toast(`证据入链:[${e.payload.event.kind}] ${e.payload.event.summary}`, "info");
      }),
    ];
    return () => subs.forEach((p) => p.then((f) => f()).catch(() => {}));
  }, [toast]);

  const writeChunk = (c: TerminalChunk) => {
    const term = termRef.current;
    if (!term) return;
    if (c.direction === "system") term.write(`\x1b[38;5;208m${c.text}\x1b[0m`);
    else term.write(c.text);
  };

  const attach = async (s: AgentSession) => {
    setActive(s);
    try {
      const snap = await ipc.getAgentSnapshot(s.id);
      termRef.current?.clear();
      snap.chunks.forEach(writeChunk);
      fitRef.current?.fit();
      ipc.gateGetBudget(s.id).then((b) => setBudget(s.id, b)).catch(() => {});
    } catch {
      toast("读取会话 transcript 失败。", "error");
    }
  };

  const launch = async () => {
    const task = tasks.find((t) => t.id === taskId) || tasks[0];
    const profile = profiles.find((p) => p.id === profileId);
    if (!task || !profile) return toast("请先选择任务和 Agent。", "warning");
    if (!profile.available && isTauri())
      return toast(`未检测到 ${profile.displayName},请先安装或配置 PATH。`, "warning");
    setLaunching(true);
    try {
      let initialPrompt: string | undefined;
      try {
        const ctx = await ipc.buildAgentStartupContext({ taskId: task.id, agentKind: profile.kind, profileId: profile.id });
        initialPrompt = ctx?.prompt;
      } catch {
        /* 预览环境无上下文,忽略 */
      }
      const s = await ipc.startAgentSession({
        taskId: task.id,
        profileId: profile.id,
        cwd: cwd.trim() || undefined,
        initialPrompt,
        autoIngest: true,
        rows: termRef.current?.rows,
        cols: termRef.current?.cols,
      });
      upsertSession(s);
      await attach(s);
      toast(`${profile.displayName} 已启动并绑定任务 ${task.id}。`, "success");
    } catch {
      toast("启动 Agent 失败,请检查 CLI 是否安装、工作目录是否存在。", "error");
    } finally {
      setLaunching(false);
    }
  };

  const sendLine = async () => {
    if (!active || !input.trim()) return;
    await ipc.sendAgentInput(active.id, `${input}\r\n`);
    setInput("");
  };

  const resolve = async (id: string, approve: boolean) => {
    try {
      await ipc.gateResolvePending(id, approve);
      useStore.getState().removePending(id);
      toast(approve ? "已放行,命令写入 Shell。" : "已拦截,命令未进入 Shell。", approve ? "success" : "info");
    } catch {
      toast("裁决失败。", "error");
    }
  };

  const stop = async () => {
    if (!active) return;
    try {
      const s = await ipc.stopAgentSession(active.id);
      setActive(s);
      upsertSession(s);
      toast("Agent 会话已停止。", "info");
    } catch {
      toast("停止会话失败。", "error");
    }
  };

  return (
    <div>
      <Kicker badge="出口 ③">运行时海关 · PTY 坐在 Agent 与 Shell 之间</Kicker>
      <PageTitle sub="规则会被模型遗忘,但不会被网关遗忘。左侧启动会话,危险命令会被扣在裁决线上等你放行或拦截。">
        Agents 控制台
      </PageTitle>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        {/* 左:启动 + 会话列表 */}
        <div className="space-y-4">
          <Panel className="space-y-3 p-4">
            <h3 className="font-mono text-[11px] tracking-kicker text-ink/45">启动会话</h3>
            <Field label="Agent">
              <div className="grid grid-cols-1 gap-1.5">
                {profiles.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setProfileId(p.id)}
                    className={cx(
                      "flex items-center justify-between rounded-lg border px-3 py-2 text-left text-[13px] transition-colors",
                      profileId === p.id ? "border-orange/50 bg-orange/[0.06]" : "border-ink/10 hover:border-ink/25",
                    )}
                  >
                    <span className="text-ink/85">{p.displayName}</span>
                    <span className={cx("font-mono text-[9.5px]", p.available ? "text-green" : "text-red")}>
                      {p.available ? "READY" : "MISSING"}
                    </span>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="绑定任务">
              <select value={taskId} onChange={(e) => setTaskId(e.target.value)} className={inputCls}>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id} className="bg-panel">
                    {t.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="工作目录 cwd" hint="留空则用应用启动目录">
              <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="D:/repo" className={inputCls} />
            </Field>
            <Button variant="primary" className="w-full" onClick={launch} disabled={launching}>
              {launching ? <Spinner /> : <Play className="h-4 w-4" />}
              {launching ? "启动中…" : "启动 Agent"}
            </Button>
          </Panel>

          <Panel className="p-4">
            <h3 className="mb-3 font-mono text-[11px] tracking-kicker text-ink/45">会话</h3>
            <div className="space-y-1.5">
              {sessions.length === 0 && <p className="py-4 text-center text-[12px] text-ink/35">还没有会话</p>}
              {sessions.map((s) => {
                const t = tasks.find((x) => x.id === s.taskId);
                return (
                  <button
                    key={s.id}
                    onClick={() => attach(s)}
                    className={cx(
                      "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                      active?.id === s.id ? "border-orange/40 bg-ink/[0.03]" : "border-ink/10 hover:border-ink/25",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10.5px] text-ink/40">{s.agentId}</span>
                      <Badge tone={sessionTone(s.status)}>{SESSION_STATUS_LABEL[s.status]}</Badge>
                    </div>
                    <p className="mt-1 truncate text-[12.5px] text-ink/80">{t?.title || s.taskId}</p>
                  </button>
                );
              })}
            </div>
          </Panel>
        </div>

        {/* 右:终端 + 裁决条 */}
        <Panel className="flex flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 bg-panel2 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="rec-dot" />
              <span className="font-mono text-[11px] tracking-wide text-ink/55">
                FLIGHT RECORDER · {active ? active.commandLine : "未附着会话"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {budget?.enabled && (
                <div className="flex items-center gap-2">
                  <div className="w-24">
                    <Meter ratio={budget.ratio} tone={budget.breakerTripped ? "red" : budget.ratio > 0.8 ? "amber" : "green"} />
                  </div>
                  <span className="font-mono text-[10px] text-ink/45">
                    {humanTokens(budget.usedTokens)}/{humanTokens(budget.maxSessionTokens)}
                  </span>
                </div>
              )}
              <Button
                variant="danger"
                className="px-3 py-1.5 text-[12px]"
                onClick={stop}
                disabled={!active || ["exited", "killed", "failed"].includes(active.status)}
              >
                <Square className="h-3 w-3" />
                停止
              </Button>
            </div>
          </div>

          {/* 裁决条 */}
          {activePending.length > 0 && (
            <div className="space-y-2 border-b border-ink/10 bg-red/[0.05] px-4 py-3">
              {activePending.map((p) => (
                <div key={p.id} className="animate-slide-down rounded-lg border border-red/40 bg-panel px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-red" />
                    <span className="font-mono text-[11px] tracking-wide text-red">运行时裁决线 · POLICY GATE</span>
                    <Badge tone="red" className="ml-auto">
                      {p.ruleId}
                    </Badge>
                  </div>
                  <code className="mt-2 block break-all font-mono text-[12.5px] text-ink/90">$ {p.commandText}</code>
                  <p className="mt-1 text-[12px] text-ink/50">{p.reason}</p>
                  <div className="mt-2.5 flex gap-2">
                    <Button variant="primary" className="px-4 py-1.5 text-[12px]" onClick={() => resolve(p.id, true)}>
                      <Check className="h-3.5 w-3.5" /> 放行
                    </Button>
                    <Button variant="danger" className="px-4 py-1.5 text-[12px]" onClick={() => resolve(p.id, false)}>
                      <X className="h-3.5 w-3.5" /> 拦截
                    </Button>
                    <span className="ml-auto self-center font-mono text-[10px] text-ink/30">不处理则默认拦截</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="xterm-host bg-panel2 p-1">
            <div ref={hostRef} className="h-[440px] w-full overflow-hidden rounded" />
          </div>

          <div className="flex gap-2 border-t border-ink/10 p-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendLine()}
              disabled={!active}
              placeholder="向当前 Agent 发送一行命令(会过海关裁决)…"
              className={cx(inputCls, "flex-1")}
            />
            <Button variant="primary" onClick={sendLine} disabled={!active || !input.trim()}>
              <Send className="h-4 w-4" /> 发送
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
