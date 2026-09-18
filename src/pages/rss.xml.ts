import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import sanitizeHtml from "sanitize-html";
import { getSortedPosts } from "@/lib/posts";
import { AUTHOR, LOCALE, SITE_NAME, TITLE_SEPARATOR } from "@/lib/site";
import { tagLabel } from "@/lib/tags";
import { absolutizeHtml } from "@/lib/feed";

export async function GET(context: APIContext) {
  const posts = await getSortedPosts();

  return rss({
    title: `${SITE_NAME}${TITLE_SEPARATOR}Writing`,
    description:
      "Notes on JavaScript, TypeScript, Astro, and the occasional reflection by Jubayer Al Mamun.",
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: new Date(post.data.pubDate),
      link: `/writings/${post.id}/`,
      author: `${AUTHOR.email} (${AUTHOR.name})`,
      // The rendered HTML, not the raw Markdown body, with root-relative
      // links made absolute so they work inside feed readers.
      content: sanitizeHtml(absolutizeHtml(post.rendered?.html ?? ""), {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
      }),
      categories: post.data.tags.map(tagLabel),
    })),
    stylesheet: "/rss/styles.xsl",
    customData: `<language>${LOCALE.feed}</language><copyright>© ${new Date().getFullYear()} ${AUTHOR.name}</copyright>`,
  });
}
