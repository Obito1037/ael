import { create } from 'zustand';
import {
  EventKind,
  Failure,
  FailureDefense,
  GuardResult,
  Skill,
  Task,
  TaskEvent,
  TaskStatus,
  TimelineEvent
} from '../types';
import { ipc } from '../lib/ipc';

interface AppState {
  tasks: Task[];
  skills: Skill[];
  failures: FailureDefense[];
  loading: boolean;

  loadData: () => Promise<void>;
  addTask: (task: Omit<Task, 'id' | 'updateTimeAgo' | 'timeline'>) => Promise<void>;
  updateTaskStatus: (id: string, status: TaskStatus) => Promise<void>;
  finalizeTask: (id: string) => Promise<void>;
  appendEvent: (taskId: string, event: Partial<TimelineEvent> & { kind?: EventKind }) => Promise<void>;

  addSkill: (skill: Omit<Skill, 'id'>) => Promise<void>;
  triggerSkill: (id: string) => Promise<void>;

  addFailure: (failure: Omit<FailureDefense, 'id' | 'occurrences'>) => Promise<void>;
  updateFailure: (id: string, failure: FailureDefense) => Promise<void>;
  checkGuard: (goal: string) => Promise<GuardResult>;
}

const formatAge = (value?: string) => {
  if (!value) return '刚刚同步';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '刚刚同步';

  const diffMs = Math.max(0, Date.now() - time);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
};

const formatElapsed = (createdAt?: string, closedAt?: string) => {
  if (!createdAt) return undefined;
  const start = new Date(createdAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined;

  const totalMinutes = Math.floor((end - start) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m`;
};

const eventTypeFromKind = (kind: EventKind) => (kind === 'step' || kind === 'note' ? 'analysis' : kind);

const eventKindFromTimeline = (kind?: string): EventKind => {
  if (
    kind === 'error' ||
    kind === 'fix' ||
    kind === 'verification' ||
    kind === 'decision' ||
    kind === 'note'
  ) {
    return kind;
  }
  return 'step';
};

const eventToTimeline = (event: TaskEvent): TimelineEvent => ({
  id: event.id,
  type: eventTypeFromKind(event.kind),
  title: event.summary,
  timestamp: formatAge(event.createdAt),
  description: event.detail || '',
  extraCode: event.kind === 'error' ? event.evidenceRef : undefined,
  fileAttachment: event.kind !== 'error' ? event.evidenceRef : undefined
});

const taskToUi = (task: Task, events?: TaskEvent[]): Task => ({
  ...task,
  description: task.description || task.goal || '',
  agentName: task.agentName || task.agentId || 'Agent-Alpha',
  priority: task.priority || 'Medium',
  updateTimeAgo: formatAge(task.updatedAt || task.createdAt),
  timeElapsed: task.timeElapsed || formatElapsed(task.createdAt, task.closedAt),
  tags: task.tags || [],
  timeline: events ? events.map(eventToTimeline) : task.timeline || [],
  derivedSkills: task.derivedSkills || [],
  relatedFailuresRef: task.relatedFailuresRef || []
});

const skillToUi = (skill: Skill): Skill => {
  const failCount = skill.failCount ?? skill.failureCount ?? 0;
  return {
    ...skill,
    body: skill.body || '',
    tags: skill.tags || [],
    trigger: skill.trigger || 'manual_invocation',
    version: skill.version || 1,
    successCount: skill.successCount ?? 0,
    failCount,
    failureCount: failCount
  };
};

const failureToUi = (failure: Failure): FailureDefense => ({
  ...failure,
  signature: failure.signature || failure.errorSignature || '',
  description: failure.description || failure.rootCause || '',
  guardRule: failure.guardRule || failure.constraint || '',
  tags: failure.tags || [],
  occurrences: failure.occurrences || 0,
  status: failure.status || 'active',
  name: failure.name || failure.signature || 'Failure Guard',
  errorSignature: failure.errorSignature || failure.signature || '',
  repairMethod: failure.repairMethod || failure.fix || '未定义',
  constraint: failure.constraint || failure.guardRule || '无',
  autoRepairActive: failure.autoRepairActive ?? true,
  upcomingAlertConfigured: failure.upcomingAlertConfigured ?? false
});

export const useStore = create<AppState>((set, get) => ({
  tasks: [],
  skills: [],
  failures: [],
  loading: false,

  loadData: async () => {
    set({ loading: true });
    try {
      const [tasks, skills, failures] = await Promise.all([
        ipc.list_tasks({ limit: 100 }),
        ipc.list_skills({ limit: 100 }),
        ipc.list_failures({ limit: 100 })
      ]);

      const eventsByTask = await Promise.all(
        tasks.map((task) => ipc.list_events({ taskId: task.id }).catch(() => [] as TaskEvent[]))
      );

      set({
        tasks: tasks.map((task, index) => taskToUi(task, eventsByTask[index])),
        skills: skills.map(skillToUi),
        failures: failures.map(failureToUi),
        loading: false
      });
    } catch (error) {
      console.error(error);
      set({ loading: false });
    }
  },

  addTask: async (task) => {
    let created = await ipc.create_task({
      title: task.title,
      goal: task.description || task.goal || task.title,
      agentId: task.agentName,
      repoPath: task.repoPath,
      repoBranch: task.repoBranch,
      repoCommit: task.repoCommit,
      tags: task.tags || []
    });

    if (task.status && created.status !== task.status) {
      created = await ipc.update_task_status({ id: created.id, status: task.status });
    }

    const uiTask = taskToUi({
      ...created,
      description: task.description || created.goal,
      agentName: task.agentName || created.agentId,
      priority: task.priority
    });
    set((state) => ({ tasks: [uiTask, ...state.tasks] }));
  },

  updateTaskStatus: async (id, status) => {
    const updated = await ipc.update_task_status({ id, status });
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? taskToUi({ ...task, ...updated, timeline: task.timeline, priority: task.priority })
          : task
      )
    }));
  },

  finalizeTask: async (id) => {
    const result = await ipc.finalize_task({ id });
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? taskToUi({ ...task, ...result.task, status: 'verified', timeline: task.timeline })
          : task
      ),
      skills: [...result.draftSkills.map(skillToUi), ...state.skills],
      failures: [...result.draftFailures.map(failureToUi), ...state.failures]
    }));
  },

  appendEvent: async (taskId, event) => {
    const saved = await ipc.append_event({
      taskId,
      kind: eventKindFromTimeline(event.kind || event.type),
      summary: event.title || '执行记录',
      detail: event.description,
      evidenceRef: event.fileAttachment || event.extraCode
    });
    const timelineEvent = eventToTimeline(saved);

    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              updateTimeAgo: '刚刚',
              timeline: [...(task.timeline || []), timelineEvent]
            }
          : task
      )
    }));
  },

  addSkill: async (skill) => {
    let created = await ipc.create_skill({
      name: skill.name,
      trigger: skill.trigger,
      body: skill.body || '',
      tags: skill.tags || [],
      sourceTaskId: skill.sourceTaskId
    });

    if (skill.status && created.status !== skill.status) {
      created = await ipc.update_skill_status({ id: created.id, status: skill.status });
    }

    set((state) => ({ skills: [skillToUi(created), ...state.skills] }));
  },

  triggerSkill: async (id) => {
    const taskId =
      get().tasks.find((task) => task.status === 'in_progress')?.id || get().tasks[0]?.id;
    if (taskId) {
      await ipc.record_skill_usage({ skillId: id, taskId, outcome: 'helped' }).catch(() => {});
    }

    set((state) => ({
      skills: state.skills.map((skill) =>
        skill.id === id
          ? {
              ...skill,
              successCount:
                typeof skill.successCount === 'number' ? skill.successCount + 1 : 1
            }
          : skill
      )
    }));
  },

  addFailure: async (failure) => {
    const nowId = `fail-${Date.now()}`;
    const created = failureToUi({
      ...failure,
      id: nowId,
      signature: failure.signature || failure.errorSignature || failure.name || nowId,
      description: failure.description || '',
      guardRule: failure.guardRule || failure.constraint || '',
      tags: failure.tags || [],
      occurrences: 0
    });
    set((state) => ({ failures: [created, ...state.failures] }));
  },

  updateFailure: async (id, failure) => {
    set((state) => ({
      failures: state.failures.map((item) => (item.id === id ? failureToUi(failure) : item))
    }));
  },

  checkGuard: async (goal) => {
    const result = await ipc.check_failure_guard({ goal });
    return {
      ...result,
      matchedFailures: result.matchedFailures.map(failureToUi),
      suggestedSkills: (result.suggestedSkills || []).map(skillToUi)
    };
  }
}));
