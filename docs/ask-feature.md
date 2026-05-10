# `/ask` — RAG Chat Feature

A small chat at `/ask` that answers questions about Jubayer's work, projects,
and writing. It retrieves the most relevant passages from this site and
streams an answer back with inline citations to the source pages.

This doc covers the architecture, the request flow, every file involved,
and exactly how to run it on your laptop.

---

## At a glance

```
                 ┌───────────────────────────────┐
   Build time:   │ pnpm prebuild                 │
                 │   ├─ read posts/projects/cv   │
                 │   ├─ chunk → hash → embed     │
                 │   └─ write embeddings.json    │
                 └──────────────┬────────────────┘
                                ▼
                       public/embeddings.json   ◄── deployed as static asset
                                ▲
                                │ fetch()
                 ┌──────────────┴────────────────┐
   Runtime:      │ POST /api/ask  (Pages Func)   │
                 │   ├─ Turnstile + KV quota     │
                 │   ├─ embed query (Gemini)     │
                 │   ├─ cosine top-k retrieval   │
                 │   └─ Groq Llama stream → SSE  │
                 └──────────────┬────────────────┘
                                ▼
                       Browser / ChatUi.astro    ◄── parses SSE, renders
                                                    citations + assistant
                                                    text incrementally
```

Two halves, separable:

1. **Build-time corpus generation** — Node script reads markdown + JSON
   sources, chunks the text, computes embeddings via **Google Gemini**,
   writes a single JSON blob into `/public`.
2. **Runtime serving** — Cloudflare Pages Function receives the user's
   message, embeds the query through the same Gemini model used at build
   time, does cosine-similarity retrieval, sends top-k passages to a
   **Groq-hosted Llama** model as grounded context, and streams the
   response back as SSE.

Two providers, one SDK (Vercel AI SDK):
- **Groq** for chat completion (`llama-3.3-70b-versatile`) — fast inference,
  generous free tier.
- **Google Gemini** for embeddings (`gemini-embedding-001`) — Groq doesn't
  offer embeddings.

Two env vars: `GROQ_API_KEY` (always required) and
`GOOGLE_GENERATIVE_AI_API_KEY` (required when using vector retrieval).

---

## File map

| Path | Role |
|------|------|
| `src/data/cv.md` | Prose CV — hand-authored. Ground truth about Jubayer for the chat. |
| `src/content/posts/*.md` | Writings; their bodies + frontmatter feed the corpus. |
| `src/content/projects/*.md` | Project case studies; same. `draft: true` files are skipped. |
| `src/data/jobs.json` | Structured job history; turned into one chunk per role. |
| `scripts/build-embeddings.ts` | Build script (run via `pnpm prebuild`). Produces `embeddings.json`. |
| `public/embeddings.json` | Generated artifact. **Gitignored.** Shipped as a static asset by Astro's build. |
| `functions/api/ask.ts` | Cloudflare Pages Function. Handles `POST /api/ask` and `GET /api/ask`. |
| `src/components/ChatUi.astro` | Client UI — input, message stream, citation rendering. |
| `src/pages/ask.astro` | Page hosting the chat. `noindex`, excluded from sitemap. |

The split between Astro (static) and Pages Functions (dynamic) is the key
architectural choice: the rest of the site stays a fast static export,
while only `/api/ask` is server-side.

---

## Build pipeline (`scripts/build-embeddings.ts`)

Triggered automatically on every `pnpm build` via the npm `prebuild` hook.

### What it does

1. **Loads sources**
   - `src/content/posts/**/*.md` (titles + bodies)
   - `src/content/projects/**/*.md` (skipping any with `draft: true`)
   - `src/data/cv.md` (whole file, treated as one document)
   - `src/data/jobs.json` (each job → one chunk: role, company, period,
     description, technologies)

2. **Chunks** each source into ~1800-character windows with 300-char
   overlap (`CHUNK_CHARS` / `CHUNK_OVERLAP` constants). Whitespace is
   collapsed before chunking.

3. **Hashes** each chunk's text (SHA-256, 16-char prefix) so re-runs can
   reuse cached embeddings for unchanged content. The hash is stored
   alongside the embedding in the manifest.

4. **Embeds** each chunk through Google's `gemini-embedding-001` model
   via the Vercel AI SDK (`embedMany()` from `ai`, `google.textEmbeddingModel(...)`
   from `@ai-sdk/google`), batched 25 at a time. The same model is used
   at runtime — using different models on the two sides would produce
   vectors in different spaces and ruin retrieval.

5. **Writes** `public/embeddings.json` as a single manifest:
   ```ts
   {
     vectorMode: "gemini-embedding-001" | "none",
     builtAt: ISO8601 string,
     chunkCount: number,
     chunks: [{
       id, source, title, url, text, hash, embedding: number[] | null
     }, ...]
   }
   ```

### The "none" fallback

If `GOOGLE_GENERATIVE_AI_API_KEY` isn't set in the build environment,
the script still runs — it produces `embeddings.json` with
`vectorMode: "none"` and `embedding: null` on every chunk. Retrieval at
runtime then falls back to a keyword-scoring algorithm that doesn't need
vectors.

This means: **the feature works locally without any API key**, just at
slightly worse retrieval quality. You can iterate on prompts and UI
before adding the key.

### The hash cache

Re-running the script reads the previous `public/embeddings.json` and
reuses any embedding whose chunk hash hasn't changed. So edits to a
single post only re-embed that post's chunks — the other ~30 chunks come
out of the cache. CI builds on Cloudflare Pages benefit from this too,
because Pages caches the previous build's output.

The cache is **invalidated automatically** when the previous manifest's
`vectorMode` doesn't match the current `EMBED_MODEL`. That happens when
you switch embedding models — old vectors live in a different space and
would produce nonsense similarity scores.

---

## Why a JSON file (and when to outgrow it)

The `public/embeddings.json` file is a flat array of
`{ id, text, vector, ... }` records. Retrieval scans every record per
query (O(N) cosine).

### Why this works for this site

- **~35 chunks today.** Linear scan over 35 × 768-dim vectors
  completes in well under 1 ms. There's no index to consult, no remote
  database round-trip — the function reads the JSON once on cold start
  and answers every subsequent query from memory.
- **One file → one HTTP fetch → one JSON.parse.** No infra to
  provision, no auth handshake, no extra service to monitor.
- **Built once at deploy, no write path.** Static asset, served from
  Cloudflare's CDN.
- **The whole "retrieval system" fits in 200 lines of code.** A
  retrieval bug is a 5-minute fix; you're not debugging a query
  planner.

### What a real vector database brings

| Capability | JSON file | Real vector DB |
|---|---|---|
| Search | O(N) linear scan | O(log N) HNSW / IVF / DiskANN |
| Concurrent writes | rebuild + redeploy | append → queryable in seconds |
| Metadata filtering | application-side `.filter()` | indexed predicates pushed into the search |
| Hybrid search | not supported | vector + BM25 in one query |
| Versioning, soft delete, multi-tenancy | not supported | first-class |
| Observability | none | query logs, slow-query analysis |
| Persistent state | the file IS the state | full DB |

### When to migrate this site

- **Corpus crosses ~1k chunks.** Below that threshold, the JSON beats
  any network-attached vector DB on p50 latency, because index-lookup
  overhead exceeds linear scan time. Above it, indexed search wins.
- **You add user-generated content** (visitors upload docs that should
  show up in retrieval the same minute). The JSON's read-only design
  breaks down — every change requires a redeploy.
- **You want metadata-filtered retrieval** ("only chunks tagged 2026"
  / "only project case studies"). Doable in JS today, but inefficient
  and ad-hoc.

### Migration path (not in scope today)

Drop-in candidates that work from a Cloudflare Worker:

- **Cloudflare Vectorize** — same provider as the host. KV-style API,
  free 50k vectors / 30M dim-bytes. Lowest-friction option.
- **Turso libSQL + sqlite-vec** — embed vectors in a SQL row, regular
  Turso replication.
- **Upstash Vector** — REST, generous free tier, decent UI.
- **pgvector on a small Postgres** — overkill but the most flexible if
  the site grows.

Only the `retrieve()` function in `functions/api/ask.ts` and the write
side of `scripts/build-embeddings.ts` change. The SSE protocol, system
prompt, and frontend stay identical — provider-agnostic by design.

---

## Runtime: `functions/api/ask.ts`

A Cloudflare Pages Function. Cloudflare automatically routes
`functions/api/ask.ts` to `/api/ask`. It exports two handlers:

- `onRequestGet` — health check. Returns `{ ok, vectorMode, chunks }` so
  you can verify deployment by hitting `GET /api/ask`.
- `onRequestPost` — the chat endpoint. Body: `{ messages: [...] }`.

### POST flow

```
1. Check GROQ_API_KEY is set                         → 503 if not
2. Parse + validate body                             → 400 if invalid
3. Trim history to last MAX_TURNS (10) messages
4. (optional) Verify Turnstile header                → 401 if invalid
5. (optional) Check + increment per-IP daily quota   → 429 if exceeded
6. Load embeddings.json (in-process cached)          → 500 if missing
7. Construct groq + (optional) google providers from env
8. Retrieve top-K chunks (vector or keyword)
9. Build system prompt: SYSTEM_PROMPT + CONTEXT
10. Open SSE stream, send `event: citations`
11. Call streamText({ model: groq(CHAT_MODEL), ... })
12. For each chunk in result.textStream, send `event: delta`
13. Send `event: done`, close stream
```

### Retrieval (`retrieve()`)

- **Vector mode** (when `manifest.vectorMode === "gemini-embedding-001"`
  *and* `GOOGLE_GENERATIVE_AI_API_KEY` is set): embed the query through
  Gemini Embedding via Vercel AI SDK's `embed()`, compute cosine
  similarity against every chunk's embedding, take the top 5 above
  similarity 0.4. (`TOP_K` and `SIM_THRESHOLD` constants.)
- **Keyword fallback** (whenever vector retrieval can't run or returns
  nothing): split the query into 3+ char tokens, count word-boundary
  matches in each chunk's text, normalize by `√(text_length / 200)` so
  longer chunks aren't unfairly favored, take top 5.

The keyword path is intentionally simple — it covers the
"no Gemini key configured" case (so you can run the chat with just a
Groq key) and any transient embedding failure in production.

### Provider construction

Pages Functions don't expose `process.env` (env vars come in via the
`env` parameter), so providers are instantiated **per request** from the
runtime-injected keys:

```ts
const groq = createGroq({ apiKey: env.GROQ_API_KEY });
const google = env.GOOGLE_GENERATIVE_AI_API_KEY
  ? createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })
  : null;
```

Chat goes through `streamText({ model: groq(CHAT_MODEL), ... })`. Query
embedding (when available) goes through `embed({ model: google.textEmbeddingModel(...), ... })`.
The SDK handles auth, retries, and streaming uniformly across providers.

### SSE wire format

The response is `text/event-stream`. Three event types:

```
event: citations
data: [{"n":1,"title":"...","url":"...","source":"post"}, ...]

event: delta
data: {"text":"He's currently leading a phased "}

event: delta
data: {"text":"monolith → microservices migration"}

...

event: done
data: {}
```

If an error occurs mid-stream, an `event: error` with
`data: {"message":"..."}` is emitted before close. The frontend renders
that as an inline error in the assistant bubble.

The wire format is intentionally simple so swapping providers (or
wrapping the SDK with a custom layer) doesn't disturb the frontend.

### Bindings table

| Binding | Required? | Purpose |
|---------|-----------|---------|
| `GROQ_API_KEY` | yes | Groq API auth. Drives chat completions. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | recommended | Gemini API auth. Drives build-time embedding + runtime query embedding. Optional if you're running keyword-only retrieval. |
| `TURNSTILE_SECRET_KEY` | optional | Bot gate. When unset, gate is bypassed. |
| `ASK_QUOTA` | optional | KV namespace for per-IP daily cap (30/day default). |

The optional bindings short-circuit cleanly: if `TURNSTILE_SECRET_KEY` is
unset, every request passes the gate. If `ASK_QUOTA` is unbound, the
quota check is a no-op. If `GOOGLE_GENERATIVE_AI_API_KEY` is unset, the
function falls into keyword-only retrieval. The minimum to deploy is
`GROQ_API_KEY`; you add the rest as you need them.

---

## Frontend: `ChatUi.astro`

Vanilla TS island. No React/framework. Behavior:

- Three suggested seeds shown initially. Clicking one fires the query.
- On submit, push the user message + an empty assistant placeholder,
  then fetch `/api/ask` with the full history (filtered to non-error
  messages, dropping the placeholder).
- Read the response body as a stream, decode, split on `\n\n` to find
  SSE event boundaries, parse each event:
  - `citations` → store on the assistant message; renders as numbered
    source links beneath the answer.
  - `delta` → append `text` to the assistant message body, re-render.
  - `error` → set the assistant message's `error` field.
- Citations like `[1]`, `[2,3]` in the assistant text get linkified
  inline to the corresponding source URL via a regex pass on the
  rendered string.
- Input is disabled while a request is in flight and re-enabled when
  the stream closes.

The disclaimer at the bottom credits Gemini and notes answers can be
wrong.

---

## Local testing

The site is normally served by `astro dev`, but `astro dev` does **not**
run Cloudflare Pages Functions. To test the chat locally end-to-end you
need Wrangler's Pages dev runtime.

Two npm scripts wrap it:

- `pnpm fn` — start Wrangler against the existing `dist/`. Use this
  when you've already built and just want to bring the function up.
- `pnpm dev:fn` — runs `pnpm build` (which fires `prebuild` →
  `embeddings.json`) and then starts Wrangler. Use this for a clean
  one-command "build + serve."

Default port: `8788`.

There are three modes you can pick from depending on what you're testing.

### Mode A: UI only (no backend)

You're tweaking the chat layout, the seed prompts, citation rendering,
or anything visual.

```bash
pnpm dev
```

Open `http://localhost:4321/ask`. The UI loads, but `POST /api/ask`
returns a 404 (Astro dev server doesn't know about
`functions/api/ask.ts`). The chat shows a "Request failed" error in the
assistant bubble — perfect for verifying the error UI.

No env vars required.

### Mode B: Function locally, keyword retrieval (Groq only)

You want to test the full flow: request → retrieval → Groq stream →
citations → UI rendering. You only have a Groq key, not a Gemini key.

1. **Get a Groq API key** from https://console.groq.com/keys. Free.

2. **Add it to `.dev.vars`** (root of repo, gitignored by Wrangler
   convention) so the runtime function picks it up:

   ```
   GROQ_API_KEY=gsk_...
   ```

3. **Build with no Gemini key** so the manifest is keyword-only:

   ```bash
   pnpm dev:fn
   ```

   `pnpm prebuild` warns that vectors aren't being generated — that's
   intentional. `public/embeddings.json` is written with `null`
   embeddings, then Wrangler starts.

4. Open `http://localhost:8788/ask`. Ask a question — retrieval falls
   into keyword scoring, the chat answers via Groq. Quality is rougher
   than vector retrieval (single misspellings hurt), but the full
   plumbing works.

5. (optional) Hit `GET /api/ask` to confirm the manifest loaded:

   ```bash
   curl http://localhost:8788/api/ask
   # → {"ok":true,"vectorMode":"none","chunks":34}
   ```

### Mode C: Full vectors (production parity)

You want exactly what production runs — vector embeddings via Gemini +
chat via Groq.

1. **Get both keys**:
   - Groq: https://console.groq.com/keys
   - Gemini: https://aistudio.google.com/apikey

2. **Add both to `.dev.vars`**:

   ```
   GROQ_API_KEY=gsk_...
   GOOGLE_GENERATIVE_AI_API_KEY=AIzaSy...
   ```

   Both the build script and the runtime function read this file —
   the build script does so via a small loader at the top of
   `scripts/build-embeddings.ts` (priority: existing `process.env` →
   `.dev.vars` → `.env.local` → `.env`), so you don't need to `export`
   anything.

3. **Run the build + dev server**:

   ```bash
   pnpm dev:fn
   ```

   Watch for `[embeddings] N chunks total · M reused · K to embed`
   in the output. The first build embeds everything; subsequent builds
   reuse the hash cache.

4. Open `http://localhost:8788/ask`. Ask a question — retrieval is now
   vector-based. Try semantically related queries that don't share
   keywords, like "tell me about his focus app" (matches Focrel via
   embedding even though "focus app" isn't an exact substring).

5. Sanity check:

   ```bash
   curl http://localhost:8788/api/ask
   # → {"ok":true,"vectorMode":"gemini-embedding-001","chunks":34}
   ```

If you've already built and just want to restart Wrangler without
re-embedding, use `pnpm fn`.

### Optional: Turnstile + quota

If you want to test the abuse protections too:

- Create a Turnstile site key/secret pair on the Cloudflare dashboard.
  Add to `.dev.vars`:
  ```
  TURNSTILE_SECRET_KEY=0x4AAAAAAA...
  ```
  Without a corresponding Turnstile widget in the UI sending a
  `cf-turnstile-response` header, every request will 401. The current
  `ChatUi.astro` doesn't ship a widget — that's a TODO for production.

- For KV quota, create a namespace with Wrangler:
  ```bash
  pnpm wrangler kv:namespace create ASK_QUOTA
  ```
  Bind it via the `--kv` flag (extending the `fn` script or running
  directly):
  ```bash
  pnpm wrangler pages dev dist --kv ASK_QUOTA
  ```
  Send 31 messages from the same IP within 24 hours and the 31st returns
  a 429.

---

## Production deploy

Set in Cloudflare Pages dashboard → Settings → Environment variables:

- **Build environment**: `GOOGLE_GENERATIVE_AI_API_KEY` so the prebuild
  script can call Gemini Embedding. (Skip this if you want a
  keyword-only deploy.)
- **Production runtime**:
  - `GROQ_API_KEY` — required. Drives chat completions.
  - `GOOGLE_GENERATIVE_AI_API_KEY` — recommended. Drives runtime query
    embedding for semantic retrieval. Without it, retrieval falls back
    to keywords.
  - Optional: `TURNSTILE_SECRET_KEY` (and add a Turnstile widget to
    `ChatUi.astro` so requests include a token).
  - Optional: `ASK_QUOTA` KV binding (Settings → Functions → KV
    namespace bindings).

Build command stays as `pnpm build` (or whatever you have configured).
Output directory: `dist`. Pages auto-detects `functions/` and deploys
those alongside the static assets.

---

## Tuning

All runtime knobs live at the top of `functions/api/ask.ts`:

| Constant | Default | What it controls |
|----------|---------|------------------|
| `CHAT_MODEL` | `llama-3.3-70b-versatile` | Groq-hosted chat model. 1K RPD on the free tier. |
| `EMBED_MODEL` | `gemini-embedding-001` | Gemini embedding model — must match the build script. |
| `MAX_TURNS` | 10 | History trimmed to last N messages. |
| `TOP_K` | 5 | Number of retrieved chunks given to the chat model. |
| `SIM_THRESHOLD` | 0.4 | Min cosine similarity to be considered relevant. |
| `QUOTA_PER_DAY` | 30 | Per-IP message cap when KV quota is bound. |

Build-time chunking knobs in `scripts/build-embeddings.ts`:

| Constant | Default | What it controls |
|----------|---------|------------------|
| `CHUNK_CHARS` | 1800 | Max chunk length in characters. |
| `CHUNK_OVERLAP` | 300 | Overlap between adjacent chunks. |
| `EMBED_MODEL` | `gemini-embedding-001` | Embedding model — must match the runtime model in `functions/api/ask.ts`. |
| `EMBED_BATCH` | 25 | Batch size sent to Gemini per request. |

If you change the embedding model on either side, you **must** rebuild
embeddings — vectors from different models live in different spaces and
will produce nonsense retrieval results. The build script auto-invalidates
the hash cache when it detects the model changed.

To swap chat models (say, from `llama-3.3-70b-versatile` to
`llama-3.1-8b-instant` for faster/cheaper responses, or to a different
provider entirely): change `CHAT_MODEL` in `functions/api/ask.ts` and,
if you're switching providers, swap the `streamText` model argument.
The Vercel AI SDK accepts any model ID as a string.

---

## Troubleshooting

**`/api/ask` returns 503 "GROQ_API_KEY not configured"**
Set it in `.dev.vars` (local) or in the Pages dashboard (prod).

**Retrieval falls back to keywords even though I set the Gemini key**
Check `GET /api/ask` — if `vectorMode` is `"none"`, the build itself
ran without the Gemini key. The build script reads `.dev.vars`
(then `.env.local`, then `.env`), so put the key in one of those and
re-run `pnpm build` (or `pnpm dev:fn`). If `vectorMode` is
`"gemini-embedding-001"` but retrieval still bails to keywords, the
Function couldn't reach Gemini at runtime — check your `.dev.vars`
has the same key and Wrangler picked it up (`pnpm fn` will print the
loaded vars on startup).

**`/api/ask` returns 500 "embeddings.json missing"**
Run `pnpm embed` (or `pnpm build`, or `pnpm dev:fn`) to generate it.
Check `public/embeddings.json` exists.

**Retrieval returns nothing useful**
Hit `GET /api/ask` to see `vectorMode`. If it's `"none"`, your build
didn't have a Gemini key — keyword retrieval is fuzzy. If it's
`"gemini-embedding-001"` but quality is still poor, lower
`SIM_THRESHOLD` from 0.4 toward 0.3.

**Stream cuts off mid-answer**
Cloudflare Pages Functions have a 30-second CPU limit on the free tier.
Drop `maxOutputTokens` (currently 600) or swap `CHAT_MODEL` to
`llama-3.1-8b-instant` for faster generation.

**Hit the daily Groq quota (429 from Groq)**
Free tier on `llama-3.3-70b-versatile` is 1K RPD; `llama-3.1-8b-instant`
is 14.4K RPD. If you're testing heavily, swap to the 8b model. The
user-facing error surfaces as an `event: error` in the SSE stream.

**Embedding cost**
The hash cache means only changed chunks re-embed. A single edit to one
post triggers ~3 embedding calls, not the full corpus. Free tier on
`gemini-embedding-001` is 1k requests/day — generous enough that you'll
hit it only with large churn.
