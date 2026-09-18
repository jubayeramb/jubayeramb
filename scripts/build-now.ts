/**
 * Prebuild: snapshot the /now Notion page into the build.
 *
 * /now used to ship only a "Loading..." shell and fetch its content in the
 * browser, so crawlers that don't run JavaScript (GPTBot, ClaudeBot,
 * PerplexityBot, CCBot) indexed an empty page. This renders the same
 * sanitized HTML at build time instead.
 *
 * Never fails the build. Fallback order:
 *   1. fresh fetch from Notion (needs NOTION_TOKEN + NOTION_NOW_PAGE_ID)
 *   2. the last good snapshot, cached in node_modules/.cache, which
 *      Cloudflare Pages keeps between builds
 *   3. an empty snapshot; the page renders a short static fallback
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./lib/env";
import { fetchNowPage } from "../src/lib/notion-now";
import { NOW_SNAPSHOT_PATH, type NowSnapshot } from "../src/lib/now-snapshot";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, NOW_SNAPSHOT_PATH);
const CACHE = join(ROOT, "node_modules/.cache/now/snapshot.json");

loadLocalEnv(ROOT);

function write(path: string, snapshot: NowSnapshot) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
}

function readCache(): NowSnapshot | null {
  if (!existsSync(CACHE)) return null;
  try {
    const cached = JSON.parse(readFileSync(CACHE, "utf8")) as NowSnapshot;
    return cached.html ? { ...cached, source: "cache" } : null;
  } catch {
    return null;
  }
}

async function main() {
  const token = process.env.NOTION_TOKEN?.trim();
  const pageId = process.env.NOTION_NOW_PAGE_ID?.trim();

  if (token && pageId) {
    try {
      const { html, lastEdited } = await fetchNowPage({ token, pageId });
      const snapshot: NowSnapshot = {
        html,
        lastEdited,
        fetchedAt: new Date().toISOString(),
        source: "fresh",
      };
      write(OUT, snapshot);
      write(CACHE, snapshot);
      console.log(`[now] fresh snapshot, last edited ${lastEdited}`);
      return;
    } catch (err) {
      console.warn(`[now] Notion fetch failed, trying cache: ${(err as Error).message}`);
    }
  } else {
    console.warn("[now] NOTION_TOKEN / NOTION_NOW_PAGE_ID not set, trying cache");
  }

  const cached = readCache();
  if (cached) {
    write(OUT, cached);
    console.warn(`[now] using cached snapshot from ${cached.fetchedAt}`);
    return;
  }

  write(OUT, { html: null, lastEdited: null, fetchedAt: null, source: "none" });
  console.warn("[now] no snapshot available, /now will render its static fallback");
}

main().catch((err) => {
  // Belt and braces: a snapshot problem must never break a deploy.
  console.error("[now] unexpected error:", err);
  write(OUT, { html: null, lastEdited: null, fetchedAt: null, source: "none" });
});
