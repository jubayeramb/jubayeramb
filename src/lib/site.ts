/**
 * Site-wide identity and navigation. Everything that used to be repeated
 * across Seo.astro, the contact page, the home page and the command
 * palette reads from here so a handle or URL only ever changes once.
 */

export const SITE_URL = "https://jubayeramb.com";
export const SITE_HOST = "jubayeramb.com";
export const SITE_NAME = "Jubayer Al Mamun";

/** Separator between page title and site name in <title> and og:title. */
export const TITLE_SEPARATOR = " - ";

export const SITE_DESCRIPTION =
  "Software engineer based in Dhaka, Bangladesh, working on web and mobile products. Writing about TypeScript, React, and Astro.";

/**
 * One source for every locale declaration so <html lang>, og:locale,
 * JSON-LD inLanguage and the feeds can't drift apart again.
 */
export const LOCALE = {
  html: "en-US",
  og: "en_US",
  ld: "en-US",
  feed: "en-us",
} as const;

export const AUTHOR = {
  name: "Jubayer Al Mamun",
  givenName: "Jubayer Al",
  familyName: "Mamun",
  username: "jubayeramb",
  jobTitle: "Software Engineer",
  email: "jubayeramb@gmail.com",
  twitter: "@jubayeramb",
  locality: "Dhaka",
  country: "BD",
  location: "Dhaka, Bangladesh",
  timezone: "UTC+6",
  employer: {
    name: "WeCycle",
    url: "https://getwecycle.com/",
    // WeCycle is a Tanbel company; Tanbel's GitHub org is the "company" on
    // the GitHub profile, so naming it here keeps the two consistent.
    parent: { name: "Tanbel", sameAs: ["https://github.com/tanbelinc"] },
  },
  alumniOf: {
    name: "Green University of Bangladesh",
    url: "https://green.edu.bd/",
  },
} as const;

export type Social = {
  id: "github" | "linkedin" | "x" | "bluesky";
  label: string;
  handle: string;
  href: string;
};

export const SOCIALS: readonly Social[] = [
  {
    id: "github",
    label: "GitHub",
    handle: "@jubayeramb",
    href: "https://github.com/jubayeramb",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    handle: "/in/jubayeramb",
    href: "https://www.linkedin.com/in/jubayeramb/",
  },
  {
    id: "x",
    label: "X (Twitter)",
    handle: "@jubayeramb",
    href: "https://twitter.com/jubayeramb",
  },
  {
    id: "bluesky",
    label: "Bluesky",
    handle: "@jubayeramb.com",
    href: "https://bsky.app/profile/jubayeramb.com",
  },
];

export const socialHref = (id: Social["id"]) =>
  SOCIALS.find((s) => s.id === id)!.href;

export type NavItem = {
  id: string;
  label: string;
  href: string;
  hint: string;
};

/** Primary navigation, in display order. */
export const NAV: readonly NavItem[] = [
  { id: "projects", label: "Projects", href: "/projects/", hint: "Selected case studies" },
  { id: "writings", label: "Writing", href: "/writings/", hint: "Notes on engineering and craft" },
  { id: "about", label: "About", href: "/about/", hint: "Background and approach" },
  { id: "now", label: "Now", href: "/now/", hint: "What I'm focused on right now" },
  { id: "contact", label: "Contact", href: "/contact/", hint: "Get in touch" },
];

export const ASK_NAV: NavItem = {
  id: "ask",
  label: "Ask",
  href: "/ask/",
  hint: "Chat grounded in this site",
};

/** Absolute URL for a site path. */
export const absolute = (path: string) => new URL(path, SITE_URL + "/").toString();
