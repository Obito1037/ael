import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react";

type Props = {
  children: ReactNode;
  resetKey?: string;
  onHome?: () => void;
};

/** Keep navigation available when a single view fails to render. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AEL] View rendering failed", error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="recovery-panel" role="alert">
        <span className="recovery-icon"><AlertTriangle size={24} /></span>
        <h1>这个页面暂时无法显示</h1>
        <p>可以重新打开页面，或返回新建任务。此操作不会删除任务和历史记录。</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" className="recovery-action" onClick={() => this.setState({ error: null })}>
            <RotateCcw size={16} /> 重试页面
          </button>
          {this.props.onHome ? (
            <button type="button" className="recovery-action" onClick={this.props.onHome}>
              <ArrowLeft size={16} /> 返回新建任务
            </button>
          ) : null}
          <button type="button" className="recovery-action" onClick={() => window.location.reload()}>
            重新加载应用
          </button>
        </div>
        <details className="mt-5 text-left">
          <summary className="cursor-pointer text-sm text-ink/60">错误详情</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-ink/55">{this.state.error.message}</pre>
        </details>
      </section>
    );
  }
}
