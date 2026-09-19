/// <reference types="@cloudflare/workers-types" />
/**
 * /api/now: serves the live version of the Notion page behind /now,
 * cached at the Cloudflare edge with stale-while-revalidate semantics.
 * Only the first request after a 24h cold start blocks on Notion;
 * everyone else gets cached content instantly and any staleness is
 * refreshed in the background.
 *
 * The /now page already ships a build-time snapshot in its HTML (see
 * scripts/build-now.ts). The page calls this endpoint after load and only
 * swaps content in when Notion has been edited since that snapshot.
 *
 * Bindings (set in Cloudflare Pages dashboard, also .dev.vars locally):
 *   NOTION_TOKEN         required. Internal integration secret.
 *   NOTION_NOW_PAGE_ID   required. ID of the /now Notion page.
 */
import { fetchNowPage, type NowPayload } from "../../src/lib/notion-now";

interface Env {
  NOTION_TOKEN: string;
  NOTION_NOW_PAGE_ID: string;
}

const FRESH_SECONDS = 300; // 5 min: within this, no revalidate
const STALE_SECONDS = 60 * 60 * 24; // 24 h: max time stale content is served
// Bump the version segment to invalidate the cache after a code change.
const CACHE_KEY = "https://internal.cache/now/v2";

// `caches.default` is a Cloudflare extension to the standard CacheStorage
// global. The workers-types augmentation conflicts with `lib: DOM` in
// tsconfig, so narrow to the standard Cache shape (match/put/delete),
// which is all this needs.
const edgeCache = (caches as unknown as { default: Cache }).default;

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });

function buildResponse(payload: NowPayload): Response {
  return json(payload, {
    headers: {
      "cache-control": `public, max-age=${STALE_SECONDS}`,
      "x-cached-at": String(Date.now()),
    },
  });
}

async function refresh(env: Env): Promise<Response> {
  const payload = await fetchNowPage({
    token: env.NOTION_TOKEN,
    pageId: env.NOTION_NOW_PAGE_ID,
  });
  const response = buildResponse(payload);
  await edgeCache.put(CACHE_KEY, response.clone());
  return response;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, waitUntil }) => {
  if (!env.NOTION_TOKEN || !env.NOTION_NOW_PAGE_ID) {
    return json(
      { error: "NOTION_TOKEN / NOTION_NOW_PAGE_ID not configured." },
      { status: 503 },
    );
  }

  const cached = await edgeCache.match(CACHE_KEY);
  if (cached) {
    const cachedAtHeader = cached.headers.get("x-cached-at");
    const cachedAt = cachedAtHeader ? Number(cachedAtHeader) : 0;
    const age = (Date.now() - cachedAt) / 1000;

    if (age < FRESH_SECONDS) return cached;
    if (age < STALE_SECONDS) {
      // Stale: return now, refresh in the background.
      waitUntil(
        refresh(env).catch((err) =>
          console.warn("[/api/now] background refresh failed:", err),
        ),
      );
      return cached;
    }
    // Past the stale window: fall through to a synchronous refetch.
  }

  try {
    return await refresh(env);
  } catch (err) {
    return json(
      { error: (err as Error).message },
      {
        status: 502,
        headers: { "cache-control": "public, max-age=60" },
      },
    );
  }
};
