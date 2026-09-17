import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./lib/format";

export type Tone = "orange" | "green" | "red" | "blue" | "amber" | "ink";

const toneText: Record<Tone, string> = {
  orange: "text-orange",
  green: "text-green",
  red: "text-red",
  blue: "text-blue",
  amber: "text-amber",
  ink: "text-ink/62",
};

const toneSurface: Record<Tone, string> = {
  orange: "border-orange/24 bg-orange/[0.07]",
  green: "border-green/22 bg-green/[0.07]",
  red: "border-red/22 bg-red/[0.065]",
  blue: "border-blue/20 bg-blue/[0.055]",
  amber: "border-amber/22 bg-amber/[0.07]",
  ink: "border-ink/10 bg-ink/[0.025]",
};

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
    <As
      className={cx(
        "rounded-[18px] border border-line/95 bg-panel/88 shadow-[0_1px_0_rgb(255_255_255_/_0.64)]",
        className,
      )}
    >
      {children}
    </As>
  );
}

export function Kicker({ badge, children }: { badge?: string; children: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-[12px] font-medium tracking-[0.12em] text-ink/44">
      {badge && (
        <span className="rounded-md border border-line bg-panel2/80 px-2 py-0.5 text-ink/50">{badge}</span>
      )}
      <span className="truncate">{children}</span>
    </div>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-8 max-w-3xl">
      <h1 className="font-serif text-[26px] font-normal leading-[1.25] tracking-[-0.015em] text-ink">
        {children}
      </h1>
      {sub && <p className="mt-2 text-[14px] leading-[1.7] text-ink/50">{sub}</p>}
    </div>
  );
}

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
        "inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-[12px] font-medium leading-5",
        toneSurface[tone],
        toneText[tone],
        solid && "shadow-[inset_0_1px_0_rgb(255_255_255_/_0.35)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-lg border border-line bg-panel2/72 px-2.5 py-1 text-[13px] text-ink/56",
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
  const variants: Record<BtnVariant, string> = {
    primary:
      "border-orange bg-orange text-white shadow-[0_7px_18px_rgb(var(--c-accent)_/_0.14)] hover:-translate-y-px hover:shadow-[0_10px_23px_rgb(var(--c-accent)_/_0.2)]",
    ghost: "border-line bg-panel/68 text-ink/72 hover:border-ink/16 hover:bg-panel",
    subtle: "border-transparent text-ink/50 hover:bg-panel2/72 hover:text-ink/82",
    danger: "border-red/28 bg-red/[0.045] text-red hover:bg-red/[0.085]",
  };

  return (
    <button
      className={cx(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-[14px] font-medium transition-[transform,box-shadow,background,color,border-color] duration-150 disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

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
      <div className={cx("font-serif text-[30px] leading-none tabular-nums", toneText[tone])}>
        {value}
        {unit && <span className="ml-1 font-sans text-[11px] text-ink/42">{unit}</span>}
      </div>
      <div className="mt-2 text-[14px] leading-relaxed text-ink/48">{label}</div>
    </div>
  );
}

export function Empty({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "rounded-[18px] border border-line/80 bg-panel2/52 px-6 py-10 text-center text-[14px] leading-relaxed text-ink/44",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-2">
      <span className="text-[13.5px] font-medium tracking-[0.04em] text-ink/52">{label}</span>
      {children}
      {hint && <span className="block text-[12.5px] leading-relaxed text-ink/40">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-xl border border-line bg-panel/84 px-3.5 py-2.5 text-[15px] leading-[1.6] text-ink shadow-[inset_0_1px_1px_rgb(var(--c-ink)_/_0.018)] placeholder:text-ink/28 focus:border-orange/42 focus:bg-panel";

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/18 p-4 backdrop-blur-[7px]"
      onClick={onClose}
    >
      <div
        className={cx(
          "glass-surface max-h-[88vh] w-full overflow-hidden rounded-[24px] shadow-[var(--shadow-float)]",
          wide ? "max-w-5xl" : "max-w-xl",
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line/80 px-5 py-4">
          <h2 className="font-serif text-[19px] font-normal text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="icon-button h-8 w-8" aria-label="关闭">
            <X className="h-3.5 w-3.5" strokeWidth={1.6} />
          </button>
        </div>
        <div className="max-h-[calc(88vh-64px)] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink/16 border-t-orange",
        className,
      )}
    />
  );
}

export function Meter({ ratio, tone = "orange" }: { ratio: number; tone?: Tone }) {
  const bg: Record<Tone, string> = {
    orange: "bg-orange",
    green: "bg-green",
    red: "bg-red",
    blue: "bg-blue",
    amber: "bg-amber",
    ink: "bg-ink/42",
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel2">
      <div
        className={cx("h-full rounded-full transition-[width] duration-500", bg[tone])}
        style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
      />
    </div>
  );
}
