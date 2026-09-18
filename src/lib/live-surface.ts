/**
 * Full-screen "live voice mode" surface: a backdrop tint, an audio-reactive
 * orb, a caption, an End call button and a small status pill.
 *
 * Loaded together with the Gemini Live session on the first mic click
 * (see MicButton.astro), so neither this module, its stylesheet nor the
 * SDK cost anything for visitors who never use voice.
 *
 * Live transcripts are deliberately not rendered here: they land in
 * chat-store on `turnComplete` and show up as normal chat bubbles once
 * the session ends.
 */
import liveCss from "../styles/features/live.css?url";
import { loadStylesheet } from "./load-stylesheet";
import type { LiveSession, LiveState } from "./live-session";

/** Resolves once the surface's stylesheet is in place. */
export const stylesReady = loadStylesheet(liveCss);

const TEMPLATE = `
  <div class="live-stage">
    <div class="live-orb" data-live="orb">
      <div class="live-orb-halo"></div>
      <svg class="live-orb-visualizer" viewBox="-150 -150 300 300" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <radialGradient id="live-orb-grad-user" cx="50%" cy="50%" r="50%">
            <stop offset="0%" style="stop-color: var(--accent); stop-opacity: 0.85"></stop>
            <stop offset="60%" style="stop-color: var(--accent); stop-opacity: 0.35"></stop>
            <stop offset="100%" style="stop-color: var(--accent); stop-opacity: 0.05"></stop>
          </radialGradient>
          <radialGradient id="live-orb-grad-assistant" cx="50%" cy="50%" r="50%">
            <stop offset="0%" style="stop-color: var(--live-assistant); stop-opacity: 0.85"></stop>
            <stop offset="55%" style="stop-color: var(--accent); stop-opacity: 0.45"></stop>
            <stop offset="100%" style="stop-color: var(--accent); stop-opacity: 0.05"></stop>
          </radialGradient>
        </defs>
        <path data-live="wave"></path>
      </svg>
      <div class="live-orb-sphere">
        <div class="live-orb-gradient"></div>
        <div class="live-orb-shimmer"></div>
        <div class="live-orb-highlight"></div>
      </div>
    </div>
    <div class="live-caption" role="status" aria-live="polite">
      <span class="live-caption-label" data-live="label">Listening</span>
      <span class="live-caption-hint" data-live="hint"></span>
    </div>
    <button type="button" class="live-end" data-live="end">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" transform="rotate(135 12 12)"></path>
      </svg>
      <span>End call</span>
    </button>
  </div>
  <div class="live-pill" data-live="pill" aria-hidden="true">
    <span class="live-pill-dot"></span>
    <span class="live-pill-status" data-live="pill-status">Listening</span>
  </div>
`;

// Audio-reactive blob: N points around a circle, each radius modulated by
// a frequency bin so the perimeter bulges where the energy is.
const POINTS = 64;
const HALF = POINTS / 2;
const BASE_R = 110;
const PEAK_BOOST = 50;
// Bins 0-2 are DC, hum and room rumble at the 16 kHz mic rate; skipping
// them stops the top of the shape bulging in silence. 50 is the upper
// edge of the voice band.
const BIN_START = 3;
const BIN_MAX = 50;
// Bins below this fraction of full scale are treated as silence.
const NOISE_FLOOR = 0.18;
const EXIT_MS = 280;

const ANGLES = Array.from({ length: POINTS }, (_, i) => {
  const a = (i / POINTS) * Math.PI * 2 - Math.PI / 2;
  return { cos: Math.cos(a), sin: Math.sin(a) };
});

let surface: HTMLElement | null = null;
let attached: LiveSession | null = null;

function build(): HTMLElement {
  const el = document.createElement("div");
  el.className = "live-surface";
  el.dataset.state = "idle";
  el.hidden = true;
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = TEMPLATE;
  return el;
}

const q = <T extends Element>(root: Element, name: string) =>
  root.querySelector<T>(`[data-live="${name}"]`);

/**
 * Mounts the surface (once) and binds it to `session`. Safe to call on
 * every mic click.
 */
export function attachLiveSurface(session: LiveSession) {
  if (!surface) {
    surface = build();
    document.body.appendChild(surface);
    // Client-side navigation replaces <body>; carry the surface over so a
    // call in progress keeps its End button on the next page.
    document.addEventListener("astro:after-swap", () => {
      if (surface && !document.body.contains(surface)) document.body.appendChild(surface);
    });
  }
  if (attached === session) return;
  attached = session;

  const root = surface;
  const orb = q<HTMLElement>(root, "orb")!;
  const wave = q<SVGPathElement>(root, "wave");
  const label = q<HTMLElement>(root, "label");
  const hint = q<HTMLElement>(root, "hint");
  const pill = q<HTMLElement>(root, "pill")!;
  const pillStatus = q<HTMLElement>(root, "pill-status");

  q<HTMLButtonElement>(root, "end")?.addEventListener("click", () => {
    void session.stop();
  });

  let exitTimer = 0;
  let wobble = 0;

  const renderWave = (freq: Uint8Array | null, level: number, assistant: boolean) => {
    if (!wave) return;
    wobble += 0.04;
    // How "alive" the audio is: a quiet frame draws a near-perfect circle,
    // speech gives the perimeter visible motion.
    const liveness = Math.min(1, level * 2);
    const baseExtra = liveness * 24;
    const binEnd = freq ? Math.min(freq.length - 1, BIN_MAX) : 0;
    const range = Math.max(1, binEnd - BIN_START);

    const pts = ANGLES.map(({ cos, sin }, i) => {
      let energy = 0;
      if (freq && freq.length > 0) {
        // Mirror across the vertical axis so both halves pulse together.
        const m = i < HALF ? i : POINTS - 1 - i;
        const idx = Math.min(binEnd, BIN_START + Math.floor((m / (HALF - 1)) * range));
        const raw =
          (freq[Math.max(BIN_START, idx - 1)] + freq[idx] + freq[Math.min(binEnd, idx + 1)]) / 3 / 255;
        energy = raw < NOISE_FLOOR ? 0 : (raw - NOISE_FLOOR) / (1 - NOISE_FLOOR);
      }
      const w = (Math.sin(wobble + i * 0.7) * 1.4 + Math.sin(wobble * 1.7 + i * 0.3) * 0.9) * liveness;
      const r = BASE_R + baseExtra + energy * PEAK_BOOST + w;
      return { x: cos * r, y: sin * r };
    });

    // Quadratic segments through each pair's midpoint give a smooth closed
    // curve instead of a 64-sided polygon.
    const mid = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      `${((a.x + b.x) / 2).toFixed(2)},${((a.y + b.y) / 2).toFixed(2)}`;
    let d = `M${mid(pts[POINTS - 1], pts[0])}`;
    for (let i = 0; i < POINTS; i++) {
      const p = pts[i];
      d += ` Q${p.x.toFixed(2)},${p.y.toFixed(2)} ${mid(p, pts[(i + 1) % POINTS])}`;
    }
    wave.setAttribute("d", `${d} Z`);
    wave.setAttribute("fill", assistant ? "url(#live-orb-grad-assistant)" : "url(#live-orb-grad-user)");
  };

  const render = () => {
    const state: LiveState = session.state;
    const assistant = session.assistantSpeaking;
    const wasActive = !root.hidden && root.dataset.state !== "idle";
    root.dataset.state = state;
    root.dataset.speaker = assistant ? "assistant" : "user";
    pill.dataset.state = state;

    if (state === "idle") {
      root.setAttribute("aria-hidden", "true");
      if (wasActive) {
        window.clearTimeout(exitTimer);
        root.dataset.exit = "true";
        exitTimer = window.setTimeout(() => {
          root.hidden = true;
          delete root.dataset.exit;
        }, EXIT_MS);
      } else {
        root.hidden = true;
      }
    } else {
      window.clearTimeout(exitTimer);
      delete root.dataset.exit;
      root.hidden = false;
      root.setAttribute("aria-hidden", "false");
    }

    const primary =
      state === "requesting"
        ? "Connecting…"
        : state === "error"
          ? (session.errorMessage ?? "Voice error")
          : assistant
            ? "Speaking"
            : "Listening";
    if (label) label.textContent = primary;
    if (pillStatus) pillStatus.textContent = primary;
    if (hint) {
      hint.textContent =
        state === "requesting"
          ? "Opening a live voice channel…"
          : state === "error"
            ? "Tap end and try again."
            : assistant
              ? "Listening will resume in a moment."
              : "Speak naturally, Jubayer's assistant is listening.";
    }

    const intensity =
      state === "live" ? Math.min(1, 0.18 + session.level * 1.4) : state === "requesting" ? 0.22 : 0;
    orb.style.setProperty("--intensity", String(intensity));
    orb.dataset.speaker = assistant ? "assistant" : "user";
    if (state === "live") renderWave(session.frequencyData, session.level, assistant);
  };

  let raf = 0;
  const tick = () => {
    raf = 0;
    render();
    if (session.state !== "idle") raf = requestAnimationFrame(tick);
  };

  session.subscribe(() => {
    render();
    if (!raf) raf = requestAnimationFrame(tick);
  });
  render();
}
