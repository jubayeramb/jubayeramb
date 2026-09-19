/**
 * Build-time snapshot of the /now Notion page, written by
 * `scripts/build-now.ts` during prebuild and read by the /now page, the
 * home page teaser, the sitemap and the footer's "last updated" date.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type NowSnapshot = {
  /** Sanitized HTML, or null when no snapshot could be produced. */
  html: string | null;
  lastEdited: string | null;
  fetchedAt: string | null;
  /** "fresh" (fetched this build), "cache" (last good copy) or "none". */
  source: "fresh" | "cache" | "none";
};

export const NOW_SNAPSHOT_PATH = "src/data/now.generated.json";

const EMPTY: NowSnapshot = { html: null, lastEdited: null, fetchedAt: null, source: "none" };

export function readNowSnapshot(root = process.cwd()): NowSnapshot {
  const file = join(root, NOW_SNAPSHOT_PATH);
  if (!existsSync(file)) return EMPTY;
  try {
    return { ...EMPTY, ...(JSON.parse(readFileSync(file, "utf8")) as Partial<NowSnapshot>) };
  } catch {
    return EMPTY;
  }
}
