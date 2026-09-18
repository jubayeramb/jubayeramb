import type { APIRoute } from "astro";
import { SITE_URL } from "@/lib/site";

/**
 * Search and AI crawlers are welcome to read and cite everything public.
 * They're named explicitly (instead of relying on `*` alone) so the
 * intent is on record, and because a bot that matches a named group
 * ignores the `*` group entirely: the disallows have to be repeated here.
 *
 * Disallowed: the private RAG corpus and palette index (machine data, not
 * pages) and the API endpoints.
 */
const AI_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "meta-externalagent",
  "Amazonbot",
  "DuckAssistBot",
  "MistralAI-User",
];

const RULES = ["Allow: /", "Disallow: /embeddings.json", "Disallow: /palette.json", "Disallow: /api/"];

export const GET: APIRoute = () => {
  const body = [
    "# AI and answer engines: allowed. Full text for models: " + `${SITE_URL}/llms.txt`,
    ...AI_AGENTS.map((a) => `User-agent: ${a}`),
    ...RULES,
    "",
    "User-agent: *",
    ...RULES,
    "",
    `Sitemap: ${SITE_URL}/sitemap-index.xml`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
