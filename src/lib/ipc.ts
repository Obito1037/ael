import { invoke } from '@tauri-apps/api/core';
import {
  EventKind,
  Failure,
  FinalizeResult,
  AgentProfile,
  AgentSession,
  AgentSnapshot,
  GuardResult,
  HandoverInclude,
  RankedSkill,
  Settings,
  Skill,
  SkillStatus,
  SkillUsageOutcome,
  Task,
  TaskEvent,
  TaskStatus,
  TerminalChunk,
  WorkspaceLock
} from '../types';
import { INITIAL_FAILURES, INITIAL_SKILLS, INITIAL_TASKS } from '../data';

const isTauri = () =>
  typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;

let MOCK_TASKS: Task[] = [...(INITIAL_TASKS as Task[])];
let MOCK_EVENTS: TaskEvent[] = INITIAL_TASKS.flatMap((task) =>
  (task.timeline || []).map((event, index) => ({
    id: event.id,
    taskId: task.id,
    seq: index + 1,
    kind: event.type === 'error' ? 'error' : event.type === 'fix' ? 'fix' : 'step',
    summary: event.title,
    detail: event.description,
    createdAt: new Date().toISOString()
  }))
);
let MOCK_SKILLS: Skill[] = [...(INITIAL_SKILLS as Skill[])];
let MOCK_FAILURES: Failure[] = [...(INITIAL_FAILURES as Failure[])];
let MOCK_AGENT_SESSIONS: AgentSession[] = [];
let MOCK_TERMINAL_CHUNKS: TerminalChunk[] = [];

const byUpdatedDesc = (a: Task, b: Task) =>
  new Date(b.updatedAt || b.createdAt || 0).getTime() -
  new Date(a.updatedAt || a.createdAt || 0).getTime();

export const ipc = {
  async create_task(args: {
    title: string;
    goal: string;
    agentId?: string;
    repoPath?: string;
    repoBranch?: string;
    repoCommit?: string;
    tags?: string[];
  }): Promise<Task> {
    if (isTauri()) return invoke('create_task', args);

    const now = new Date().toISOString();
    const task: Task = {
      id: `TSK-${Date.now()}`,
      title: args.title,
      goal: args.goal,
      status: 'in_progress',
      agentId: args.agentId || 'Agent-Alpha',
      repoPath: args.repoPath,
      repoBranch: args.repoBranch,
      repoCommit: args.repoCommit,
      tags: args.tags || [],
      createdAt: now,
      updatedAt: now
    };
    MOCK_TASKS = [task, ...MOCK_TASKS];
    return task;
  },

  async get_task(args: { id: string }): Promise<Task> {
    if (isTauri()) return invoke('get_task', args);
    const task = MOCK_TASKS.find((item) => item.id === args.id);
    if (!task) throw new Error('Task not found');
    return task;
  },

  async list_tasks(args?: {
    status?: TaskStatus;
    limit?: number;
    offset?: number;
  }): Promise<Task[]> {
    if (isTauri()) return invoke('list_tasks', args || {});
    let result = [...MOCK_TASKS].sort(byUpdatedDesc);
    if (args?.status) result = result.filter((task) => task.status === args.status);
    const offset = args?.offset || 0;
    return result.slice(offset, offset + (args?.limit || result.length));
  },

  async update_task_status(args: { id: string; status: TaskStatus }): Promise<Task> {
    if (isTauri()) return invoke('update_task_status', args);
    const task = MOCK_TASKS.find((item) => item.id === args.id);
    if (!task) throw new Error('Task not found');
    task.status = args.status;
    task.updatedAt = new Date().toISOString();
    if (args.status === 'verified') task.closedAt = task.updatedAt;
    return task;
  },

  async append_event(args: {
    taskId: string;
    kind: EventKind;
    summary: string;
    detail?: string;
    evidenceRef?: string;
  }): Promise<TaskEvent> {
    if (isTauri()) return invoke('append_event', args);

    const events = MOCK_EVENTS.filter((event) => event.taskId === args.taskId);
    const event: TaskEvent = {
      id: `EV-${Date.now()}`,
      taskId: args.taskId,
      seq: events.length + 1,
      kind: args.kind,
      summary: args.summary,
      detail: args.detail,
      evidenceRef: args.evidenceRef,
      createdAt: new Date().toISOString()
    };
    MOCK_EVENTS = [...MOCK_EVENTS, event];
    return event;
  },

  async list_events(args: { taskId: string }): Promise<TaskEvent[]> {
    if (isTauri()) return invoke('list_events', args);
    return MOCK_EVENTS.filter((event) => event.taskId === args.taskId).sort(
      (a, b) => a.seq - b.seq
    );
  },

  async finalize_task(args: { id: string }): Promise<FinalizeResult> {
    if (isTauri()) return invoke('finalize_task', args);

    const task = MOCK_TASKS.find((item) => item.id === args.id);
    if (!task) throw new Error('Task not found');
    task.status = 'verified';
    task.updatedAt = new Date().toISOString();
    task.closedAt = task.updatedAt;

    const newSkill: Skill = {
      id: `SKILL-${Date.now()}`,
      name: `Draft Skill from ${task.title}`,
      trigger: 'When a similar task appears',
      body: 'Reuse the verified steps recorded in the evidence chain.',
      tags: task.tags || [],
      sourceTaskId: task.id,
      status: 'draft',
      version: 1,
      successCount: 0,
      failCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    MOCK_SKILLS = [newSkill, ...MOCK_SKILLS];
    return { task, draftSkills: [newSkill], draftFailures: [] };
  },

  async list_skills(args?: {
    status?: SkillStatus;
    limit?: number;
    offset?: number;
  }): Promise<Skill[]> {
    if (isTauri()) return invoke('list_skills', args || {});
    let result = [...MOCK_SKILLS];
    if (args?.status) result = result.filter((skill) => skill.status === args.status);
    const offset = args?.offset || 0;
    return result.slice(offset, offset + (args?.limit || result.length));
  },

  async get_skill(args: { id: string }): Promise<Skill> {
    if (isTauri()) return invoke('get_skill', args);
    const skill = MOCK_SKILLS.find((item) => item.id === args.id);
    if (!skill) throw new Error('Skill not found');
    return skill;
  },

  async create_skill(args: {
    name: string;
    trigger: string;
    body: string;
    tags?: string[];
    sourceTaskId?: string;
  }): Promise<Skill> {
    if (isTauri()) return invoke('create_skill', args);

    const now = new Date().toISOString();
    const skill: Skill = {
      id: `SKILL-${Date.now()}`,
      name: args.name,
      trigger: args.trigger,
      body: args.body,
      tags: args.tags || [],
      sourceTaskId: args.sourceTaskId,
      status: 'draft',
      version: 1,
      successCount: 0,
      failCount: 0,
      createdAt: now,
      updatedAt: now
    };
    MOCK_SKILLS = [skill, ...MOCK_SKILLS];
    return skill;
  },

  async update_skill(args: {
    id: string;
    name?: string;
    trigger?: string;
    body?: string;
    tags?: string[];
  }): Promise<Skill> {
    if (isTauri()) return invoke('update_skill', args);

    const skill = MOCK_SKILLS.find((item) => item.id === args.id);
    if (!skill) throw new Error('Skill not found');
    Object.assign(skill, args, { updatedAt: new Date().toISOString() });
    return skill;
  },

  async update_skill_status(args: { id: string; status: SkillStatus }): Promise<Skill> {
    if (isTauri()) return invoke('update_skill_status', args);

    const skill = MOCK_SKILLS.find((item) => item.id === args.id);
    if (!skill) throw new Error('Skill not found');
    skill.status = args.status;
    skill.updatedAt = new Date().toISOString();
    return skill;
  },

  async record_skill_usage(args: {
    skillId: string;
    taskId: string;
    outcome: SkillUsageOutcome;
  }): Promise<void> {
    if (isTauri()) return invoke('record_skill_usage', args);

    const skill = MOCK_SKILLS.find((item) => item.id === args.skillId);
    if (!skill) return;
    if (args.outcome === 'harmful') {
      skill.failCount = typeof skill.failCount === 'number' ? skill.failCount + 1 : 1;
    } else if (args.outcome === 'helped') {
      skill.successCount =
        typeof skill.successCount === 'number' ? skill.successCount + 1 : 1;
    }
  },

  async search_skills(args: {
    query: string;
    status?: SkillStatus;
    limit?: number;
  }): Promise<Skill[]> {
    if (isTauri()) {
      const ranked = await invoke<RankedSkill[]>('search_skills', args);
      return ranked.map((item) => item.skill);
    }

    const query = args.query.toLowerCase();
    return MOCK_SKILLS.filter(
      (skill) =>
        skill.name.toLowerCase().includes(query) ||
        skill.trigger.toLowerCase().includes(query) ||
        (skill.body || '').toLowerCase().includes(query)
    ).slice(0, args.limit || 20);
  },

  async list_failures(args?: { limit?: number; offset?: number }): Promise<Failure[]> {
    if (isTauri()) return invoke('list_failures', args || {});
    const offset = args?.offset || 0;
    return MOCK_FAILURES.slice(offset, offset + (args?.limit || MOCK_FAILURES.length));
  },

  async get_failure(args: { id: string }): Promise<Failure> {
    if (isTauri()) return invoke('get_failure', args);
    const failure = MOCK_FAILURES.find((item) => item.id === args.id);
    if (!failure) throw new Error('Failure not found');
    return failure;
  },

  async check_failure_guard(args: { goal: string; tags?: string[] }): Promise<GuardResult> {
    if (isTauri()) return invoke('check_failure_guard', args);

    const goal = args.goal.toLowerCase();
    const matchedFailures = MOCK_FAILURES.filter((failure) => {
      const signature = failure.signature || failure.errorSignature || '';
      const tagHit = (failure.tags || []).some((tag) => goal.includes(tag.toLowerCase()));
      const searchable = [
        signature,
        failure.name,
        failure.description,
        failure.guardRule,
        failure.constraint,
        failure.repairMethod,
        ...(failure.tags || [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const tokenHit = goal
        .split(/[^a-z0-9_\u4e00-\u9fa5]+/i)
        .filter((token) => token.length >= 3)
        .some((token) => searchable.includes(token));

      return tagHit || tokenHit || (!!signature && goal.includes(signature.toLowerCase()));
    });

    return {
      matchedFailures,
      suggestedSkills: [],
      constraints: matchedFailures.map(
        (failure) => failure.guardRule || failure.constraint || 'Review this known failure before starting.'
      ),
      handoverPrompt: matchedFailures.length
        ? 'A similar failure has been seen before. Inject the listed guard rules before starting.'
        : ''
    };
  },

  async export_handover(args: {
    taskId: string;
    include?: HandoverInclude;
  }): Promise<{ path: string }> {
    if (isTauri()) return invoke('export_handover', args);
    return { path: `mock://handovers/${args.taskId}.zip` };
  },

  async import_handover(args: { path: string }): Promise<{ taskId: string }> {
    if (isTauri()) return invoke('import_handover', args);
    return { taskId: args.path.split('/').pop()?.replace('.zip', '') || 'GLOBAL' };
  },

  async generate_handover_prompt(args: { taskId: string }): Promise<{ prompt: string }> {
    if (isTauri()) return invoke('generate_handover_prompt', args);
    return {
      prompt: `Continue task ${args.taskId}. Review the evidence chain, active skills, and failure guards before making changes.`
    };
  },

  async get_settings(): Promise<Settings> {
    if (isTauri()) return invoke('get_settings');
    return {
      dataDir: '.ael',
      maxBackups: 10,
      retrievalMode: 'hybrid',
      guardMinScore: 0.2
    };
  },

  async set_settings(args: Partial<Settings>): Promise<Settings> {
    if (isTauri()) return invoke('set_settings', args);
    return {
      dataDir: args.dataDir || '.ael',
      maxBackups: args.maxBackups || 10,
      retrievalMode: args.retrievalMode || 'hybrid',
      guardMinScore: args.guardMinScore ?? 0.2
    };
  },

  async backup_now(): Promise<{ path: string }> {
    if (isTauri()) return invoke('backup_now');
    return { path: 'mock://backups/ael.sqlite3.zip' };
  },

  async detect_agents(): Promise<AgentProfile[]> {
    if (isTauri()) return invoke('detect_agents');
    return [
      {
        id: 'codex',
        kind: 'codex',
        displayName: 'Codex CLI',
        executable: 'codex',
        defaultArgs: [],
        available: true,
        version: 'browser-preview',
        path: 'mock://codex'
      },
      {
        id: 'claude_code',
        kind: 'claude_code',
        displayName: 'Claude Code',
        executable: 'claude',
        defaultArgs: [],
        available: true,
        version: 'browser-preview',
        path: 'mock://claude'
      },
      {
        id: 'shell',
        kind: 'shell',
        displayName: 'Shell',
        executable: 'shell',
        defaultArgs: [],
        available: true,
        version: 'browser-preview',
        path: 'mock://shell'
      }
    ];
  },

  async start_agent_session(args: {
    taskId: string;
    profileId: string;
    cwd?: string;
    args?: string[];
    initialPrompt?: string;
    executable?: string;
    rows?: number;
    cols?: number;
    autoIngest?: boolean;
    lockWorkspace?: boolean;
  }): Promise<AgentSession> {
    if (isTauri()) return invoke('start_agent_session', args);

    const now = new Date().toISOString();
    const session: AgentSession = {
      id: `AGENT-${Date.now()}`,
      taskId: args.taskId,
      profileId: args.profileId,
      agentId: args.profileId,
      status: 'running',
      cwd: args.cwd || '.',
      commandLine: `${args.profileId} ${(args.args || []).join(' ')}`.trim(),
      startedAt: now,
      updatedAt: now,
      lastSeq: 0
    };
    MOCK_AGENT_SESSIONS = [session, ...MOCK_AGENT_SESSIONS];
    MOCK_TERMINAL_CHUNKS.push({
      sessionId: session.id,
      seq: 1,
      direction: 'system',
      text: 'Browser preview session started. Real Codex/Claude launch is available inside Tauri desktop.\r\n',
      createdAt: now
    });
    if (args.initialPrompt) {
      MOCK_TERMINAL_CHUNKS.push({
        sessionId: session.id,
        seq: 2,
        direction: 'input',
        text: args.initialPrompt,
        createdAt: now
      });
      session.lastSeq = 2;
    } else {
      session.lastSeq = 1;
    }
    return session;
  },

  async send_agent_input(args: { sessionId: string; text: string }): Promise<void> {
    if (isTauri()) return invoke('send_agent_input', args);
    const session = MOCK_AGENT_SESSIONS.find((item) => item.id === args.sessionId);
    if (!session) return;
    session.lastSeq += 1;
    MOCK_TERMINAL_CHUNKS.push({
      sessionId: args.sessionId,
      seq: session.lastSeq,
      direction: 'input',
      text: args.text,
      createdAt: new Date().toISOString()
    });
  },

  async resize_agent_terminal(args: {
    sessionId: string;
    cols: number;
    rows: number;
  }): Promise<void> {
    if (isTauri()) return invoke('resize_agent_terminal', args);
  },

  async stop_agent_session(args: {
    sessionId: string;
    killTree?: boolean;
  }): Promise<AgentSession> {
    if (isTauri()) return invoke('stop_agent_session', args);
    const session = MOCK_AGENT_SESSIONS.find((item) => item.id === args.sessionId);
    if (!session) throw new Error('Session not found');
    session.status = 'killed';
    session.endedAt = new Date().toISOString();
    return session;
  },

  async list_agent_sessions(args?: {
    taskId?: string;
    status?: string;
  }): Promise<AgentSession[]> {
    if (isTauri()) return invoke('list_agent_sessions', args || {});
    return MOCK_AGENT_SESSIONS.filter((session) =>
      args?.taskId ? session.taskId === args.taskId : true
    ).filter((session) => (args?.status ? session.status === args.status : true));
  },

  async get_agent_snapshot(args: { sessionId: string }): Promise<AgentSnapshot> {
    if (isTauri()) return invoke('get_agent_snapshot', args);
    const session = MOCK_AGENT_SESSIONS.find((item) => item.id === args.sessionId);
    if (!session) throw new Error('Session not found');
    return {
      session,
      chunks: MOCK_TERMINAL_CHUNKS.filter((chunk) => chunk.sessionId === args.sessionId)
    };
  },

  async list_terminal_chunks(args: {
    sessionId: string;
    afterSeq?: number;
  }): Promise<TerminalChunk[]> {
    if (isTauri()) return invoke('list_terminal_chunks', args);
    return MOCK_TERMINAL_CHUNKS.filter(
      (chunk) => chunk.sessionId === args.sessionId && chunk.seq > (args.afterSeq || 0)
    );
  },

  async list_workspace_locks(): Promise<WorkspaceLock[]> {
    if (isTauri()) return invoke('list_workspace_locks');
    return MOCK_AGENT_SESSIONS.filter((session) => session.status === 'running').map(
      (session) => ({
        id: `lock-${session.id}`,
        repoPath: session.cwd,
        ownerSessionId: session.id,
        lockKind: 'write',
        createdAt: session.startedAt
      })
    );
  },

  async release_workspace_locks_for_session(args: { sessionId: string }): Promise<number> {
    if (isTauri()) return invoke('release_workspace_locks_for_session', args);
    return 1;
  },

  async list_agent_config_targets(_args?: any): Promise<any[]> { return []; },
  async read_agent_config_target(_args?: any): Promise<any> { return { content: '' }; },
  async write_agent_config_target(_args?: any): Promise<void> {},
  async backup_agent_config_target(_args?: any): Promise<{ backupPath: string }> { return { backupPath: '' }; },
  async list_providers(): Promise<any[]> { return []; },
  async test_provider(_args?: any): Promise<{success: boolean, message: string}> { return {success: true, message: 'OK'}; },
  async save_provider(_args?: any): Promise<void> {},
  async list_mcp_servers(): Promise<any[]> { return []; },
  async save_mcp_server(_args?: any): Promise<void> {},
  async build_agent_startup_context(_args?: any): Promise<any> { return {}; }
};
