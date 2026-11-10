---
title: "Tailwind CSS v4 Dark Mode without `dark:` Prefixes"
description: "Add dark mode to an Astro (or any) site with Tailwind CSS v4 and CSS variables, no `dark:` prefixes. Follows prefers-color-scheme, with a toggle."
pubDate: 2023-11-10
updatedDate: 2026-11-11
tags: ["technical", "astro", "tailwindcss", "css", "html", "javascript"]
tldr:
  - "Define your colors once as Tailwind theme variables, then override those variables for dark mode. Every `bg-*` and `text-*` class follows the theme on its own, so you never write `dark:`."
  - "In Tailwind v4 that's a few lines of CSS: `@theme` for the light values, a `prefers-color-scheme` block and a `[data-theme=\"dark\"]` block for the dark ones. No `tailwind.config.js`."
  - "Opacity modifiers like `bg-content/10` work out of the box in v4. The `rgb(var(--x) / <alpha-value>)` trick from v3 is gone."
  - "Still on Tailwind v3? The same idea works with `theme.extend.colors` in the config file. That version is at the end."
faq:
  - q: "How do I add dark mode in Tailwind CSS v4?"
    a: "By default, `dark:` in v4 follows `prefers-color-scheme`. To avoid `dark:` entirely, define colors in `@theme` and override the same variables under a dark selector, as this post does."
  - q: "How do I make Tailwind v4 dark mode follow a class or data attribute?"
    a: "Add `@custom-variant dark (&:where([data-theme=\"dark\"], [data-theme=\"dark\"] *));` to your CSS. Swap the selector for `.dark` if you toggle a class instead."
  - q: "Where did tailwind.config.js go in v4?"
    a: "Configuration moved into CSS. Theme values live in an `@theme` block in the same file that has `@import \"tailwindcss\";`. A JS config still works through `@config`, but you don't need one for this."
  - q: "Does this work outside Astro?"
    a: "Yes. The CSS and the toggle script are plain CSS and JavaScript. Only the install step and the `.astro` file wrappers are Astro-specific."
---

A quick guide on how to add dark mode to your Astro (or whatever) website using Tailwind CSS without `dark:` prefixes.
It follows the user's system theme through the `prefers-color-scheme` media query, and adds a toggle on top.
This also works with any other framework or plain HTML/CSS/JS.

> Note: I first wrote this post in November 2023 for Tailwind CSS v3.
> It's now updated for Tailwind CSS v4, which moved configuration from `tailwind.config.js` into CSS.
> The v3 version is still at the [end of the post](#still-on-tailwind-v3) if you need it.

You can check the source code of the original version on [GitHub](https://github.com/jubayeramb/astro-tailwind-dark-theme).

## The idea in one paragraph

Tailwind's color classes read CSS variables.
`bg-bg` compiles to `background-color: var(--color-bg)`.
So instead of writing `bg-white dark:bg-slate-900` on every element, we define `--color-bg` once and give it a different value in dark mode.
Every element using `bg-bg` switches with it.

## 1. Initial setup

Initialize an Astro project by running the following command in your terminal:

```bash
npm create astro@latest
```

> You can use your preferred package manager (`yarn` or `pnpm`) instead of `npm` if you want.

You can choose the default template or any other one.
I'll use the minimal template here.
Once your project is initialized and dependencies are installed, start the dev server:

```bash
npm run dev
```

The default dev server runs on `localhost:4321`.

## 2. Add Tailwind CSS

Add Tailwind CSS to your project with:

```bash
npx astro add tailwind
```

This installs Tailwind CSS v4 with its Vite plugin, `@tailwindcss/vite`.
It registers the plugin in `astro.config.mjs` and creates `src/styles/global.css` with a single line:

```css
@import "tailwindcss";
```

Your `astro.config.mjs` should now look like this:

```js
// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
});
```

There's no `tailwind.config.js` in v4.
Theme values live in CSS, which is exactly what makes this approach shorter now.

> Note: the old `@astrojs/tailwind` integration only supports Tailwind v3.
> If you're upgrading an existing project, remove it and follow the [Tailwind CSS Astro guide](https://tailwindcss.com/docs/installation/framework-guides/astro).

## 3. Clean up the project (optional)

If you chose the minimal template, skip this step.
Otherwise, remove the template's pages and components, then create `src/pages/index.astro`:

```astro
---
import Layout from "../layouts/Layout.astro";
---

<Layout title="Your Site">
  <main class="w-full h-screen flex items-center justify-center">
    <h1 class="font-bold text-2xl">Welcome To Your Site</h1>
  </main>
</Layout>
```

And replace `src/layouts/Layout.astro` with:

```astro
---
import "../styles/global.css";

interface Props {
  title: string;
}

const { title } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="Your site description" />
    <meta name="viewport" content="width=device-width" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="generator" content={Astro.generator} />
    <title>{title}</title>
  </head>
  <body>
    <slot />
  </body>
</html>
```

> **Notice** defining the `Props` type gives you type support for the component's props.
> If you didn't choose TypeScript, you can remove the `Props` interface.

Save the files and check the browser (make sure the dev server is running).
You should see "Welcome To Your Site" in the center of the page, already styled by Tailwind.

## 4. Add dark mode

We'll use the `prefers-color-scheme` media query to follow the user's system theme by default, then add a toggle button to switch manually.

### 4.1. Define the colors

Open `src/styles/global.css` and replace it with:

```css
@import "tailwindcss";

/* Light values. Each --color-* variable becomes a utility: bg-bg, text-content, ... */
@theme {
  --color-bg: rgb(221 230 237);
  --color-content: rgb(34 40 49);
}

@layer base {
  :root {
    --sun-fill: rgb(0 0 0);
    --moon-fill: transparent;
  }

  /* System is dark, and the user hasn't picked light. */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --color-bg: rgb(34 40 49);
      --color-content: rgb(238 238 238);
      --sun-fill: transparent;
      --moon-fill: rgb(255 255 255);
    }
  }

  /* The user picked dark with the toggle. */
  :root[data-theme="dark"] {
    --color-bg: rgb(34 40 49);
    --color-content: rgb(238 238 238);
    --sun-fill: transparent;
    --moon-fill: rgb(255 255 255);
  }
}
```

> Here `@theme` declares `--color-bg` and `--color-content` as theme colors, so Tailwind generates `bg-bg`, `text-content`, `border-content` and the rest.
> The two dark blocks then override the same variables.
> `--sun-fill` and `--moon-fill` are plain variables for the toggle icon, not theme colors.

> **Notice** the `:root:not([data-theme="light"])` selector.
> It applies the dark colors when the system is dark, unless the user has switched to light with the toggle.
> `:root[data-theme="dark"]` covers the opposite case: system light, user picked dark.

There's no config file to edit.
In v3 this step needed a second file and the `rgb(var(--x) / <alpha-value>)` trick to keep opacity modifiers working.
In v4, `bg-content/10` works on any color, because Tailwind mixes it with `color-mix()` for you.

### 4.2. Use the colors

The layout already imports `global.css`.
Now use `bg-bg` and `text-content` on the `<body>` in `src/layouts/Layout.astro`:

```astro
  <body class="text-content bg-bg">
    <slot />
  </body>
```

**Woohoo! You have successfully added dark mode to your website!** 🔥

Your site now follows the system theme.
Switch your OS between light and dark to see it change.
Next, a toggle so the user can choose for themselves.

### 4.3. Add a toggle button

The toggle sets a `data-theme` attribute on `<html>` and remembers the choice in `localStorage`.

Create `src/components/ThemeIcon.astro`:

```astro
<button
  id="themeToggle"
  class="border-0 bg-none hover:bg-slate-300/20 p-2 rounded-full"
  aria-label="Toggle dark mode"
>
  <svg width="20px" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <!-- sun -->
    <path
      class="fill-(--sun-fill)"
      fill-rule="evenodd"
      d="M12 17.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zm0 1.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm12-7a.8.8 0 0 1-.8.8h-2.4a.8.8 0 0 1 0-1.6h2.4a.8.8 0 0 1 .8.8zM4 12a.8.8 0 0 1-.8.8H.8a.8.8 0 0 1 0-1.6h2.5a.8.8 0 0 1 .8.8zm16.5-8.5a.8.8 0 0 1 0 1l-1.8 1.8a.8.8 0 0 1-1-1l1.7-1.8a.8.8 0 0 1 1 0zM6.3 17.7a.8.8 0 0 1 0 1l-1.7 1.8a.8.8 0 1 1-1-1l1.7-1.8a.8.8 0 0 1 1 0zM12 0a.8.8 0 0 1 .8.8v2.5a.8.8 0 0 1-1.6 0V.8A.8.8 0 0 1 12 0zm0 20a.8.8 0 0 1 .8.8v2.4a.8.8 0 0 1-1.6 0v-2.4a.8.8 0 0 1 .8-.8zM3.5 3.5a.8.8 0 0 1 1 0l1.8 1.8a.8.8 0 1 1-1 1L3.5 4.6a.8.8 0 0 1 0-1zm14.2 14.2a.8.8 0 0 1 1 0l1.8 1.7a.8.8 0 0 1-1 1l-1.8-1.7a.8.8 0 0 1 0-1z"
    ></path>
    <!-- moon -->
    <path
      class="fill-(--moon-fill)"
      fill-rule="evenodd"
      d="M16.5 6A10.5 10.5 0 0 1 4.7 16.4 8.5 8.5 0 1 0 16.4 4.7l.1 1.3zm-1.7-2a9 9 0 0 1 .2 2 9 9 0 0 1-11 8.8 9.4 9.4 0 0 1-.8-.3c-.4 0-.8.3-.7.7a10 10 0 0 0 .3.8 10 10 0 0 0 9.2 6 10 10 0 0 0 4-19.2 9.7 9.7 0 0 0-.9-.3c-.3-.1-.7.3-.6.7a9 9 0 0 1 .3.8z"
    ></path>
  </svg>
</button>

<script is:inline>
  const attributeName = "data-theme";
  const element = document.documentElement;

  const handleToggleClick = () => {
    const current = element.getAttribute(attributeName);
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = current ? current === "dark" : systemDark;
    const next = isDark ? "light" : "dark";
    element.setAttribute(attributeName, next);
    localStorage.setItem("theme", next);
  };

  document.getElementById("themeToggle").addEventListener("click", handleToggleClick);
</script>
```

> Note: `fill-(--sun-fill)` is the v4 shorthand for "use this CSS variable".
> In v3 it was written `fill-[--sun-fill]`.

Then restore the saved choice before the page paints.
Put this in the `<head>` of `src/layouts/Layout.astro`, so the page doesn't flash the wrong theme on load:

```astro
<script is:inline>
  const theme = localStorage.getItem("theme");
  if (theme) document.documentElement.setAttribute("data-theme", theme);
</script>
```

Now import `ThemeIcon.astro` in the layout and place it anywhere, for example at the top of the `<body>`:

```astro
---
import "../styles/global.css";
import ThemeIcon from "../components/ThemeIcon.astro";
// ...
---

  <body class="text-content bg-bg">
    <div class="flex justify-center">
      <ThemeIcon />
    </div>
    <slot />
  </body>
```

> You can create a Nav component and place `ThemeIcon.astro` in it.

**Congratulations! You added a dynamic dark theme to your site!** 🎉

You don't need `dark:` on every class that changes with the theme.
Use `bg-bg`, `text-content` and the other theme colors, and the site follows the theme on its own.
Click the button to switch between light and dark mode.

## When you still want `dark:`

Sometimes one element needs a different treatment in dark mode, not just a different color, like a shadow or an image filter.
In v4, `dark:` follows `prefers-color-scheme` by default, so it would ignore the toggle.
Point it at the same `data-theme` attribute with one line in `global.css`:

```css
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
```

Now `dark:shadow-none` applies when the toggle says dark.
I keep this for the rare exception and let the theme colors do the rest.

## Still on Tailwind v3?

The idea is the same, but the colors are defined in two places.
In `global.css`, store the colors as space-separated RGB channels:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root,
  :root[data-theme="light"] {
    --color-bgColor: 221 230 237;
    --color-contentColor: 34 40 49;
    --sun-fill: rgb(0, 0, 0);
    --moon-fill: transparent;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --color-bgColor: 34 40 49;
      --color-contentColor: 238 238 238;
      --sun-fill: transparent;
      --moon-fill: rgb(255, 255, 255);
    }
  }
  :root[data-theme="dark"] {
    --color-bgColor: 34 40 49;
    --color-contentColor: 238 238 238;
    --sun-fill: transparent;
    --moon-fill: rgb(255, 255, 255);
  }
}
```

Then register them in `tailwind.config.js`, with `<alpha-value>` so opacity modifiers keep working:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      colors: {
        bgColor: "rgb(var(--color-bgColor) / <alpha-value>)",
        contentColor: "rgb(var(--color-contentColor) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
```

Use `bg-bgColor` and `text-contentColor` on your elements, and `fill-[--sun-fill]` / `fill-[--moon-fill]` in the toggle icon.
The toggle script is the same.

Thanks for reading! 🙏
