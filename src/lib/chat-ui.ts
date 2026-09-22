/**
 * Chat transcript and composer, shared by /ask and the home page overlay.
 * Renders chat-store updates incrementally.
 *
 * Imported by ChatUi.astro once the page has loaded.
 */
import {
  getMessages,
  isStreaming,
  subscribe,
  send,
  clear,
  type Msg,
} from "./chat-store";

const wireChat = () => {
  document
    .querySelectorAll<HTMLElement>("section.chat[data-mode]")
    .forEach(wireOne);
};

function wireOne(root: HTMLElement) {
  if ((root as any).__wired) return;
  (root as any).__wired = true;

  const scroll = root.querySelector<HTMLElement>("#chat-scroll");
  const stream = root.querySelector<HTMLOListElement>("#chat-stream");
  const seed = root.querySelector<HTMLElement>("#chat-seed");
  const form = root.querySelector<HTMLFormElement>("#chat-form");
  const input = root.querySelector<HTMLInputElement>("#chat-input");
  const sendBtn = root.querySelector<HTMLButtonElement>("#chat-send");
  const clearBtn = root.querySelector<HTMLButtonElement>("#chat-clear");
  if (!stream || !form || !input || !sendBtn || !scroll) return;

  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // Belt-and-suspenders: ensure no [n] markers ever reach the DOM,
  // even if stale data sneaks past the store's strip.
  const STRIP = /\[\d+(?:\s*,\s*\d+)*\]/g;
  const cleanText = (s: string) => s.replace(STRIP, "");

  // ── Incremental render ──────────────────────────────────────────
  // Rebuilding `stream.innerHTML` on every SSE delta was retriggering
  // the bubble-in animation, replaying the typing indicator, and
  // letting the browser recompute layout for the whole list multiple
  // times per second. The result was the "jumping / dancing" bubbles
  // the user reported. We now mount each bubble once and patch the
  // delta in place: only the streaming bubble's textContent updates,
  // and only newly-arrived bubbles get the entrance animation.

  const createBubble = (m: Msg): HTMLLIElement => {
    const li = document.createElement("li");
    li.dataset.id = m.id;

    const body = document.createElement("div");
    body.className = "bubble-body";
    li.appendChild(body);

    // Voice tag + sources are appended/refreshed in updateBubble.
    updateBubble(li, m, null);
    return li;
  };

  const updateBubble = (
    li: HTMLLIElement,
    m: Msg,
    prev: Msg | null,
  ) => {
    // Top-level class / flag updates.
    const desired = `bubble bubble--${m.role}` +
      (m.streaming ? " bubble--streaming" : "") +
      (m.via === "voice" ? " bubble--voice" : "") +
      (m.speaking ? " bubble--speaking" : "");
    if (li.className !== desired) li.className = desired;

    const body = li.querySelector<HTMLElement>(".bubble-body");
    if (!body) return;

    // Decide which view the body should be in: error / typing / text.
    const showError = !!m.error;
    const showTyping =
      !showError &&
      m.role === "assistant" &&
      (m.streaming || m.speaking) &&
      !m.content;

    if (showError) {
      const errText = `<span class="bubble-error">${escape(m.error!)}</span>`;
      if (body.innerHTML !== errText) body.innerHTML = errText;
    } else if (showTyping) {
      if (!body.querySelector(".bubble-typing")) {
        body.innerHTML =
          '<span class="bubble-typing" aria-label="Thinking"><span></span><span></span><span></span></span>';
      }
    } else {
      const next = cleanText(m.content);
      // textContent diff - only writes when the value really changed,
      // avoiding spurious layout work on identical-value updates.
      if (body.textContent !== next) body.textContent = next;
    }

    // Voice tag - append once, never re-create.
    if (m.via === "voice") {
      if (!li.querySelector(".bubble-via")) {
        const tag = document.createElement("div");
        tag.className = "bubble-via";
        tag.textContent = "🎤 voice";
        li.appendChild(tag);
      }
    } else {
      li.querySelector(".bubble-via")?.remove();
    }

    // Sources - render once when they first arrive, replace only if
    // the citation URLs change (rare; usually they appear in a single
    // event then never mutate).
    const newCites = m.citations ?? [];
    const newKey = newCites.map((c) => c.url).join("|");
    const prevKey = (prev?.citations ?? []).map((c) => c.url).join("|");
    if (newKey !== prevKey) {
      li.querySelector(".bubble-sources")?.remove();
      if (m.role === "assistant" && newCites.length) {
        const sources = document.createElement("div");
        sources.className = "bubble-sources";
        sources.innerHTML =
          `<span class="bubble-sources-label">Sources</span> ` +
          newCites
            .map((c) => `<a href="${escape(c.url)}">${escape(c.title)}</a>`)
            .join('<span class="bubble-sources-sep">·</span>');
        li.appendChild(sources);
      }
    }
  };

  const isAtBottom = () => {
    return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
  };

  // Keep a per-id snapshot of the last-rendered Msg so updateBubble
  // can do precise diffs (especially for citations).
  const rendered = new Map<string, { li: HTMLLIElement; msg: Msg }>();

  const render = () => {
    const messages = getMessages();
    const wasAtBottom = isAtBottom();
    const seenIds = new Set<string>();

    // Pass 1: ensure every current message has a bubble in the DOM
    // in the correct position, and is up to date.
    messages.forEach((m, i) => {
      seenIds.add(m.id);
      const existing = rendered.get(m.id);
      if (existing) {
        updateBubble(existing.li, m, existing.msg);
        existing.msg = m;
        // Position correction (rare - only on reorder or clear+rebuild).
        const at = stream.children[i];
        if (at !== existing.li) stream.insertBefore(existing.li, at ?? null);
      } else {
        const li = createBubble(m);
        rendered.set(m.id, { li, msg: m });
        const at = stream.children[i];
        stream.insertBefore(li, at ?? null);
      }
    });

    // Pass 2: drop any bubbles that no longer exist (e.g. after clear).
    for (const [id, { li }] of rendered) {
      if (!seenIds.has(id)) {
        li.remove();
        rendered.delete(id);
      }
    }

    if (seed) seed.hidden = messages.length > 0;
    if (clearBtn) clearBtn.hidden = messages.length === 0;

    const streaming = isStreaming();
    input.disabled = streaming;
    sendBtn.disabled = streaming;

    if (wasAtBottom) {
      requestAnimationFrame(() => {
        scroll.scrollTop = scroll.scrollHeight;
      });
    }
  };

  const submit = (q: string) => {
    const text = q.trim();
    if (!text || isStreaming()) return;
    input.value = "";
    send(text);
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit(input.value);
  });

  if (seed) {
    seed.addEventListener("click", (e) => {
      const target = (e.target as HTMLElement)?.closest<HTMLButtonElement>(
        "[data-suggest]",
      );
      if (!target?.dataset.suggest) return;
      submit(target.dataset.suggest);
    });
  }

  clearBtn?.addEventListener("click", () => {
    clear();
    input.focus();
  });

  const unsub = subscribe(render);
  render();
  requestAnimationFrame(() => {
    scroll.scrollTop = scroll.scrollHeight;
  });

  document.addEventListener("astro:before-swap", () => unsub(), {
    once: true,
  });
}

wireChat();
document.addEventListener("astro:page-load", wireChat);
