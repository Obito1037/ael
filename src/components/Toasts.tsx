import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { useStore } from "../store";
import { cx } from "../lib/format";
import type { ToastKind } from "../types";

const icon: Record<ToastKind, any> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};
const tone: Record<ToastKind, string> = {
  info: "text-blue border-blue/30",
  success: "text-green border-green/30",
  warning: "text-orange border-orange/40",
  error: "text-red border-red/40",
};

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => {
        const Icon = icon[t.kind];
        return (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={cx(
              "pointer-events-auto flex items-start gap-3 rounded-xl border bg-panel/95 px-4 py-3 text-left text-[13px] text-ink/85 shadow-2xl backdrop-blur animate-slide-down",
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
