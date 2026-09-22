/**
 * Marks the site's module scripts as low fetch priority.
 *
 * Chrome fetches `<script type="module">` at High priority, so on a slow
 * phone the router, prefetch and palette listeners share bandwidth with
 * the hero portrait and the fonts, although none of them draws anything.
 * `fetchpriority="low"` on the tag only covers the entry file: the chunks
 * it imports are still fetched at High. So each entry's static imports are
 * also declared up front as low-priority modulepreloads, which the module
 * loader then reuses.
 *
 * Astro has no option for script attributes, so this rewrites the built
 * HTML once the build is done.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";

const ENTRY = /<script type="module" src="(\/_astro\/[^"]+\.js)"><\/script>/g;
// Static imports in Vite's minified output: `import{a as b}from"./x.js"`
// and `import"./x.js"`. Dynamic `import("./x.js")` is left alone: those
// chunks are meant to load later.
const STATIC_IMPORT = /\bimport\s*(?:[\w$*{}\s,]+?from\s*)?["']\.\/([^"']+\.js)["']/g;

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return htmlFiles(path);
    return e.name.endsWith(".html") ? [path] : [];
  });
}

export default function lowPriorityScripts(): AstroIntegration {
  return {
    name: "low-priority-scripts",
    hooks: {
      "astro:build:done": ({ dir }) => {
        const outDir = fileURLToPath(dir);
        const importsOf = new Map<string, string[]>();

        // Every chunk a script pulls in before it runs, depth first.
        const chunksOf = (src: string, seen = new Set<string>()): string[] => {
          if (!importsOf.has(src)) {
            const code = readFileSync(join(outDir, src), "utf8");
            importsOf.set(
              src,
              [...code.matchAll(STATIC_IMPORT)].map((m) => `/_astro/${m[1]}`),
            );
          }
          for (const dep of importsOf.get(src)!) {
            if (seen.has(dep)) continue;
            seen.add(dep);
            chunksOf(dep, seen);
          }
          return [...seen];
        };

        for (const file of htmlFiles(outDir)) {
          const html = readFileSync(file, "utf8");
          const entries = [...html.matchAll(ENTRY)].map((m) => m[1]);
          if (entries.length === 0) continue;

          const chunks = new Set(entries.flatMap((src) => chunksOf(src)));
          for (const src of entries) chunks.delete(src);
          const preloads = [...chunks]
            .map((href) => `<link rel="modulepreload" href="${href}" fetchpriority="low">`)
            .join("");

          const out = html
            .replace(ENTRY, '<script type="module" src="$1" fetchpriority="low"></script>')
            .replace("</head>", `${preloads}</head>`);
          writeFileSync(file, out);
        }
      },
    },
  };
}
