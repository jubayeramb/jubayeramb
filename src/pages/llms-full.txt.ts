import type { APIRoute } from "astro";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getProjects, getSortedPosts } from "@/lib/posts";
import { postToMarkdown, projectToMarkdown, textResponse } from "@/lib/markdown-export";
import { AUTHOR, SITE_URL } from "@/lib/site";

// The full text of the site in one Markdown document: the CV, then every
// case study and post.
export const GET: APIRoute = async () => {
  const [posts, projects] = await Promise.all([getSortedPosts(), getProjects()]);
  const cv = readFileSync(join(process.cwd(), "src/data/cv.md"), "utf8").trim();
  const body = [
    `# ${AUTHOR.name}: full site text`,
    `> Everything published on ${SITE_URL}, as Markdown. Index: ${SITE_URL}/llms.txt`,
    cv.replace(/^# .*\n/, "## CV\n"),
    ...projects.map((p) => projectToMarkdown(p).replace(/^# /, "## Project: ")),
    ...posts.map((p) => postToMarkdown(p).replace(/^# /, "## Post: ")),
  ].join("\n\n---\n\n");
  return textResponse(body + "\n");
};
