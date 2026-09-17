import { useState } from "react";
import { BookOpenText, FileCheck2, Fingerprint, ListChecks } from "lucide-react";
import { cx } from "../lib/format";
import { Tasks } from "./Tasks";
import { Briefs } from "./Briefs";
import { Blame } from "./Blame";
import { Adr } from "./Adr";

type EvidenceTab = "chain" | "review" | "blame" | "decisions";

const TABS: Array<{ id: EvidenceTab; label: string; icon: typeof ListChecks }> = [
  { id: "chain", label: "任务与证据", icon: ListChecks },
  { id: "review", label: "Review Brief", icon: FileCheck2 },
  { id: "blame", label: "来源链", icon: Fingerprint },
  { id: "decisions", label: "决策记录", icon: BookOpenText },
];

/**
 * Evidence is the compact shell for the former task/review/blame/ADR pages.
 * The existing feature views remain reusable and their visual language is not
 * duplicated or changed; this shell only gives them one coherent entry point.
 */
export function Evidence() {
  const [tab, setTab] = useState<EvidenceTab>("chain");
  const Active = tab === "chain" ? Tasks : tab === "review" ? Briefs : tab === "blame" ? Blame : Adr;

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2 rounded-2xl border border-line bg-panel2/38 p-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            onClick={() => setTab(id)}
            className={cx(
              "flex items-center gap-2 rounded-xl px-3.5 py-2 text-[11.5px] transition-colors",
              tab === id ? "bg-orange/[0.09] text-orange" : "text-ink/48 hover:bg-panel2 hover:text-ink/72",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
      <Active />
    </div>
  );
}
