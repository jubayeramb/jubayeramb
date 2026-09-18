import { SITE_URL } from "./site";

/**
 * Rewrites root-relative href/src attributes to absolute URLs. Feed
 * readers and LLM crawlers see content out of the page's context, where
 * "/writings/foo" means nothing.
 */
export function absolutizeHtml(html: string): string {
  return html.replace(/\s(href|src)="\/(?!\/)/g, ` $1="${SITE_URL}/`);
}
