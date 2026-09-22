import { defineConfig, fontProviders } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { rehypeHeadingIds } from "@astrojs/markdown-remark";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import remarkHeadingGuard from "./src/lib/markdown/remark-heading-guard";
import { shikiAaLight } from "./src/lib/markdown/shiki-aa-light";
import rehypePublicImg from "./src/lib/markdown/rehype-public-img";
import {
  lastModifiedByPath,
  readCollection,
  tagCounts,
} from "./src/lib/build/content-index";
import { isThinTag } from "./src/lib/tags";
import { readNowSnapshot } from "./src/lib/now-snapshot";
import lowPriorityScripts from "./src/lib/build/low-priority-scripts";

const SITE = "https://jubayeramb.com";

// Real per-page modification dates for the sitemap. Pages without a
// trustworthy date get no <lastmod> at all rather than the build time.
const now = readNowSnapshot();
const lastmod = lastModifiedByPath(process.cwd(), {
  "/now/": now.lastEdited ? new Date(now.lastEdited) : undefined,
});

// Tag pages with a single post are noindex (see src/lib/tags.ts), so they
// must not be advertised in the sitemap either.
const thinTagPaths = new Set(
  [...tagCounts(readCollection("posts")).entries()]
    .filter(([, count]) => isThinTag(count))
    .map(([tag]) => `${SITE}/tags/${tag}/`),
);

const EXCLUDED = ["/404", "/ask"];

// Per-route priority. Boosts content pages over taxonomies.
const priorityFor = (page: string) => {
  if (page === `${SITE}/`) return 1.0;
  if (page.startsWith(`${SITE}/writings/`)) return 0.9;
  if (page.startsWith(`${SITE}/projects/`)) return 0.9;
  if (page.startsWith(`${SITE}/now/`)) return 0.8;
  if (page.startsWith(`${SITE}/about/`)) return 0.8;
  if (page.startsWith(`${SITE}/contact/`)) return 0.7;
  if (page.startsWith(`${SITE}/tags/`)) return 0.4;
  return 0.6;
};

// Self-hosted variable fonts from Fontsource, registered through Astro's
// Fonts API: files are served first-party from /_astro/ with immutable
// hashes, and Astro generates metric-matched fallback faces so the swap
// doesn't shift layout.
const fontFile = (pkg: string, file: string) =>
  `./node_modules/@fontsource-variable/${pkg}/files/${file}`;

// https://astro.build/config
export default defineConfig({
  site: SITE,
  trailingSlash: "ignore",
  build: {
    format: "directory",
    inlineStylesheets: "always",
  },
  image: {
    service: {
      entrypoint: "astro/assets/services/sharp",
      // Max AVIF encoder effort for production: 1.5-2.5% smaller at equal
      // or better SSIM than the default (measured on the hero portrait).
      // Build time only, cached in node_modules/.astro. The dev server
      // encodes on request, where effort 9 left the hero blank for ~600ms,
      // so it keeps sharp's default.
      config: { avif: { effort: process.argv.includes("build") ? 9 : 4 } },
    },
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },
  fonts: [
    {
      name: "Schibsted Grotesk",
      cssVariable: "--font-display",
      provider: fontProviders.local(),
      fallbacks: ["ui-sans-serif", "system-ui", "sans-serif"],
      options: {
        variants: [
          {
            src: [fontFile("schibsted-grotesk", "schibsted-grotesk-latin-wght-normal.woff2")],
            weight: "400 900",
            style: "normal",
          },
        ],
      },
    },
    {
      name: "Instrument Sans",
      cssVariable: "--font-body",
      provider: fontProviders.local(),
      fallbacks: ["ui-sans-serif", "system-ui", "sans-serif"],
      options: {
        variants: [
          {
            src: [fontFile("instrument-sans", "instrument-sans-latin-wght-normal.woff2")],
            weight: "400 700",
            style: "normal",
          },
          {
            src: [fontFile("instrument-sans", "instrument-sans-latin-wght-italic.woff2")],
            weight: "400 700",
            style: "italic",
          },
        ],
      },
    },
    {
      name: "Geist Mono",
      cssVariable: "--font-mono",
      provider: fontProviders.local(),
      fallbacks: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      options: {
        variants: [
          {
            src: [fontFile("geist-mono", "geist-mono-latin-wght-normal.woff2")],
            weight: "100 900",
            style: "normal",
          },
        ],
      },
    },
  ],
  markdown: {
    // Both themes are emitted as CSS variables and src/styles/prose.css
    // picks one with light-dark(), so code follows the site theme.
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
      transformers: [shikiAaLight],
    },
    remarkPlugins: [remarkHeadingGuard],
    rehypePlugins: [
      // Ids first, so the autolink plugin and the page's table of contents
      // both see them.
      rehypeHeadingIds,
      [
        rehypeAutolinkHeadings,
        {
          // "wrap" keeps each heading's accessible name equal to its text,
          // which "append"/"prepend" would pollute with the link label.
          behavior: "wrap",
          properties: { className: ["heading-link"] },
        },
      ],
      rehypePublicImg,
    ],
  },
  integrations: [
    lowPriorityScripts(),
    sitemap({
      filter: (page) =>
        !EXCLUDED.some((p) => page.includes(p)) && !thinTagPaths.has(page),
      serialize(item) {
        const path = new URL(item.url).pathname;
        const lm = lastmod.get(path);
        if (lm) item.lastmod = lm.toISOString();
        item.priority = priorityFor(item.url);
        return item;
      },
    }),
  ],
});
