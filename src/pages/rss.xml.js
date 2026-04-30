import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import sanitizeHtml from "sanitize-html";

export async function GET(context) {
  const posts = await getCollection("posts");
  const sortedPosts = posts.sort(
    (a, b) =>
      new Date(b.data.pubDate).getTime() - new Date(a.data.pubDate).getTime()
  );

  return rss({
    title: "Jubayer Al Mamun — Writing",
    description:
      "Notes on JavaScript, TypeScript, Astro, and the occasional reflection by Jubayer Al Mamun.",
    site: context.site,
    items: sortedPosts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: new Date(post.data.pubDate),
      link: `/writings/${post.id}/`,
      content: sanitizeHtml(post.body ?? "", {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
      }),
      categories: post.data.tags ?? [],
    })),
    stylesheet: "/rss/styles.xsl",
    customData: `<language>en-us</language><copyright>© ${new Date().getFullYear()} Jubayer Al Mamun</copyright>`,
  });
}
