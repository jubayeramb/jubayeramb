/** @type {import('tailwindcss').Config} */
const defaultTheme = require("tailwindcss/defaultTheme");

module.exports = {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        fg: "var(--fg)",
        "fg-2": "var(--fg-2)",
        "fg-3": "var(--fg-3)",
        line: "var(--line)",
        "line-2": "var(--line-2)",
        accent: "var(--accent)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", ...defaultTheme.fontFamily.sans],
        serif: ["Newsreader", "Iowan Old Style", "Georgia", ...defaultTheme.fontFamily.serif],
        mono: ["JetBrains Mono", "ui-monospace", "SF Mono", ...defaultTheme.fontFamily.mono],
      },
    },
  },
};
