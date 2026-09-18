/**
 * Props accepted by Seo.astro, and passed through BaseLayout and Layout
 * unchanged. Declared once here instead of three times.
 */

export type CollectionItem = {
  title: string;
  url: string;
  date?: string | Date;
  description?: string;
};

export type ProjectMeta = {
  role?: string;
  period?: string;
  url?: string;
  technologies?: string[];
  /**
   * Marks a project as a SoftwareApplication. Triggers the matching rich
   * result schema (with offers) instead of plain CreativeWork.
   */
  softwareApp?: {
    applicationCategory: string;
    operatingSystem: string;
    price?: string;
    priceCurrency?: string;
    installUrl?: string;
  };
};

export type FaqItem = { q: string; a: string };

/** An image with known dimensions; `src` is absolute or root-relative. */
export type SeoImage = { src: string; width: number; height: number };

export type RobotsDirective = "index" | "noindex-follow" | "noindex";

export type SeoProps = {
  title: string;
  description?: string;
  imageAlt?: string;
  keywords?: string[];
  /** Page kind: drives og:type and the JSON-LD shape. */
  type?: "website" | "article" | "profile" | "project";
  pubDate?: string | Date;
  updatedDate?: string | Date;
  tags?: string[];
  /** Project only: fed into CreativeWork / SoftwareApplication JSON-LD. */
  projectMeta?: ProjectMeta;
  /** Index pages: emits CollectionPage + ItemList over these. */
  collectionItems?: CollectionItem[];
  collectionKind?: "Article" | "CreativeWork" | "WebPage";
  /** Emits ProfilePage with the Person as mainEntity (home, /about). */
  profilePage?: boolean;
  canonical?: string;
  /**
   * "noindex-follow" keeps the page out of the index while still letting
   * crawlers follow its links (thin tag pages). "noindex" is for pages
   * that should not be crawled into at all (/ask, 404).
   */
  robots?: RobotsDirective;
  /** Shorthand for robots="noindex". */
  noindex?: boolean;
  /** Article only. */
  readingStats?: { wordCount: number; isoDuration: string };
  /** Short summary, emitted as BlogPosting.abstract. */
  abstract?: string;
  /** Cover image, emitted in JSON-LD next to the OG card. */
  cover?: SeoImage;
  faq?: FaqItem[];
  /** Path of a text/markdown version of this page. */
  markdownAlternate?: string;
  /** Last content change for non-article pages, e.g. /now. */
  lastModified?: string | Date;
};
