import { getCollection } from "astro:content";

export type PaletteAction =
  | "toggle-theme"
  | "copy-email"
  | "random-article";

export type PaletteItem = {
  id: string;
  group: "Navigate" | "Projects" | "Posts" | "Actions";
  label: string;
  href?: string;
  action?: PaletteAction;
  external?: boolean;
  hint?: string;
  keywords?: string;
};

export async function buildPaletteIndex(): Promise<PaletteItem[]> {
  const isProd = import.meta.env.PROD;

  const posts = (await getCollection("posts")).sort(
    (a, b) =>
      new Date(b.data.pubDate).getTime() - new Date(a.data.pubDate).getTime()
  );

  const projects = (await getCollection("projects"))
    .filter((p) => (isProd ? !p.data.draft : true))
    .sort((a, b) => b.data.order - a.data.order);

  const items: PaletteItem[] = [
    { id: "nav-home", group: "Navigate", label: "Home", href: "/" },
    { id: "nav-projects", group: "Navigate", label: "Projects", href: "/projects" },
    { id: "nav-writings", group: "Navigate", label: "Writings", href: "/writings" },
    { id: "nav-ask", group: "Navigate", label: "Ask my CV", href: "/ask" },
    { id: "nav-about", group: "Navigate", label: "About", href: "/about" },
    { id: "nav-contact", group: "Navigate", label: "Contact", href: "/contact" },

    ...projects.map<PaletteItem>((p) => ({
      id: `project-${p.id}`,
      group: "Projects",
      label: p.data.title,
      href: `/projects/${p.id}`,
      hint: p.data.period,
      keywords: [p.data.summary, ...p.data.technologies].join(" "),
    })),

    ...posts.map<PaletteItem>((p) => ({
      id: `post-${p.id}`,
      group: "Posts",
      label: p.data.title,
      href: `/writings/${p.id}`,
      keywords: (p.data.tags ?? []).join(" "),
    })),

    {
      id: "act-theme",
      group: "Actions",
      label: "Toggle theme",
      action: "toggle-theme",
      keywords: "dark light mode",
    },
    {
      id: "act-email",
      group: "Actions",
      label: "Copy email",
      action: "copy-email",
      hint: "jubayeramb@gmail.com",
    },
    {
      id: "act-rss",
      group: "Actions",
      label: "Open RSS feed",
      href: "/rss.xml",
    },
    {
      id: "act-random",
      group: "Actions",
      label: "Random article",
      action: "random-article",
    },
    {
      id: "act-github",
      group: "Actions",
      label: "Open GitHub",
      href: "https://github.com/jubayeramb",
      external: true,
    },
    {
      id: "act-x",
      group: "Actions",
      label: "Open X (Twitter)",
      href: "https://twitter.com/jubayeramb",
      external: true,
    },
    {
      id: "act-linkedin",
      group: "Actions",
      label: "Open LinkedIn",
      href: "https://www.linkedin.com/in/jubayeramb/",
      external: true,
    },
  ];

  return items;
}
