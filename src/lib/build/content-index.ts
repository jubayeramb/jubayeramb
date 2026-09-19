/**
 * Build-time view of the content collections, read straight from disk.
 *
 * `astro:content` isn't available inside astro.config or the prebuild
 * scripts, so this reads the same Markdown frontmatter with gray-matter.
 * Only the fields those callers need are exposed.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

export type IndexedEntry = {
  id: string;
  collection: "posts" | "projects";
  data: Record<string, any>;
  body: string;
};

const DIRS = {
  posts: "src/content/posts",
  projects: "src/content/projects",
} as const;

export function readCollection(
  collection: keyof typeof DIRS,
  root = process.cwd(),
): IndexedEntry[] {
  const dir = join(root, DIRS[collection]);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const { data, content } = matter(readFileSync(join(dir, file), "utf8"));
      return { id: file.replace(/\.md$/, ""), collection, data, body: content };
    })
    .filter((e) => !e.data.draft);
}

const toDate = (v: unknown): Date | undefined => {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/** Last real content change of an entry: updatedDate, else pubDate. */
export const entryModified = (e: IndexedEntry) =>
  toDate(e.data.updatedDate) ?? toDate(e.data.pubDate);

const latest = (dates: (Date | undefined)[]) =>
  dates.filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];

export function tagCounts(posts: IndexedEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of posts) {
    for (const tag of (p.data.tags as string[] | undefined) ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Real last-modified dates keyed by path ("/writings/foo/"). Pages without
 * a trustworthy date are left out on purpose: no lastmod is more honest
 * than a build timestamp.
 */
export function lastModifiedByPath(
  root = process.cwd(),
  extra: Record<string, Date | undefined> = {},
): Map<string, Date> {
  const posts = readCollection("posts", root);
  const projects = readCollection("projects", root);
  const map = new Map<string, Date>();
  const set = (path: string, d: Date | undefined) => {
    if (d) map.set(path, d);
  };

  for (const p of posts) set(`/writings/${p.id}/`, entryModified(p));
  for (const p of projects) set(`/projects/${p.id}/`, entryModified(p));

  const latestPost = latest(posts.map(entryModified));
  const latestProject = latest(projects.map(entryModified));
  set("/writings/", latestPost);
  set("/projects/", latestProject);
  set("/tags/", latestPost);
  for (const tag of tagCounts(posts).keys()) {
    set(
      `/tags/${tag}/`,
      latest(posts.filter((p) => p.data.tags?.includes(tag)).map(entryModified)),
    );
  }
  for (const [path, d] of Object.entries(extra)) set(path, d);
  set("/", latest([latestPost, latestProject, extra["/now/"]]));
  return map;
}
