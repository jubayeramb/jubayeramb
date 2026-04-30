import type { CollectionEntry } from "astro:content";

export type JobDescription = {
  company: string;
  url: string;
  designation: string;
  startDate: string;
  endDate: string;
  description: string;
  technologies: string[];
};

export type BlogPostType = CollectionEntry<"posts">;
export type BlogPostFrontMatter = BlogPostType["data"];
