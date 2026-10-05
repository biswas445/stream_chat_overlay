# Hikasha Chat — Stream Chat Overlay for Twitch, YouTube & Kick

Transparent, always-on-top multistream chat overlay for streamers.
Floats Twitch, YouTube, and Kick live chat over any game or stream in a
borderless Electron window — an OBS browser-source alternative that works
with any streaming software (OBS Studio, Streamlabs, XSplit) or none at all.

![Electron 44](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)
![Vite 7](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-supported-blue?logo=windows&logoColor=white)
![CI](https://github.com/biswas445/stream_chat_overlay/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

## Features

- **Multistream chat** — Twitch, YouTube, and Kick in a single scroll,
  rendered through your [BotRix](https://botrix.live) multistream widget.
- **Transparent glass mode** — borderless panel floats over gameplay;
  one click switches to an opaque solid card.
- **Always-on-top pin** — keep the panel above all other windows.
- **Live viewer counts** — per-platform counts in the header, refreshed
  every 30 seconds with offline backoff.
- **Frameless, movable, resizable** — drag the header to move; window
  position and size persist across restarts.
- **Themed messages** — pill rows, bold usernames, platform icons, zebra striping.
- **Guided setup** — a missing or invalid configuration shows an actionable
  setup card instead of a blank panel.
- **Tray application** — no taskbar button; Show/Hide and Quit from the tray icon.
- **Private by design** — messages exist only in memory; the widget session id
  stays in your local git-ignored `.env` file.

## Requirements

- Windows 10/11
- [Node.js](https://nodejs.org) 18 or later (for running from source)
- A free [BotRix](https://botrix.live) account with Twitch, YouTube,
  and Kick connected

## Quick Start

**Option A — installer scripts (recommended):**

1. Double-click `install.bat`. It verifies Node 18+, installs dependencies,
   creates `.env` from the template, and runs the test suite.
2. Paste your BotRix widget URL into `.env` (see Configuration).
3. Double-click `start.bat` to launch.

**Option B — manual:**

```bash
git clone https://github.com/biswas445/stream_chat_overlay.git
cd stream_chat_overlay
npm install
npm start
```

## Configuration

1. Log in at [botrix.live](https://botrix.live) and link your
   Twitch, YouTube, and Kick accounts.
2. Open **Widgets** in the left sidebar, select **Chat Overlay**,
   scroll down, and copy the widget link. It looks like this:

   ```text
   https://botrix.live/widgets/chat/?bid=YOUR_BID&theme=default&messageSound=0&...
   ```

3. Paste the **entire link as-is** into your local `.env` file:

   ```dotenv
   BOTRIX_WIDGET_URL="https://botrix.live/widgets/chat/?bid=YOUR_BID&theme=default&..."
   ```

   Trimming is unnecessary — the application extracts and retains only
   the `?bid=` value internally.

> **Security note:** the `?bid=` value is a private session identifier.
> Do not share the link. `.env` is git-ignored and never committed; only
> `.env.example` (placeholder value) is tracked. If a bid is exposed,
> regenerate the widget URL in BotRix and update `.env`.

## Usage

| Control | Behavior |
| --- | --- |
| Pin button | Toggle always-on-top |
| Transparency button | Switch between glass and solid themes |
| Close button | Quit the application |
| Tray icon | Show/Hide panel, Quit |

Window position, size, pin state, and theme persist between sessions
in `%AppData%/overlay-state.json`.

## Development

```bash
npm test        # syntax checks + unit tests + production build
npm run lint    # syntax checks + unit tests (no build)
npm run dist:win  # Windows NSIS installer, output to release/
```

| Path | Responsibility |
| --- | --- |
| `electron/main.js` | Window management, tray, viewer polling, error reporting, config diagnosis |
| `electron/state-utils.js` | Tested helpers: state validation, `.env` parsing, URL/bid/viewer logic |
| `electron/chat-preload.js` | Minimal IPC bridge exposed to the renderer |
| `electron/launch.js` | Process launcher (strips `ELECTRON_RUN_AS_NODE`) |
| `src/chat.js`, `chat.html` | Panel UI, setup card, error display |
| `splash.html` | Startup splash screen |
| `tests/state-utils.test.js` | Unit test suite (must remain green) |
| `install.bat`, `start.bat` | First-run installer and launcher with preflight checks |
| `vite.config.js` | Renderer build configuration (`dist/renderer`) |

## Security Model

- `contextIsolation` enabled, `nodeIntegration` disabled, `sandbox: true`
  on all windows. Renderer communicates only through the preload IPC bridge.
- Widget URLs are restricted to `botrix.live` at three layers:
  main process, renderer, and Content Security Policy `frame-src`.
- Embedded content cannot open popups and is granted no media,
  fullscreen, or device permissions.
- The widget session uses an isolated `persist:botrix-chat` partition.
- Chat content is never written to disk. Unexpected errors are logged
  and surfaced in the panel rather than failing silently.

## Troubleshooting

| Symptom | Cause | Resolution |
| --- | --- | --- |
| Setup card: `.env` file not found | Fresh install | Copy `.env.example` to `.env` and add the widget URL |
| Setup card: `missing ?bid=` | Truncated URL | Re-copy the complete link from BotRix |
| `widget failed to load (timeout)` | Invalid bid or offline | Verify the URL and connection, then restart |
| Viewer counts dimmed at 0 | BotRix unreachable | Automatic recovery with exponential backoff |
| `panel bridge unavailable` | Preload failure | Restart; reinstall if the problem persists |

## License

MIT — see [LICENSE](LICENSE) for details.
