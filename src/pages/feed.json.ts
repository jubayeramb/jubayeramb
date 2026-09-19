import type { APIRoute } from "astro";
import { getSortedPosts } from "@/lib/posts";
import { AUTHOR, LOCALE, SITE_NAME, SITE_URL, TITLE_SEPARATOR } from "@/lib/site";
import { tagLabel } from "@/lib/tags";
import { absolutizeHtml } from "@/lib/feed";

// JSON Feed 1.1 (https://jsonfeed.org/version/1.1), alongside RSS.
export const GET: APIRoute = async () => {
  const posts = await getSortedPosts();
  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: `${SITE_NAME}${TITLE_SEPARATOR}Writing`,
    home_page_url: `${SITE_URL}/`,
    feed_url: `${SITE_URL}/feed.json`,
    description: "Notes on JavaScript, TypeScript, Astro, and the occasional reflection by Jubayer Al Mamun.",
    icon: `${SITE_URL}/icon-512.png`,
    favicon: `${SITE_URL}/icon-192.png`,
    language: LOCALE.html,
    authors: [{ name: AUTHOR.name, url: `${SITE_URL}/about/` }],
    items: posts.map((p) => ({
      id: `${SITE_URL}/writings/${p.id}/`,
      url: `${SITE_URL}/writings/${p.id}/`,
      title: p.data.title,
      summary: p.data.description,
      content_html: absolutizeHtml(p.rendered?.html ?? ""),
      date_published: p.data.pubDate,
      ...(p.data.updatedDate ? { date_modified: p.data.updatedDate } : {}),
      tags: p.data.tags.map(tagLabel),
    })),
  };
  return new Response(JSON.stringify(feed, null, 2), {
    headers: { "content-type": "application/feed+json; charset=utf-8" },
  });
};
