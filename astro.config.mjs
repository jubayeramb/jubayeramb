import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

const SITE = "https://jubayeramb.com";

// Read post + project frontmatter dates so sitemap entries get accurate
// per-page lastmod values instead of the build timestamp. Index/static
// pages fall back to today.
const lastmodMap = (() => {
  const map = new Map();
  const collect = (dir, urlPrefix) => {
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      try {
        const { data } = matter(readFileSync(join(dir, file), "utf8"));
        const slug = file.replace(/\.md$/, "");
        const updated = data?.updatedDate ?? data?.pubDate;
        if (updated) {
          map.set(`${SITE}${urlPrefix}/${slug}/`, new Date(updated));
        }
      } catch {
        /* ignore unparseable */
      }
    }
  };
  collect("./src/content/posts", "/writings");
  collect("./src/content/projects", "/projects");
  return map;
})();

// Per-route priority. Boosts content pages over taxonomies.
const priorityFor = (page) => {
  if (page === `${SITE}/`) return 1.0;
  if (page.startsWith(`${SITE}/writings/`)) return 0.9;
  if (page.startsWith(`${SITE}/projects/`)) return 0.9;
  if (page.startsWith(`${SITE}/about/`)) return 0.8;
  if (page.startsWith(`${SITE}/contact/`)) return 0.7;
  if (page.startsWith(`${SITE}/tags/`)) return 0.4;
  return 0.6;
};

// https://astro.build/config
export default defineConfig({
  site: SITE,
  trailingSlash: "ignore",
  build: {
    format: "directory",
  },
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    sitemap({
      changefreq: "weekly",
      filter: (page) => !page.includes("/404") && !page.includes("/ask"),
      serialize(item) {
        const lm = lastmodMap.get(item.url);
        if (lm) item.lastmod = lm.toISOString();
        else item.lastmod = new Date().toISOString();
        item.priority = priorityFor(item.url);
        return item;
      },
    }),
  ],
});
