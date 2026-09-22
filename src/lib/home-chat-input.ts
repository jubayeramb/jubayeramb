/**
 * Home page chat input: expands into suggestion chips or a preview of the
 * running chat, and hands submitted questions to the chat overlay.
 *
 * Imported by HomeChatInput.astro once the page has loaded.
 */
import { getMessages, subscribe, send } from "./chat-store";

const TRUNCATE = 140;
const STRIP = /\[\d+(?:\s*,\s*\d+)*\]/g;

const wireHomeChat = () => {
  const root = document.getElementById("home-chat");
  if (!root || (root as any).__wired) return;
  (root as any).__wired = true;

  const form = root.querySelector<HTMLFormElement>("#home-chat-form");
  const input = root.querySelector<HTMLInputElement>("#home-chat-input");
  const chips = root.querySelector<HTMLElement>("#home-chat-chips");
  const preview = root.querySelector<HTMLOListElement>("#home-chat-preview");
  if (!form || !input || !chips || !preview) return;

  const truncate = (s: string, n: number) =>
    s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";

  const renderPreview = () => {
    const messages = getMessages();
    // Last 3 turns, newest first in DOM. Combined with column-reverse,
    // that puts newest flush above the input and older bubbles fading
    // upward through the mask.
    const last = messages
      .slice(-3)
      .filter((m) => m.content || m.error)
      .reverse();
    preview.innerHTML = "";
    for (const m of last) {
      const li = document.createElement("li");
      li.className = `bubble bubble--${m.role} home-chat-preview-bubble`;
      const body = document.createElement("div");
      body.className = "bubble-body";
      const text = m.error ?? m.content;
      body.textContent = truncate(text.replace(STRIP, ""), TRUNCATE);
      li.appendChild(body);
      preview.appendChild(li);
    }
  };

  const updateHistoryFlag = () => {
    const has = getMessages().length > 0;
    root.dataset.history = has ? "true" : "false";
    input.placeholder = has
      ? "Continue the chat…"
      : "Ask anything about Jubayer…";
  };

  const expand = () => {
    root.dataset.state = "expanded";
    const has = root.dataset.history === "true";
    if (has) {
      chips.hidden = true;
      preview.hidden = false;
      renderPreview();
    } else {
      preview.hidden = true;
      chips.hidden = false;
      animateChips();
    }
  };

  const collapse = () => {
    if (document.activeElement === input) return;
    if (input.value.trim()) return;
    root.dataset.state = "idle";
    chips.hidden = true;
    preview.hidden = true;
  };

  const animateChips = () => {
    const els = Array.from(chips.querySelectorAll<HTMLElement>(".home-chat-chip"));
    els.forEach((el, i) => {
      el.animate(
        [
          { opacity: 0, transform: "translateY(6px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        {
          duration: 260,
          delay: i * 60,
          fill: "forwards",
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        }
      );
    });
  };

  input.addEventListener("focus", expand);
  input.addEventListener("blur", () => {
    // Slight delay so a chip click registers before collapse.
    setTimeout(collapse, 120);
  });

  chips.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement)?.closest<HTMLButtonElement>("[data-suggest]");
    if (!target?.dataset.suggest) return;
    input.value = target.dataset.suggest;
    submit();
  });

  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    send(text);
    input.value = "";
    window.dispatchEvent(new CustomEvent("chat:open"));
    input.blur();
    root.dataset.state = "idle";
    chips.hidden = true;
    preview.hidden = true;
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });

  // Hide ourselves while overlay is open.
  window.addEventListener("chat:opened", () => {
    root.dataset.hidden = "true";
  });
  // On close, return to a fresh idle state - no preview/chips visible.
  // The user has to click the input again to see the resume preview.
  window.addEventListener("chat:closed", () => {
    root.dataset.hidden = "false";
    root.dataset.state = "idle";
    chips.hidden = true;
    preview.hidden = true;
    input.value = "";
    input.blur();
  });

  subscribe(updateHistoryFlag);
  updateHistoryFlag();
};

wireHomeChat();
document.addEventListener("astro:page-load", wireHomeChat);
