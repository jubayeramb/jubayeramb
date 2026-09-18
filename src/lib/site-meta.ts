/**
 * Site-level freshness, derived from real content dates (post and project
 * frontmatter, the /now snapshot) instead of the build clock.
 */
import { lastModifiedByPath } from "./build/content-index";
import { readNowSnapshot } from "./now-snapshot";

let cached: Map<string, Date> | null = null;

function modifiedMap() {
  if (!cached) {
    const now = readNowSnapshot();
    cached = lastModifiedByPath(process.cwd(), {
      "/now/": now.lastEdited ? new Date(now.lastEdited) : undefined,
    });
  }
  return cached;
}

/** Most recent real content change anywhere on the site. */
export function siteLastUpdated(): Date | undefined {
  return modifiedMap().get("/");
}

/** Real last-modified date for a path such as "/writings/", if known. */
export function pathLastModified(path: string): Date | undefined {
  return modifiedMap().get(path);
}
