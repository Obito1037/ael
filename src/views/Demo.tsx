import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, Circle, ClipboardCopy, Download, FlaskConical, History, Link2, RotateCcw, Sparkles, X } from "lucide-react";
import { CdsButton } from "open-claude-ui";
import { useStore } from "../store";
import { useDemoSession } from "../lib/demo-session";
import { DEMO_STAGES, DEMO_TASKS, buildDemoArtifacts, getDemoActions, type DemoActionOption, type DemoStage, type DemoState, type DemoVerification } from "../lib/demo";
import { downloadText } from "../lib/browserExports";
import { cx } from "../lib/format";
import "./Demo.css";

const COPY: Record<DemoStage, { eyebrow: string; title: string; description: string }> = {
  prepare: { eyebrow: "一个问题，两次任务", title: "让一次解决，成为下一次的经验", description: "从一次 Windows 路径错误开始，亲手决定什么可以成为记忆、什么时候应该复用。" },
  learn: { eyebrow: "第一次任务 · 先解决问题", title: "什么样的修复值得留下？", description: "路径包含空格和中文。选择一个方案，对照输入与输出检查它有没有改变真正的目录。" },
  candidate: { eyebrow: "从执行证据中提炼", title: "修复通过了，经验还是候选", description: "候选记录包括做法、适用条件和来源。你可以先试着召回，看看未确认的内容会不会被使用。" },
  review: { eyebrow: "人来决定是否保留", title: "确认这条经验的使用边界", description: "阅读记忆卡与来源，再决定启用或拒绝。未经确认的候选不会参与下一次召回。" },
  recall: { eyebrow: "第二次任务 · 按需召回", title: "这次，真的需要这条记忆吗？", description: "换一个任务，比较相关性、启用状态和运行环境。没有合适的记忆，也应该是正常结果。" },
  reuse: { eyebrow: "应用之后，再独立验证", title: "复用经验，也要检查本次结果", description: "环境变化时先重验。你也可以选择不复用，重新处理，或者反馈这条经验带来的问题。" },
  summary: { eyebrow: "从使用中继续更新", title: "经验留下了，使用记录也留下了", description: "查看这次实际做过的演示选择，试着暂停与恢复召回，或换个任务再比较。" },
};
const STATUS = { candidate: "待确认", active: "已启用", paused: "已暂停召回", rejected: "已拒绝" };

function isSelected(option: DemoActionOption, state: DemoState) {
  const action = option.action;
  if (action.type === "select-fix") return state.firstTask.fixId === action.fixId;
  if (action.type === "select-manual-fix") return state.reuse.manualFixId === action.fixId;
  if (action.type === "select-task") return state.secondTaskId === action.taskId;
  return false;
}

function Checks({ verification, label }: { verification: DemoVerification; label: string }) {
  if (verification.status === "idle") return null;
  return <section className={cx("demo-checks", verification.status === "passed" ? "is-passed" : "is-failed")} aria-label={label}>
    <div className="demo-result-heading">{verification.status === "passed" ? <CheckCircle2 size={17} /> : <X size={17} />}<strong>{verification.status === "passed" ? "模拟样例通过" : "模拟样例未通过"}</strong></div>
    <p>{verification.message.replace(/^\[模拟\]\s*/, "")}</p>
    <details><summary>查看 {verification.checks.length} 条样例证据 <ChevronDown size={13} /></summary>
      <div className="demo-check-list">{verification.checks.map(check => <div key={check.id} className="demo-check-row">
        <span>{check.passed ? <Check size={14} /> : <X size={14} />}{check.label.replace(/^\[模拟\]\s*/, "")}</span>
        <dl><dt>预期路径</dt><dd>{check.expected}</dd><dt>实际路径</dt><dd>{check.actual}</dd></dl>
      </div>)}</div>
    </details>
  </section>;
}

export function Demo() {
  const state = useDemoSession(session => session.state);
  const dispatch = useDemoSession(session => session.dispatch);
  const setView = useStore(store => store.setView);
  const [notice, setNotice] = useState("");
  const [showRecord, setShowRecord] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const steps = useRef<HTMLOListElement>(null);
  const recordRef = useRef<HTMLTextAreaElement>(null);
  const options = getDemoActions(state);
  const choices = options.filter(option => option.group === "choice");
  const primary = options.filter(option => option.group === "primary" && !(option.disabled && (
    (option.action.type === "run-verification" && state.firstTask.verification.status !== "idle") ||
    (option.action.type === "apply-memory" && state.reuse.applied) ||
    (option.action.type === "verify-reuse" && state.reuse.verification.status !== "idle")
  )));
  const secondary = options.filter(option => option.group === "secondary" && !["reset", "back"].includes(option.action.type));
  const back = options.find(option => option.action.type === "back");
  const info = COPY[state.stage];
  const memory = state.memory;
  const task = DEMO_TASKS.find(item => item.id === state.secondTaskId)!;
  const artifacts = useMemo(() => buildDemoArtifacts(state), [state]);
  const latest = state.logs[state.logs.length - 1];
  const complete = {
    prepare: state.stage !== "prepare",
    learn: state.firstTask.verification.status === "passed",
    candidate: Boolean(memory),
    review: Boolean(memory && memory.status !== "candidate"),
    recall: state.recall.status !== "idle",
    reuse: state.reuse.verification.status === "passed",
    summary: state.stage === "summary",
  };

  useEffect(() => {
    setNotice("");
    heading.current?.focus({ preventScroll: true });
    document.querySelector(".app-main")?.scrollTo({ top: 0, behavior: "instant" });
    steps.current?.querySelector<HTMLElement>('[aria-current="step"]')?.scrollIntoView({ block: "nearest", inline: "center", behavior: "instant" });
  }, [state.stage]);

  function act(option: DemoActionOption) {
    if (option.disabled) return;
    setNotice("");
    dispatch(option.action);
  }
  function reset() {
    dispatch({ type: "reset" });
    setShowRecord(false);
    setNotice("本次演示已重置，真实记忆库未改动。");
  }
  function download() {
    try {
      const name = downloadText("ael-memory-demo.json", artifacts.jsonText, "application/json;charset=utf-8");
      setNotice("已发起下载：" + name + "。文件包含本次演示选择与模拟标记。");
    } catch {
      setShowRecord(true);
      setNotice("当前环境无法发起下载，可以展开记录后复制内容。");
    }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(artifacts.reviewMarkdown); setNotice("已复制带有模拟标记的演示记录。"); }
    catch { setShowRecord(true); setNotice("请在下方记录中选择文字，再按 Ctrl+C 复制。"); }
  }

  return <div className="memory-demo" data-testid="memory-demo">
    <div className="demo-toolbar">
      <span className="demo-sandbox"><FlaskConical size={14} />交互演示</span>
      <p>不调用模型，不执行系统命令，不改动真实记忆。</p>
      <CdsButton variant="ghost" size="sm" onClick={reset}><RotateCcw size={13} /> 重置演示</CdsButton>
      <CdsButton variant="ghost" size="sm" onClick={() => setView("memory")}><ArrowLeft size={13} /> 退出演示</CdsButton>
    </div>

    <ol ref={steps} className="demo-steps" aria-label="记忆学习与复用流程">
      {DEMO_STAGES.map((step, index) => <li key={step.id} className={cx(state.stage === step.id && "is-current", complete[step.id] && "is-complete")} aria-current={state.stage === step.id ? "step" : undefined}>
        <span>{complete[step.id] && state.stage !== step.id ? <Check size={12} /> : String(index + 1).padStart(2, "0")}</span><strong>{step.label}</strong>
      </li>)}
    </ol>

    <div className="demo-workspace">
      <section className="demo-stage-panel" data-stage={state.stage}>
        <span className="demo-eyebrow">{info.eyebrow}</span>
        <h1 ref={heading} tabIndex={-1}>{info.title}</h1>
        <p className="demo-description">{info.description}</p>

        {state.stage === "prepare" && <div className="demo-introduction">
          <div className="demo-case"><span>案例 · Windows 构建失败</span><code>D:\课程项目\AEL Demo</code><p>路径被错误地拆成多个参数。我们需要保留原目录，并验证换一个路径后仍然有效。</p></div>
          <div className="demo-story"><span><Circle size={16} />解决一次</span><ArrowRight size={15} /><span><BookOpen size={16} />确认经验</span><ArrowRight size={15} /><span><Sparkles size={16} />再次复用</span></div>
          <div className="demo-promises"><p><Check size={14} />每条候选能追溯到来源与检查结果</p><p><Check size={14} />不相关、未确认的记忆不会进入召回</p><p><Check size={14} />你可以拒绝、暂停或恢复，而非只能接受</p></div>
        </div>}

        {state.stage === "learn" && <div className="demo-case"><span>待解决的问题</span><code>目标目录：D:\课程项目\AEL Demo<br />错误参数：[D:\课程项目\AEL, Demo]</code></div>}

        {["candidate", "review"].includes(state.stage) && memory && <div className="demo-candidate-preview"><BookOpen size={20} /><div><strong>{memory.title}</strong><p>{memory.trigger}</p><small>{memory.evidenceIds.length} 条来源 · {STATUS[memory.status]}</small></div></div>}

        {["recall", "reuse", "summary"].includes(state.stage) && <div className="demo-task-context"><span>下一次任务</span><strong>{task.title}</strong><small>{task.environment}</small></div>}

        {choices.length > 0 && <div className="demo-choices" aria-label="本阶段可选操作">
          {choices.map(option => {
            const selected = isSelected(option, state);
            return <button type="button" key={option.id} data-demo-action={option.id} disabled={option.disabled} aria-pressed={selected} aria-label={option.label} onClick={() => act(option)} className={cx("demo-choice", selected && "is-selected", option.tone === "warning" && "is-warning")}>
              <span className="demo-choice-icon">{selected ? <CheckCircle2 size={17} /> : <Circle size={17} />}</span>
              <span><strong>{option.label}</strong><small>{option.description}</small></span>
              {selected && <span className="demo-selected-label">已选择</span>}
            </button>;
          })}
        </div>}

        {state.stage === "learn" && <Checks verification={state.firstTask.verification} label="第一次任务的模拟验证" />}
        {state.recall.status !== "idle" && ["recall", "reuse"].includes(state.stage) && <div className={cx("demo-recall-result", state.recall.status === "matched" ? "is-matched" : "is-blocked")} data-testid="recall-result" role="status"><strong>{state.recall.status === "matched" ? "找到相关记忆" : "本次不召回"}</strong><p>{state.recall.reason}</p></div>}
        {state.stage === "reuse" && <><Checks verification={state.reuse.revalidation} label="新环境模拟重验" /><Checks verification={state.reuse.verification} label="第二次任务的模拟验证" /></>}

        {state.stage === "summary" && <div className="demo-summary" data-testid="demo-summary">
          <div><span>记忆状态</span><strong>{memory ? STATUS[memory.status] : "尚无记忆"}</strong></div>
          <div><span>本次是否复用</span><strong>{state.reuse.applied ? "已应用" : "未应用"}</strong></div>
          <div><span>本次模拟检查</span><strong>{state.reuse.verification.status === "passed" ? "通过" : state.reuse.verification.status === "failed" ? "未通过" : "未运行"}</strong></div>
          <div><span>使用反馈</span><strong>{state.reuse.feedback === "helped" ? "有帮助" : state.reuse.feedback === "harmful" ? "负面影响" : "未提交"}</strong></div>
        </div>}

        <div className="demo-primary-actions">
          {primary.map(option => <CdsButton key={option.id} data-demo-action={option.id} variant={option.tone === "primary" ? "primary" : "secondary"} size="lg" disabled={option.disabled} onClick={() => act(option)} title={option.description}>{option.label}<ArrowRight size={14} /></CdsButton>)}
        </div>
        {secondary.length > 0 && <div className="demo-secondary-actions">{secondary.map(option => <CdsButton key={option.id} data-demo-action={option.id} variant="outline" disabled={option.disabled} onClick={() => act(option)}>{option.label}</CdsButton>)}</div>}

        {state.stage === "summary" && <section className="demo-export">
          <h2>带走本次演示记录</h2><p>下载文件仅包含模拟案例、你的选择和相应检查结果。</p>
          <div><CdsButton variant="outline" onClick={download}><Download size={14} />下载演示记忆记录</CdsButton><CdsButton variant="ghost" onClick={() => void copy()}><ClipboardCopy size={14} />复制记录</CdsButton><CdsButton variant="ghost" onClick={() => setShowRecord(!showRecord)}>{showRecord ? "收起记录" : "预览记录"}</CdsButton></div>
          {showRecord && <textarea ref={recordRef} aria-label="演示记录" value={artifacts.reviewMarkdown} readOnly rows={9} onFocus={event => event.target.select()} />}
        </section>}
        {notice && <p className="demo-notice" role="status">{notice}</p>}
        {back && <button type="button" className="demo-back" onClick={() => act(back)}><ArrowLeft size={13} />返回上一步</button>}
      </section>

      <aside className="demo-inspector" aria-label="演示记忆与来源">
        <section className="demo-memory-card" data-testid="demo-memory-card">
          <div className="demo-memory-heading"><span><Sparkles size={16} />演示记忆</span><span className={cx("demo-memory-status", memory && "status-" + memory.status)}>{memory ? STATUS[memory.status] : "尚未提炼"}</span></div>
          {memory ? <>
            <h2>{memory.title}</h2><p className="demo-memory-body">{memory.body}</p>
            <dl className="demo-memory-facts"><dt>适用条件</dt><dd>{memory.trigger}</dd><dt>环境证据</dt><dd>{memory.validatedEnvironments.join(" / ")}</dd><dt>当前有效性</dt><dd>{memory.freshness === "fresh" ? "当前环境已验证（模拟）" : "环境变化，等待重验"}</dd></dl>
            <div className="demo-tags">{memory.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
            <div className="demo-memory-feedback"><span>有帮助 <strong>{memory.helped}</strong></span><span>负面反馈 <strong>{memory.harmful}</strong></span></div>
            <details className="demo-evidence-links"><summary><Link2 size={13} />{memory.evidenceIds.length} 条来源证据</summary>{memory.evidenceIds.map(id => {
              const log = state.logs.find(item => item.id === id);
              return <p key={id}><code>{id}</code><span>{log?.message.replace(/^\[模拟\]\s*/, "") || "对应的模拟样例记录保存在导出文件中。"}</span></p>;
            })}</details>
          </> : <div className="demo-memory-empty"><BookOpen size={28} /><p>先解决并验证一个问题，<br />再让经验成为候选。</p><span>此处会随你的操作更新</span></div>}
        </section>

        <section className="demo-history"><div className="demo-history-heading"><span><History size={15} />本次过程</span><span>{state.logs.length}</span></div>
          <ol>{[...state.logs].reverse().map(log => <li key={log.id} data-level={log.level}><span className="demo-log-dot" /><div><strong>{log.title.replace(/^\[模拟\]\s*/, "")}</strong><p>{log.message.replace(/^\[模拟\]\s*/, "")}</p></div></li>)}</ol>
          <span className="demo-local-label">模拟事件 · 不是真实 Agent 执行记录</span>
        </section>
      </aside>
    </div>
    <span className="sr-only" aria-live="polite">{latest?.title}。{latest?.message}</span>
  </div>;
}
