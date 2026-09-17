/** @type {import('tailwindcss').Config} */
// 颜色全部走 CSS 变量(--c-* 为「R G B」通道值),因此支持像 VSCode 一样运行时换主题,
// 且保留 tailwind 的透明度修饰符(text-ink/50、border-ink/10 等)。
const withVar = (name) => `rgb(var(${name}) / <alpha-value>)`;

module.exports = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: withVar("--c-bg"),
        panel: withVar("--c-panel"),
        panel2: withVar("--c-panel2"),
        ink: withVar("--c-ink"),
        // 品牌强调色(可换主题;orange 与 accent 同源,组件沿用 orange 即可)
        orange: withVar("--c-accent"),
        accent: withVar("--c-accent"),
        green: withVar("--c-green"),
        red: withVar("--c-red"),
        blue: withVar("--c-blue"),
        amber: withVar("--c-amber"),
        line: withVar("--c-line"),
        muted: withVar("--c-muted"),
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI Variable"',
          '"Segoe UI"',
          '"PingFang SC"',
          '"Microsoft YaHei UI"',
          '"Noto Sans SC"',
          "sans-serif",
        ],
        mono: ['"Cascadia Code"', '"SFMono-Regular"', '"JetBrains Mono"', "Consolas", "ui-monospace", "monospace"],
        display: ['"Songti SC"', '"STSong"', '"Noto Serif SC"', "Georgia", "serif"],
        serif: ['"Songti SC"', '"STSong"', '"Noto Serif SC"', "Georgia", "serif"],
      },
      borderRadius: {
        xl: "18px",
        lg: "13px",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "none" },
        },
        blink: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.25" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.28s cubic-bezier(0.22,1,0.36,1)",
        blink: "blink 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
