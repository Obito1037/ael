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
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "Consolas", "monospace"],
        display: ['"Space Grotesk"', '"Noto Sans SC"', "sans-serif"],
      },
      borderRadius: {
        xl: "14px",
        lg: "11px",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "none" },
        },
        blink: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.25" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s cubic-bezier(0.22,1,0.36,1)",
        blink: "blink 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
