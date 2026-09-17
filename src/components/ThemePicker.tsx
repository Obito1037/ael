import { useEffect, useRef, useState } from "react";
import { Check, SunMoon } from "lucide-react";
import { useStore } from "../store";
import { THEMES } from "../themes";
import { cx } from "../lib/format";

function Swatches({ swatch }: { swatch: [string, string, string, string] }) {
  const [bg, panel, accent, ink] = swatch;
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-ink/10"
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

/** 侧栏底部的主题切换器。 */
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
          "flex w-full items-center gap-2.5 rounded-lg border border-transparent px-3 py-2 text-[12px] transition-colors",
          open ? "bg-panel2 text-ink" : "text-ink/52 hover:bg-panel2/70 hover:text-ink/82",
        )}
      >
        <SunMoon className="h-[15px] w-[15px] text-ink/46" strokeWidth={1.7} />
        <span className="flex-1 text-left">外观</span>
        <Swatches swatch={current.swatch} />
      </button>

      {open && (
        <div className="glass-surface absolute bottom-[calc(100%+8px)] left-0 z-50 w-[230px] animate-pop-in overflow-hidden rounded-[20px]">
          <div className="border-b border-line px-3 py-2.5 text-[10px] tracking-[0.12em] text-ink/38">
            外观
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
                    "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                    active ? "bg-panel2" : "hover:bg-panel2/70",
                  )}
                >
                  <Swatches swatch={t.swatch} />
                  <span className="flex-1">
                    <span className="block text-[12px] text-ink/86">{t.name}</span>
                    <span className="text-[9.5px] text-ink/34">
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
