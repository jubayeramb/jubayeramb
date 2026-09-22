/**
 * Tag display names and the "thin tag" rule. Pure data with no
 * `astro:content` import, so the Astro config and build scripts can use it
 * as well as pages.
 */

const TAG_LABELS: Record<string, string> = {
  ai: "AI",
  agents: "Agents",
  astro: "Astro",
  career: "Career",
  claude: "Claude",
  css: "CSS",
  "error-handling": "Error handling",
  goals: "Goals",
  html: "HTML",
  javascript: "JavaScript",
  life: "Life",
  llm: "LLM",
  mcp: "MCP",
  promises: "Promises",
  skills: "Skills",
  tailwindcss: "Tailwind CSS",
  technical: "Technical",
  typescript: "TypeScript",
  "year-in-review": "Year in review",
};

/** Human label for a tag slug, e.g. "mcp" -> "MCP", "year-in-review" -> "Year in review". */
export function tagLabel(tag: string): string {
  if (TAG_LABELS[tag]) return TAG_LABELS[tag];
  const words = tag.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A tag page listing a single post is a near-duplicate of that post's own
 * page. Those stay reachable for visitors but are `noindex, follow` and
 * left out of the sitemap.
 */
export const MIN_POSTS_FOR_INDEXABLE_TAG = 2;

export function isThinTag(count: number): boolean {
  return count < MIN_POSTS_FOR_INDEXABLE_TAG;
}
