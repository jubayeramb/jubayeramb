import { join } from "node:path";
import sharp from "sharp";
import { getImage } from "astro:assets";
import cutout from "@/assets/portrait/hero-cutout.png";

/**
 * The home hero portrait, built once so the <picture> in HomeHero and the
 * <link rel="preload"> in the page head reference byte-identical URLs (a
 * mismatch would download the image twice).
 *
 * The portrait renders at min(15rem, 62vw) on phones and 26rem from 64rem
 * up; the widths cover those at 1x to 3x density.
 */
export const HERO_SIZES = "(width >= 64rem) 26rem, min(15rem, 62vw)";
const WIDTHS = [240, 320, 420, 480, 640, 832];

/**
 * A 24px-wide copy of the cutout, inlined as a data URI (a few hundred
 * bytes) and shown blurred until the real image loads, so the arch never
 * sits empty on a slow connection. Read from source because getImage only
 * returns URLs.
 */
async function placeholderDataUri() {
  const buf = await sharp(join(process.cwd(), "src/assets/portrait/hero-cutout.png"))
    .resize(24)
    .webp({ quality: 50, alphaQuality: 50 })
    .toBuffer();
  return `data:image/webp;base64,${buf.toString("base64")}`;
}

export async function getHeroImage() {
  const [[avif, webp], placeholder] = await Promise.all([
    Promise.all(
      (["avif", "webp"] as const).map((format) =>
        getImage({ src: cutout, widths: WIDTHS, sizes: HERO_SIZES, format }),
      ),
    ),
    placeholderDataUri(),
  ]);
  return { avif, webp, placeholder, width: cutout.width, height: cutout.height };
}

export type HeroImage = Awaited<ReturnType<typeof getHeroImage>>;
