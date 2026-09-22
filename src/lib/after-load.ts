/**
 * Runs `fn` once the page has loaded and the browser is next idle. For
 * features that aren't needed to draw the page (the chat, the mic), so
 * their code never competes with first paint or the hero image. Waiting
 * for idle, not just `load`, matters on fast devices, where `load` can
 * fire before the largest paint.
 *
 * Safe to call on client-side navigations too: the document is already
 * complete, so it only waits for idle.
 */
export function afterLoad(fn: () => void) {
  const idle = () =>
    "requestIdleCallback" in window
      ? requestIdleCallback(() => fn(), { timeout: 2000 })
      : setTimeout(fn, 200);
  if (document.readyState === "complete") idle();
  else addEventListener("load", idle, { once: true });
}
