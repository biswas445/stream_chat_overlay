# Hikasha Chat — Stream Chat Overlay (Twitch + YouTube + Kick)

> A standalone, **transparent, always-on-top multistream chat overlay panel**
> for streamers. It floats your Twitch, YouTube and Kick chat over your game or
> stream in a single borderless Electron window — the same way an OBS browser
> source would, but completely independent of your streaming software.

![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Tests](https://github.com/biswas445/stream_chat_overlay/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-green)

**Keywords:** twitch chat overlay, youtube live chat overlay, kick chat overlay,
multistream chat, OBS chat overlay alternative, transparent chat panel,
always-on-top chat, streamer overlay, BotRix widget, Electron overlay, Windows.

## Features

- **Multistream chat in one panel** — embeds the [BotRix](https://botrix.live)
  multistream widget, which merges chat from **Twitch, YouTube and Kick** into
  one scroll. No chat protocol code to maintain: BotRix keeps the platform
  connections alive, the panel renders them.
- **True transparency (glass mode)** — the window background is fully clear,
  so chat floats directly over your desktop or gameplay. All text switches to
  white with a soft shadow for readability on any background.
- **Solid mode** — one click switches to an opaque rounded card with dark text.
- **Always-on-top pin** — keep the panel above everything, like an overlay.
- **Live viewer counts** — per-platform pills (Twitch / YouTube / Kick) in the
  header, polled from BotRix every 30 s.
- **Frameless & movable** — drag the header to move it, resize from the window
  edges; position and size persist across restarts.
- **Themed widget** — the embedded chat is restyled live (custom CSS +
  MutationObserver) to match the panel: pill rows, bold usernames, platform
  icons, zebra stripes.
- **Tray-resident** — no taskbar button; reopen or quit from the tray icon.
- **Privacy-minded** — chat messages are never stored: no buffer, no disk, no
  database. They exist only in the panel's DOM while it is open.
- **Splash screen** — a short branded intro while the app starts.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- A [BotRix](https://botrix.live) account with a **multistream chat widget**
  configured (this is what merges Twitch + YouTube + Kick chat and carries
  your connected channels via its `?bid=` session id).

### Install & run

**Easy (Windows):**

1. Double-click **`install.bat`** — checks Node 18+, installs dependencies,
   creates `.env` from the example, and verifies with the test suite.
2. Paste your BotRix widget URL into `.env` (see below).
3. Double-click **`start.bat`** to launch.

**Manual:**

```bash
git clone https://github.com/biswas445/stream_chat_overlay.git
cd stream_chat_overlay
npm install   # or double-click install.bat
npm start     # or double-click start.bat
```

`npm start` builds the renderer with Vite, then launches Electron.
`npm test` runs syntax checks + 15 unit tests + production build.
`npm run dist:win` produces a Windows NSIS installer in `release/`.

### Configure the widget

Copy the example config and paste your BotRix multistream widget URL (the
exact URL an OBS browser source would load):

```bash
cp .env.example .env
```

```dotenv
BOTRIX_WIDGET_URL="https://botrix.live/widgets/multistream?bid=..."
```

The `.env` file is read by the Electron main process at startup.

> **Keep your `?bid=` private.** It is your BotRix session id — anyone with
> it can view your widget configuration. `.env` is git-ignored and never
> committed; only `.env.example` (with a placeholder bid) is tracked. If a
> bid ever leaks, regenerate the widget URL in BotRix and update `.env`.

## How it works

```
Electron main process
├── chat window (frameless, transparent, always-on-top)
│   └── <iframe> → BotRix multistream widget (renders Twitch/YouTube/Kick chat)
│       └── injected CSS + MutationObserver → panel-matched theme
├── splash window (branded intro, self-dismisses)
├── viewer-count poller → botrix.live REST API → header pills
├── tray icon + menu (show panel / quit)
└── overlay-state.json → persisted window bounds, pin, transparency
```

| Path | Role |
| --- | --- |
| `electron/main.js` | Window management, widget theming, viewer counts, tray, state persistence |
| `electron/chat-preload.js` | Secure IPC bridge exposed to the panel page |
| `electron/launch.js` | Spawns Electron with `ELECTRON_RUN_AS_NODE` stripped |
| `chat.html` / `src/chat.js` | The panel page: header, buttons, glass/solid themes |
| `splash.html` | The startup splash |
| `vite.config.js` | Builds `chat.html` + `splash.html` into `dist/renderer` |

## Security notes

- `contextIsolation` is on, `nodeIntegration` is off, and `sandbox: true`
  in every window; the renderer talks to the main process only through the
  small IPC surface in `chat-preload.js`.
- The widget URL is allow-listed to `botrix.live` in three layers
  (main process, renderer, and CSP `frame-src`); popups are denied and no
  media/fullscreen permissions are granted to embedded content.
- The widget session uses an isolated `persist:botrix-chat` partition.
- Chat content is never written to disk; window bounds/pin/theme persist in
  `overlay-state.json`. The `?bid=` session id lives only in your local
  git-ignored `.env` — never hardcode it anywhere else.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Setup card: `.env file not found` | Fresh clone | `copy .env.example .env`, paste widget URL |
| Setup card: `missing ?bid=` | Truncated URL | Re-copy the FULL URL from BotRix |
| `widget failed to load (timeout)` | Bad bid / offline | Check URL, check connection, restart |
| Viewer pills dimmed at 0 | BotRix unreachable | Automatic backoff; recovers on its own |
| `panel bridge unavailable` | Preload failed | Restart; reinstall if it persists |

## License

MIT — see [LICENSE](LICENSE).
