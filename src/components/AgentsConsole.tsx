import { useEffect, useMemo, useRef, useState } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {
  Activity,
  Bot,
  Circle,
  Folder,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Square,
  TerminalSquare
} from 'lucide-react';
import {
  AgentProfile,
  AgentSession,
  AppTab,
  ParsedEventPayload,
  SessionStatusPayload,
  Task,
  TerminalChunk,
  TerminalChunkPayload
} from '../types';
import { ipc } from '../lib/ipc';

interface AgentsConsoleProps {
  tasks: Task[];
  searchQuery: string;
  statusFilter: string;
  setCurrentTab: (tab: AppTab) => void;
  addToast: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

const isTauriRuntime = () =>
  typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;

const statusText: Record<string, string> = {
  running: '运行中',
  starting: '启动中',
  waiting: '等待输入',
  blocked: '阻塞',
  exited: '已退出',
  killed: '已停止',
  failed: '失败'
};

const statusClass: Record<string, string> = {
  running: 'text-[#10b981] bg-[#10b981]/10',
  starting: 'text-[#3b82f6] bg-[#3b82f6]/10',
  waiting: 'text-[#f59e0b] bg-[#f59e0b]/10',
  blocked: 'text-[#f59e0b] bg-[#f59e0b]/10',
  exited: 'text-[#64748b] bg-[#64748b]/10',
  killed: 'text-[#64748b] bg-[#64748b]/10',
  failed: 'text-[#ef4444] bg-[#ef4444]/10'
};

export default function AgentsConsole({
  tasks,
  searchQuery,
  statusFilter,
  setCurrentTab,
  addToast
}: AgentsConsoleProps) {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [activeSession, setActiveSession] = useState<AgentSession | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState('codex');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [cwd, setCwd] = useState('');
  const [manualPrompt, setManualPrompt] = useState('');
  const [inputText, setInputText] = useState('');
  const [launching, setLaunching] = useState(false);
  const [loading, setLoading] = useState(false);

  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) || tasks[0],
    [selectedTaskId, tasks]
  );
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);

  const filteredSessions = sessions.filter((session) => {
    const q = searchQuery.toLowerCase();
    const task = tasks.find((item) => item.id === session.taskId);
    const matchesSearch =
      !q ||
      session.id.toLowerCase().includes(q) ||
      session.agentId.toLowerCase().includes(q) ||
      session.commandLine.toLowerCase().includes(q) ||
      (task?.title || '').toLowerCase().includes(q);

    let matchesStatus = true;
    if (statusFilter !== '全部状态') {
      const map: Record<string, string> = {
        运行中: 'running',
        等待输入: 'waiting',
        已退出: 'exited'
      };
      matchesStatus = session.status === map[statusFilter];
    }

    return matchesSearch && matchesStatus;
  });

  const refreshAgents = async () => {
    setLoading(true);
    try {
      const [detected, runningSessions] = await Promise.all([
        ipc.detect_agents(),
        ipc.list_agent_sessions()
      ]);
      setProfiles(detected);
      setSessions(runningSessions);
      if (!selectedProfileId && detected[0]) setSelectedProfileId(detected[0].id);
      if (!selectedTaskId && tasks[0]) setSelectedTaskId(tasks[0].id);
    } catch (error) {
      console.error(error);
      addToast('Agent Runtime 状态读取失败。', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAgents();
  }, []);

  useEffect(() => {
    if (!selectedTaskId && tasks[0]) setSelectedTaskId(tasks[0].id);
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    activeSessionIdRef.current = activeSession?.id || null;
  }, [activeSession?.id]);

  useEffect(() => {
    if (!terminalHostRef.current || terminalRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      fontSize: 12,
      rows: 24,
      theme: {
        background: '#111315',
        foreground: '#e6e8ea',
        cursor: '#ffffff',
        selectionBackground: '#3b82f655'
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalHostRef.current);
    fitAddon.fit();
    terminal.writeln('AEL Agent Terminal ready.');
    terminal.writeln('Select or launch a session to attach.');

    terminal.onData((data) => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return;
      ipc.send_agent_input({ sessionId, text: data }).catch((error) => {
        console.error(error);
        addToast('发送终端输入失败。', 'error');
      });
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const onResize = () => {
      fitAddon.fit();
      const sessionId = activeSessionIdRef.current;
      if (sessionId) {
        ipc.resize_agent_terminal({
          sessionId,
          cols: terminal.cols,
          rows: terminal.rows
        }).catch(() => {});
      }
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [addToast]);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    const cleanups: UnlistenFn[] = [];
    Promise.all([
      listen<TerminalChunkPayload>('agent://terminal-chunk', (event) => {
        const payload = event.payload;
        if (payload.sessionId === activeSessionIdRef.current) {
          writeChunk(payload.chunk);
        }
      }),
      listen<SessionStatusPayload>('agent://session-status', (event) => {
        const { session } = event.payload;
        setSessions((prev) => {
          const exists = prev.some((item) => item.id === session.id);
          return exists
            ? prev.map((item) => (item.id === session.id ? session : item))
            : [session, ...prev];
        });
        setActiveSession((current) => (current?.id === session.id ? session : current));
      }),
      listen<ParsedEventPayload>('agent://parsed-event', (event) => {
        addToast(`已沉淀事件：${event.payload.event.summary}`, 'info');
      })
    ]).then((items) => cleanups.push(...items));

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [addToast]);

  const writeChunk = (chunk: TerminalChunk) => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    if (chunk.direction === 'system') {
      terminal.write(`\x1b[38;5;39m${chunk.text}\x1b[0m`);
    } else {
      terminal.write(chunk.text);
    }
  };

  const attachSession = async (session: AgentSession) => {
    setActiveSession(session);
    try {
      const snapshot = await ipc.get_agent_snapshot({ sessionId: session.id });
      terminalRef.current?.clear();
      snapshot.chunks.forEach(writeChunk);
      fitAddonRef.current?.fit();
    } catch (error) {
      console.error(error);
      addToast('读取 session transcript 失败。', 'error');
    }
  };

  const buildStartupPrompt = async () => {
    if (!selectedTask) return manualPrompt;

    const goal = selectedTask.description || selectedTask.goal || selectedTask.title;
    const [guard, skills] = await Promise.all([
      ipc.check_failure_guard({ goal, tags: selectedTask.tags }),
      ipc.search_skills({ query: goal, limit: 5 })
    ]);

    const constraints = guard.constraints.length
      ? guard.constraints.map((item, index) => `${index + 1}. ${item}`).join('\n')
      : '无历史失败约束命中。';
    const skillText = skills.length
      ? skills.map((skill, index) => `${index + 1}. ${skill.name}: ${skill.trigger}`).join('\n')
      : '无推荐 Skill。';

    return [
      'AEL AGENT STARTUP CONTEXT',
      '',
      `Task ID: ${selectedTask.id}`,
      `Title: ${selectedTask.title}`,
      `Goal: ${goal}`,
      `Tags: ${(selectedTask.tags || []).join(', ') || 'none'}`,
      '',
      'Failure Guard constraints:',
      constraints,
      '',
      'Suggested reusable skills:',
      skillText,
      '',
      'Operating rules:',
      '- Work inside the selected cwd/repository.',
      '- Report errors, fixes, decisions, and verification clearly; AEL will ingest terminal output into the task evidence chain.',
      '- If blocked, state the blocker and the next required input.',
      '',
      manualPrompt.trim() ? `User launch note:\n${manualPrompt.trim()}` : '',
      ''
    ]
      .filter(Boolean)
      .join('\n');
  };

  const startSession = async () => {
    if (!selectedTask || !selectedProfile) {
      addToast('请先选择任务和 Agent。', 'warning');
      return;
    }
    if (!selectedProfile.available && isTauriRuntime()) {
      addToast(`未检测到 ${selectedProfile.displayName}，请先安装或配置 PATH。`, 'warning');
      return;
    }

    setLaunching(true);
    try {
      const initialPrompt = await buildStartupPrompt();
      const session = await ipc.start_agent_session({
        taskId: selectedTask.id,
        profileId: selectedProfile.id,
        cwd: cwd.trim() || undefined,
        initialPrompt,
        autoIngest: true,
        rows: terminalRef.current?.rows,
        cols: terminalRef.current?.cols
      });
      setSessions((prev) => [session, ...prev.filter((item) => item.id !== session.id)]);
      await attachSession(session);
      addToast(`${selectedProfile.displayName} 已启动并绑定到任务 ${selectedTask.id}。`, 'success');
    } catch (error) {
      console.error(error);
      addToast('启动 Agent 失败，请检查 CLI 是否安装、工作目录是否存在。', 'error');
    } finally {
      setLaunching(false);
    }
  };

  const sendLine = async () => {
    if (!activeSession || !inputText.trim()) return;
    const text = `${inputText}\r\n`;
    await ipc.send_agent_input({ sessionId: activeSession.id, text });
    setInputText('');
  };

  const sendHandoverPrompt = async () => {
    if (!activeSession) return;
    try {
      const result = await ipc.generate_handover_prompt({ taskId: activeSession.taskId });
      await ipc.send_agent_input({
        sessionId: activeSession.id,
        text: `${result.prompt}\r\n`
      });
      addToast('接手 Prompt 已发送到当前 Agent。', 'success');
    } catch (error) {
      console.error(error);
      addToast('发送接手 Prompt 失败。', 'error');
    }
  };

  const stopSession = async () => {
    if (!activeSession) return;
    try {
      const stopped = await ipc.stop_agent_session({
        sessionId: activeSession.id,
        killTree: true
      });
      setActiveSession(stopped);
      setSessions((prev) => prev.map((item) => (item.id === stopped.id ? stopped : item)));
      addToast('Agent session 已停止。', 'info');
    } catch (error) {
      console.error(error);
      addToast('停止 Agent session 失败。', 'error');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4 border-b border-[#E2E8F0] pb-6">
        <div>
          <h2 className="font-sans text-xl font-bold text-black mb-1">Agent 控制台</h2>
          <p className="font-sans text-xs text-[#747878] max-w-3xl leading-relaxed">
            统一启动 Codex、Claude Code 与其他 CLI，实时读取终端上下文，并把输出沉淀到 AEL 任务证据链。
          </p>
        </div>
        <button
          onClick={refreshAgents}
          className="px-4 py-2 border border-[#E2E8F0] rounded font-sans text-xs font-semibold text-black hover:bg-[#f2f4f6] flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          重新检测
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-6">
        <div className="space-y-4">
          <section className="glass-card rounded-xl p-4 space-y-3">
            <h3 className="font-sans text-xs font-bold text-black uppercase flex items-center gap-2">
              <Bot className="w-4 h-4" />
              可用 Agent
            </h3>
            <div className="space-y-2">
              {profiles.map((profile) => (
                <button
                  key={profile.id}
                  onClick={() => setSelectedProfileId(profile.id)}
                  className={`w-full text-left border rounded p-3 transition-colors ${
                    selectedProfileId === profile.id
                      ? 'border-black bg-[#f2f4f6]'
                      : 'border-[#E2E8F0] hover:border-black'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-sans text-sm font-bold text-black">
                      {profile.displayName}
                    </span>
                    <span
                      className={`font-mono text-[10px] px-2 py-0.5 rounded ${
                        profile.available
                          ? 'text-[#10b981] bg-[#10b981]/10'
                          : 'text-[#ef4444] bg-[#ef4444]/10'
                      }`}
                    >
                      {profile.available ? 'READY' : 'MISSING'}
                    </span>
                  </div>
                  <p className="font-mono text-[10px] text-[#747878] mt-2 truncate">
                    {profile.version || profile.path || profile.executable}
                  </p>
                </button>
              ))}
            </div>
          </section>

          <section className="glass-card rounded-xl p-4 space-y-3">
            <h3 className="font-sans text-xs font-bold text-black uppercase flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              启动上下文
            </h3>
            <label className="block space-y-1">
              <span className="font-sans text-[11px] font-bold text-[#747878] uppercase">绑定任务</span>
              <select
                value={selectedTask?.id || ''}
                onChange={(event) => setSelectedTaskId(event.target.value)}
                className="w-full border border-[#E2E8F0] rounded p-2 text-sm bg-[#f2f4f6] text-black"
              >
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="font-sans text-[11px] font-bold text-[#747878] uppercase">工作目录 cwd</span>
              <div className="flex items-center gap-2">
                <Folder className="w-4 h-4 text-[#747878]" />
                <input
                  value={cwd}
                  onChange={(event) => setCwd(event.target.value)}
                  placeholder="留空则使用应用启动目录"
                  className="w-full border border-[#E2E8F0] rounded p-2 text-sm bg-[#f2f4f6] text-black"
                />
              </div>
            </label>
            <label className="block space-y-1">
              <span className="font-sans text-[11px] font-bold text-[#747878] uppercase">额外启动说明</span>
              <textarea
                value={manualPrompt}
                onChange={(event) => setManualPrompt(event.target.value)}
                rows={4}
                placeholder="例如：先检查 git status，再实施最小改动。"
                className="w-full border border-[#E2E8F0] rounded p-2 text-sm bg-[#f2f4f6] text-black resize-none"
              />
            </label>
            <button
              onClick={startSession}
              disabled={launching || !selectedTask || !selectedProfile}
              className="w-full px-4 py-2 bg-black text-white rounded font-sans text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              {launching ? '启动中...' : '启动 Agent'}
            </button>
          </section>

          <section className="glass-card rounded-xl p-4 space-y-3">
            <h3 className="font-sans text-xs font-bold text-black uppercase flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Sessions
            </h3>
            <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
              {filteredSessions.map((session) => {
                const task = tasks.find((item) => item.id === session.taskId);
                const active = activeSession?.id === session.id;
                return (
                  <button
                    key={session.id}
                    onClick={() => attachSession(session)}
                    className={`w-full text-left border rounded p-3 transition-colors ${
                      active ? 'border-black bg-[#f2f4f6]' : 'border-[#E2E8F0] hover:border-black'
                    }`}
                  >
                    <div className="flex justify-between items-center gap-2">
                      <span className="font-mono text-[10px] text-[#747878]">
                        {session.agentId}
                      </span>
                      <span
                        className={`font-mono text-[10px] px-2 py-0.5 rounded ${
                          statusClass[session.status] || 'bg-[#64748b]/10 text-[#64748b]'
                        }`}
                      >
                        {statusText[session.status] || session.status}
                      </span>
                    </div>
                    <p className="font-sans text-xs font-bold text-black mt-1 truncate">
                      {task?.title || session.taskId}
                    </p>
                    <p className="font-mono text-[10px] text-[#747878] mt-1 truncate">
                      {session.commandLine}
                    </p>
                  </button>
                );
              })}
              {filteredSessions.length === 0 && (
                <div className="border border-dashed border-[#E2E8F0] rounded p-6 text-center text-xs text-[#747878]">
                  还没有 Agent session。
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="min-w-0 space-y-4">
          <section className="glass-card rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <TerminalSquare className="w-4 h-4 text-black" />
                <div>
                  <h3 className="font-sans text-sm font-bold text-black">
                    {activeSession ? activeSession.commandLine : '未附着 session'}
                  </h3>
                  <p className="font-mono text-[10px] text-[#747878]">
                    {activeSession ? activeSession.cwd : '启动或选择一个 Agent session'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {activeSession && (
                  <span
                    className={`font-mono text-[10px] px-2 py-1 rounded flex items-center gap-1 ${
                      statusClass[activeSession.status] || 'bg-[#64748b]/10 text-[#64748b]'
                    }`}
                  >
                    <Circle className="w-2 h-2 fill-current" />
                    {statusText[activeSession.status] || activeSession.status}
                  </span>
                )}
                <button
                  onClick={sendHandoverPrompt}
                  disabled={!activeSession}
                  className="px-3 py-1.5 border border-[#E2E8F0] rounded text-xs font-semibold text-black disabled:opacity-50 hover:bg-[#f2f4f6]"
                >
                  发送接手 Prompt
                </button>
                <button
                  onClick={stopSession}
                  disabled={!activeSession || ['exited', 'killed', 'failed'].includes(activeSession.status)}
                  className="px-3 py-1.5 border border-[#ef4444]/20 text-[#ef4444] rounded text-xs font-semibold disabled:opacity-50 hover:bg-[#ef4444]/10 flex items-center gap-1"
                >
                  <Square className="w-3 h-3" />
                  停止
                </button>
              </div>
            </div>
            <div className="bg-[#111315] p-2">
              <div ref={terminalHostRef} className="h-[520px] w-full overflow-hidden rounded" />
            </div>
            <div className="p-3 border-t border-[#E2E8F0] flex gap-2">
              <input
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') sendLine();
                }}
                disabled={!activeSession}
                placeholder="向当前 Agent 发送一行输入..."
                className="flex-1 border border-[#E2E8F0] rounded px-3 py-2 text-sm bg-[#f2f4f6] text-black disabled:opacity-50"
              />
              <button
                onClick={sendLine}
                disabled={!activeSession || !inputText.trim()}
                className="px-4 py-2 bg-black text-white rounded text-xs font-semibold disabled:opacity-50 flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                发送
              </button>
            </div>
          </section>

          <section className="glass-card rounded-xl p-4 flex flex-wrap gap-3 text-xs text-[#747878]">
            <button
              onClick={() => setCurrentTab('tasks')}
              className="px-3 py-1.5 border border-[#E2E8F0] rounded text-black hover:bg-[#f2f4f6]"
            >
              查看任务证据链
            </button>
            <span className="leading-7">
              终端输出会实时进入 transcript；完成行会自动解析为 AEL task events。
            </span>
          </section>
        </div>
      </div>
    </div>
  );
}
