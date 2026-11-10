---
title: Syncroll
company: Personal product
role: Designer & Engineer
period: "2026"
summary: Chrome extension that scroll-syncs two tabs in Chrome's native Split View. Works on standard pages, chat UIs, and canvas apps like Figma.
url: https://syncroll.jubayeramb.com
order: 100
draft: false
technologies:
  - JavaScript
  - Chrome Extensions
  - Manifest V3
softwareApp:
  applicationCategory: BrowserApplication
  operatingSystem: Chrome 145+
  installUrl: https://chromewebstore.google.com/detail/syncroll-split-view-sync/ghpgfihdllhgmjkgkjnkmoonelfokpdi
metrics:
  - { label: Sync modes, value: "3" }
  - { label: Chrome target, value: "v145+" }
  - { label: Pairs, value: "Cross-mode" }
cover:
  src: ./images/syncroll.png
  alt: Syncroll, split-view scroll sync
updatedDate: 2026-11-11
faq:
  - q: "How do I sync scroll in Chrome Split View?"
    a: "Chrome has no built-in scroll sync. Install Syncroll, open its popup inside a split (both panes are detected automatically), pick an alignment and hit Sync Split Panes. Scroll either side and the other follows."
  - q: "Can I scroll two Chrome windows at the same time without Split View?"
    a: "Yes. Pick any two open tabs in the Syncroll popup and tick Open in new window. Syncroll places them in two windows on the left and right halves of your screen and keeps them in sync."
  - q: "Does it work on ChatGPT, Gemini or Figma?"
    a: "Yes. On chat apps it finds the inner scrolling area, so the sidebar stays put. On canvas apps like Figma, Miro and Excalidraw it relays wheel events, so both canvases pan together."
  - q: "Does Syncroll collect any data?"
    a: "No. There are no servers, analytics or tracking. Sync runs locally between your tabs through Chrome's built-in messaging."
---

## The problem

Chrome 145 shipped native Split View: two tabs side by side, one
window. A real productivity unlock for cross-referencing docs, comparing
API responses, or designing against a spec. Except scrolling. Each pane
scrolls in isolation, which kills the use case the moment one document
is longer than the other or the two views are different page types
entirely.

The use case I wanted: open ChatGPT on the left, my MDX draft on the
right, scroll either side, the other follows.

## How to scroll two tabs together in Chrome

Chrome doesn't sync scrolling between Split View panes on its own. With
Syncroll it takes four steps:

1. Install Syncroll from the
   [Chrome Web Store](https://chromewebstore.google.com/detail/syncroll-split-view-sync/ghpgfihdllhgmjkgkjnkmoonelfokpdi).
   It needs Chrome 145 or newer.
2. Click the Syncroll icon. Inside Chrome's Split View, both panes are
   detected automatically. Otherwise, pick the left and right tab from
   the dropdowns. Any tab in any window works.
3. Pick a scroll alignment: **Relative (%)** so both pages reach the end
   together, or **Exact (px)** so both travel the same distance.
4. Hit **Sync Split Panes**. Scroll either side, the other follows.

Not using Split View? Tick **Open in new window** in step 2 and Syncroll
arranges the two tabs as side-by-side windows on the left and right
halves of your screen. That also answers the other common question, how
to scroll two windows at the same time.

## What shipped

A zero-build Chrome extension that handles three kinds of pages:

- **Standard pages**: synced by scroll percentage, so pages of different
  lengths stay visually aligned.
- **Container-scroll apps** like ChatGPT, Gemini, and Slack: auto-detects
  the inner scrollable element and syncs that.
- **Canvas/WebGL apps** like Figma, Miro, and Excalidraw: captures wheel
  events and replays them on the other side.

Cross-mode pairs work cleanly: a normal site on one side and Figma on the
other syncs without thinking about it. It's on the
[Chrome Web Store](https://chromewebstore.google.com/detail/syncroll-split-view-sync/ghpgfihdllhgmjkgkjnkmoonelfokpdi), and the landing page is at
[syncroll.jubayeramb.com](https://syncroll.jubayeramb.com/).
