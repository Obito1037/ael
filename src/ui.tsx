import { type ReactNode, type ButtonHTMLAttributes } from "react";
import { cx } from "./lib/format";

export type Tone = "orange" | "green" | "red" | "blue" | "amber" | "ink";

const toneText: Record<Tone, string> = {
  orange: "text-orange",
  green: "text-green",
  red: "text-red",
  blue: "text-blue",
  amber: "text-amber",
  ink: "text-ink/70",
};
const toneBorder: Record<Tone, string> = {
  orange: "border-orange/45",
  green: "border-green/45",
  red: "border-red/45",
  blue: "border-blue/45",
  amber: "border-amber/45",
  ink: "border-ink/15",
};

/** 面板:石墨面 + 细线边框 + 大圆角 */
export function Panel({
  children,
  className,
  as: As = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: any;
}) {
  return (
    <As className={cx("rounded-xl border border-ink/10 bg-panel", className)}>{children}</As>
  );
}

/** kicker 小标签(mono 大字距 + 橙色方块) */
export function Kicker({ badge, children }: { badge?: string; children: ReactNode }) {
  return (
    <p className="mb-4 flex items-center gap-2.5 font-mono text-[11px] tracking-kicker text-ink/55">
      {badge && (
        <b className="rounded-md border border-orange/45 px-2 py-0.5 font-medium text-orange">
          {badge}
        </b>
      )}
      {children}
    </p>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="font-sans text-[26px] font-black leading-tight text-ink">{children}</h1>
      {sub && <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-ink/50">{sub}</p>}
    </div>
  );
}

/** 徽章 */
export function Badge({
  tone = "ink",
  children,
  solid = false,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  solid?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10.5px] tracking-wide",
        toneBorder[tone],
        solid ? "bg-ink/[0.03]" : "",
        toneText[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** 圆角标签胶囊 */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border border-ink/10 bg-ink/[0.02] px-2.5 py-0.5 text-[11px] text-ink/55",
        className,
      )}
    >
      {children}
    </span>
  );
}

type BtnVariant = "primary" | "ghost" | "danger" | "subtle";
export function Button({
  variant = "ghost",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-all disabled:cursor-default disabled:opacity-40";
  const variants: Record<BtnVariant, string> = {
    primary: "bg-orange text-bg hover:-translate-y-px hover:accent-glow",
    ghost: "border border-ink/12 text-ink/85 hover:border-ink/25 hover:bg-ink/[0.03]",
    subtle: "text-ink/55 hover:text-ink hover:bg-ink/[0.04]",
    danger: "border border-red/40 text-red hover:bg-red/10",
  };
  return (
    <button className={cx(base, variants[variant], className)} {...rest}>
      {children}
    </button>
  );
}

/** 统计块 */
export function Stat({
  value,
  label,
  tone = "ink",
  unit,
}: {
  value: ReactNode;
  label: ReactNode;
  tone?: Tone;
  unit?: string;
}) {
  return (
    <div>
      <div className={cx("font-display text-[34px] font-bold leading-none tabular-nums", toneText[tone])}>
        {value}
        {unit && <span className="ml-1 text-[0.42em] text-orange">{unit}</span>}
      </div>
      <div className="mt-2 text-[12.5px] leading-relaxed text-ink/50">{label}</div>
    </div>
  );
}

export function Empty({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "rounded-xl border border-dashed border-ink/12 px-6 py-10 text-center text-[13px] text-ink/40",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="font-mono text-[10.5px] uppercase tracking-kicker text-ink/45">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-ink/35">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-ink/12 bg-panel2 px-3 py-2 text-[13px] text-ink placeholder:text-ink/30 focus:border-orange/50";

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={cx(
          "max-h-[86vh] w-full overflow-hidden rounded-xl border border-ink/12 bg-panel shadow-2xl",
          wide ? "max-w-4xl" : "max-w-xl",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink/10 bg-panel2 px-5 py-3.5">
          <h2 className="font-sans text-[15px] font-bold text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[calc(86vh-56px)] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink/20 border-t-orange",
        className,
      )}
    />
  );
}

/** 微型进度条 */
export function Meter({ ratio, tone = "orange" }: { ratio: number; tone?: Tone }) {
  const bg: Record<Tone, string> = {
    orange: "bg-orange",
    green: "bg-green",
    red: "bg-red",
    blue: "bg-blue",
    amber: "bg-amber",
    ink: "bg-ink/40",
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full border border-ink/10 bg-panel2">
      <div
        className={cx("h-full rounded-full transition-all duration-700", bg[tone])}
        style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
      />
    </div>
  );
}
