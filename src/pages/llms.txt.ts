import type { APIRoute } from "astro";
import { getProjects, getSortedPosts } from "@/lib/posts";
import { textResponse } from "@/lib/markdown-export";
import { AUTHOR, SITE_URL, SOCIALS } from "@/lib/site";

// https://llmstxt.org: a Markdown index of the site for language models,
// pointing at clean Markdown versions of every post and case study.
export const GET: APIRoute = async () => {
  const [posts, projects] = await Promise.all([getSortedPosts(), getProjects()]);
  const body = `# ${AUTHOR.name}

> ${AUTHOR.name} is a software engineer based in ${AUTHOR.location} (${AUTHOR.timezone}), currently a ${AUTHOR.jobTitle} at ${AUTHOR.employer.name}. This is his personal site: writing on TypeScript, React, Astro and AI tooling, and case studies of products he has built end to end.

Every post and case study below links to a plain Markdown version. The complete text of the site, including his CV, is in [llms-full.txt](${SITE_URL}/llms-full.txt).

## Writing

${posts.map((p) => `- [${p.data.title}](${SITE_URL}/writings/${p.id}.md): ${p.data.description}`).join("\n")}

## Projects

${projects.map((p) => `- [${p.data.title}](${SITE_URL}/projects/${p.id}.md): ${p.data.summary}`).join("\n")}

## About

- [About](${SITE_URL}/about/): Background, experience, recognition, education and stack
- [Now](${SITE_URL}/now/): What he is focused on right now
- [Contact](${SITE_URL}/contact/): How to reach him; fastest is a DM on X or LinkedIn

## Optional

${SOCIALS.map((s) => `- [${s.label}](${s.href})`).join("\n")}
- [RSS feed](${SITE_URL}/rss.xml)
- [JSON Feed](${SITE_URL}/feed.json)
`;
  return textResponse(body);
};
