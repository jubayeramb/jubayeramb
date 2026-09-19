/**
 * One-off portrait + favicon preparation.
 *
 * Reads the original photos (kept outside the repo) and writes the
 * committed source assets the site builds from:
 *
 *   src/assets/portrait/hero-cutout.png  alpha-feathered hero cutout
 *   src/assets/portrait/about.jpg        square headshot for /about
 *   src/assets/portrait/avatar.jpg       square head-and-shoulders, used
 *                                        for Person.image + author bio
 *   public/favicon.ico, icon-*.png, apple-touch-icon.png
 *
 * Astro's image pipeline derives every responsive size from these, so
 * this only needs re-running when the source photos change:
 *
 *   PORTRAIT_SRC=/path/to/profile-pictures pnpm portraits
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.env.PORTRAIT_SRC ?? "/Users/jubayer/jub/media/profile-pictures";
const OUT = join(ROOT, "src/assets/portrait");
const PUBLIC = join(ROOT, "public");

// Matches --portrait-block (light) in src/styles/tokens.css.
const BLOCK = { r: 0xdf, g: 0xe6, b: 0xf0 };

/**
 * The background remover leaves two alpha artifacts: the body sits at
 * 253 rather than 255 (so the portrait is faintly see-through, and every
 * encoder pays for a noisy alpha plane), and a 1-5 halo floats around the
 * silhouette. A levels pass maps [ALPHA_FLOOR, ALPHA_CEIL] onto [0, 255]
 * to fix both while keeping the edge gradient.
 *
 * It also left a hard, slightly aliased hairline. Blurring only the alpha
 * channel by a fraction of a pixel then softens that edge without
 * touching the photo itself.
 */
const ALPHA_FLOOR = 6;
const ALPHA_CEIL = 250;
async function featheredCutout(): Promise<Buffer> {
  const { data: rgba, info } = await sharp(join(SRC, "jub-no-bg.png"))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const alpha = Buffer.alloc(width * height);
  for (let i = 0; i < alpha.length; i++) {
    const a = rgba[i * 4 + 3];
    alpha[i] = Math.round(
      Math.min(255, Math.max(0, ((a - ALPHA_FLOOR) * 255) / (ALPHA_CEIL - ALPHA_FLOOR))),
    );
  }
  // `blur` promotes a single-channel input to sRGB, so pin the output back
  // to one band or the buffer no longer lines up pixel for pixel.
  const soft = await sharp(alpha, { raw: { width, height, channels: 1 } })
    .blur(0.6)
    .extractChannel(0)
    .raw()
    .toBuffer();
  if (soft.length !== alpha.length) throw new Error("alpha buffer size mismatch");
  for (let i = 0; i < soft.length; i++) rgba[i * 4 + 3] = soft[i];
  return sharp(rgba, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Crops a square out of the cutout and flattens it onto the block color. */
async function onBlock(
  cutout: Buffer,
  region: { left: number; top: number; size: number },
  outSize: number,
): Promise<Buffer> {
  const square = await sharp(cutout)
    .extract({ left: region.left, top: region.top, width: region.size, height: region.size })
    .resize(outSize, outSize)
    .toBuffer();
  return sharp({
    create: { width: outSize, height: outSize, channels: 4, background: { ...BLOCK, alpha: 1 } },
  })
    .composite([{ input: square }])
    .png()
    .toBuffer();
}

/** Minimal ICO container holding PNG payloads (supported everywhere since Vista). */
function toIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const cutout = await featheredCutout();
  await writeFile(join(OUT, "hero-cutout.png"), cutout);

  // Square crop of the studio headshot, centered on the face. The source
  // is 1302x1208, so this keeps its full height and never upscales.
  await sharp(join(SRC, "jub-white-shirt.png"))
    .extract({ left: 47, top: 0, width: 1208, height: 1208 })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(join(OUT, "about.jpg"));

  // Head and shoulders, 800px square: Google recommends at least 696px
  // for profile imagery.
  const avatar = await onBlock(cutout, { left: 196, top: 30, size: 850 }, 800);
  await sharp(avatar).jpeg({ quality: 88, mozjpeg: true }).toFile(join(OUT, "avatar.jpg"));

  // Favicons come from a separate face-only cutout. Tab icons keep it on
  // transparency, trimmed to the face so it still reads at 16px; the
  // Apple touch and maskable icons need an opaque square, so those sit on
  // the portrait block.
  const faceSrc = await sharp(join(SRC, "jub-face-only.png")).trim({ threshold: 1 }).png().toBuffer();
  const fit = (s: number, pad: number) =>
    sharp(faceSrc)
      .resize(s - pad * 2, s - pad * 2, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  const onSquare = async (s: number, inset: number) =>
    sharp({ create: { width: s, height: s, channels: 4, background: { ...BLOCK, alpha: 1 } } })
      .composite([{ input: await fit(s - inset * 2, 0), left: inset, top: inset }])
      .png()
      .toBuffer();

  await writeFile(
    join(PUBLIC, "favicon.ico"),
    toIco([
      { size: 16, png: await fit(16, 0) },
      { size: 32, png: await fit(32, 0) },
      { size: 48, png: await fit(48, 1) },
    ]),
  );
  // Quantized PNGs: a photo at 512px is ~500 KB as truecolor, ~100 KB with
  // a 256-color palette, and the difference is invisible at icon sizes.
  const small = (buf: Buffer) => sharp(buf).png({ palette: true, quality: 90, effort: 10 }).toBuffer();
  await writeFile(join(PUBLIC, "icon-192.png"), await small(await fit(192, 6)));
  await writeFile(join(PUBLIC, "icon-512.png"), await small(await fit(512, 16)));
  // iOS shows black behind transparency, so the touch icon is opaque.
  await writeFile(join(PUBLIC, "apple-touch-icon.png"), await small(await onSquare(180, 14)));
  // Maskable: the face stays inside the central 80% safe zone.
  await writeFile(join(PUBLIC, "icon-maskable-512.png"), await small(await onSquare(512, 72)));

  console.log("[portraits] wrote src/assets/portrait/* and public favicons");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
