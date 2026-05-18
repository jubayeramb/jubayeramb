/// <reference types="@cloudflare/workers-types" />
/**
 * /api/now — fetches the Notion page that backs /now, converts blocks to
 * sanitized HTML, and caches at the Cloudflare edge with stale-while-
 * revalidate semantics. Only the first request after a 24h cold-start
 * blocks on Notion; everyone else gets cached content instantly and any
 * staleness is refreshed in the background.
 *
 * Bindings (set in Cloudflare Pages dashboard, also .dev.vars locally):
 *   NOTION_TOKEN         — required. Internal integration secret.
 *   NOTION_NOW_PAGE_ID   — required. ID of the /now Notion page.
 */
import sanitizeHtml from "sanitize-html";

interface Env {
  NOTION_TOKEN: string;
  NOTION_NOW_PAGE_ID: string;
}

const NOTION_VERSION = "2022-06-28";
const FRESH_SECONDS = 300; // 5 min — within this, no revalidate
const STALE_SECONDS = 60 * 60 * 24; // 24 h — max time we'll serve stale
// Bump the version segment to invalidate the cache after a code change.
const CACHE_KEY = "https://internal.cache/now/v1";

// `caches.default` is a Cloudflare extension to the standard CacheStorage
// global. The workers-types augmentation conflicts with `lib: DOM` in
// tsconfig, so we narrow to the standard Cache shape (match/put/delete)
// which is all we need.
const edgeCache = (caches as unknown as { default: Cache }).default;

type Annotations = {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
};
type RichText = {
  plain_text: string;
  href?: string | null;
  annotations?: Annotations;
};
type Block = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: any;
};

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderRichText(rt: RichText[] | undefined): string {
  if (!rt || rt.length === 0) return "";
  return rt
    .map((piece) => {
      let text = escapeHtml(piece.plain_text ?? "");
      const a = piece.annotations ?? {};
      if (a.code) text = `<code>${text}</code>`;
      if (a.bold) text = `<strong>${text}</strong>`;
      if (a.italic) text = `<em>${text}</em>`;
      if (a.strikethrough) text = `<s>${text}</s>`;
      if (a.underline) text = `<u>${text}</u>`;
      if (piece.href) {
        const href = escapeHtml(piece.href);
        text = `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
      }
      return text;
    })
    .join("");
}

// Notion returns list items as flat sibling blocks rather than nested
// lists. Group consecutive bulleted/numbered/to_do items so the rendered
// HTML uses proper <ul>/<ol> wrappers.
function renderBlocks(blocks: Block[]): string {
  let out = "";
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listType) {
      out += `</${listType}>`;
      listType = null;
    }
  };

  for (const b of blocks) {
    const data = b[b.type] ?? {};
    const rt: RichText[] | undefined = data.rich_text;

    const isBullet = b.type === "bulleted_list_item";
    const isNumber = b.type === "numbered_list_item";
    const isTodo = b.type === "to_do";

    if (isBullet || isTodo) {
      if (listType !== "ul") {
        closeList();
        out += "<ul>";
        listType = "ul";
      }
      if (isTodo) {
        const checked = !!data.checked;
        const mark = checked ? "☑ " : "☐ ";
        out += `<li>${mark}${renderRichText(rt)}</li>`;
      } else {
        out += `<li>${renderRichText(rt)}</li>`;
      }
      continue;
    }

    if (isNumber) {
      if (listType !== "ol") {
        closeList();
        out += "<ol>";
        listType = "ol";
      }
      out += `<li>${renderRichText(rt)}</li>`;
      continue;
    }

    closeList();

    switch (b.type) {
      case "heading_1":
      case "heading_2":
        out += `<h2>${renderRichText(rt)}</h2>`;
        break;
      case "heading_3":
        out += `<h3>${renderRichText(rt)}</h3>`;
        break;
      case "paragraph": {
        const inner = renderRichText(rt);
        // Notion uses empty paragraphs as visual breaks; preserve as a
        // small spacer rather than emitting <p></p>.
        if (!inner.trim()) {
          out += `<p class="now-blank">&nbsp;</p>`;
        } else {
          out += `<p>${inner}</p>`;
        }
        break;
      }
      case "quote":
        out += `<blockquote>${renderRichText(rt)}</blockquote>`;
        break;
      case "code": {
        const lang = data.language ? ` data-lang="${escapeHtml(data.language)}"` : "";
        out += `<pre${lang}><code>${escapeHtml(
          (rt ?? []).map((r) => r.plain_text).join("")
        )}</code></pre>`;
        break;
      }
      case "divider":
        out += `<hr/>`;
        break;
      default:
        // Skip anything we don't explicitly support (images, embeds,
        // tables, etc.) — keep the page short and predictable.
        break;
    }
  }

  closeList();
  return out;
}

async function fetchAllBlocks(
  env: Env,
  pageId: string
): Promise<Block[]> {
  const blocks: Block[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL(
      `https://api.notion.com/v1/blocks/${pageId}/children`
    );
    url.searchParams.set("page_size", "100");
    if (cursor) url.searchParams.set("start_cursor", cursor);
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Notion blocks fetch failed (${res.status}): ${body.slice(0, 200)}`
      );
    }
    const data = (await res.json()) as {
      results: Block[];
      has_more?: boolean;
      next_cursor?: string | null;
    };
    blocks.push(...data.results);
    cursor = data.has_more ? data.next_cursor ?? undefined : undefined;
  } while (cursor);
  return blocks;
}

async function fetchPageMeta(
  env: Env,
  pageId: string
): Promise<{ lastEdited: string }> {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Notion page fetch failed (${res.status}): ${body.slice(0, 200)}`
    );
  }
  const data = (await res.json()) as { last_edited_time?: string };
  return { lastEdited: data.last_edited_time ?? new Date().toISOString() };
}

async function fetchNotion(
  env: Env
): Promise<{ html: string; lastEdited: string }> {
  const pageId = env.NOTION_NOW_PAGE_ID;
  const [meta, blocks] = await Promise.all([
    fetchPageMeta(env, pageId),
    fetchAllBlocks(env, pageId),
  ]);
  const rawHtml = renderBlocks(blocks);
  // sanitize-html strips anything we didn't whitelist, so a stray
  // <script>/style/iframe in a code block can't escape.
  const html = sanitizeHtml(rawHtml, {
    allowedTags: [
      "p", "br", "hr",
      "h2", "h3", "h4",
      "ul", "ol", "li",
      "strong", "em", "s", "u", "code", "pre",
      "blockquote", "a",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      pre: ["data-lang"],
      p: ["class"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        target: "_blank",
        rel: "noopener",
      }),
    },
  });
  return { html, lastEdited: meta.lastEdited };
}

function buildResponse(payload: {
  html: string;
  lastEdited: string;
}): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${STALE_SECONDS}`,
      "x-cached-at": String(Date.now()),
    },
  });
}

async function refresh(env: Env): Promise<Response> {
  const payload = await fetchNotion(env);
  const response = buildResponse(payload);
  await edgeCache.put(CACHE_KEY, response.clone());
  return response;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, waitUntil }) => {
  if (!env.NOTION_TOKEN || !env.NOTION_NOW_PAGE_ID) {
    return json(
      { error: "NOTION_TOKEN / NOTION_NOW_PAGE_ID not configured." },
      { status: 503 }
    );
  }

  const cached = await edgeCache.match(CACHE_KEY);
  if (cached) {
    const cachedAtHeader = cached.headers.get("x-cached-at");
    const cachedAt = cachedAtHeader ? Number(cachedAtHeader) : 0;
    const age = (Date.now() - cachedAt) / 1000;

    if (age < FRESH_SECONDS) {
      return cached;
    }
    if (age < STALE_SECONDS) {
      // Stale — return now, refresh in background.
      waitUntil(
        refresh(env).catch((err) =>
          console.warn("[/api/now] background refresh failed:", err)
        )
      );
      return cached;
    }
    // Past stale window — fall through to synchronous refetch.
  }

  try {
    return await refresh(env);
  } catch (err) {
    return json(
      { error: (err as Error).message },
      {
        status: 502,
        headers: { "cache-control": "public, max-age=60" },
      }
    );
  }
};
