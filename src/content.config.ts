import { defineCollection, reference, type SchemaContext } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const isoDate = z.date().transform((date) => date.toISOString());

/** Cover image resolved through astro:assets, so it gets AVIF/WebP + srcset. */
const coverSchema = (image: SchemaContext["image"]) =>
  z.object({ src: image(), alt: z.string() });

/**
 * Question/answer pairs rendered visibly under an "FAQ" heading and
 * emitted as FAQPage JSON-LD. The visible text and the schema text are the
 * same strings, which is what search and answer engines expect. `a` may
 * contain inline Markdown.
 */
const faqSchema = z
  .array(z.object({ q: z.string(), a: z.string() }))
  .optional();

const postsCollection = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/posts" }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      pubDate: isoDate,
      updatedDate: isoDate.optional(),
      image: coverSchema(image).optional(),
      tags: z.array(z.string()),
      /** Key takeaways shown at the top of the post and used as BlogPosting.abstract. */
      tldr: z.array(z.string()).optional(),
      faq: faqSchema,
      /** Projects this post is about, linked from both sides. */
      relatedProjects: z.array(reference("projects")).optional(),
    }),
});

const projectsCollection = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/projects" }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      company: z.string(),
      role: z.string(),
      period: z.string(),
      summary: z.string(),
      url: z.url().optional(),
      metrics: z
        .array(z.object({ label: z.string(), value: z.string() }))
        .default([]),
      technologies: z.array(z.string()),
      cover: coverSchema(image).optional(),
      order: z.number().default(0),
      draft: z.boolean().default(false),
      /** Real publish / edit dates. Drive sitemap lastmod and JSON-LD. */
      pubDate: isoDate.optional(),
      updatedDate: isoDate.optional(),
      faq: faqSchema,
      // When present, the page emits SoftwareApplication JSON-LD instead of
      // plain CreativeWork, which is required for Google's software-app
      // rich result. applicationCategory accepts the schema.org enum
      // strings (e.g. "BrowserApplication", "TravelApplication",
      // "DesktopEnhancementApplication").
      softwareApp: z
        .object({
          applicationCategory: z.string(),
          operatingSystem: z.string(),
          price: z.string().default("0"),
          priceCurrency: z.string().default("USD"),
          /** Store listing, e.g. the Chrome Web Store page. */
          installUrl: z.url().optional(),
        })
        .optional(),
    }),
});

export const collections = {
  posts: postsCollection,
  projects: projectsCollection,
};
