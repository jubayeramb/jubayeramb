/**
 * Plain-Markdown versions of posts and projects, served as
 * /writings/<slug>.md, /projects/<slug>.md and concatenated into
 * /llms-full.txt. Answer engines and LLM crawlers get the author's own
 * text with no layout, scripts or navigation to strip.
 */
import { SITE_URL, AUTHOR } from "./site";
import { tagLabel } from "./tags";
import type { Post, Project } from "./posts";

const day = (iso: string | undefined) => (iso ? iso.split("T")[0] : undefined);

/** Root-relative Markdown links and images become absolute URLs. */
const absolutize = (md: string) => md.replace(/\]\(\/(?!\/)/g, `](${SITE_URL}/`);

const faqSection = (faq: { q: string; a: string }[] | undefined) =>
  faq && faq.length > 0
    ? `\n\n## FAQ\n\n${faq.map((f) => `### ${f.q}\n\n${f.a}`).join("\n\n")}`
    : "";

const header = (title: string, summary: string, fields: [string, string | undefined][]) =>
  [
    `# ${title}`,
    "",
    `> ${summary}`,
    "",
    ...fields.filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`),
  ].join("\n");

export function postToMarkdown(post: Post): string {
  const d = post.data;
  const tldr =
    d.tldr && d.tldr.length > 0 ? `\n\n## TL;DR\n\n${d.tldr.map((t) => `- ${t}`).join("\n")}` : "";
  return (
    header(d.title, d.description, [
      ["URL", `${SITE_URL}/writings/${post.id}/`],
      ["Author", `${AUTHOR.name} (${SITE_URL}/about/)`],
      ["Published", day(d.pubDate)],
      ["Updated", day(d.updatedDate)],
      ["Topics", d.tags.map(tagLabel).join(", ")],
    ]) +
    tldr +
    "\n\n" +
    absolutize((post.body ?? "").trim()) +
    faqSection(d.faq) +
    "\n"
  );
}

export function projectToMarkdown(project: Project): string {
  const d = project.data;
  const metrics =
    d.metrics.length > 0 ? `\n\n## At a glance\n\n${d.metrics.map((m) => `- ${m.label}: ${m.value}`).join("\n")}` : "";
  return (
    header(d.title, d.summary, [
      ["URL", `${SITE_URL}/projects/${project.id}/`],
      ["Live", d.url],
      ["Role", `${d.role}, ${d.company}`],
      ["Period", d.period],
      ["Built with", d.technologies.join(", ")],
    ]) +
    metrics +
    "\n\n" +
    absolutize((project.body ?? "").trim()) +
    faqSection(d.faq) +
    "\n"
  );
}

export const markdownResponse = (body: string) =>
  new Response(body, { headers: { "content-type": "text/markdown; charset=utf-8" } });

export const textResponse = (body: string) =>
  new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
