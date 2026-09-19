/**
 * Adds a <link rel="stylesheet"> once and resolves when it has loaded.
 *
 * Astro hoists any CSS a client script imports (dynamic imports included)
 * into every page that ships the script. Feature modules that should cost
 * nothing until used import their stylesheet with `?url` instead and call
 * this before rendering, so the CSS is fetched on demand.
 */
const pending = new Map<string, Promise<void>>();

export function loadStylesheet(href: string): Promise<void> {
  let p = pending.get(href);
  if (p) return p;
  p = new Promise<void>((resolve) => {
    const existing = document.querySelector<HTMLLinkElement>(`link[rel="stylesheet"][href="${href}"]`);
    if (existing) return resolve();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    // Resolve on error too: an unstyled feature beats a dead button.
    link.onload = link.onerror = () => resolve();
    document.head.appendChild(link);
  });
  pending.set(href, p);
  return p;
}
