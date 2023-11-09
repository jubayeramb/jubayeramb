import type { MarkdownInstance } from "astro";

export type JobDescription = {
  company: string;
  description: string;
  url: string;
  designation: string;
  startDate: string;
  endDate: string;
  technologies: string[];
};

export type BlogPostFrontMatter = {
  layout: string;
  title: string;
  description: string;
  pubDate: string;
  slug: string;
  tags: string[];
  image?: string;
  imageAlt?: string;
  updatedDate?: string;
};

export type BlogPostType = MarkdownInstance<BlogPostFrontMatter>;
