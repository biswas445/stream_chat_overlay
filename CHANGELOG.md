# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versioning follows
[SemVer](https://semver.org/).

## [Unreleased]

### Added

- Settings db: the BotRix widget URL is stored in
  `%AppData%/Hikasha Chat/botrix-config.json` (atomic writes) and managed
  through a gear-icon settings panel (Enter/Change buttons, themed input,
  masked bid display) — replacing the `.env` mechanism entirely.
- One-time migration: a pre-upgrade legacy config file's widget URL is
  imported into the settings db on the first boot after upgrading.
- First-launch guidance: the setup card points at the gear icon; every
  config failure mode gets an actionable per-code card (missing, empty,
  bad protocol/host/port, too long, no bid, invalid bid).
- End-to-end test layer (Playwright Electron): boot, full settings flow,
  restart-load, and close-path verified in the real app.
- Property-based tests (fast-check): whole-input-domain properties for the
  URL/state helpers (allowlist, canonicalization, caps, viewer parsing).
- Behavioral main-process tests: settings-db IPC handlers driven against a
  real temp db (save, unchanged, rejections, corrupt-db fallback).
- Auto-update: packaged builds check GitHub Releases on boot and apply on
  the next start; the tag-gated release workflow publishes installers.

### Security

- IPC sender gating: every channel is restricted to the panel's main frame
  (sub-frames and foreign windows rejected).
- Preload bridge confined to the top frame (the embedded widget frame can
  never reach the privileged bridge).
- `will-navigate` blocked on all windows; frame-navigate monitoring
  surfaces a widget frame leaving botrix.live.
- Widget frame targeting uses proper hostname validation (never substring
  matching).
- DevTools disabled in packaged builds; the dev-server URL is ignored in
  packaged builds.
- The viewer poller refuses redirects and is frozen to the boot-time URL;
  failed-load logging strips the bid; the settings UI masks the bid.
- Length caps on saved URLs (2048) and ports (standard https only).
- Atomic writes for the settings db and window state (crash-safe).
- CI hardening: SHA-pinned actions, least-privilege token, no credential
  persistence, job timeouts, concurrency groups; Node 22 engine alignment.

## [0.1.0] — initial public release

- Tray-resident, frameless, transparent multistream chat overlay
  (Twitch/YouTube/Kick via the BotRix widget).
- BotRix viewer counts in the header with exponential-backoff polling.
- Pin and glass/solid theme toggles; splash intro; error reporting in-panel.
