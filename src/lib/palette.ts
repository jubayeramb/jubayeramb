/**
 * Command palette behaviour. Loaded on demand by CommandPalette.astro, so
 * none of this (or its stylesheet, or the index) costs anything on pages
 * where the palette is never opened.
 */
import paletteCss from "../styles/features/palette.css?url";
import { loadStylesheet } from "./load-stylesheet";
import type { PaletteItem } from "./palette-index";
import { AUTHOR } from "./site";

let index: Promise<PaletteItem[]> | null = null;
const loadIndex = () =>
  (index ??= fetch("/palette.json")
    .then((r) => (r.ok ? (r.json() as Promise<PaletteItem[]>) : []))
    .catch(() => {
      index = null;
      return [];
    }));

// Start fetching the stylesheet as soon as the module loads (on hover or
// first shortcut), so it is usually in place before the dialog opens.
const stylesReady = loadStylesheet(paletteCss);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const score = (q: string, item: PaletteItem): number => {
  if (!q) return 1;
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 100;
  if (new RegExp(`\\b${escapeRe(q)}`).test(label)) return 60;
  if (`${label} ${item.keywords ?? ""}`.toLowerCase().includes(q)) return 30;
  return 0;
};

type Els = {
  dialog: HTMLDialogElement;
  input: HTMLInputElement;
  list: HTMLUListElement;
  askBtn: HTMLButtonElement | null;
  askQuery: HTMLElement | null;
};

let els: Els | null = null;
let all: PaletteItem[] = [];
let visible: PaletteItem[] = [];
let active = 0;

function elements(): Els | null {
  const dialog = document.getElementById("palette") as HTMLDialogElement | null;
  const input = document.getElementById("palette-input") as HTMLInputElement | null;
  const list = document.getElementById("palette-results") as HTMLUListElement | null;
  if (!dialog || !input || !list) return null;
  // The dialog is transition:persist'ed, so it's the same node across
  // navigations; wire it once.
  if (els?.dialog === dialog) return els;
  els = {
    dialog,
    input,
    list,
    askBtn: document.getElementById("palette-ask") as HTMLButtonElement | null,
    askQuery: document.getElementById("palette-ask-query"),
  };
  wire(els);
  return els;
}

function render() {
  if (!els) return;
  const { input, list, askQuery } = els;
  const q = input.value.trim().toLowerCase();
  visible = all
    .map((it) => ({ it, s: score(q, it) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((r) => r.it)
    .slice(0, 40);
  if (active >= visible.length) active = 0;

  const groups = new Map<string, PaletteItem[]>();
  for (const it of visible) {
    if (!groups.has(it.group)) groups.set(it.group, []);
    groups.get(it.group)!.push(it);
  }

  list.replaceChildren();
  let i = 0;
  for (const [group, items] of groups) {
    const header = document.createElement("li");
    header.className = "palette-group";
    header.setAttribute("role", "presentation");
    header.textContent = group;
    list.appendChild(header);
    for (const it of items) {
      const li = document.createElement("li");
      li.className = "palette-item";
      li.id = `palette-opt-${i}`;
      li.setAttribute("role", "option");
      li.dataset.idx = String(i);
      const label = document.createElement("span");
      label.className = "palette-label";
      label.textContent = it.label;
      li.appendChild(label);
      if (it.hint || it.external) {
        const hint = document.createElement("span");
        hint.className = "palette-hint";
        hint.textContent = it.hint ?? "↗";
        li.appendChild(hint);
      }
      list.appendChild(li);
      i++;
    }
  }

  if (visible.length === 0) {
    const empty = document.createElement("li");
    empty.className = "palette-empty";
    empty.setAttribute("role", "presentation");
    empty.textContent = q ? "No matches. Press Enter to ask my CV instead." : "Loading…";
    list.appendChild(empty);
  }
  if (askQuery) askQuery.textContent = q || "anything";
  setActive(active, false);
}

function setActive(i: number, scroll = true) {
  if (!els || visible.length === 0) {
    els?.input.removeAttribute("aria-activedescendant");
    return;
  }
  active = (i + visible.length) % visible.length;
  els.list.querySelectorAll<HTMLLIElement>(".palette-item").forEach((el) => {
    const on = Number(el.dataset.idx) === active;
    el.classList.toggle("active", on);
    el.setAttribute("aria-selected", String(on));
    if (on && scroll) el.scrollIntoView({ block: "nearest" });
  });
  els.input.setAttribute("aria-activedescendant", `palette-opt-${active}`);
}

function close() {
  if (els?.dialog.open) els.dialog.close();
}

function flash(msg: string) {
  const t = document.createElement("div");
  t.className = "palette-toast";
  t.setAttribute("role", "status");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1600);
}

function go(href: string, external = false) {
  if (external) window.open(href, "_blank", "noopener");
  else window.location.href = href;
}

function execute(item?: PaletteItem) {
  if (!item) return;
  close();
  switch (item.action) {
    case "toggle-theme":
      document.getElementById("themeToggle")?.click();
      return;
    case "copy-email":
      navigator.clipboard?.writeText(AUTHOR.email).then(() => flash("Email copied"));
      return;
    case "random-article": {
      const posts = all.filter((x) => x.group === "Posts");
      const pick = posts[Math.floor(Math.random() * posts.length)];
      if (pick?.href) go(pick.href);
      return;
    }
  }
  if (item.href) go(item.href, !!item.external);
}

function askAi() {
  if (!els) return;
  const q = els.input.value.trim();
  close();
  window.location.assign(q ? `/ask/?q=${encodeURIComponent(q)}` : "/ask/");
}

function wire({ dialog, input, list, askBtn }: Els) {
  input.addEventListener("input", () => {
    active = 0;
    render();
  });
  list.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLLIElement>(".palette-item");
    if (li) execute(visible[Number(li.dataset.idx)]);
  });
  list.addEventListener("mousemove", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLLIElement>(".palette-item");
    if (li && Number(li.dataset.idx) !== active) setActive(Number(li.dataset.idx), false);
  });
  askBtn?.addEventListener("click", askAi);
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Enter with no match, or Cmd/Ctrl+Enter, asks the CV chat instead.
      if (visible.length === 0 || e.metaKey || e.ctrlKey) askAi();
      else execute(visible[active]);
    }
  });
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close();
  });
}

export async function openPalette() {
  const e = elements();
  if (!e || e.dialog.open) return;
  await stylesReady;
  if (e.dialog.open) return;
  e.dialog.showModal();
  e.input.value = "";
  active = 0;
  render();
  requestAnimationFrame(() => e.input.focus());
  all = await loadIndex();
  if (e.dialog.open) render();
}

export function togglePalette() {
  const e = elements();
  if (e?.dialog.open) close();
  else void openPalette();
}
