/// <reference types="@cloudflare/workers-types" />
/**
 * /api/live-token — mints a short-lived Gemini Live ephemeral token.
 *
 * The browser uses the returned token to open a WebSocket directly to
 * Google. Our server stays out of the audio path entirely, so this
 * function fires once per session — not per audio frame — keeping the
 * Pages Function quota near-untouched even for active users.
 *
 * The token is locked to:
 *   - the Live model we want
 *   - response modality (audio out)
 *   - input + output transcription on
 *   - a system instruction grounding the assistant in Jubayer's CV
 *
 * Bindings (set in Cloudflare Pages dashboard):
 *   GOOGLE_GENERATIVE_AI_API_KEY  — required. Master key used to mint the
 *                                   ephemeral token.
 *   ASK_QUOTA                     — optional KV namespace. When bound,
 *                                   applies a per-IP daily session cap
 *                                   (separate `live:` prefix from the
 *                                   text-chat 30/day cap).
 */
import { GoogleGenAI, Modality } from "@google/genai";

interface Env {
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  ASK_QUOTA?: KVNamespace;
}

// Model ID, not the friendly display name. The dashboard shows
// "Gemini 2.5 Flash Native Audio Dialog" but the actual API id is the
// preview-tagged identifier below — the @google/genai SDK lists it in
// its known-Model_2 type. The previous string ("…audio-dialog") was
// the *display name*, not the API id, and the server rejected it.
const MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";
const SESSION_EXPIRES_IN_SECONDS = 60 * 30; // server-side max session length
const NEW_SESSION_WINDOW_SECONDS = 60 * 2; // browser must connect within 2 min
const SESSIONS_PER_DAY = 8;

const SYSTEM_INSTRUCTION = `You're a chat companion on jubayeramb.com, helping a visitor learn about Jubayer Al Mamun.

How to sound natural:
- Conversational and direct — no marketing fluff.
- Refer to him as "Jubayer" or "he", never "the candidate" or "I".
- Match the energy of the question. Brief asks get short answers.
- Vary your phrasing turn to turn.
- NEVER use the words "context", "the information provided", "the sources", "the snippets", or anything that breaks the illusion that you simply know him.
- Don't list bracketed citation numbers like [1]; voice mode has no visible citations.

Grounding — what's known about Jubayer:

Software engineer based in Dhaka, Bangladesh (UTC+6). 4+ years building scalable web and mobile applications. CS graduate from Green University of Bangladesh (Jan 2022 — Jan 2026). Currently Software Engineer at WeCycle (Dec 2023 — Present), where he leads two junior engineers, drove SEO from 0 to ~1.2M impressions / 4.23K clicks in 5 months, shipped a RAG-powered AI chatbot that drove +43% bookings at a 30.2% chat-to-conversion rate, cut response latency ~40% with BullMQ + Redis, and reduced CI/CD time ~30% via GitHub Actions optimization. Stack at WeCycle: React, Next.js, Express, MongoDB, Redis, BullMQ, Stripe, Twilio.

Past roles: Full Stack Developer (contract) at Finding Healers (Dec 2022 — Dec 2023), Software Developer at HomePay (Feb 2022 — Mar 2023, .NET Core + MSSQL payment APIs, +20% platform adoption onboarding DeshiPay and ShopUp).

Personal products: Triplone (2025 — present, AI travel platform, pre.triplone.com), Focrel (2026, local-first macOS focus app, focrel.jubayeramb.com), Syncroll (2026, Chrome split-view scroll-sync extension, syncroll.jubayeramb.com).

Hackathons: Verdicto — 1st Runner-Up at WebXtream (320 teams), crime-focused social platform with AI captioning + sentiment analysis, built in 12 hours with LLaVA:7B (Ollama) and OpenAI SDK. UniSync — 2nd Runner-Up at MIST NEOFETCH (40+ finalists), university companion app with AR navigation and Mistral on Ollama, 6 hours, 3-person team.

Skills: TypeScript, JavaScript, C#, React, Next.js, React Native, Astro, Node.js, Express, Hono, NestJS, .NET Core Web API, PostgreSQL, MongoDB, Drizzle, Prisma, EF Core, Tailwind, shadcn/ui, Zustand, React Query, Postman, Playwright, Cypress, Vitest, GitHub Actions, Docker, Nginx, Turborepo, Nx, DigitalOcean. AI tools: Claude Code, GitHub Copilot, OpenCode, Ollama, AI SDK, Figma.

Contact: only mention his email (jubayeramb@gmail.com) when the visitor explicitly asks how to reach him. Otherwise keep the conversation about his work.

Off-topic asks (weather, jokes, code review of their own code): nudge back to questions about Jubayer in one light sentence.`;

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...(init?.headers ?? {}),
    },
  });

async function checkQuota(env: Env, request: Request): Promise<boolean> {
  if (!env.ASK_QUOTA) return true; // disabled
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return true;
  const day = new Date().toISOString().slice(0, 10);
  const key = `live:${day}:${ip}`;
  const raw = await env.ASK_QUOTA.get(key);
  const used = raw ? parseInt(raw, 10) : 0;
  if (used >= SESSIONS_PER_DAY) return false;
  await env.ASK_QUOTA.put(key, String(used + 1), {
    expirationTtl: 60 * 60 * 26,
  });
  return true;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return json(
      { error: "GOOGLE_GENERATIVE_AI_API_KEY not configured." },
      { status: 503 },
    );
  }

  if (!(await checkQuota(env, request))) {
    return json(
      {
        error:
          "Daily voice-session limit reached. Try again tomorrow or use the text chat.",
      },
      { status: 429 },
    );
  }

  const client = new GoogleGenAI({
    apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
    apiVersion: "v1alpha", // ephemeral tokens are v1alpha-only
  } as any);

  const expireTime = new Date(Date.now() + SESSION_EXPIRES_IN_SECONDS * 1000);
  const newSessionExpireTime = new Date(
    Date.now() + NEW_SESSION_WINDOW_SECONDS * 1000,
  );

  try {
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime: expireTime.toISOString(),
        newSessionExpireTime: newSessionExpireTime.toISOString(),
        liveConnectConstraints: {
          model: MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            // Male voice — "Puck" is the upbeat, friendly male voice in
            // Gemini Live's prebuilt set. Distinct character from the
            // deeper "Charon" we previously had.
            // Other male options if you want to swap: "Charon" (deep),
            // "Fenrir" (bright), "Orus" (warm/business), "Achird" (calm).
            // Female alternatives: Kore, Aoede, Leda, Zephyr.
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: "Puck" },
              },
            },
            systemInstruction: {
              parts: [{ text: SYSTEM_INSTRUCTION }],
            },
          },
        },
        // Lock the system-instruction-bearing fields. Empty list is fine
        // — anything inside `liveConnectConstraints.config` is already
        // pinned to that exact value when the browser opens the session.
      },
    });

    if (!token.name) {
      return json({ error: "Failed to mint token (no name returned)." }, { status: 500 });
    }

    return json({
      token: token.name,
      expiresAt: expireTime.toISOString(),
      model: MODEL,
    });
  } catch (err) {
    console.error("[live-token] mint failed", err);
    return json(
      { error: (err as Error).message ?? "Token mint failed." },
      { status: 500 },
    );
  }
};
