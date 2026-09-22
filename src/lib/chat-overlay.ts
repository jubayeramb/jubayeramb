/**
 * The home page chat <dialog>: opens on the first message or a chat:open
 * event, and reports chat:opened / chat:closed to the home input.
 *
 * Imported by ChatOverlay.astro once the page has loaded.
 */
import { getMessages, subscribe } from "./chat-store";

const wireOverlay = () => {
  const dialog = document.getElementById(
    "chat-overlay",
  ) as HTMLDialogElement | null;
  if (!dialog || (dialog as any).__wired) return;
  (dialog as any).__wired = true;

  const closeBtn = document.getElementById("chat-overlay-close");
  const maxBtn = document.getElementById("chat-overlay-max");

  const open = () => {
    if (dialog.open) return;
    dialog.showModal();
    window.dispatchEvent(new CustomEvent("chat:opened"));
    requestAnimationFrame(() => {
      const scroll = dialog.querySelector<HTMLElement>(".chat-scroll");
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
      const input = dialog.querySelector<HTMLInputElement>("#chat-input");
      input?.focus();
    });
  };

  const close = () => {
    if (!dialog.open) return;
    dialog.close();
  };

  closeBtn?.addEventListener("click", close);
  maxBtn?.addEventListener("click", () => {
    close();
    window.location.assign("/ask");
  });

  // Click outside the inner frame closes the overlay.
  dialog.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target === dialog) close();
  });

  dialog.addEventListener("close", () => {
    window.dispatchEvent(new CustomEvent("chat:closed"));
  });

  window.addEventListener("chat:open", open as EventListener);
  // Live voice mode dispatches `chat:close` when starting up so it
  // can render its full-takeover surface without the chat dialog
  // sitting in front of it (top-layer beats z-index).
  window.addEventListener("chat:close", close as EventListener);

  // Auto-open exactly once when the user transitions from empty → first turn.
  let prevLen = getMessages().length;
  subscribe(() => {
    const len = getMessages().length;
    if (prevLen === 0 && len > 0 && !dialog.open) open();
    prevLen = len;
  });
};

wireOverlay();
document.addEventListener("astro:page-load", wireOverlay);
