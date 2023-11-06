import type { BlogPostType } from "@/types";

/**
 * Returns an array of unique tags from an array of blog posts.
 * @param posts An array of blog posts.
 * @returns An array of unique tags.
 */
export const getAllUniqueTags = (posts: BlogPostType[]): string[] => {
  return [
    ...new Set(
      posts
        .map((post) => post.frontmatter.tags)
        .flat()
        .filter((tag) => !!tag)
    ),
  ];
};
