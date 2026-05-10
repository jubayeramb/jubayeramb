/// <reference types="@cloudflare/workers-types" />
/**
 * /api/ask — RAG chat backed by Groq (chat) + Google Gemini (embeddings)
 * via the Vercel AI SDK.
 *
 * Pipeline: load embeddings.json → embed the user's query through Gemini →
 * cosine-rank top-K chunks → stream the answer through Groq Llama as SSE.
 *
 * Bindings (set in Cloudflare Pages dashboard):
 *   GROQ_API_KEY                  — required. Drives chat completions.
 *   GOOGLE_GENERATIVE_AI_API_KEY  — required when embeddings.json was
 *                                   built with vectors. Drives runtime
 *                                   query embedding for semantic search.
 *                                   Optional when vectorMode is "none".
 *   TURNSTILE_SECRET_KEY          — optional. When set, requests must
 *                                   include a valid `cf-turnstile-response`
 *                                   header.
 *   ASK_QUOTA                     — optional KV namespace. When bound,
 *                                   applies a per-IP daily message cap.
 */
import { streamText, embed } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";

type Role = "user" | "assistant";
type Msg = { role: Role; content: string };

type Chunk = {
  id: string;
  source: "post" | "project" | "cv" | "jobs";
  title: string;
  url: string;
  text: string;
  hash: string;
  embedding: number[] | null;
};

type Manifest = {
  vectorMode: "gemini-embedding-001" | "none";
  chunks: Chunk[];
};

interface Env {
  GROQ_API_KEY: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  ASK_QUOTA?: KVNamespace;
}

// Llama 3.3 70B Versatile on Groq — 1K RPD, 12K TPM free tier; 70B params
// beat Gemini Flash Lite on reasoning, and Groq's inference is sub-second.
const CHAT_MODEL = "llama-3.3-70b-versatile";
// Must match the embedding model used at build time in
// scripts/build-embeddings.ts.
const EMBED_MODEL = "gemini-embedding-001";

const MAX_TURNS = 10;
const TOP_K = 5;
const SIM_THRESHOLD = 0.4;
const QUOTA_PER_DAY = 30;

let MANIFEST: Manifest | null = null;

const SYSTEM_PROMPT = `You're chatting with a visitor on Jubayer Al Mamun's personal site (jubayeramb.com). Talk to them like Jubayer himself would, someone who happens to know his work well, helping a friend understand it.

How to sound natural:
- Conversational. Direct. No marketing fluff, no corporate filler.
- Avoid em dashes. Use commas, colons, or periods like a normal person typing on a phone. They make text read as AI-generated; do not use them.
- Refer to him as "Jubayer" or "he". Never "the candidate", never "I".
- Match the energy of the question. Short asks get short answers; deeper asks get more.
- Vary your phrasing turn to turn. Don't fall into a template.
- NEVER use the words "context", "the information provided", "the sources", "the snippets", "based on what's given", or anything that breaks the illusion that you simply know him. Just answer.
- Bracketed citation numbers like [1] or [2,3] are FORBIDDEN in your prose. Sources appear as a small footer beneath your reply automatically; don't reference them.

Grounding:
- Answer based on what's known about Jubayer below. Don't invent roles, dates, metrics, or technologies that aren't shown.
- If a question genuinely isn't covered, say so naturally in your own words ("Not sure about that one" / "Don't know" / "Nothing on that side") and stop. Don't fabricate.

Contact info:
- ONLY share Jubayer's email (jubayeramb@gmail.com) when the visitor explicitly asks how to reach him, OR when they want to discuss something the site genuinely can't answer (hiring, partnership, private project specifics).
- Do NOT append the email as a default fallback. Do NOT close every reply with "feel free to email…". A reply that doesn't mention email is normal.

Off-topic:
- For totally unrelated requests (weather, jokes, code review of their own code), nudge back to questions about Jubayer's work in one light sentence. Don't lecture.

What's known about Jubayer:`;

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

async function loadManifest(request: Request): Promise<Manifest> {
  if (MANIFEST) return MANIFEST;
  const url = new URL("/embeddings.json", request.url);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`embeddings.json missing (status ${res.status})`);
  }
  MANIFEST = (await res.json()) as Manifest;
  return MANIFEST;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function keywordScore(query: string, text: string): number {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  if (terms.length === 0) return 0;
  const haystack = text.toLowerCase();
  let hits = 0;
  for (const t of terms) {
    const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    const matches = haystack.match(re);
    if (matches) hits += matches.length;
  }
  return hits / Math.sqrt(text.length / 200);
}

async function retrieve(
  query: string,
  manifest: Manifest,
  google: ReturnType<typeof createGoogleGenerativeAI> | null
): Promise<Chunk[]> {
  if (manifest.vectorMode === "gemini-embedding-001" && google) {
    try {
      const { embedding: queryVec } = await embed({
        model: google.textEmbeddingModel(EMBED_MODEL),
        value: query,
      });
      if (Array.isArray(queryVec) && queryVec.length > 0) {
        const scored = manifest.chunks
          .filter((c) => c.embedding)
          .map((c) => ({ c, s: cosine(queryVec, c.embedding as number[]) }))
          .filter((x) => x.s >= SIM_THRESHOLD)
          .sort((a, b) => b.s - a.s)
          .slice(0, TOP_K)
          .map((x) => x.c);
        if (scored.length > 0) return scored;
      }
    } catch (err) {
      console.warn("[retrieve] vector path failed, falling back to keywords:", err);
    }
  }

  // Keyword fallback (covers vectorMode "none" and any embedding hiccup)
  const kw = manifest.chunks
    .map((c) => ({ c, s: keywordScore(query, c.text) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, TOP_K)
    .map((x) => x.c);
  return kw;
}

function buildContext(chunks: Chunk[]): string {
  return chunks
    .map((c, i) => {
      const label = c.source === "cv" ? "CV" : c.source;
      return `[${i + 1}] (${label}: ${c.title}) ${c.url}\n${c.text}`;
    })
    .join("\n\n---\n\n");
}

async function verifyTurnstile(env: Env, request: Request): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true; // gate disabled
  const token = request.headers.get("cf-turnstile-response");
  if (!token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("token", token);
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  if (ip) form.append("remoteip", ip);
  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: form }
  );
  const data = (await res.json()) as { success?: boolean };
  return Boolean(data.success);
}

async function checkQuota(env: Env, request: Request): Promise<boolean> {
  if (!env.ASK_QUOTA) return true; // quota disabled
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return true;
  const day = new Date().toISOString().slice(0, 10);
  const key = `ask:${day}:${ip}`;
  const raw = await env.ASK_QUOTA.get(key);
  const used = raw ? parseInt(raw, 10) : 0;
  if (used >= QUOTA_PER_DAY) return false;
  await env.ASK_QUOTA.put(key, String(used + 1), {
    expirationTtl: 60 * 60 * 26,
  });
  return true;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.GROQ_API_KEY) {
    return json(
      { error: "GROQ_API_KEY not configured on this deployment." },
      { status: 503 }
    );
  }

  let body: { messages?: Msg[] };
  try {
    body = (await request.json()) as { messages?: Msg[] };
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages = (body.messages ?? []).slice(-MAX_TURNS);
  const last = messages.at(-1);
  if (!last || last.role !== "user" || !last.content?.trim()) {
    return json({ error: "Last message must be a non-empty user message." }, { status: 400 });
  }

  if (!(await verifyTurnstile(env, request))) {
    return json({ error: "Turnstile verification failed." }, { status: 401 });
  }

  if (!(await checkQuota(env, request))) {
    return json(
      { error: "Daily message limit reached. Try again tomorrow or email jubayeramb@gmail.com." },
      { status: 429 }
    );
  }

  let manifest: Manifest;
  try {
    manifest = await loadManifest(request);
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }

  // Pages Functions don't expose process.env, so providers get built per
  // request from the runtime-injected keys.
  const groq = createGroq({ apiKey: env.GROQ_API_KEY });
  const google = env.GOOGLE_GENERATIVE_AI_API_KEY
    ? createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })
    : null;

  const retrieved = await retrieve(last.content, manifest, google);
  const context = buildContext(retrieved);

  // Dedupe citations by URL — multiple chunks from the same document
  // shouldn't render as duplicate "CV · CV" entries to the visitor.
  // The full chunk list still goes into the prompt for grounding.
  const seenUrls = new Set<string>();
  const citations: { n: number; title: string; url: string; source: string }[] = [];
  for (const c of retrieved) {
    if (seenUrls.has(c.url)) continue;
    seenUrls.add(c.url);
    citations.push({
      n: citations.length + 1,
      title: c.title,
      url: c.url,
      source: c.source,
    });
  }

  const systemPrompt = context
    ? `${SYSTEM_PROMPT}\n\n${context}`
    : `${SYSTEM_PROMPT}\n\n(Nothing relevant came up for this question. Say you don't know in your own voice. Don't suggest email unless they specifically asked how to reach him.)`;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        send("citations", citations);

        const result = streamText({
          model: groq(CHAT_MODEL),
          system: systemPrompt,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          maxOutputTokens: 600,
        });

        for await (const chunk of result.textStream) {
          if (chunk) send("delta", { text: chunk });
        }
        send("done", {});
      } catch (err) {
        send("error", { message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
};

export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  let manifest: Manifest | null = null;
  try {
    manifest = await loadManifest(request);
  } catch {}
  return json({
    ok: true,
    vectorMode: manifest?.vectorMode ?? null,
    chunks: manifest?.chunks?.length ?? 0,
  });
};
