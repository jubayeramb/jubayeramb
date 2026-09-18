/**
 * Notion page -> sanitized HTML for /now.
 *
 * Shared by two runtimes:
 *   - `scripts/build-now.ts` (Node, prebuild) renders a snapshot straight
 *     into the /now page's HTML, so crawlers that don't execute
 *     JavaScript still see the content.
 *   - `functions/api/now.ts` (Cloudflare Pages Function) serves the live
 *     version the page refreshes from after load.
 *
 * Nothing in here touches Node or Workers-specific APIs, only `fetch`.
 */
import sanitizeHtml from "sanitize-html";

export type NotionCredentials = { token: string; pageId: string };
export type NowPayload = { html: string; lastEdited: string };

const NOTION_VERSION = "2022-06-28";

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
export function renderBlocks(blocks: Block[]): string {
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
        const mark = data.checked ? "☑ " : "☐ ";
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
        // Notion uses empty paragraphs as visual breaks. The page's own
        // spacing already separates blocks, so they're dropped.
        if (inner.trim()) out += `<p>${inner}</p>`;
        break;
      }
      case "quote":
        out += `<blockquote>${renderRichText(rt)}</blockquote>`;
        break;
      case "code": {
        const lang = data.language ? ` data-lang="${escapeHtml(data.language)}"` : "";
        out += `<pre${lang}><code>${escapeHtml(
          (rt ?? []).map((r) => r.plain_text).join(""),
        )}</code></pre>`;
        break;
      }
      case "divider":
        out += `<hr/>`;
        break;
      default:
        // Skip anything not explicitly supported (images, embeds, tables,
        // etc.) to keep the page short and predictable.
        break;
    }
  }

  closeList();
  return out;
}

async function notionGet<T>(path: string, creds: NotionCredentials): Promise<T> {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Notion-Version": NOTION_VERSION,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion ${path.split("/")[0]} fetch failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function fetchAllBlocks(creds: NotionCredentials): Promise<Block[]> {
  const blocks: Block[] = [];
  let cursor: string | undefined;
  do {
    const qs = new URLSearchParams({ page_size: "100" });
    if (cursor) qs.set("start_cursor", cursor);
    const data = await notionGet<{
      results: Block[];
      has_more?: boolean;
      next_cursor?: string | null;
    }>(`blocks/${creds.pageId}/children?${qs}`, creds);
    blocks.push(...data.results);
    cursor = data.has_more ? (data.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return blocks;
}

/** Fetches the /now page and returns sanitized HTML plus its last edit time. */
export async function fetchNowPage(creds: NotionCredentials): Promise<NowPayload> {
  const [meta, blocks] = await Promise.all([
    notionGet<{ last_edited_time?: string }>(`pages/${creds.pageId}`, creds),
    fetchAllBlocks(creds),
  ]);
  // sanitize-html strips anything not whitelisted, so a stray
  // <script>/style/iframe in a code block can't escape.
  const html = sanitizeHtml(renderBlocks(blocks), {
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
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        target: "_blank",
        rel: "noopener",
      }),
    },
  });
  return { html, lastEdited: meta.last_edited_time ?? new Date().toISOString() };
}
