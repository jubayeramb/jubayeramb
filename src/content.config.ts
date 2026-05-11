import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const postsCollection = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/posts" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.date().transform((date) => date.toISOString()),
    updatedDate: z.date().optional(),
    image: z
      .object({
        url: z.string(),
        alt: z.string(),
      })
      .optional(),
    tags: z.array(z.string()),
  }),
});

const projectsCollection = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: z.object({
    title: z.string(),
    company: z.string(),
    role: z.string(),
    period: z.string(),
    summary: z.string(),
    url: z.string().url().optional(),
    metrics: z
      .array(z.object({ label: z.string(), value: z.string() }))
      .default([]),
    technologies: z.array(z.string()),
    cover: z
      .object({ url: z.string(), alt: z.string() })
      .optional(),
    order: z.number().default(0),
    draft: z.boolean().default(false),
    // When present, the page emits SoftwareApplication JSON-LD instead of
    // plain CreativeWork — required for Google's software-app rich result.
    // applicationCategory accepts the schema.org enum strings (e.g.
    // "BrowserApplication", "TravelApplication", "DesktopEnhancementApplication").
    softwareApp: z
      .object({
        applicationCategory: z.string(),
        operatingSystem: z.string(),
        price: z.string().default("0"),
        priceCurrency: z.string().default("USD"),
      })
      .optional(),
  }),
});

export const collections = {
  posts: postsCollection,
  projects: projectsCollection,
};
