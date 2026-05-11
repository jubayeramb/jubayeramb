/**
 * Build-time RAG corpus generator.
 *
 * Reads posts, projects, the prose CV, and the structured jobs file, chunks
 * them, and (when a Gemini API key is available) embeds each chunk via the
 * Vercel AI SDK against Google's `gemini-embedding-001` model. Output lands
 * at `public/embeddings.json` and is consumed by `functions/api/ask.ts`.
 *
 * Required env var for vector mode:
 *   GOOGLE_GENERATIVE_AI_API_KEY  (https://aistudio.google.com/apikey)
 *
 * Without it, the script still emits chunks but marks vectorMode = "none"
 * so the Function falls back to keyword scoring.
 */
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { embedMany } from "ai";
import { google } from "@ai-sdk/google";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Load env from local files (same format as .env: KEY=VALUE per line).
// Priority: existing process.env wins; then .dev.vars (Wrangler convention,
// shared with the Pages Function runtime); then .env.local; then .env.
// This means `pnpm build` picks up keys you put in `.dev.vars` automatically,
// no shell `export` needed.
function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip wrapping quotes on either side.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(join(ROOT, ".dev.vars"));
loadEnvFile(join(ROOT, ".env.local"));
loadEnvFile(join(ROOT, ".env"));
const POSTS_DIR = join(ROOT, "src/content/posts");
const PROJECTS_DIR = join(ROOT, "src/content/projects");
const CV_PATH = join(ROOT, "src/data/cv.md");
const JOBS_PATH = join(ROOT, "src/data/jobs.json");
const OUT_DIR = join(ROOT, "public");
const OUT_PATH = join(OUT_DIR, "embeddings.json");
// Mirror the manifest into node_modules/.cache so it survives Cloudflare
// Pages builds — CF restores `node_modules` between runs based on the
// lockfile, while `public/` is wiped. Without this, every CI build pays
// the full embedding cost (0 reused).
const CACHE_DIR = join(ROOT, "node_modules/.cache");
const CACHE_PATH = join(CACHE_DIR, "embeddings.json");

type ChunkSource = "post" | "project" | "cv" | "jobs";

type Chunk = {
  id: string;
  source: ChunkSource;
  title: string;
  url: string;
  text: string;
  hash: string;
  embedding: number[] | null;
};

type VectorMode = "gemini-embedding-001" | "none";

type Manifest = {
  vectorMode: VectorMode;
  builtAt: string;
  chunkCount: number;
  chunks: Chunk[];
};

const CHUNK_CHARS = 1800;
const CHUNK_OVERLAP = 300;
const EMBED_MODEL: VectorMode = "gemini-embedding-001";
// Gemini Embedding's free tier accepts batches; keep groups small to avoid
// hitting per-request token limits on long chunks.
const EMBED_BATCH = 25;

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= CHUNK_CHARS) return [clean];
  const out: string[] = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(clean.length, i + CHUNK_CHARS);
    out.push(clean.slice(i, end));
    if (end === clean.length) break;
    i = end - CHUNK_OVERLAP;
  }
  return out;
}

async function loadMarkdownDir(
  dir: string,
  source: ChunkSource,
  toUrl: (id: string) => string
): Promise<Chunk[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const out: Chunk[] = [];
  for (const file of entries) {
    if (!file.endsWith(".md")) continue;
    const id = basename(file, extname(file));
    const raw = await readFile(join(dir, file), "utf8");
    const { data, content } = matter(raw);
    if (data?.draft) continue;
    const title = (data?.title as string) ?? id;
    const url = toUrl(id);
    const pieces = chunkText(`${title}\n\n${content}`);
    pieces.forEach((piece, idx) => {
      out.push({
        id: `${source}:${id}:${idx}`,
        source,
        title,
        url,
        text: piece,
        hash: sha(piece),
        embedding: null,
      });
    });
  }
  return out;
}

async function loadCv(): Promise<Chunk[]> {
  if (!existsSync(CV_PATH)) return [];
  const raw = await readFile(CV_PATH, "utf8");
  const { content } = matter(raw);
  const pieces = chunkText(content);
  return pieces.map((piece, idx) => ({
    id: `cv:main:${idx}`,
    source: "cv",
    title: "CV",
    url: "/about",
    text: piece,
    hash: sha(piece),
    embedding: null,
  }));
}

async function loadJobs(): Promise<Chunk[]> {
  if (!existsSync(JOBS_PATH)) return [];
  const raw = await readFile(JOBS_PATH, "utf8");
  const data = JSON.parse(raw) as Record<string, any>;
  return Object.values(data).map((job, idx) => {
    const text = [
      `${job.designation} at ${job.company} (${job.startDate} — ${job.endDate || "Present"})`,
      job.description,
      `Stack: ${(job.technologies || []).join(", ")}`,
    ].join("\n");
    return {
      id: `jobs:${job.company.toLowerCase().replace(/\W+/g, "-")}:${idx}`,
      source: "jobs" as const,
      title: `${job.designation} — ${job.company}`,
      url: "/about",
      text,
      hash: sha(text),
      embedding: null,
    };
  });
}

async function loadCachedEmbeddings(): Promise<Map<string, number[]>> {
  const cache = new Map<string, number[]>();
  // Prefer the node_modules cache (survives Cloudflare builds), fall back
  // to the shipped output (useful locally on first run after a clean).
  const sources = [CACHE_PATH, OUT_PATH];
  for (const path of sources) {
    if (!existsSync(path)) continue;
    try {
      const prev = JSON.parse(await readFile(path, "utf8")) as Manifest;
      // Vectors only line up across builds when the embedding model matches.
      // If the previous build used a different model (or "none"), throw the
      // cache away — those vectors live in a different space.
      if (prev.vectorMode !== EMBED_MODEL) {
        console.log(
          `[embeddings] cached manifest at ${path} used ${prev.vectorMode}; current is ${EMBED_MODEL} — skipping.`
        );
        continue;
      }
      for (const c of prev.chunks ?? []) {
        if (c.embedding && c.hash) cache.set(c.hash, c.embedding);
      }
      if (cache.size > 0) break;
    } catch {
      // ignore — regenerating from scratch is safe
    }
  }
  return cache;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({
    model: google.textEmbeddingModel(EMBED_MODEL),
    values: texts,
  });
  return embeddings;
}

async function main() {
  const haveGoogleKey = Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
  );

  const [posts, projects, cv, jobs] = await Promise.all([
    loadMarkdownDir(POSTS_DIR, "post", (id) => `/writings/${id}`),
    loadMarkdownDir(PROJECTS_DIR, "project", (id) => `/projects/${id}`),
    loadCv(),
    loadJobs(),
  ]);
  const chunks: Chunk[] = [...posts, ...projects, ...cv, ...jobs];

  if (!haveGoogleKey) {
    console.warn(
      "[embeddings] GOOGLE_GENERATIVE_AI_API_KEY missing — writing chunks without vectors. /api/ask will fall back to keyword scoring."
    );
    await writeManifest({
      vectorMode: "none",
      builtAt: new Date().toISOString(),
      chunkCount: chunks.length,
      chunks,
    });
    return;
  }

  const cache = await loadCachedEmbeddings();
  const need: Chunk[] = [];
  for (const c of chunks) {
    const cached = cache.get(c.hash);
    if (cached) c.embedding = cached;
    else need.push(c);
  }

  console.log(
    `[embeddings] ${chunks.length} chunks total · ${cache.size} reused · ${need.length} to embed`
  );

  for (let i = 0; i < need.length; i += EMBED_BATCH) {
    const batch = need.slice(i, i + EMBED_BATCH);
    const vectors = await embedBatch(batch.map((c) => c.text));
    if (vectors.length !== batch.length) {
      throw new Error(
        `Embedding count mismatch: requested ${batch.length}, got ${vectors.length}`
      );
    }
    batch.forEach((c, j) => {
      c.embedding = vectors[j];
    });
  }

  await writeManifest({
    vectorMode: EMBED_MODEL,
    builtAt: new Date().toISOString(),
    chunkCount: chunks.length,
    chunks,
  });
}

async function writeManifest(m: Manifest) {
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });
  const payload = JSON.stringify(m);
  await writeFile(OUT_PATH, payload, "utf8");
  // Also write to the persistent cache so subsequent CI runs reuse vectors.
  if (!existsSync(CACHE_DIR)) await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_PATH, payload, "utf8");
  console.log(
    `[embeddings] wrote ${OUT_PATH} · mode=${m.vectorMode} · chunks=${m.chunkCount}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
