---
layout: "../../layouts/BlogLayout.astro"
title: "Tailwind CSS Dark Mode without `dark:` Prefixes"
description: "A quick guide on how to add dark mode to your Astro (or whatever) website without `dark:` prefixes using Tailwind CSS. Also supports `prefers-color-scheme` media query."
date: 2023-11-10
tags: ["technical", "astro", "tailwindcss", "css"]
---

A quick guide on how to add dark mode to your Astro (or whatever) website using Tailwind CSS without `dark:` prefixes. Also supports `prefers-color-scheme` media query. </br>
In this blog, I will show you how to add dark mode to a Astro website. This will also work with any other framework or even vanilla HTML/CSS/JS. </br>
You can check the complete source code of this blog on [GitHub](https://github.com/jubayeramb/astro-tailwind-dark-theme).

### 1. Initial setup

Initialize an Astro project by running the following command in your terminal:

```bash
npm create astro@latest
```

> You can use your preferred package manager (`yarn` or `pnpm`) instead of `npm` if you want.

You can choose to use the default template or any other template you want. I will be using the default template for this blog. You can go with or without TypeScript.
Once your project is initialized and dependencies are installed, you can start the dev server by running:

```bash
npm run dev
```

The default dev server will be running on `localhost:4321`.

### 2. Add Tailwind CSS

You can add Tailwind CSS to your project by running the following command in your terminal:

```bash
npx astro add tailwind
```

The `astro add` CLI command will automatically install the required dependencies and add the required Tailwind configuration to your project. So you're now good to go with Tailwind CSS!

> You can also add Tailwind CSS manually by following the [Manual Tailwind CSS installation documentation](https://docs.astro.build/en/guides/integrations-guide/tailwind/#manual-install) on Astro doc.

### 3. Clean up the project (optional)

If you chose the empty template, you don't need to follow this step. But if you chose any other template, you can clean up the project by removing the unnecessary files and code. You can remove the following files and folders:

- `src/pages/index.astro`
- `src/components/Card.astro`

Now create a new file `src/pages/index.astro` and add the following code:

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

Also replace the content of `src/layouts/Layout.astro` with the following code:

```astro
---
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

> **Notice** defining the `Props` type helps you getting type support for the component incoming props. If you didn't choose TypeScript, you can remove the `Props` interface.

Now you can save the files and check the browser (make suer the dev server is running). You should see a page with a title "Welcome To Your Site" placed in the center of the page. _**Notice that the Tailwind CSS is already working.**_

### 4. Add dark mode

Now we will add dark mode to our website. We will be using the `prefers-color-scheme` media query to detect the user's system preference by default and then we will add a toggle button to switch between light and dark mode.
To skip the `dark:` prefixes, we will take advantage of the Tailwind color palette customization and CSS variables. First we will declare two color variable in our `./src/styles/global.css` file and define the colors in the `tailwind.config.js` file and then we will use the `bg-[color]` and `text-[color]` classes to apply the colors to the elements.

#### 4.1. Add color variables

Create a `global.css` file in the `./src/styles/` directory and add the following code:

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

> Here we are using the `--color-bgColor` and `--color-contentColor` variables to define the background and content colors. We are also using the `--sun-fill` and `--moon-fill` variables to define the fill color of the sun and moon icons. We will use these variables in the `tailwind.config.js` file to define the colors.

> **Notice** that we are using the `:root[data-theme="light"]` and `:root[data-theme="dark"]` selectors to define the colors. We will use the `data-theme` attribute to switch between light and dark mode. We're also using the `prefers-color-scheme` media query to detect the user's system preference by default.

#### 4.2. Add color definitions

Now open the `tailwind.config.cjs` file and add the following code:

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

#### 4.3. Import global styles

Usually you will be using the `Layout.astro` component to wrap your other pages. So import the `global.css` file in the `./src/layouts/Layout.astro` file frontmatter (otherwise add it to the `index.astro` file, if you're not using the `Layout.astro` component) like this:

```astro
---
interface Props {
    title: string;
}

const { title } = Astro.props;

import "../styles/global.css";
---
```

Now all you need to do is to use the `bg-bgColor` and `text-contentColor` classes to apply the colors to the elements. For example, you can replace the `<body>` element of the `./src/layouts/Layout.astro` wrapper file with the following code:

```astro
  <body class="text-contentColor bg-bgColor">
    <slot />
  </body>
```

**Wohoo! You have successfully added dark mode to your website!** 🔥 </br>
Now your site will respond to the user's system preference. Toggle your System theme to see the effect on your site. But we still need to add a toggle button for the user to switch between light and dark mode manually.

#### 4.4. Add a toggle button

Now we will add a toggle button to switch between light and dark mode manually. We will use the `data-theme` attribute to switch between light and dark mode. We will also use the `--sun-fill` and `--moon-fill` variables to define the fill color of the sun and moon icons. We will use the `bg-[color]` and `text-[color]` classes to apply the colors to the elements.

Create a `ThemeIcon.astro` file into the `./src/components/` directory and add the following code:

```astro
---
---

<button
  id="themeToggle"
  class="border-0 bg-none hover:bg-slate-300/20 p-2 rounded-full"
  aria-label="Toggle dark mode"
>
  <svg width="20px" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <!-- sun -->
    <path
      class="fill-[--sun-fill]"
      fill-rule="evenodd"
      d="M12 17.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zm0 1.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm12-7a.8.8 0 0 1-.8.8h-2.4a.8.8 0 0 1 0-1.6h2.4a.8.8 0 0 1 .8.8zM4 12a.8.8 0 0 1-.8.8H.8a.8.8 0 0 1 0-1.6h2.5a.8.8 0 0 1 .8.8zm16.5-8.5a.8.8 0 0 1 0 1l-1.8 1.8a.8.8 0 0 1-1-1l1.7-1.8a.8.8 0 0 1 1 0zM6.3 17.7a.8.8 0 0 1 0 1l-1.7 1.8a.8.8 0 1 1-1-1l1.7-1.8a.8.8 0 0 1 1 0zM12 0a.8.8 0 0 1 .8.8v2.5a.8.8 0 0 1-1.6 0V.8A.8.8 0 0 1 12 0zm0 20a.8.8 0 0 1 .8.8v2.4a.8.8 0 0 1-1.6 0v-2.4a.8.8 0 0 1 .8-.8zM3.5 3.5a.8.8 0 0 1 1 0l1.8 1.8a.8.8 0 1 1-1 1L3.5 4.6a.8.8 0 0 1 0-1zm14.2 14.2a.8.8 0 0 1 1 0l1.8 1.7a.8.8 0 0 1-1 1l-1.8-1.7a.8.8 0 0 1 0-1z"
    ></path>
    <!-- moon -->
    <path
      class="fill-[--moon-fill]"
      fill-rule="evenodd"
      d="M16.5 6A10.5 10.5 0 0 1 4.7 16.4 8.5 8.5 0 1 0 16.4 4.7l.1 1.3zm-1.7-2a9 9 0 0 1 .2 2 9 9 0 0 1-11 8.8 9.4 9.4 0 0 1-.8-.3c-.4 0-.8.3-.7.7a10 10 0 0 0 .3.8 10 10 0 0 0 9.2 6 10 10 0 0 0 4-19.2 9.7 9.7 0 0 0-.9-.3c-.3-.1-.7.3-.6.7a9 9 0 0 1 .3.8z"
    ></path>
  </svg>
</button>

<script is:inline>
const attributeName = "data-theme";
const theme = (() => {
  if (typeof localStorage !== "undefined") {
    return localStorage.getItem("theme") || null;
  }
})();

if (!!theme) {
  document.documentElement.setAttribute(attributeName, theme);
}

const handleToggleClick = () => {
  const element = document.documentElement;
  const themeAtt = element.attributes.getNamedItem(attributeName)?.value;
  // no att. and system is dark
  if (
    !themeAtt &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    element.setAttribute(attributeName, "light");
    window.localStorage.setItem("theme", "light");
    return;
  } else if (!themeAtt) {
    // no att. and system is light
    element.setAttribute(attributeName, "dark");
    window.localStorage.setItem("theme", "dark");
    return;
  } else if (themeAtt === "light") {
    // light att.
    element.setAttribute(attributeName, "dark");
    window.localStorage.setItem("theme", "dark");
    return;
  } else if (themeAtt === "dark") {
    // dark att.
    element.setAttribute(attributeName, "light");
    window.localStorage.setItem("theme", "light");
    return;
  }
};

document
  .getElementById("themeToggle")
  .addEventListener("click", handleToggleClick);
</script>
```

> Here we are using a SVG icon to toggle between light and dark mode (you can update the icon as of your choice). We are also using the `localStorage` API to store the user's preference. We are using the `data-theme` attribute to switch between light and dark mode. We are also using the `--sun-fill` and `--moon-fill` variables to define the fill color of the sun and moon icons. We are using the `bg-[color]` and `text-[color]` classes to apply the colors to the elements.

Now you can import the `ThemeIcon.astro` component in the `./src/layouts/Layout.astro` file and place it anywhere you want. For example, you can place it in the `<body>` element of the `./src/layouts/Layout.astro` wrapper file like this:

```astro
  <body class="text-contentColor bg-bgColor">
    <div class="flex justify-center">
      <ThemeIcon />
    </div>
    <slot />
  </body>
```

> You can create a Nav component and place the `ThemeIcon.astro` component in the Nav component.

**Congratulations! You have successfully added a dynamic dark mode to your website!** 🎉 </br>
You don't event need to add the `dark:` prefixes to the Tailwind CSS classes. You can use the `bg-[color]` and `text-[color]` classes to apply the colors to the elements and the site will automatically adjust the theme color. </br>
Now you can save the files and check the browser (make suer the dev server is running). You should see a toggle button in the center of the page. Click on the button to switch between light and dark mode.

Thanks for reading! 🙏 </br>
