import { AUTHOR, NAV, ASK_NAV, SOCIALS } from "./site";
import { getProjects, getSortedPosts } from "./posts";

export type PaletteAction = "toggle-theme" | "copy-email" | "random-article";

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

/** Served as /palette.json and fetched the first time the palette opens. */
export async function buildPaletteIndex(): Promise<PaletteItem[]> {
  const [posts, projects] = await Promise.all([getSortedPosts(), getProjects()]);

  return [
    { id: "nav-home", group: "Navigate", label: "Home", href: "/" },
    ...[...NAV, ASK_NAV].map<PaletteItem>((item) => ({
      id: `nav-${item.id}`,
      group: "Navigate",
      label: item.id === "ask" ? "Ask my CV" : item.label,
      href: item.href,
      keywords: item.hint,
    })),

    ...projects.map<PaletteItem>((p) => ({
      id: `project-${p.id}`,
      group: "Projects",
      label: p.data.title,
      href: `/projects/${p.id}/`,
      hint: p.data.period,
      keywords: [p.data.summary, ...p.data.technologies].join(" "),
    })),

    ...posts.map<PaletteItem>((p) => ({
      id: `post-${p.id}`,
      group: "Posts",
      label: p.data.title,
      href: `/writings/${p.id}/`,
      keywords: [p.data.description, ...p.data.tags].join(" "),
    })),

    { id: "act-theme", group: "Actions", label: "Toggle theme", action: "toggle-theme", keywords: "dark light mode" },
    { id: "act-email", group: "Actions", label: "Copy email", action: "copy-email", hint: AUTHOR.email },
    { id: "act-rss", group: "Actions", label: "Open RSS feed", href: "/rss.xml" },
    { id: "act-random", group: "Actions", label: "Random article", action: "random-article" },
    ...SOCIALS.map<PaletteItem>((s) => ({
      id: `act-${s.id}`,
      group: "Actions",
      label: `Open ${s.label}`,
      href: s.href,
      external: true,
    })),
  ];
}
