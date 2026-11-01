import "../lib/openui-bootstrap";
import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { useMemo, useState } from "react";
import { z } from "zod/v4";
import type { Skill } from "../types";

const fields = z.object({
  name: z.string(),
  trigger: z.string(),
  body: z.string(),
  freshness: z.string(),
  helped: z.number(),
  failed: z.number(),
  tags: z.string(),
});

const EvidenceCard = defineComponent({
  name: "EvidenceCard",
  description: "Expandable evidence for an AEL memory. Read-only; no tools or remote content.",
  props: fields,
  component: ({ props }) => <details className="evidence-card">
    <summary>
      <span className="evidence-card-title">{props.name}</span>
      <span className={props.freshness === "fresh" ? "evidence-fresh" : "evidence-stale"}>
        {props.freshness === "fresh" ? "有效" : "待重验"}
      </span>
    </summary>
    <p className="evidence-trigger">适用场景 · {props.trigger}</p>
    <div className="evidence-body">{props.body || "暂无详细内容。"}</div>
    <div className="evidence-footer"><span>有效反馈 {props.helped} · 失败 {props.failed}</span><span>{props.tags}</span></div>
  </details>,
});

const EvidenceList = defineComponent({
  name: "EvidenceList",
  description: "A list of task-relevant evidence cards.",
  props: z.object({ children: z.array(EvidenceCard.ref) }),
  component: ({ props, renderNode }) => <div className="evidence-list">{renderNode(props.children)}</div>,
});

const library = createLibrary({ components: [EvidenceList, EvidenceCard], root: "EvidenceList" });

export default function MemoryEvidenceRenderer({ skills }: { skills: Skill[] }) {
  const [failedResponse, setFailedResponse] = useState<string | null>(null);
  const response = useMemo(() => {
    // Positional arguments must match the schema order. Encode every value;
    // memory text is data, never a program, HTML, URL, or a tool invocation.
    const cards = skills.slice(0, 20).map(skill => {
      const data = fields.parse({
        name: String(skill.name ?? "未命名记忆").slice(0, 240),
        trigger: String(skill.trigger ?? "").slice(0, 1000),
        body: String(skill.body ?? "").slice(0, 6000),
        freshness: String(skill.freshness ?? "needs_revalidation"),
        helped: Number.isFinite(skill.successCount) ? skill.successCount : 0,
        failed: Number.isFinite(skill.failCount) ? skill.failCount : 0,
        tags: Array.isArray(skill.tags) ? skill.tags.slice(0, 3).join(" / ") : "",
      });
      return `EvidenceCard(${Object.values(data).map(value => JSON.stringify(value)).join(", ")})`;
    });
    return `root = EvidenceList([${cards.join(", ")}])`;
  }, [skills]);

  if (failedResponse === response) return <div role="status" className="text-sm text-ink/60">
    记忆卡片暂时无法呈现，可从记忆库查看原始记录。
  </div>;

  return <Renderer response={response} library={library} isStreaming={false} publishObservability={false}
    onError={errors => { if (errors.some(error => error.severity !== "warning")) setFailedResponse(response); }} />;
}
