# Hikasha Chat — Stream Chat Overlay

A standalone, **transparent, always-on-top multistream chat overlay panel** for
streamers. It floats your Twitch, YouTube and Kick chat over your game or
stream in a single borderless Electron window — the same way an OBS browser
source would, but completely independent of your streaming software.

![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows-blue)

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

```bash
git clone https://github.com/biswas445/stream_chat_overlay.git
cd stream_chat_overlay
npm install
npm start
```

`npm start` builds the renderer with Vite, then launches Electron.

### Configure the widget

Copy the example config and paste your BotRix multistream widget URL (the
exact URL an OBS browser source would load):

```bash
cp .env.example .env
```

```dotenv
BOTRIX_WIDGET_URL="https://botrix.live/widgets/multistream?bid=..."
```

The `.env` file is read by the Electron main process at startup — no secrets
belong in the repo, and this file is git-ignored.

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

- `contextIsolation` is on and `nodeIntegration` is off in every window; the
  renderer talks to the main process only through the small IPC surface in
  `chat-preload.js`.
- The panel page's CSP allows `frame-src https:` so any configured widget
  host works; the widget URL is validated to be `https://` before embedding.
- No chat content, credentials, or identifiers are persisted anywhere.

## License

MIT — see [LICENSE](LICENSE).
