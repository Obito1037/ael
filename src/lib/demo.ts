/** Deterministic, local-only simulation. No IPC, storage, network, or command execution. */
export type DemoStage = "prepare" | "learn" | "candidate" | "review" | "recall" | "reuse" | "summary";
export type DemoFixId = "argument-array" | "remove-spaces" | "hardcode-path";
export type DemoTaskId = "related" | "unrelated" | "changed-environment";
export type DemoMemoryStatus = "candidate" | "active" | "paused" | "rejected";
export type DemoFeedback = "helped" | "harmful";

export interface DemoCheck {
  simulation: true;
  id: string;
  label: string;
  passed: boolean;
  expected: string;
  actual: string;
}
export interface DemoVerification {
  simulation: true;
  status: "idle" | "passed" | "failed";
  checks: DemoCheck[];
  message: string;
}
export interface DemoLog {
  simulation: true;
  id: string;
  stage: DemoStage;
  level: "info" | "success" | "warning";
  title: string;
  message: string;
}
export interface DemoMemory {
  simulation: true;
  id: string;
  title: string;
  body: string;
  trigger: string;
  tags: string[];
  status: DemoMemoryStatus;
  freshness: "fresh" | "needs_revalidation";
  validatedEnvironments: string[];
  helped: number;
  harmful: number;
  evidenceIds: string[];
}
export interface DemoEvaluation {
  simulation: true;
  id: string;
  taskId: "first-task" | DemoTaskId;
  fixId: DemoFixId;
  memoryReused: boolean;
  verification: DemoVerification;
  evidenceId: string;
}
export interface DemoState {
  simulation: true;
  stage: DemoStage;
  revision: number;
  firstTask: { fixId: DemoFixId | null; verification: DemoVerification; attempts: number };
  memory: DemoMemory | null;
  secondTaskId: DemoTaskId;
  recall: { status: "idle" | "matched" | "blocked"; reason: string };
  reuse: {
    choice: "reuse" | "skip" | null;
    applied: boolean;
    manualFixId: DemoFixId | null;
    revalidation: DemoVerification;
    verification: DemoVerification;
    feedback: DemoFeedback | null;
    attempts: number;
  };
  logs: DemoLog[];
  evaluations: DemoEvaluation[];
}
export type DemoAction =
  | { type: "begin" | "run-verification" | "extract-candidate" | "review-candidate" | "confirm-memory" | "reject-memory" | "try-recall" | "search-recall" | "apply-memory" | "verify-reuse" | "retry" | "complete" | "restart-recall" | "pause-memory" | "restore-memory" | "back" | "reset" }
  | { type: "select-fix" | "select-manual-fix"; fixId: DemoFixId }
  | { type: "select-task"; taskId: DemoTaskId }
  | { type: "choose-reuse"; choice: "reuse" | "skip" }
  | { type: "revalidate-memory"; method: "sample-path" | "trust-history" }
  | { type: "feedback"; feedback: DemoFeedback };
export interface DemoActionOption {
  id: string;
  label: string;
  description: string;
  action: DemoAction;
  tone: "primary" | "neutral" | "warning";
  group: "primary" | "choice" | "secondary";
  disabled?: boolean;
}

export const DEMO_STAGES: ReadonlyArray<{ id: DemoStage; label: string; description: string }> = [
  { id: "prepare", label: "认识案例", description: "本地模拟，不会修改项目或运行 Agent" },
  { id: "learn", label: "修复与验证", description: "观察路径错误，选择方案并检查模拟样例" },
  { id: "candidate", label: "提炼候选", description: "从已通过的模拟修复提炼经验" },
  { id: "review", label: "人工确认", description: "候选经确认后才进入召回" },
  { id: "recall", label: "下一次任务", description: "检查任务相关性、状态和环境" },
  { id: "reuse", label: "复用与反馈", description: "必要时重验，记录实际演示选择" },
  { id: "summary", label: "记忆记录", description: "查看反馈、暂停或恢复，并导出演示记录" },
];
export const DEMO_FIXES: ReadonlyArray<{ id: DemoFixId; title: string; description: string }> = [
  { id: "argument-array", title: "保留路径，用参数数组传递", description: "保留空格与中文，把完整路径作为一个参数交给进程接口。" },
  { id: "remove-spaces", title: "删除路径里的空格", description: "看起来可以避开空格，但会改变真实目录名称。" },
  { id: "hardcode-path", title: "写死自己电脑的目录", description: "固定到一个本机路径，不检查换目录后的表现。" },
];
export interface DemoTask {
  id: DemoTaskId;
  title: string;
  description: string;
  environment: string;
  tags: readonly string[];
  paths: readonly string[];
}
export const DEMO_TASKS: readonly DemoTask[] = [
  { id: "related", title: "另一个 Windows 构建任务", description: "同类带空格路径，环境保持不变。", environment: "Windows · PowerShell 7", tags: ["build", "paths", "windows"], paths: ["D:\\课程项目\\第二个 Demo", "D:\\Work Space\\release"] },
  { id: "unrelated", title: "调整登录页配色", description: "任务需要设计经验，不涉及路径或构建参数。", environment: "Windows · PowerShell 7", tags: ["design", "colors", "ui"], paths: [] },
  { id: "changed-environment", title: "迁移到 Linux 构建环境", description: "任务相关，但原先的 Windows 验证不覆盖新环境。", environment: "Linux · Bash", tags: ["build", "paths", "linux"], paths: ["/home/demo/course projects/ael", "/home/demo/中文项目/build output"] },
];
const FIRST_ENVIRONMENT = "Windows · PowerShell 7";
const FIRST_PATHS = ["D:\\课程项目\\AEL Demo", "D:\\Work Space\\课程示例"];
const idleVerification = (): DemoVerification => ({ simulation: true, status: "idle", checks: [], message: "[模拟] 尚未运行样例验证。" });
const emptyReuse = (): DemoState["reuse"] => ({ choice: null, applied: false, manualFixId: null, revalidation: idleVerification(), verification: idleVerification(), feedback: null, attempts: 0 });
const idleRecall = (): DemoState["recall"] => ({ status: "idle", reason: "尚未检索。" });
const selectedTask = (state: DemoState) => DEMO_TASKS.find(task => task.id === state.secondTaskId)!;

export function createDemoState(): DemoState {
  return {
    simulation: true, stage: "prepare", revision: 0,
    firstTask: { fixId: null, verification: idleVerification(), attempts: 0 },
    memory: null, secondTaskId: "related", recall: idleRecall(), reuse: emptyReuse(), evaluations: [],
    logs: [{ simulation: true, id: "demo-event-0", stage: "prepare", level: "info", title: "[模拟] 演示已准备", message: "本流程只计算内存中的演示状态；不会运行系统命令、调用模型或读写真实记忆。" }],
  };
}

function actionKey(action: DemoAction): string {
  if ("fixId" in action) return `${action.type}:${action.fixId}`;
  if ("taskId" in action) return `${action.type}:${action.taskId}`;
  if ("choice" in action) return `${action.type}:${action.choice}`;
  if ("method" in action) return `${action.type}:${action.method}`;
  if ("feedback" in action) return `${action.type}:${action.feedback}`;
  return action.type;
}
function option(action: DemoAction, label: string, description: string, group: DemoActionOption["group"] = "primary", disabled = false, tone: DemoActionOption["tone"] = "neutral"): DemoActionOption {
  return { id: actionKey(action), action, label, description, group, disabled, tone };
}
function fixOptions(state: DemoState, manual = false): DemoActionOption[] {
  return DEMO_FIXES.map(fix => option({ type: manual ? "select-manual-fix" : "select-fix", fixId: fix.id }, fix.title, fix.description, "choice", (manual ? state.reuse.manualFixId : state.firstTask.fixId) === fix.id));
}

/** The UI can render these options directly; disabled actions are rejected by transitionDemo. */
export function getDemoActions(state: DemoState): DemoActionOption[] {
  const actions: DemoActionOption[] = [];
  const add = (...items: DemoActionOption[]) => actions.push(...items);
  switch (state.stage) {
    case "prepare":
      add(option({ type: "begin" }, "观察第一次构建错误", "查看带空格路径被错误拆分的模拟案例。", "primary", false, "primary"));
      break;
    case "learn":
      add(...fixOptions(state));
      add(option({ type: "run-verification" }, "运行模拟样例验证", "比较修复前后收到的路径，不执行真实构建。", "primary", !state.firstTask.fixId || state.firstTask.verification.status !== "idle", "primary"));
      if (state.firstTask.verification.status === "passed") add(option({ type: "extract-candidate" }, "从本次证据提炼候选", "只有当前修复的模拟样例通过后才能提炼。", "primary", false, "primary"));
      if (state.firstTask.verification.status === "failed") add(option({ type: "retry" }, "重新选择修复方案", "失败记录保留；回到路径输入与实际目录的对应关系。", "primary", false, "warning"));
      break;
    case "candidate":
      add(option({ type: "review-candidate" }, "审阅记忆候选", "检查适用条件、正文和来源验证。", "primary", false, "primary"));
      add(option({ type: "try-recall" }, "试试未经确认能否召回", "候选不会自动变成已启用记忆。", "choice"));
      break;
    case "review":
      if (state.memory?.status === "candidate") {
        add(option({ type: "confirm-memory" }, "确认并启用记忆", "仅启用此演示候选，不修改真实记忆库。", "primary", false, "primary"));
        add(option({ type: "reject-memory" }, "拒绝这个候选", "保留演示来源记录，但不让它参与召回。", "choice", false, "warning"));
      }
      add(option({ type: "try-recall" }, "查看下一次任务的召回", "按当前候选状态检查，而不是直接显示成功。", "choice"));
      break;
    case "recall":
      add(...DEMO_TASKS.map(task => option({ type: "select-task", taskId: task.id }, task.title, task.description, "choice", state.secondTaskId === task.id)));
      add(option({ type: "search-recall" }, "检查是否应该召回", "同时检查启用状态、任务相关性和环境。", "primary", false, "primary"));
      if (state.memory?.status === "candidate") add(option({ type: "review-candidate" }, "先去人工确认", "未确认的候选不进入复用。", "primary"));
      if (state.recall.status === "matched" && state.memory?.status === "active") {
        add(option({ type: "choose-reuse", choice: "reuse" }, "使用这条记忆", "进入适用性检查，必要时先重验。", "primary", false, "primary"));
        add(option({ type: "choose-reuse", choice: "skip" }, "本次不复用，重新处理", "再次选择修复方案，可与复用过程比较。", "choice"));
      }
      break;
    case "reuse":
      if (state.reuse.choice === "reuse") {
        if (state.memory?.freshness === "needs_revalidation") {
          add(option({ type: "revalidate-memory", method: "sample-path" }, "在新环境检查代表性路径", "用当前环境的空格与中文路径运行本地模拟检查。", "primary", false, "primary"));
          add(option({ type: "revalidate-memory", method: "trust-history" }, "直接信任旧环境结果", "尝试跳过当前环境证据，查看系统会怎样处理。", "choice", false, "warning"));
        }
        add(option({ type: "apply-memory" }, "将记忆用于本次模拟任务", "仅当记忆启用且环境已验证时可用。", "primary", state.memory?.status !== "active" || state.memory.freshness !== "fresh" || state.reuse.applied, "primary"));
      } else add(...fixOptions(state, true));
      add(option({ type: "verify-reuse" }, "验证第二次任务的模拟结果", "本次结果独立检查，不继承第一次的通过结论。", "primary", state.reuse.verification.status !== "idle" || (state.reuse.choice === "reuse" ? !state.reuse.applied : !state.reuse.manualFixId), "primary"));
      if (state.reuse.verification.status === "failed") add(option({ type: "retry" }, "修正后重试", "保留失败证据，再选择修复方案。", "primary", false, "warning"));
      if (state.reuse.verification.status !== "idle" && state.reuse.choice === "reuse" && state.reuse.applied && !state.reuse.feedback) {
        add(option({ type: "feedback", feedback: "helped" }, "反馈：这次确实有帮助", "记录一条模拟使用反馈，不当作真实用户测评。", "choice"));
        add(option({ type: "feedback", feedback: "harmful" }, "反馈：产生了负面影响", "即使样例通过，也可报告问题；该记忆会暂停召回。", "choice", false, "warning"));
      }
      if (state.reuse.verification.status === "passed") add(option({ type: "complete" }, "查看本次记忆记录", "汇总实际操作与模拟证据，未反馈不会自动记为有帮助。", "primary"));
      break;
    case "summary":
      add(option({ type: "restart-recall" }, "换一个任务再比较", "保留学习与反馈记录，重新检查下一次任务。", "primary", !state.memory, "primary"));
      break;
  }
  if (["recall", "summary"].includes(state.stage) && state.memory?.status === "paused") add(option({ type: "restore-memory" }, "恢复这条记忆的召回", "保留负面反馈；环境变化时仍需重验。", "secondary"));
  if (state.stage === "summary" && state.memory?.status === "active") add(option({ type: "pause-memory" }, "暂停召回（可恢复）", "模拟可逆遗忘，保留正文和来源证据。", "secondary", false, "warning"));
  if (state.stage !== "prepare" && !(state.stage === "review" && state.memory?.status !== "candidate")) add(option({ type: "back" }, "返回上一步", "保留操作记录，撤销尚未完成的后续选择。", "secondary"));
  add(option({ type: "reset" }, "重新开始演示", "只清空本次内存演示，不触及真实项目或记忆。", "secondary"));
  return actions;
}

function evaluateFix(fix: DemoFixId, paths: readonly string[]): DemoVerification {
  const checks = paths.map((expected, index): DemoCheck => {
    const actual = fix === "argument-array" ? expected : fix === "remove-spaces" ? expected.replace(/\s+/g, "") : "C:\\Users\\demo\\project";
    return { simulation: true, id: `path-${index + 1}`, label: `[模拟] 路径样例 ${index + 1}`, passed: actual === expected, expected, actual };
  });
  const passed = checks.length > 0 && checks.every(check => check.passed);
  return { simulation: true, status: passed ? "passed" : "failed", checks, message: passed ? "[模拟] 所有样例均保留了完整路径；未运行真实构建。" : "[模拟] 修复改变了目标目录。恢复路线：保留原路径，用参数数组传递，再运行样例。" };
}
function recallMemory(state: DemoState): DemoState["recall"] {
  if (!state.memory) return { status: "blocked", reason: "尚无候选记忆。" };
  if (state.memory.status === "candidate") return { status: "blocked", reason: "候选尚未人工确认，不参与召回。" };
  if (state.memory.status === "rejected") return { status: "blocked", reason: "候选已被拒绝，不参与召回。" };
  if (state.memory.status === "paused") return { status: "blocked", reason: "这条记忆已暂停召回；需要明确恢复后才可使用。" };
  const task = selectedTask(state);
  if (task.tags.filter(tag => state.memory!.tags.includes(tag)).length < 2) return { status: "blocked", reason: "当前任务与路径构建经验不相关，不召回这条记忆。" };
  return { status: "matched", reason: state.memory.freshness === "needs_revalidation" ? "任务相关，但当前环境未经验证。可审阅，应用前必须重验。" : "任务相关、记忆已启用，且当前环境有模拟样例证据。" };
}
function syncFreshness(state: DemoState) {
  if (state.memory) state.memory.freshness = state.memory.validatedEnvironments.includes(selectedTask(state).environment) ? "fresh" : "needs_revalidation";
}
function log(state: DemoState, title: string, message: string, level: DemoLog["level"] = "info") {
  const id = `demo-event-${state.logs.length}`;
  state.logs.push({ simulation: true, id, stage: state.stage, level, title: `[模拟] ${title}`, message });
  return id;
}
function recordEvaluation(state: DemoState, taskId: DemoEvaluation["taskId"], fixId: DemoFixId, memoryReused: boolean, verification: DemoVerification) {
  const evidenceId = log(state, verification.status === "passed" ? "样例验证通过" : "样例验证未通过", verification.message, verification.status === "passed" ? "success" : "warning");
  state.evaluations.push({ simulation: true, id: `demo-evaluation-${state.evaluations.length + 1}`, taskId, fixId, memoryReused, verification, evidenceId });
}

/** Invalid/disabled actions return the original object. Valid transitions never mutate their input. */
export function transitionDemo(previous: DemoState, action: DemoAction): DemoState {
  if (!getDemoActions(previous).some(item => !item.disabled && actionKey(item.action) === actionKey(action))) return previous;
  if (action.type === "reset") return createDemoState();
  const state: DemoState = structuredClone(previous);
  state.revision += 1;
  switch (action.type) {
    case "begin":
      state.stage = "learn";
      log(state, "观察首次错误", `命令字符串错误拆分了带空格的路径：${FIRST_PATHS[0]}。请选择修复方案。`);
      break;
    case "select-fix":
      state.firstTask.fixId = action.fixId;
      state.firstTask.verification = idleVerification();
      state.memory = null;
      log(state, "选择修复方案", DEMO_FIXES.find(fix => fix.id === action.fixId)!.title);
      break;
    case "run-verification":
      state.firstTask.attempts += 1;
      state.firstTask.verification = evaluateFix(state.firstTask.fixId!, FIRST_PATHS);
      recordEvaluation(state, "first-task", state.firstTask.fixId!, false, state.firstTask.verification);
      break;
    case "extract-candidate": {
      const evidence = [...state.evaluations].reverse().find(item => item.taskId === "first-task" && item.verification.status === "passed")!;
      state.memory = {
        simulation: true, id: `demo-memory-${state.revision}`, title: "带空格或中文路径应作为完整参数传递",
        body: "保留原目录名称。使用进程接口的参数数组传递路径，不删除空格，不硬编码本机目录。应用前检查当前环境；使用包含空格和中文的样例验证传入路径与目标路径一致。",
        trigger: "构建或进程调用中，路径被拆分、截断，或涉及空格与中文目录。",
        tags: ["build", "paths", "argv"], status: "candidate", freshness: "fresh", validatedEnvironments: [FIRST_ENVIRONMENT], helped: 0, harmful: 0, evidenceIds: [evidence.evidenceId],
      };
      state.stage = "candidate";
      log(state, "候选已提炼，等待确认", "候选来自本次通过的模拟样例；它还没有进入召回。", "success");
      break;
    }
    case "review-candidate":
      state.stage = "review";
      log(state, "人工审阅候选", "检查正文、触发条件、环境及来源；点击确认才会启用。");
      break;
    case "confirm-memory":
      state.memory!.status = "active";
      state.stage = "recall";
      state.recall = idleRecall();
      syncFreshness(state);
      log(state, "人工确认并启用", "此候选现在可参与演示召回；尚未产生第二次任务的验证结果。", "success");
      break;
    case "reject-memory":
      state.memory!.status = "rejected";
      state.stage = "summary";
      state.recall = { status: "blocked", reason: "候选已被拒绝，不参与召回。" };
      log(state, "候选被拒绝", "候选和来源保留在演示记录中，不会自动启用。", "warning");
      break;
    case "select-task":
      state.secondTaskId = action.taskId;
      state.recall = idleRecall();
      state.reuse = emptyReuse();
      syncFreshness(state);
      log(state, "更换下一次任务", selectedTask(state).title);
      break;
    case "try-recall":
    case "search-recall":
      state.stage = "recall";
      syncFreshness(state);
      state.recall = recallMemory(state);
      log(state, state.recall.status === "matched" ? "找到相关记忆" : "本次不召回", state.recall.reason, state.recall.status === "matched" ? "success" : "warning");
      break;
    case "choose-reuse":
      state.stage = "reuse";
      state.reuse = { ...emptyReuse(), choice: action.choice };
      log(state, action.choice === "reuse" ? "选择复用" : "选择不复用", action.choice === "reuse" ? "先检查适用环境，再决定是否应用。" : "本次重新选择修复方案，使用结果不计入记忆的有帮助反馈。");
      break;
    case "revalidate-memory":
      if (action.method === "trust-history") {
        state.reuse.revalidation = { simulation: true, status: "failed", checks: [{ simulation: true, id: "current-environment", label: "[模拟] 当前环境证据", passed: false, expected: selectedTask(state).environment, actual: state.memory!.validatedEnvironments.join("；") }], message: "[模拟] 旧环境结果不能证明新环境适用，仍须重验。" };
        log(state, "跳过重验被阻止", state.reuse.revalidation.message, "warning");
      } else {
        state.reuse.revalidation = evaluateFix("argument-array", selectedTask(state).paths);
        if (state.reuse.revalidation.status === "passed") {
          state.memory!.validatedEnvironments.push(selectedTask(state).environment);
          syncFreshness(state);
          const evidenceId = log(state, "当前环境模拟重验通过", `仅验证了 ${selectedTask(state).environment} 的演示样例，不代表真实环境验证。`, "success");
          state.memory!.evidenceIds.push(evidenceId);
        }
      }
      break;
    case "apply-memory":
      state.reuse.applied = true;
      log(state, "将记忆用于模拟任务", "采用完整参数数组方案，仍需要独立检查第二次任务的结果。");
      break;
    case "select-manual-fix":
      state.reuse.manualFixId = action.fixId;
      state.reuse.verification = idleVerification();
      log(state, "重新选择修复方案", DEMO_FIXES.find(fix => fix.id === action.fixId)!.title);
      break;
    case "verify-reuse": {
      const fixId = state.reuse.choice === "reuse" ? "argument-array" : state.reuse.manualFixId!;
      state.reuse.attempts += 1;
      state.reuse.verification = evaluateFix(fixId, selectedTask(state).paths);
      recordEvaluation(state, state.secondTaskId, fixId, state.reuse.choice === "reuse", state.reuse.verification);
      break;
    }
    case "feedback":
      state.reuse.feedback = action.feedback;
      state.memory![action.feedback] += 1;
      if (action.feedback === "harmful") {
        state.memory!.status = "paused";
        state.recall = { status: "blocked", reason: "收到负面反馈，已暂停召回；反馈记录保留。" };
      }
      state.stage = "summary";
      log(state, action.feedback === "helped" ? "记录有帮助反馈" : "负面反馈并暂停召回", "这是操作者在演示中的反馈，不是实际用户测评数据。", action.feedback === "helped" ? "success" : "warning");
      break;
    case "complete":
      state.stage = "summary";
      log(state, "查看演示结果", "汇总实际分支与模拟证据；未提供反馈的使用不会自动记为有帮助。");
      break;
    case "restart-recall":
      state.stage = "recall";
      state.recall = idleRecall();
      state.reuse = emptyReuse();
      log(state, "开始另一轮比较", "保留原有反馈和操作记录，重新检查任务相关性。");
      break;
    case "pause-memory":
      state.memory!.status = "paused";
      state.recall = { status: "blocked", reason: "操作者已暂停召回。" };
      log(state, "暂停召回", "正文与来源仍然保留，可明确选择恢复。", "warning");
      break;
    case "restore-memory":
      state.memory!.status = "active";
      syncFreshness(state);
      state.recall = idleRecall();
      log(state, "恢复召回资格", "负面反馈没有被删除；环境未验证时仍需重验。");
      break;
    case "retry":
      if (state.stage === "learn") { state.firstTask.fixId = null; state.firstTask.verification = idleVerification(); }
      else { state.reuse.manualFixId = null; state.reuse.verification = idleVerification(); }
      log(state, "准备重新尝试", "之前的失败证据保留，尚未产生新的通过结果。");
      break;
    case "back":
      if (state.stage === "learn") state.stage = "prepare";
      else if (state.stage === "candidate") { state.stage = "learn"; state.memory = null; state.recall = idleRecall(); state.reuse = emptyReuse(); }
      else if (state.stage === "review") state.stage = "candidate";
      else if (state.stage === "recall") state.stage = "review";
      else { state.stage = "recall"; state.recall = idleRecall(); state.reuse = emptyReuse(); }
      log(state, "返回上一阶段", "操作记录保留；未完成的第二次任务结果不会被当作已通过。");
      break;
  }
  return state;
}

export interface DemoExport {
  schemaVersion: 1;
  simulation: true;
  kind: "ael-memory-learning-demo";
  revision: number;
  stage: DemoStage;
  memory: DemoMemory | null;
  firstTask: DemoState["firstTask"];
  secondTask: DemoTask;
  recall: DemoState["recall"];
  reuse: DemoState["reuse"];
  evaluations: DemoEvaluation[];
  logs: DemoLog[];
  limitations: string[];
}
export interface DemoArtifacts { reviewMarkdown: string; handoverMarkdown: string; json: DemoExport; jsonText: string }
export function buildDemoArtifacts(state: DemoState): DemoArtifacts {
  const json: DemoExport = structuredClone({
    schemaVersion: 1, simulation: true, kind: "ael-memory-learning-demo", revision: state.revision, stage: state.stage,
    memory: state.memory, firstTask: state.firstTask, secondTask: selectedTask(state), recall: state.recall,
    reuse: state.reuse, evaluations: state.evaluations, logs: state.logs,
    limitations: ["纯本地内存模拟；没有执行系统命令、真实构建或模型请求。", "样例通过只代表本次演示规则通过，不是实际项目测试结果。", "反馈由演示操作者选择，不代表实际用户调研、效率提升或竞赛成绩。"],
  });
  const status = (value: DemoVerification["status"]) => value === "passed" ? "模拟样例通过" : value === "failed" ? "模拟样例未通过" : "尚未验证";
  const reviewMarkdown = [
    "# AEL 记忆学习演示记录", "", "simulation: true", "", "> 以下全部为模拟演示，不是实际构建、模型执行或用户测评。", "",
    `当前阶段：${DEMO_STAGES.find(stage => stage.id === state.stage)!.label}`, `第一次任务：${status(state.firstTask.verification.status)}；尝试 ${state.firstTask.attempts} 次。`,
    `第二次任务：${selectedTask(state).title}；${status(state.reuse.verification.status)}；尝试 ${state.reuse.attempts} 次。`,
    `本次是否选择复用：${state.reuse.choice === "reuse" ? "是" : state.reuse.choice === "skip" ? "否" : "尚未选择"}。`,
    `召回判断：${state.recall.reason}`, "", "## 模拟验证记录", "",
    ...(state.evaluations.length ? state.evaluations.map(item => `- ${item.id} / ${item.taskId}：${status(item.verification.status)}；方案 ${item.fixId}；${item.memoryReused ? "复用记忆" : "自行选择"}；证据 ${item.evidenceId}`) : ["尚无验证记录。"]),
    "", "## 操作记录", "", ...state.logs.map(item => `- ${item.id} · ${item.title}：${item.message}`), "", "## 使用边界", "", ...json.limitations.map(item => `- ${item}`),
  ].join("\n");
  const memory = state.memory;
  const handoverMarkdown = [
    "# AEL 演示记忆导出", "", "simulation: true", "", "> 此文件仅包含演示状态，不会自动导入真实记忆库。", "",
    ...(memory ? [`记忆：${memory.title}`, `状态：${memory.status}`, `当前任务适用性：${memory.freshness}`, "", "## 触发条件", "", memory.trigger, "", "## 候选正文", "", memory.body, "", "## 来源与反馈", "", `来源证据：${memory.evidenceIds.join("、")}`, `已验证的模拟环境：${memory.validatedEnvironments.join("；")}`, `模拟反馈：有帮助 ${memory.helped}；有负面影响 ${memory.harmful}。`] : ["尚未生成记忆候选。没有可导出的可靠经验正文。"]),
    "", "## 继续使用前", "", "在真实项目中重新确认适用性并运行真实验证。演示候选、暂停或拒绝状态均不得视为可自动召回。",
  ].join("\n");
  return { reviewMarkdown, handoverMarkdown, json, jsonText: JSON.stringify(json, null, 2) };
}
