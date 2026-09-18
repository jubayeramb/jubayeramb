/**
 * Build-time OG image generator.
 *
 * For every post, project, tag and key static page, renders a 1200x630 PNG
 * card via Satori (element tree to SVG) and resvg (SVG to PNG). Output goes to
 * `public/og/<path>.png` and is referenced by `<meta property="og:image">`
 * in `src/components/Seo.astro`.
 *
 * No browser, no external service, no runtime cost: runs once at `pnpm
 * prebuild` and ships the generated PNGs as static assets.
 */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { readCollection, tagCounts } from "../src/lib/build/content-index";
import { tagLabel } from "../src/lib/tags";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public/og");
const AVATAR = join(ROOT, "src/assets/portrait/avatar.jpg");
// Manifest lives in node_modules cache so it never ships in `public/`.
const MANIFEST_PATH = join(ROOT, "node_modules/.cache/og-manifest.json");
// Cached PNG copies, mirrored at the same relative paths as OUT_DIR.
// Cloudflare Pages preserves `node_modules` between builds (keyed on the
// lockfile) but wipes `public/`, so without this mirror every CI build
// re-renders every card.
const PNG_CACHE_DIR = join(ROOT, "node_modules/.cache/og-pngs");

const SITE = "jubayeramb.com";
const SIZE = { width: 1200, height: 630 };

// Cool paper palette mirroring src/styles/tokens.css (light theme). Kept
// here as literals so the renderer doesn't depend on CSS at build time.
const PALETTE = {
  canvas: "#f6f8fb",
  band: "#edf1f6",
  ink: "#0f1720",
  ink2: "#465262",
  ink3: "#5b6778",
  hairline: "#dde3ea",
  accent: "#2c5fed",
  block: "#dfe6f0",
};

// Bump when the card design changes: it's part of every hash key, so all
// cards re-render once (the Cloudflare build cache keys on these hashes).
const DESIGN_VERSION = "v5";

type LoadedFont = {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 600 | 700;
  style: "normal";
};

// Satori can't read woff2 or variable fonts, so the static WOFF builds of
// the site's three families are read straight from node_modules. No
// network, pinned by the lockfile.
const FONT_FILES: (Omit<LoadedFont, "data"> & { file: string })[] = [
  { name: "Schibsted Grotesk", weight: 600, style: "normal", file: "@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-600-normal.woff" },
  { name: "Instrument Sans", weight: 400, style: "normal", file: "@fontsource/instrument-sans/files/instrument-sans-latin-400-normal.woff" },
  { name: "Instrument Sans", weight: 600, style: "normal", file: "@fontsource/instrument-sans/files/instrument-sans-latin-600-normal.woff" },
  { name: "Geist Mono", weight: 500, style: "normal", file: "@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff" },
];

async function loadFonts(): Promise<LoadedFont[]> {
  return Promise.all(
    FONT_FILES.map(async ({ file, ...f }) => ({
      ...f,
      data: await readFile(join(ROOT, "node_modules", file)),
    })),
  );
}

async function loadAvatar(): Promise<string> {
  const buf = await sharp(AVATAR).resize(96, 96).jpeg({ quality: 85 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

type Card = {
  /** Output file path relative to `public/og/`, e.g. "writings/foo.png". */
  out: string;
  /** Hash key: when content is unchanged the render is skipped. */
  hashKey: string;
  /** Big display title. */
  title: string;
  /** Small mono label above the title, e.g. "Writing · Dec 31, 2024". */
  eyebrow?: string;
  /** Optional line under the title, e.g. a project summary. */
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

function loadPostCards(): Card[] {
  return readCollection("posts", ROOT).map((p) => {
    const title = (p.data.title as string) ?? p.id;
    const date = p.data.pubDate ? fmtDate(p.data.pubDate as string | Date) : "";
    const eyebrow = ["Writing", date].filter(Boolean).join(" · ");
    return {
      out: `writings/${p.id}.png`,
      hashKey: sha(`writings|${DESIGN_VERSION}|${p.id}|${title}|${eyebrow}`),
      title,
      eyebrow,
    };
  });
}

function loadProjectCards(): Card[] {
  return readCollection("projects", ROOT).map((p) => {
    const title = (p.data.title as string) ?? p.id;
    const eyebrow = ["Project", p.data.period as string].filter(Boolean).join(" · ");
    const meta = p.data.summary as string | undefined;
    return {
      out: `projects/${p.id}.png`,
      hashKey: sha(`projects|${DESIGN_VERSION}|${p.id}|${title}|${eyebrow}|${meta}`),
      title,
      eyebrow,
      meta,
    };
  });
}

function loadTagCards(): Card[] {
  return [...tagCounts(readCollection("posts", ROOT)).entries()].map(([tag, count]) => {
    const title = `Writing about ${tagLabel(tag)}.`;
    const eyebrow = `Topic · ${count} ${count === 1 ? "post" : "posts"}`;
    return {
      out: `tags/${tag}.png`,
      hashKey: sha(`tags|${DESIGN_VERSION}|${tag}|${title}|${eyebrow}`),
      title,
      eyebrow,
    };
  });
}

// Keyed on their content like every other card, so editing a title here
// re-renders that card on the next build.
const STATIC_CARDS: Card[] = ([
  {
    out: "index.png",
    title: "I build the product and the systems behind it.",
    eyebrow: "Jubayer Al Mamun",
  },
  {
    out: "about.png",
    title: "About Jubayer.",
    eyebrow: "Profile",
  },
  {
    out: "contact.png",
    title: "Get in touch.",
    eyebrow: "Contact",
  },
  {
    out: "ask.png",
    title: "Ask my CV.",
    eyebrow: "Chat",
  },
  {
    out: "now.png",
    title: "What I'm focused on right now.",
    eyebrow: "Now",
  },
  {
    out: "writings/index.png",
    title: "Writing.",
    eyebrow: "All posts",
  },
  {
    out: "projects/index.png",
    title: "Projects.",
    eyebrow: "Selected work",
  },
  {
    out: "tags/index.png",
    title: "Tags.",
    eyebrow: "Tags",
  },
] satisfies Omit<Card, "hashKey">[]).map((c: Omit<Card, "hashKey">) => ({
  ...c,
  hashKey: sha(`static|${DESIGN_VERSION}|${c.out}|${c.title}|${c.eyebrow ?? ""}|${c.meta ?? ""}`),
}));

/** Tiny helper so the card tree below stays readable. */
const el = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}) => ({
  type,
  props: { style, children, ...extra },
});

/** Renders a Satori-compatible element tree for a card. */
function template(card: Card, avatar: string) {
  const { title, eyebrow, meta } = card;

  const titleNode: unknown = title;
  const long = title.length > 48;

  return el(
    "div",
    {
      width: SIZE.width,
      height: SIZE.height,
      display: "flex",
      flexDirection: "column",
      padding: "60px 72px 56px",
      background: PALETTE.canvas,
      fontFamily: "Instrument Sans",
      color: PALETTE.ink,
      borderTop: `10px solid ${PALETTE.accent}`,
    },
    [
      // Eyebrow
      el(
        "div",
        {
          display: "flex",
          fontFamily: "Geist Mono",
          fontWeight: 500,
          fontSize: 20,
          letterSpacing: 2.4,
          textTransform: "uppercase",
          color: PALETTE.ink3,
        },
        eyebrow ?? "Jubayer Al Mamun",
      ),
      // Title
      el(
        "div",
        {
          display: "flex",
          flexWrap: "wrap",
          marginTop: 28,
          fontFamily: "Schibsted Grotesk",
          fontWeight: 600,
          fontSize: long ? 64 : 84,
          lineHeight: 1.04,
          letterSpacing: long ? -1.8 : -2.8,
          maxWidth: 1000,
        },
        titleNode,
      ),
      meta
        ? el(
            "div",
            {
              display: "flex",
              marginTop: 24,
              maxWidth: 900,
              fontSize: 26,
              lineHeight: 1.4,
              color: PALETTE.ink2,
            },
            meta.length > 140 ? meta.slice(0, 137).trimEnd() + "..." : meta,
          )
        : null,
      // Spacer
      el("div", { display: "flex", flex: 1 }),
      // Byline
      el(
        "div",
        {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 28,
          borderTop: `1px solid ${PALETTE.hairline}`,
        },
        [
          el("div", { display: "flex", alignItems: "center", gap: 18 }, [
            el("img", { width: 60, height: 60, borderRadius: 30, border: `2px solid ${PALETTE.block}` }, undefined, {
              src: avatar,
              width: 60,
              height: 60,
            }),
            el("div", { display: "flex", flexDirection: "column" }, [
              el("div", { display: "flex", fontSize: 26, fontWeight: 600 }, "Jubayer Al Mamun"),
              el("div", { display: "flex", fontSize: 20, color: PALETTE.ink3 }, "Software engineer, Dhaka"),
            ]),
          ]),
          el(
            "div",
            { display: "flex", fontFamily: "Geist Mono", fontWeight: 500, fontSize: 22, color: PALETTE.accent },
            SITE,
          ),
        ],
      ),
    ],
  );
}

async function renderCard(card: Card, fonts: LoadedFont[], avatar: string): Promise<Buffer> {
  const svg = await satori(template(card, avatar) as any, {
    width: SIZE.width,
    height: SIZE.height,
    fonts: fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: f.style })),
  });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: SIZE.width } }).render().asPng();
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

  const cards = [...STATIC_CARDS, ...loadPostCards(), ...loadProjectCards(), ...loadTagCards()];

  const prev = await loadManifest();
  const next: Manifest = { hashes: {} };

  let rendered = 0;
  let reused = 0;

  // Lazy-load fonts and the avatar so a fully cached run skips the work.
  let fonts: LoadedFont[] | null = null;
  let avatar: string | null = null;

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
        // Backfill the cache copy if it's missing, which keeps the cache
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

    fonts ??= await loadFonts();
    avatar ??= await loadAvatar();
    const dir = dirname(outPath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const png = await renderCard(card, fonts, avatar);
    await writeFile(outPath, png);
    const cacheDir = dirname(cachePath);
    if (!existsSync(cacheDir)) await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, png);
    rendered++;
  }

  await ensureManifestDir();
  await writeFile(MANIFEST_PATH, JSON.stringify(next, null, 2), "utf8");
  console.log(
    `[og] ${cards.length} cards · ${rendered} rendered · ${reused} reused -> public/og/`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
