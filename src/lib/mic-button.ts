/**
 * Mic buttons for voice chat. The live session and its surface are
 * imported on the first click, not with this module.
 *
 * Imported by MicButton.astro once the page has loaded.
 */
// Lazy-load the live session AND its full-screen surface the FIRST time
// the visitor clicks a mic. Until then the @google/genai SDK (~290 KB),
// the audio worklet and the surface's styles are not in any bundle the
// page loads. The resolved session is cached on window so a mic button
// on a later page reuses it.
type Session = import("./live-session").LiveSession;
let sessionPromise: Promise<Session> | null = null;

function getSession(): Promise<Session> {
  const existing = (window as any).__liveSession as Session | undefined;
  if (existing) return Promise.resolve(existing);
  sessionPromise ??= Promise.all([
    import("./live-session"),
    import("./live-surface"),
  ]).then(async ([live, surface]) => {
    await surface.stylesReady;
    const s = live.createLiveSession();
    surface.attachLiveSurface(s);
    (window as any).__liveSession = s;
    return s;
  });
  return sessionPromise;
}

const wireMicButton = (btn: HTMLButtonElement) => {
  if ((btn as any).__wired) return;
  (btn as any).__wired = true;

  const ring = btn.querySelector<HTMLElement>(".mic-btn-ring");

  const render = (
    state: "idle" | "requesting" | "live" | "error",
    level: number,
    err: string | null,
  ) => {
    btn.dataset.state = state;
    btn.setAttribute("aria-pressed", state === "live" ? "true" : "false");
    btn.setAttribute(
      "aria-label",
      state === "live"
        ? "Stop voice chat"
        : state === "requesting"
          ? "Connecting…"
          : state === "error"
            ? `Voice error: ${err ?? "try again"}`
            : "Talk to the assistant",
    );
    if (err) btn.dataset.error = err;
    else delete btn.dataset.error;
    if (ring) {
      // Pulse strength tracks mic level (0..1).
      ring.style.setProperty("--mic-level", String(Math.min(1, level * 2)));
    }
  };

  // Default to idle state. We deliberately do NOT subscribe on wire -
  // that would dynamic-import live-session.js and defeat lazy loading.
  render("idle", 0, null);

  btn.addEventListener(
    "click",
    async () => {
      const session = await getSession();

      // First-click subscribe - wire the button to the session once
      // the module has loaded.
      if (!(btn as any).__subscribed) {
        (btn as any).__subscribed = true;
        const update = () =>
          render(session.state, session.level, session.errorMessage);
        session.subscribe(update);
        update();
      }

      if (session.state === "live" || session.state === "requesting") {
        await session.stop();
      } else {
        // Voice mode is a focused full-takeover surface. An open chat
        // overlay <dialog> sits in the top layer, ABOVE every other
        // element regardless of z-index, so ask it to close before
        // starting. chat-store keeps the transcript; it can be reopened
        // after the call ends.
        window.dispatchEvent(new CustomEvent("chat:close"));
        await session.start();
      }
    },
  );
};

const wireAll = () => {
  document
    .querySelectorAll<HTMLButtonElement>("[data-mic-btn]")
    .forEach(wireMicButton);
};

wireAll();
document.addEventListener("astro:page-load", wireAll);

// Side effects only; the export makes this a module, not a global script.
export {};
