---
title: Focrel
company: Personal product
role: Designer & Engineer
period: "2026"
summary: Local-first macOS focus app that binds wallpaper, music, to-dos, and macOS Focus mode to each context. Switch the realm with one click.
url: https://focrel.jubayeramb.com
order: 90
draft: false
technologies:
  - Tauri 2
  - React
  - TypeScript
  - Rust
  - SQLite
  - Next.js 16
softwareApp:
  applicationCategory: DesktopEnhancementApplication
  operatingSystem: macOS 14+
metrics:
  - { label: Platform, value: "macOS native" }
  - { label: Data, value: "Local-first" }
  - { label: Status, value: "Free beta" }
cover:
  url: /projects/focrel.png
  alt: Focrel, context-switching focus app
---

## The problem

Focus is a feeling. The lights, the music, the apps you keep open, the
notifications you turn off: that's the actual stack. Productivity apps
treat focus as a timer. Focrel treats it as a *place*: a context with
its own wallpaper, soundtrack, to-do list, and macOS Focus mode. Switch
the context, switch the realm.

## What shipped

A free macOS beta. Native Tauri app that owns four pieces of system
state per realm: wallpaper, background audio, the active to-do list, and
the macOS Focus mode. One click swaps all of them. Crash-safe by design:
if the app dies mid-session, the next launch restores your original
wallpaper and exits the Focus mode cleanly. Marketing site at
[focrel.jubayeramb.com](https://focrel.jubayeramb.com).

## What's next

Windows and Linux builds first. Then user accounts and device sync, iOS
and Android companions, and a paid tier for cloud-synced realms. The
local-first core stays; sync is additive, not a replacement.
