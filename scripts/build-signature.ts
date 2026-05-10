/**
 * One-shot: pull Caveat-Regular.ttf from the Google Fonts repo, run "Jubayer"
 * through opentype.js, and emit the SVG path data + bounding box.
 *
 * Run with `pnpm tsx scripts/build-signature.ts` — copy the output into
 * src/components/Signature.astro.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = join(ROOT, "tmp");
const FONT_PATH = join(CACHE_DIR, "caveat.ttf");

// Stable mirror — Google's fonts repo on GitHub serves raw TTFs.
const FONT_URL =
  "https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/Caveat%5Bwght%5D.ttf";

const TEXT = "Jubayer";
const FONT_SIZE = 120;

async function ensureFont() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  if (existsSync(FONT_PATH)) return;
  console.log(`[sig] downloading ${FONT_URL}`);
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`Font fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(FONT_PATH, buf);
  console.log(`[sig] cached at ${FONT_PATH} (${buf.length} bytes)`);
}

async function main() {
  await ensureFont();
  const font = opentype.parse(
    readFileSync(FONT_PATH).buffer.slice(0) as ArrayBuffer
  );

  const path = font.getPath(TEXT, 0, FONT_SIZE, FONT_SIZE);
  const bb = path.getBoundingBox();

  // Tighten margins around the bounding box, with a small pad so strokes
  // aren't clipped at the viewBox edge.
  const PAD = 4;
  const x = Math.floor(bb.x1 - PAD);
  const y = Math.floor(bb.y1 - PAD);
  const w = Math.ceil(bb.x2 - bb.x1 + PAD * 2);
  const h = Math.ceil(bb.y2 - bb.y1 + PAD * 2);

  const pathData = path.toPathData(2);

  console.log("\n=== copy below into Signature.astro ===\n");
  console.log(`viewBox="${x} ${y} ${w} ${h}"  // w:h ≈ ${(w / h).toFixed(2)}`);
  console.log(`d="${pathData}"\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
