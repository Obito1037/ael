import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from "lucide-react";
import { useStore } from "../store";
import { cx } from "../lib/format";
import type { ToastKind } from "../types";

const icon: Record<ToastKind, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};
const tone: Record<ToastKind, string> = {
  info: "text-blue",
  success: "text-green",
  warning: "text-orange",
  error: "text-red",
};

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed left-1/2 top-5 z-[60] flex w-[390px] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = icon[t.kind];
        return (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={cx(
              "glass-surface pointer-events-auto flex items-start gap-3 rounded-[18px] px-4 py-3 text-left text-[12.5px] text-ink/80 animate-slide-down",
              tone[t.kind],
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="leading-snug">{t.message}</span>
          </button>
        );
      })}
    </div>
  );
}
