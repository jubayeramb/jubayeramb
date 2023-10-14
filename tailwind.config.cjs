/** @type {import('tailwindcss').Config} */
const defaultTheme = require("tailwindcss/defaultTheme");
const plugin = require("tailwindcss/plugin");

module.exports = {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      colors: {
        bgc: "rgb(var(--color-bgc) / <alpha-value>)",
        content: "rgb(var(--color-content) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Poppins", ...defaultTheme.fontFamily.sans],
      },
    },
  },
  // darkMode: ["class", '[data-theme="dark"]'],
  // plugins: [
  //   plugin(function ({ addVariant }) {
  //     addVariant("system-dark", "@media (prefers-color-scheme: dark)");
  //   }),
  // ],
};
