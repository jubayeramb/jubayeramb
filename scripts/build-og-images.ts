/**
 * Build-time OG image generator.
 *
 * For every post, project, and key static page, renders a 1200×630 PNG card
 * via Satori (JSX → SVG) and resvg (SVG → PNG). Output goes to
 * `public/og/<path>.png` and is referenced by `<meta property="og:image">`
 * in `src/components/Seo.astro`.
 *
 * No browser, no external service, no runtime cost — runs once at `pnpm
 * prebuild` and ships the generated PNGs as static assets.
 */
import { readFile, readdir, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import matter from "gray-matter";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import wawoff2 from "wawoff2";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const POSTS_DIR = join(ROOT, "src/content/posts");
const PROJECTS_DIR = join(ROOT, "src/content/projects");
const OUT_DIR = join(ROOT, "public/og");
const FONT_CACHE_DIR = join(ROOT, "node_modules/.cache/og-fonts");
// Manifest lives in node_modules cache so it never ships in `public/`.
const MANIFEST_PATH = join(ROOT, "node_modules/.cache/og-manifest.json");
// Cached PNG copies, mirrored at the same relative paths as OUT_DIR.
// Cloudflare Pages preserves `node_modules` between builds (keyed on the
// lockfile) but wipes `public/`, so without this mirror every CI build
// re-renders every card.
const PNG_CACHE_DIR = join(ROOT, "node_modules/.cache/og-pngs");

const SITE = "jubayeramb.com";
const SIZE = { width: 1200, height: 630 };

// Cool-slate palette mirroring src/styles/global.css. Kept here as literals
// so the OG renderer doesn't depend on the theme tokens at build time.
const PALETTE = {
  bg: "#eef1f5",
  fg: "#0d1419",
  fg2: "#4a5562",
  fg3: "#7a8493",
  line: "#d0d8e0",
  line2: "#b5bec8",
  accent: "#2c5fed",
};

type FontWeight = 400 | 500 | 600;
type FontStyle = "normal" | "italic";
type FontSpec = {
  name: string;
  weight: FontWeight;
  style: FontStyle;
};

const FONTS: FontSpec[] = [
  { name: "IBM Plex Sans", weight: 400, style: "normal" },
  { name: "IBM Plex Sans", weight: 500, style: "normal" },
  { name: "IBM Plex Serif", weight: 400, style: "normal" },
  { name: "IBM Plex Serif", weight: 500, style: "italic" },
  { name: "IBM Plex Mono", weight: 400, style: "normal" },
];

type LoadedFont = {
  name: string;
  data: Buffer;
  weight: FontWeight;
  style: FontStyle;
};

// Modern Chrome UA — Google's css2 endpoint only serves woff2 to recent
// Chrome/Firefox/Safari builds; older / generic UAs get the legacy woff
// endpoint which satori can't decode.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/**
 * Resolves the latin-subset woff2 URL for a Google-Fonts family/weight/style.
 * The CSS endpoint returns multiple `@font-face` blocks (one per subset like
 * cyrillic, greek, latin, etc.) — we want the latin one.
 */
async function resolveWoff2Url(font: FontSpec): Promise<string> {
  const family = font.name.replace(/\s+/g, "+");
  const ital = font.style === "italic" ? "1" : "0";
  const cssUrl = `https://fonts.googleapis.com/css2?family=${family}:ital,wght@${ital},${font.weight}&display=swap`;
  const res = await fetch(cssUrl, { headers: { "user-agent": UA } });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${font.name} ${font.weight} CSS: ${res.status}`);
  }
  const css = await res.text();

  // Match the `/* latin */` block specifically.
  const latinBlockMatch = css.match(/\/\*\s*latin\s*\*\/[^}]+url\(([^)]+\.woff2)\)/);
  if (latinBlockMatch) return latinBlockMatch[1];

  // Fallback: any woff2 URL.
  const anyWoff2 = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/);
  if (anyWoff2) return anyWoff2[1];

  throw new Error(`No woff2 URL found in CSS for ${font.name} ${font.weight}`);
}

async function loadFonts(): Promise<LoadedFont[]> {
  if (!existsSync(FONT_CACHE_DIR)) {
    await mkdir(FONT_CACHE_DIR, { recursive: true });
  }
  const out: LoadedFont[] = [];
  for (const font of FONTS) {
    // Cache the decompressed TTF — satori can't parse woff2 directly
    // (its bundled opentype.js fork doesn't support it), so we keep the
    // expanded form on disk and re-use it across builds.
    const fname = `${font.name.replace(/\s+/g, "-")}-${font.weight}-${font.style}.ttf`;
    const cached = join(FONT_CACHE_DIR, fname);
    let buf: Buffer;
    if (existsSync(cached)) {
      buf = await readFile(cached);
    } else {
      const url = await resolveWoff2Url(font);
      const res = await fetch(url, { headers: { "user-agent": UA } });
      if (!res.ok) {
        throw new Error(`Failed to fetch font ${font.name} ${font.weight}: ${res.status}`);
      }
      const woff2 = new Uint8Array(await res.arrayBuffer());
      const ttf = await wawoff2.decompress(woff2);
      buf = Buffer.from(ttf);
      await writeFile(cached, buf);
    }
    out.push({ name: font.name, data: buf, weight: font.weight, style: font.style });
  }
  return out;
}

type Card = {
  /** Output file path relative to `public/og/`, e.g. "writings/foo.png". */
  out: string;
  /** Hash key — when content unchanged we skip render. */
  hashKey: string;
  /** Big serif title. */
  title: string;
  /** Optional substring of `title` to render in italic accent. */
  titleAccent?: string;
  /** Small mono label above the title, e.g. "Writing · Dec 31, 2024". */
  eyebrow?: string;
  /** Optional bottom-left meta, e.g. "Project · 2025 — Present". */
  meta?: string;
};

const sha = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 16);

function fmtDate(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function loadPostCards(): Promise<Card[]> {
  if (!existsSync(POSTS_DIR)) return [];
  const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith(".md"));
  const cards: Card[] = [];
  for (const file of files) {
    const id = file.replace(/\.md$/, "");
    const raw = await readFile(join(POSTS_DIR, file), "utf8");
    const { data } = matter(raw);
    if (data?.draft) continue;
    const title = (data?.title as string) ?? id;
    const date = data?.pubDate
      ? fmtDate(data.pubDate as string | Date)
      : "";
    const eyebrow = ["Writing", date].filter(Boolean).join(" · ");
    cards.push({
      out: `writings/${id}.png`,
      hashKey: sha(`writings|v3|${id}|${title}|${eyebrow}`),
      title,
      eyebrow,
    });
  }
  return cards;
}

async function loadProjectCards(): Promise<Card[]> {
  if (!existsSync(PROJECTS_DIR)) return [];
  const files = (await readdir(PROJECTS_DIR)).filter((f) => f.endsWith(".md"));
  const cards: Card[] = [];
  for (const file of files) {
    const id = file.replace(/\.md$/, "");
    const raw = await readFile(join(PROJECTS_DIR, file), "utf8");
    const { data } = matter(raw);
    if (data?.draft) continue;
    const title = (data?.title as string) ?? id;
    const period = (data?.period as string) ?? "";
    const eyebrow = ["Project", period].filter(Boolean).join(" · ");
    cards.push({
      out: `projects/${id}.png`,
      hashKey: sha(`projects|v3|${id}|${title}|${eyebrow}`),
      title,
      eyebrow,
    });
  }
  return cards;
}

const STATIC_CARDS: Card[] = [
  {
    out: "index.png",
    hashKey: "static-index-v3",
    title: "Software engineer building things for the web.",
    titleAccent: "web",
    eyebrow: "Jubayer Al Mamun",
  },
  {
    out: "about.png",
    hashKey: "static-about-v3",
    title: "About Jubayer.",
    eyebrow: "Profile",
  },
  {
    out: "contact.png",
    hashKey: "static-contact-v3",
    title: "Get in touch.",
    eyebrow: "Contact",
  },
  {
    out: "ask.png",
    hashKey: "static-ask-v3",
    title: "Ask my CV.",
    titleAccent: "CV",
    eyebrow: "Chat",
  },
  {
    out: "writings/index.png",
    hashKey: "static-writings-index-v3",
    title: "Writing.",
    eyebrow: "All posts",
  },
  {
    out: "projects/index.png",
    hashKey: "static-projects-index-v3",
    title: "Projects.",
    eyebrow: "Selected work",
  },
];

/** Renders a Satori-compatible JSX tree for a card. */
function template(card: Card) {
  const { title, titleAccent, eyebrow, meta } = card;

  let titleNode: any = title;
  if (titleAccent && title.includes(titleAccent)) {
    const idx = title.indexOf(titleAccent);
    const before = title.slice(0, idx);
    const after = title.slice(idx + titleAccent.length);
    titleNode = [
      before,
      {
        type: "span",
        props: {
          style: {
            fontFamily: "IBM Plex Serif",
            fontStyle: "italic",
            fontWeight: 500,
            color: PALETTE.accent,
          },
          children: titleAccent,
        },
      },
      after,
    ];
  }

  return {
    type: "div",
    props: {
      style: {
        width: SIZE.width,
        height: SIZE.height,
        background: PALETTE.bg,
        display: "flex",
        flexDirection: "column",
        padding: "56px 64px",
        position: "relative",
        fontFamily: "IBM Plex Sans",
      },
      children: [
        // Top row — small mono brand on left, domain on right
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontFamily: "IBM Plex Mono",
              fontSize: 14,
              color: PALETTE.fg3,
              letterSpacing: 1.4,
              textTransform: "uppercase",
            },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center", gap: 12 },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: {
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          background: PALETTE.accent,
                        },
                      },
                    },
                    "Jubayer Al Mamun",
                  ],
                },
              },
              {
                type: "div",
                props: { style: { display: "flex" }, children: SITE },
              },
            ],
          },
        },

        // Spacer
        { type: "div", props: { style: { flex: 1 } } },

        // Eyebrow
        eyebrow
          ? {
              type: "div",
              props: {
                style: {
                  fontFamily: "IBM Plex Mono",
                  fontSize: 16,
                  color: PALETTE.fg3,
                  letterSpacing: 1.2,
                  textTransform: "uppercase",
                  marginBottom: 18,
                },
                children: eyebrow,
              },
            }
          : null,

        // Big serif title
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexWrap: "wrap",
              fontFamily: "IBM Plex Serif",
              fontWeight: 400,
              fontSize: 72,
              lineHeight: 1.08,
              color: PALETTE.fg,
              letterSpacing: -1.2,
              maxWidth: 1000,
            },
            children: titleNode,
          },
        },

        // Bottom row — accent line + optional meta
        {
          type: "div",
          props: {
            style: {
              marginTop: "auto",
              paddingTop: 28,
              borderTop: `1px solid ${PALETTE.line}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontFamily: "IBM Plex Mono",
              fontSize: 13,
              color: PALETTE.fg3,
              letterSpacing: 1,
              textTransform: "uppercase",
            },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex" },
                  children: meta ?? "Read on jubayeramb.com",
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex" },
                  children: "© 2026",
                },
              },
            ],
          },
        },
      ],
    },
  };
}

async function renderCard(card: Card, fonts: LoadedFont[]): Promise<Buffer> {
  const svg = await satori(template(card) as any, {
    width: SIZE.width,
    height: SIZE.height,
    fonts: fonts.map((f) => ({
      name: f.name,
      data: f.data,
      weight: f.weight,
      style: f.style,
    })),
  });
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: SIZE.width },
  }).render().asPng();
  return Buffer.from(png);
}

type Manifest = {
  hashes: Record<string, string>;
};

async function loadManifest(): Promise<Manifest> {
  if (!existsSync(MANIFEST_PATH)) return { hashes: {} };
  try {
    const txt = await readFile(MANIFEST_PATH, "utf8");
    return JSON.parse(txt) as Manifest;
  } catch {
    return { hashes: {} };
  }
}

async function ensureManifestDir() {
  const dir = dirname(MANIFEST_PATH);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function main() {
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });

  const cards = [
    ...STATIC_CARDS,
    ...(await loadPostCards()),
    ...(await loadProjectCards()),
  ];

  const prev = await loadManifest();
  const next: Manifest = { hashes: {} };

  let rendered = 0;
  let reused = 0;

  // Lazy-load fonts so a fully-cached run avoids the network entirely.
  let fonts: LoadedFont[] | null = null;

  for (const card of cards) {
    const outPath = join(OUT_DIR, card.out);
    const cachePath = join(PNG_CACHE_DIR, card.out);
    next.hashes[card.out] = card.hashKey;

    const cachedHash = prev.hashes[card.out];
    if (cachedHash === card.hashKey) {
      // Hydrate the public output from the cached copy when needed
      // (typical CI case: cache survives, public/ is empty).
      if (!existsSync(outPath) && existsSync(cachePath)) {
        const outDir = dirname(outPath);
        if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });
        await copyFile(cachePath, outPath);
      }
      if (existsSync(outPath)) {
        // Backfill the cache copy if it's missing — keeps the cache
        // warm even when prior builds rendered straight to public/.
        if (!existsSync(cachePath)) {
          const cacheDir = dirname(cachePath);
          if (!existsSync(cacheDir)) await mkdir(cacheDir, { recursive: true });
          await copyFile(outPath, cachePath);
        }
        reused++;
        continue;
      }
    }

    if (!fonts) fonts = await loadFonts();
    const dir = dirname(outPath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const png = await renderCard(card, fonts);
    await writeFile(outPath, png);
    const cacheDir = dirname(cachePath);
    if (!existsSync(cacheDir)) await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, png);
    rendered++;
  }

  await ensureManifestDir();
  await writeFile(MANIFEST_PATH, JSON.stringify(next, null, 2), "utf8");
  console.log(
    `[og] ${cards.length} cards · ${rendered} rendered · ${reused} reused → public/og/`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
