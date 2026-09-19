import { getCollection, type CollectionEntry } from "astro:content";

export type Post = CollectionEntry<"posts">;
export type Project = CollectionEntry<"projects">;

const byDateDesc = (a: Post, b: Post) =>
  new Date(b.data.pubDate).getTime() - new Date(a.data.pubDate).getTime();

export async function getSortedPosts(): Promise<Post[]> {
  return (await getCollection("posts")).sort(byDateDesc);
}

/** Published projects, highest `order` first. Drafts show only in dev. */
export async function getProjects(): Promise<Project[]> {
  const isProd = import.meta.env.PROD;
  return (await getCollection("projects"))
    .filter((p) => (isProd ? !p.data.draft : true))
    .sort((a, b) => b.data.order - a.data.order);
}

export type ReadingStats = {
  /** Words of prose, code blocks excluded. Used for BlogPosting.wordCount. */
  wordCount: number;
  /** Rounded-up minutes at ~220 wpm over the whole body. */
  minutes: number;
  /** ISO 8601 duration for BlogPosting.timeRequired, e.g. "PT7M". */
  isoDuration: string;
};

const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * Computed once from the raw Markdown body and reused by the layouts,
 * index pages, JSON-LD and feeds so the numbers always agree.
 */
export function getReadingStats(body: string | undefined): ReadingStats {
  const text = body ?? "";
  const prose = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]/g, " ");
  const minutes = Math.max(1, Math.ceil(countWords(text) / 220));
  return { wordCount: countWords(prose), minutes, isoDuration: `PT${minutes}M` };
}

/** The tag every technical post carries adds no signal to relatedness. */
const GENERIC_TAGS = new Set(["technical"]);

/** Posts sharing the most specific tags with `post`, newest first on ties. */
export function getRelatedPosts(post: Post, all: Post[], limit = 3): Post[] {
  const tags = new Set(post.data.tags.filter((t) => !GENERIC_TAGS.has(t)));
  return all
    .filter((p) => p.id !== post.id)
    .map((p) => ({
      p,
      score: p.data.tags.filter((t) => tags.has(t)).length,
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || byDateDesc(a.p, b.p))
    .slice(0, limit)
    .map((r) => r.p);
}

/** Chronological neighbours: `newer` and `older` than `post`. */
export function getPrevNext(post: Post, sorted: Post[]) {
  const i = sorted.findIndex((p) => p.id === post.id);
  return {
    newer: i > 0 ? sorted[i - 1] : undefined,
    older: i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : undefined,
  };
}

/** Posts that declare this project in `relatedProjects`. */
export function getPostsAboutProject(projectId: string, all: Post[]): Post[] {
  return all.filter((p) => p.data.relatedProjects?.some((r) => r.id === projectId));
}
