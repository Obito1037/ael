import { lazy, Suspense } from "react";
import { ArrowUpRight } from "lucide-react";
import { CdsButton } from "open-claude-ui";
import type { Skill } from "../types";
import { ErrorBoundary } from "./ErrorBoundary";

const EvidenceRenderer = lazy(() => import("./MemoryEvidenceRenderer"));

export function MemoryEvidence({ skills, onOpenMemory }: { skills: Skill[]; onOpenMemory: () => void }) {
  return <section className="memory-evidence" aria-label="关联记忆证据">
    <div className="memory-evidence-heading">
      <span>关联记忆</span><span className="font-mono text-xs text-ink/45">{skills.length} 条</span>
    </div>
    <p className="mb-4 text-xs leading-relaxed text-ink/50">展开查看内容与使用记录。此处为匹配结果，实际注入以启动上下文为准。</p>
    {skills.length === 0 ? <p className="py-5 text-sm text-ink/50">当前任务没有匹配到已启用记忆。</p> :
      <ErrorBoundary resetKey={skills.map(skill => skill.id).join(",")}>
        <Suspense fallback={<p role="status" className="py-5 text-sm text-ink/50">正在加载记忆证据…</p>}>
          <EvidenceRenderer skills={skills} />
        </Suspense>
      </ErrorBoundary>}
    <CdsButton className="mt-4 w-full" variant="ghost" onClick={onOpenMemory}>
      查看记忆库 <ArrowUpRight size={14} />
    </CdsButton>
  </section>;
}
