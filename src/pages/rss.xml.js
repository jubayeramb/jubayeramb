import rss, { pagesGlobToRssItems } from "@astrojs/rss";
import sanitizeHtml from "sanitize-html";

export async function GET(context) {
  const posts = Object.values(
    import.meta.glob("./writing/*.md", {
      eager: true,
    })
  );
  return rss({
    // `<title>` field in output xml
    title: "Jubayer's Blog",
    // `<description>` field in output xml
    description: "A blog about web development, programming and DIY",
    // Pull in your project "site" from the endpoint context
    // https://docs.astro.build/en/reference/api-reference/#contextsite
    site: context.site,
    // Array of `<item>`s in output xml
    // See "Generating items" section for examples using content collections and glob imports
    items: posts.map((post) => ({
      link: post.url,
      content: sanitizeHtml(post.compiledContent()),
      ...post.frontmatter,
    })),
    stylesheet: "/rss/styles.xsl",
    // (optional) inject custom xml
    customData: `<language>en-us</language>`,
  });
}
