/**
 * Gives in-body Markdown images served from `public/` intrinsic
 * dimensions and lazy loading.
 *
 * These images deliberately stay in `public/` (not astro:assets) because
 * the RSS feed, JSON Feed, Markdown alternates and llms-full.txt all need
 * stable absolute URLs, and `entry.rendered.html` carries unresolved
 * placeholders for optimized images. Width and height still matter: they
 * let the browser reserve space before the file arrives, so there's no
 * layout shift.
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import sharp from "sharp";
import type { Root, Element } from "hast";
import { visit } from "unist-util-visit";

const cache = new Map<string, { width: number; height: number } | null>();

async function dimensions(src: string) {
  if (cache.has(src)) return cache.get(src)!;
  const file = join(process.cwd(), "public", decodeURIComponent(src));
  let dims: { width: number; height: number } | null = null;
  if (existsSync(file)) {
    const meta = await sharp(file).metadata();
    if (meta.width && meta.height) dims = { width: meta.width, height: meta.height };
  }
  cache.set(src, dims);
  return dims;
}

export default function rehypePublicImg() {
  return async (tree: Root) => {
    const images: Element[] = [];
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "img") return;
      const src = node.properties?.src;
      if (typeof src === "string" && src.startsWith("/")) images.push(node);
    });
    await Promise.all(
      images.map(async (node) => {
        const dims = await dimensions(node.properties.src as string);
        if (dims) {
          node.properties.width = dims.width;
          node.properties.height = dims.height;
        }
        node.properties.loading = "lazy";
        node.properties.decoding = "async";
      }),
    );
  };
}
