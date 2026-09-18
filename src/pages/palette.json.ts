import type { APIRoute } from "astro";
import { buildPaletteIndex } from "@/lib/palette-index";

// The command palette's search index. Fetched on first open instead of
// being inlined into every page's HTML.
export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await buildPaletteIndex()), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
