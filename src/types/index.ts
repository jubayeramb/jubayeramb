import type { CollectionEntry } from "astro:content";

export type JobDescription = {
  company: string;
  description: string;
  url: string;
  designation: string;
  startDate: string;
  endDate: string;
  technologies: string[];
};

export type BlogPostType = CollectionEntry<"posts">;
export type BlogPostFrontMatter = BlogPostType["data"];
