import { useEffect, useRef, useState } from "react";
import { Check, Palette } from "lucide-react";
import { useStore } from "../store";
import { THEMES } from "../themes";
import { cx } from "../lib/format";

function Swatches({ swatch }: { swatch: [string, string, string, string] }) {
  const [bg, panel, accent, ink] = swatch;
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md ring-1 ring-black/20"
      style={{ background: bg }}
    >
      <span className="grid h-full w-full grid-cols-2 grid-rows-2">
        <span style={{ background: panel }} />
        <span style={{ background: accent }} />
        <span style={{ background: accent, opacity: 0.5 }} />
        <span style={{ background: ink }} />
      </span>
    </span>
  );
}

/** 侧栏底部的主题切换器 —— 点开像 VSCode 的主题选择弹层。 */
export function ThemePicker() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const current = THEMES.find((t) => t.id === theme) || THEMES[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cx(
          "flex w-full items-center gap-2.5 rounded-lg border border-ink/10 px-3 py-2 text-[12.5px] transition-colors",
          open ? "bg-ink/[0.05] text-ink" : "text-ink/60 hover:bg-ink/[0.03] hover:text-ink/90",
        )}
      >
        <Palette className="h-[15px] w-[15px] text-orange" />
        <span className="flex-1 text-left">主题</span>
        <Swatches swatch={current.swatch} />
      </button>

      {open && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-[230px] animate-pop-in overflow-hidden rounded-xl border border-ink/12 bg-panel shadow-2xl">
          <div className="border-b border-ink/10 px-3 py-2 font-mono text-[10px] tracking-kicker text-ink/40">
            APPEARANCE · 主题配色
          </div>
          <div className="max-h-[320px] overflow-y-auto p-1.5">
            {THEMES.map((t) => {
              const active = t.id === theme;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setTheme(t.id);
                    setOpen(false);
                  }}
                  className={cx(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                    active ? "bg-ink/[0.06]" : "hover:bg-ink/[0.04]",
                  )}
                >
                  <Swatches swatch={t.swatch} />
                  <span className="flex-1">
                    <span className="block text-[13px] text-ink/90">{t.name}</span>
                    <span className="font-mono text-[10px] text-ink/35">
                      {t.kind === "light" ? "浅色" : "深色"}
                    </span>
                  </span>
                  {active && <Check className="h-4 w-4 text-orange" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
