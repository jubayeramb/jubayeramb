// Singleton chat store. Holds the conversation in module scope so every
// chat surface (home floating input, overlay, /ask page) reads and writes
// the same state. Persists to localStorage and syncs across tabs.

export type Role = "user" | "assistant";
export type Citation = {
  n: number;
  title: string;
  url: string;
  source: string;
};
export type Msg = {
  id: string;
  role: Role;
  content: string;
  citations?: Citation[];
  error?: string;
  streaming?: boolean;
  /** How the message was authored — text input or voice (Live API). */
  via?: "text" | "voice";
  /** Transient: assistant audio is currently playing. Not persisted. */
  speaking?: boolean;
};

const STORAGE_KEY = "ask-chat-v1";
const MAX_STORED = 40;
const MAX_TURNS = 10;
const STRIP_CITES = /\[\d+(?:\s*,\s*\d+)*\]/g;

let messages: Msg[] = [];
let abortCtrl: AbortController | null = null;
const listeners = new Set<() => void>();
let hydrated = false;

const isBrowser = typeof window !== "undefined";

function uid(): string {
  if (isBrowser && typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function load(): Msg[] {
  if (!isBrowser) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is Msg =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
      )
      .map((m) => ({
        ...m,
        id: m.id ?? uid(),
        // Strip any citation markers that slipped through earlier versions
        // — defensive cleanup so stale localStorage doesn't show [1] [2].
        content:
          m.role === "assistant"
            ? m.content.replace(STRIP_CITES, "")
            : m.content,
        streaming: false,
        // `speaking` is transient (audio currently playing); never restore
        // it from storage.
        speaking: false,
      }));
  } catch {
    return [];
  }
}

function persist() {
  if (!isBrowser) return;
  try {
    const cleaned = messages.filter(
      (m) => m.role === "user" || m.content || m.error
    );
    const trimmed = cleaned.slice(-MAX_STORED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage may be unavailable (private mode, quota) — chat still
    // works in-memory; this turn just won't survive a refresh.
  }
}

function ensureHydrated() {
  if (hydrated || !isBrowser) return;
  hydrated = true;
  messages = load();
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    messages = load();
    listeners.forEach((l) => l());
  });
}

function emit() {
  persist();
  listeners.forEach((l) => l());
}

export function getMessages(): readonly Msg[] {
  ensureHydrated();
  return messages;
}

export function isStreaming(): boolean {
  return messages.some((m) => m.streaming);
}

export function subscribe(fn: () => void): () => void {
  ensureHydrated();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function abort() {
  abortCtrl?.abort();
  abortCtrl = null;
  // Mark any streaming message as completed; preserve partial content.
  let changed = false;
  messages = messages.map((m) => {
    if (m.streaming) {
      changed = true;
      return { ...m, streaming: false };
    }
    return m;
  });
  if (changed) emit();
}

export function clear() {
  abort();
  messages = [];
  emit();
}

function patch(id: string, partial: Partial<Msg>) {
  const idx = messages.findIndex((m) => m.id === id);
  if (idx === -1) return;
  messages = [
    ...messages.slice(0, idx),
    { ...messages[idx], ...partial },
    ...messages.slice(idx + 1),
  ];
  emit();
}

export async function send(text: string): Promise<void> {
  ensureHydrated();
  const trimmed = text.trim();
  if (!trimmed || isStreaming()) return;

  const userMsg: Msg = { id: uid(), role: "user", content: trimmed };
  const aiMsg: Msg = {
    id: uid(),
    role: "assistant",
    content: "",
    streaming: true,
  };
  messages = [...messages, userMsg, aiMsg];
  emit();

  abortCtrl = new AbortController();
  const signal = abortCtrl.signal;

  try {
    const wireMessages = messages
      .filter((m) => !m.error && (m.role === "user" || m.content))
      .filter((m) => m.id !== aiMsg.id) // drop the empty placeholder
      .slice(-MAX_TURNS)
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: wireMessages }),
      signal,
    });

    if (!res.ok) {
      const err = await res
        .json()
        .catch(() => ({ error: `Request failed (${res.status})` }));
      patch(aiMsg.id, {
        error: (err as { error?: string }).error ?? `Server returned ${res.status}.`,
        streaming: false,
      });
      return;
    }

    if (!res.body) {
      patch(aiMsg.id, { error: "No response stream.", streaming: false });
      return;
    }

    await pumpSSE(res.body, aiMsg.id, signal);
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      patch(aiMsg.id, { streaming: false });
      return;
    }
    patch(aiMsg.id, { error: (err as Error).message, streaming: false });
  } finally {
    if (abortCtrl?.signal === signal) abortCtrl = null;
  }
}

async function pumpSSE(
  body: ReadableStream<Uint8Array>,
  targetId: string,
  signal: AbortSignal
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let citations: Citation[] | undefined;

  while (true) {
    if (signal.aborted) {
      reader.cancel().catch(() => {});
      return;
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const lines = block.split("\n");
      const eventLine = lines.find((l) => l.startsWith("event:"));
      const dataLine = lines.find((l) => l.startsWith("data:"));
      if (!eventLine || !dataLine) continue;

      const event = eventLine.slice(6).trim();
      let data: any = {};
      try {
        data = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue;
      }

      if (event === "citations") {
        citations = data as Citation[];
        patch(targetId, { citations });
      } else if (event === "delta") {
        const cleaned = String(data.text ?? "").replace(STRIP_CITES, "");
        text += cleaned;
        patch(targetId, { content: text, citations, streaming: true });
      } else if (event === "done") {
        patch(targetId, { streaming: false });
      } else if (event === "error") {
        patch(targetId, {
          error: data.message ?? "Stream error.",
          streaming: false,
        });
      }
    }
  }

  // Stream ended without an explicit `done` event.
  patch(targetId, { streaming: false });
}

// ────────────────────────────────────────────────────────────────────────
// Voice (Gemini Live) helpers
//
// Live sessions don't go through `/api/ask` SSE — they connect the
// browser straight to Gemini Live via an ephemeral token, and the audio
// path stays out of our server entirely. These helpers let the live
// session manager append transcript turns into the same chat-store the
// text path uses, so the unified timeline persists across both modes.

/** Add a freshly-spoken user turn. Returns the message id for follow-up patches. */
export function appendUserVoice(text: string): string {
  ensureHydrated();
  const msg: Msg = {
    id: uid(),
    role: "user",
    content: text,
    via: "voice",
  };
  messages = [...messages, msg];
  emit();
  return msg.id;
}

/** Add an assistant voice turn, optionally marked as currently speaking. */
export function appendAssistantVoice(text: string, speaking = false): string {
  ensureHydrated();
  const msg: Msg = {
    id: uid(),
    role: "assistant",
    content: text,
    via: "voice",
    speaking,
  };
  messages = [...messages, msg];
  emit();
  return msg.id;
}

/**
 * Live API streams transcripts in `partial` chunks before finalizing.
 * Patch the target message with the latest text. `final = true` clears
 * any "this is partial" indicator.
 */
export function patchVoiceTranscript(id: string, text: string, _final = false) {
  patch(id, { content: text });
}

/**
 * Toggle the playing-now indicator on an assistant voice message. Not
 * persisted — `emit()` will write current state to localStorage but
 * `speaking` resets to false on hydrate (see `load()`).
 */
export function setSpeaking(id: string, speaking: boolean) {
  patch(id, { speaking });
}

/** True iff a voice session has an in-flight assistant turn. */
export function isLiveSpeaking(): boolean {
  return messages.some((m) => m.speaking);
}
