// 主题注册表 —— 实际配色在 index.css 的 :root[data-theme] 块里,
// 这里只放切换器要用的元数据与预览色板(hex,仅用于 UI 展示)。

export interface ThemeDef {
  id: string;
  name: string;
  kind: "dark" | "light";
  /** 预览色板:底 / 面板 / 强调 / 文字 */
  swatch: [string, string, string, string];
}

export const THEMES: ThemeDef[] = [
  { id: "graphite", name: "石墨橙", kind: "dark", swatch: ["#0F1216", "#1B222B", "#FF6A2B", "#E9EDF2"] },
  { id: "midnight", name: "午夜蓝", kind: "dark", swatch: ["#0A0E1A", "#171F36", "#5494FF", "#E4EBF7"] },
  { id: "forest", name: "深林绿", kind: "dark", swatch: ["#0D1411", "#1A2821", "#34D399", "#E4F0E8"] },
  { id: "amethyst", name: "暗紫水晶", kind: "dark", swatch: ["#110E1A", "#231C34", "#A78BFA", "#EBE6F6"] },
  { id: "daylight", name: "石灰白", kind: "light", swatch: ["#F4F5F7", "#FFFFFF", "#E25814", "#1A1D22"] },
  { id: "contrast", name: "高对比", kind: "dark", swatch: ["#000000", "#141414", "#FF8A2E", "#FFFFFF"] },
];

export const DEFAULT_THEME = "graphite";
const STORAGE_KEY = "ael-theme";

export function loadTheme(): string {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    if (t && THEMES.some((x) => x.id === t)) return t;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME;
}

/** 应用主题:切换 <html data-theme> 并持久化。
 *  切换瞬间临时关闭全局 transition —— 否则依赖 CSS 变量的 border/color 过渡属性
 *  在变量变化时会卡在旧值(浏览器已知行为),导致换主题「换不干净」。 */
export function applyTheme(id: string): void {
  const theme = THEMES.some((x) => x.id === id) ? id : DEFAULT_THEME;
  const el = document.documentElement;
  el.classList.add("theme-switching");
  el.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
  if (raf) {
    raf(() => raf(() => el.classList.remove("theme-switching")));
  } else {
    el.classList.remove("theme-switching");
  }
}

/** 读取当前主题下某个 CSS 变量的 rgb() 字符串(供 xterm 等运行时消费)。 */
export function cssColor(varName: string, alpha = 1): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return alpha < 1 ? `rgba(0,0,0,${alpha})` : "#000";
  return alpha < 1 ? `rgb(${raw} / ${alpha})` : `rgb(${raw})`;
}
