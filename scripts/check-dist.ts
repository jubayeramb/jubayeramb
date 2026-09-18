/**
 * Post-build guard over `dist/`. Run with `pnpm check:dist` (or `pnpm verify`).
 *
 * Every built HTML page must have:
 *   - exactly one <title>, a meta description and a robots directive
 *   - one absolute canonical ending in "/" that matches the page's own path,
 *     listed in the sitemap when indexable and absent from it when not
 *   - a complete Open Graph and Twitter card set
 *   - exactly one JSON-LD block whose @id references all resolve
 *   - exactly one h1 and no skipped heading levels
 *   - internal links, assets and same-page fragments that resolve
 *     (honoring public/_redirects)
 *   - images with alt text and explicit dimensions
 *   - no em dashes in visible text or metadata
 *   - first-party JS under the page's byte budget
 *
 * Plus: /now renders real content, and the text endpoints are dash-free.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, type HTMLElement } from "node-html-parser";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const SITE = "https://jubayeramb.com";
const EM_DASH = "\u2014";

// Raw bytes of first-party JS a page may load before any interaction.
// Lazily imported chunks (palette, voice, chat store on demand) don't count.
const JS_BUDGET_DEFAULT = 25 * 1024;
const JS_BUDGET: Record<string, number> = {
  "/": 45 * 1024, // floating chat
  "/ask/": 45 * 1024, // full chat
};

type Problem = { page: string; msg: string };
const problems: Problem[] = [];
const fail = (page: string, msg: string) => problems.push({ page, msg });

if (!existsSync(DIST)) {
  console.error("dist/ not found. Run `pnpm build` first.");
  process.exit(1);
}

// ---------------------------------------------------------------- inputs

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const files = walk(DIST);
const htmlFiles = files.filter((f) => f.endsWith(".html"));

/** "/writings/foo/" for dist/writings/foo/index.html, "/404.html" for 404. */
const routeOf = (file: string) => {
  const rel = "/" + relative(DIST, file).split("\\").join("/");
  return rel.endsWith("/index.html") ? rel.slice(0, -"index.html".length) : rel;
};

const sitemapUrls = new Set(
  readdirSync(DIST)
    .filter((f) => /^sitemap-\d+\.xml$/.test(f))
    .flatMap((f) => [...readFileSync(join(DIST, f), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])),
);

const redirectSources = new Set(
  existsSync(join(DIST, "_redirects"))
    ? readFileSync(join(DIST, "_redirects"), "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => l.split(/\s+/)[0])
    : [],
);

/** Does an internal URL path resolve to something Cloudflare Pages would serve? */
const resolves = (pathname: string): boolean => {
  if (redirectSources.has(pathname) || redirectSources.has(pathname.replace(/\/$/, ""))) return true;
  if (pathname.startsWith("/api/")) return true; // Pages Functions, not in dist
  const clean = decodeURIComponent(pathname).replace(/^\//, "");
  const candidates = [clean, join(clean, "index.html"), `${clean.replace(/\/$/, "")}.html`];
  return candidates.some((c) => existsSync(join(DIST, c)) && statSync(join(DIST, c)).isFile());
};

// ------------------------------------------------------- JS byte budget

const chunkCache = new Map<string, { size: number; imports: string[] }>();
/** Size of a module plus everything it statically imports (not import()). */
const staticClosure = (urlPath: string, seen = new Set<string>()): number => {
  if (seen.has(urlPath)) return 0;
  seen.add(urlPath);
  let entry = chunkCache.get(urlPath);
  if (!entry) {
    const file = join(DIST, urlPath);
    if (!existsSync(file)) return 0;
    const src = readFileSync(file, "utf8");
    const imports = [...src.matchAll(/(?:^|[;\s}])import\s*(?:[\w*{}\s,$]+from\s*)?["']([^"']+\.js)["']/g)].map(
      (m) => posix.join(posix.dirname(urlPath), m[1]),
    );
    entry = { size: Buffer.byteLength(src), imports };
    chunkCache.set(urlPath, entry);
  }
  return entry.size + entry.imports.reduce((n, i) => n + staticClosure(i, seen), 0);
};

// ----------------------------------------------------------- per page

const jsReport: { route: string; bytes: number; budget: number }[] = [];

const visibleText = (root: HTMLElement) => {
  const clone = parse(root.toString());
  clone.querySelectorAll("script, style, pre, code, template").forEach((n) => n.remove());
  return clone.textContent;
};

for (const file of htmlFiles) {
  const route = routeOf(file);
  const html = readFileSync(file, "utf8");
  const doc = parse(html, { comment: false });
  const head = doc.querySelector("head");
  const meta = (sel: string) => head?.querySelectorAll(sel) ?? [];
  const content = (sel: string) => meta(sel)[0]?.getAttribute("content")?.trim() ?? "";
  const is404 = route === "/404.html";

  // Title, description, robots
  const titles = doc.querySelectorAll("title");
  if (titles.length !== 1) fail(route, `expected 1 <title>, found ${titles.length}`);
  else if (!titles[0].textContent.trim()) fail(route, "empty <title>");
  if (!content('meta[name="description"]')) fail(route, "missing meta description");
  const robots = content('meta[name="robots"]');
  if (!robots) fail(route, "missing meta robots");
  const indexable = robots.startsWith("index");

  // Canonical and sitemap
  const canon = meta('link[rel="canonical"]');
  if (!is404) {
    if (canon.length !== 1) fail(route, `expected 1 canonical, found ${canon.length}`);
    const href = canon[0]?.getAttribute("href") ?? "";
    if (!href.startsWith(`${SITE}/`) || !href.endsWith("/")) fail(route, `canonical not absolute with trailing slash: ${href}`);
    else if (new URL(href).pathname !== route) fail(route, `canonical points elsewhere: ${href}`);
    if (indexable && !sitemapUrls.has(href)) fail(route, `indexable but missing from sitemap: ${href}`);
    if (!indexable && sitemapUrls.has(href)) fail(route, `noindex but listed in sitemap: ${href}`);
  }

  // Social cards
  for (const p of ["og:title", "og:description", "og:url", "og:type", "og:image", "og:image:width", "og:image:height", "og:image:alt"]) {
    if (!content(`meta[property="${p}"]`)) fail(route, `missing ${p}`);
  }
  for (const n of ["twitter:card", "twitter:title", "twitter:description", "twitter:image"]) {
    if (!content(`meta[name="${n}"]`)) fail(route, `missing ${n}`);
  }
  const ogImage = content('meta[property="og:image"]');
  if (ogImage.startsWith(SITE) && !resolves(new URL(ogImage).pathname)) fail(route, `og:image not in dist: ${ogImage}`);

  // JSON-LD: one graph, every bare {"@id"} reference defined somewhere in it
  const ld = doc.querySelectorAll('script[type="application/ld+json"]');
  if (ld.length !== 1) fail(route, `expected 1 JSON-LD block, found ${ld.length}`);
  for (const block of ld) {
    let data: unknown;
    try {
      data = JSON.parse(block.textContent);
    } catch (e) {
      fail(route, `JSON-LD does not parse: ${(e as Error).message}`);
      continue;
    }
    const defined = new Set<string>();
    const referenced = new Set<string>();
    const visit = (v: unknown) => {
      if (Array.isArray(v)) return v.forEach(visit);
      if (!v || typeof v !== "object") return;
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o);
      if (typeof o["@id"] === "string") (keys.length === 1 ? referenced : defined).add(o["@id"]);
      keys.forEach((k) => visit(o[k]));
    };
    visit(data);
    for (const id of referenced) if (!defined.has(id)) fail(route, `JSON-LD @id reference unresolved: ${id}`);
    if (/undefined|NaN|\[object Object\]/.test(block.textContent)) fail(route, "JSON-LD contains undefined/NaN");
  }

  // Heading outline
  const body = doc.querySelector("body");
  if (body) {
    const headings = body.querySelectorAll("h1, h2, h3, h4, h5, h6").filter((h) => !h.closest("template"));
    const h1s = headings.filter((h) => h.tagName === "H1");
    if (h1s.length !== 1) fail(route, `expected 1 h1, found ${h1s.length}`);
    let prev = 0;
    for (const h of headings) {
      const level = Number(h.tagName[1]);
      if (prev && level > prev + 1) fail(route, `heading jumps h${prev} -> h${level}: "${h.textContent.trim().slice(0, 50)}"`);
      prev = level;
    }

    // Links, assets and fragments
    const ids = new Set(body.querySelectorAll("[id]").map((n) => n.id));
    ids.add("top");
    const checkUrl = (raw: string, attr: string) => {
      if (!raw || /^(mailto:|tel:|javascript:|data:|blob:)/.test(raw)) return;
      let url: URL;
      try {
        url = new URL(raw, `${SITE}${route}`);
      } catch {
        return fail(route, `unparseable ${attr}: ${raw}`);
      }
      if (url.origin !== SITE) return;
      if (url.pathname === route && url.hash && raw.startsWith("#")) {
        const id = decodeURIComponent(url.hash.slice(1));
        if (id && !ids.has(id)) fail(route, `fragment target missing: ${raw}`);
        return;
      }
      if (!resolves(url.pathname)) fail(route, `broken ${attr}: ${raw}`);
    };
    for (const a of doc.querySelectorAll("a[href]")) checkUrl(a.getAttribute("href")!, "link");
    for (const n of doc.querySelectorAll("link[href]")) {
      const rel = n.getAttribute("rel") ?? "";
      if (/canonical|alternate|me|author|preconnect|dns-prefetch/.test(rel)) {
        if (rel === "alternate") checkUrl(n.getAttribute("href")!, "alternate");
        continue;
      }
      checkUrl(n.getAttribute("href")!, `link[rel=${rel}]`);
    }
    for (const n of doc.querySelectorAll("[src]")) checkUrl(n.getAttribute("src")!, "src");
    for (const n of doc.querySelectorAll("[srcset]")) {
      for (const part of n.getAttribute("srcset")!.split(",")) checkUrl(part.trim().split(/\s+/)[0], "srcset");
    }

    // Images
    for (const img of body.querySelectorAll("img")) {
      const src = img.getAttribute("src") ?? "";
      if (!img.hasAttribute("alt")) fail(route, `img without alt: ${src}`);
      if (!img.getAttribute("width") || !img.getAttribute("height")) fail(route, `img without dimensions: ${src}`);
    }
  }

  // Em dashes in anything a reader or a crawler sees
  const dashScope = [
    visibleText(doc),
    titles.map((t) => t.textContent).join(" "),
    ...meta("meta[content]").map((m) => m.getAttribute("content") ?? ""),
    ...ld.map((b) => b.textContent),
  ].join("\n");
  if (dashScope.includes(EM_DASH)) {
    const at = dashScope.indexOf(EM_DASH);
    fail(route, `em dash in page: "...${dashScope.slice(Math.max(0, at - 40), at + 20).replace(/\s+/g, " ")}..."`);
  }

  // JS budget: every module script in the document plus its static imports
  const seen = new Set<string>();
  let bytes = 0;
  for (const s of doc.querySelectorAll('script[type="module"][src]')) bytes += staticClosure(s.getAttribute("src")!, seen);
  for (const s of doc.querySelectorAll("script:not([src])")) {
    if (s.getAttribute("type") === "application/ld+json") continue;
    bytes += Buffer.byteLength(s.textContent);
    for (const m of s.textContent.matchAll(/import\s*(?:[\w*{}\s,$]+from\s*)?["'](\/_astro\/[^"']+\.js)["']/g)) {
      bytes += staticClosure(m[1], seen);
    }
  }
  const budget = JS_BUDGET[route] ?? JS_BUDGET_DEFAULT;
  jsReport.push({ route, bytes, budget });
  if (bytes > budget) fail(route, `JS ${(bytes / 1024).toFixed(1)} KB over budget ${(budget / 1024).toFixed(0)} KB`);
}

// ------------------------------------------------------------ site-wide

const nowFile = join(DIST, "now/index.html");
if (existsSync(nowFile)) {
  const main = parse(readFileSync(nowFile, "utf8")).querySelector("main");
  const text = main ? visibleText(main).replace(/\s+/g, " ").trim() : "";
  if (text.length < 300) fail("/now/", `too little server-rendered content (${text.length} chars)`);
} else fail("/now/", "page missing");

for (const endpoint of ["llms.txt", "llms-full.txt", "rss.xml", "feed.json", "robots.txt", "site.webmanifest"]) {
  const p = join(DIST, endpoint);
  if (!existsSync(p)) fail(`/${endpoint}`, "missing");
  else if (endpoint !== "llms-full.txt" && readFileSync(p, "utf8").includes(EM_DASH)) fail(`/${endpoint}`, "contains an em dash");
}

for (const url of sitemapUrls) {
  if (!resolves(new URL(url).pathname)) fail("sitemap", `lists a URL with no page: ${url}`);
}

// ------------------------------------------------------------- report

const heaviest = [...jsReport].sort((a, b) => b.bytes - a.bytes).slice(0, 5);
console.log(`check-dist: ${htmlFiles.length} pages, ${sitemapUrls.size} sitemap URLs`);
console.log("heaviest first-party JS:");
for (const r of heaviest) console.log(`  ${r.route.padEnd(52)} ${(r.bytes / 1024).toFixed(1).padStart(6)} KB / ${(r.budget / 1024).toFixed(0)} KB`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p.page}  ${p.msg}`);
  process.exit(1);
}
console.log("\nall checks passed");
