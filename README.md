# Hikasha Chat — Stream Chat Overlay for Twitch, YouTube & Kick

Transparent, always-on-top multistream chat overlay for streamers.
Floats Twitch, YouTube, and Kick live chat over any game or stream in a
borderless Electron window — an OBS browser-source alternative that works
with any streaming software (OBS Studio, Streamlabs, XSplit) or none at all.

![Electron 44](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)
![Vite 7](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-supported-blue?logo=windows&logoColor=white)
![CI](https://github.com/hikashakatsunori/stream_chat_overlay/actions/workflows/ci.yml/badge.svg)
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
- **In-app setup** — no config files to edit: enter your widget URL once via the
  panel's gear icon; it is stored in a local settings file and loaded on every start.
- **Auto-update** — packaged builds check GitHub Releases on boot and apply on
  the next start (dev builds skip the check).
- **Portable mode** — copy the app folder anywhere and drop an empty
  `portable.flag` file next to the exe: all app data (settings db, logs,
  widget session) is stored inside the folder instead of `%AppData%`, so
  nothing is written to the machine outside it.
- **Private by design** — messages exist only in memory; the widget session id
  stays in a local config file on your machine, never synced or logged.

## Requirements

- Windows 10/11
- [Node.js](https://nodejs.org) 18 or later (for running from source)
- A free [BotRix](https://botrix.live) account with Twitch, YouTube,
  and Kick connected

## Quick Start

**Option A — installer scripts (recommended):**

1. Double-click `install.bat`. It verifies Node 18+, installs dependencies,
   and runs the test suite.
2. Double-click `start.bat` to launch.
3. Click the gear (settings) icon in the panel and enter your BotRix
   widget URL (see Configuration).
4. Restart the app — the widget loads on the next startup.

**Option B — manual:**

```bash
git clone https://github.com/hikashakatsunori/stream_chat_overlay.git
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

3. Launch the app and click the **gear icon** in the panel's top bar.
   Paste the **entire link as-is** into the text field and press **Enter**.
   The app extracts the `?bid=` session id, drops the display params
   (theme/sound — the panel manages those itself), and stores the clean
   URL in a local settings file (`botrix-config.json` in
   `%AppData%/Hikasha Chat`).
4. Restart the app — the widget loads on the next startup.

The panel's **Change** button loads the saved URL back into the field for
editing; **Enter** validates and saves whatever is in the field. Empty or
invalid URLs are rejected with a specific message (missing `?bid=`,
non-https, wrong host, invalid characters).

> **Security note:** the `?bid=` value is a private session identifier.
> Do not share the link. It is stored only in the local settings file on
> your machine — never committed, never synced, never logged. If a bid is
> exposed, regenerate the widget URL in BotRix and re-enter it via the
> gear icon.

## Usage

| Control | Behavior |
| --- | --- |
| Pin button | Toggle always-on-top |
| Transparency button | Switch between glass and solid themes |
| Gear button | Widget URL settings: enter / change the BotRix widget URL |
| Close button | Quit the application |
| Tray icon | Show/Hide panel, Quit |

Window position, size, pin state, and theme persist between sessions in
`%AppData%/Hikasha Chat/overlay-state.json`.

## Uninstall & Portability

**Installed via the Setup exe:** uninstall from Windows Settings → Apps
("Hikasha Chat"). The uninstaller removes the install folder, shortcuts,
and the registry entry, and also deletes the app's data folder
(`%AppData%/Hikasha Chat` — window state, settings db with the widget
URL, logs, and the widget session cache). Electron's own updater cache
(`%LocalAppData%/chat-overlay-frontend-updater`, a few KB) is the only
trace that remains.

**Portable:** copy `win-unpacked/` (or any install folder) anywhere, drop
an empty `portable.flag` file next to `Hikasha Chat.exe`, and run it —
every file the app writes (settings db, logs, widget session, window
state) stays inside that folder's `app-data/`. Delete the folder and the
app is gone completely; nothing is written to the machine outside it.

## Development

```bash
npm test        # syntax checks + unit + property + behavioral tests + build + E2E
npm run lint    # syntax checks + unit/property/behavioral tests (no build)
npm run dist:win  # Windows NSIS installer, output to release/
```

Test layers:

- **Unit** (`tests/state-utils.test.js`) — pure helpers: state/config
  validation, URL/bid diagnosis, canonicalization, viewer parsing, and
  wiring contracts across the three layers.
- **Property** (`tests/property.test.js`, fast-check) — whole-input-domain
  properties: the allowlist never allows non-botrix hosts for any string,
  sanitization never emits NaN/out-of-range dims, canonical output keeps
  only `?bid=`, counts map to `max(0, N)`.
- **Behavioral** (`tests/main-process.test.js`) — the real main process
  against a stubbed Electron + real temp settings db: save, unchanged,
  rejections, sender gating, corrupt-db fallback.
- **E2E** (`tests/e2e.test.js`, Playwright Electron) — boots the real app
  against an isolated userData dir and drives the actual UI: first-run
  setup card, gear/Enter/Change flow, restart-load, X-button termination.

| Path | Responsibility |
| --- | --- |
| `electron/main.js` | Window management, tray, viewer polling, error reporting, config diagnosis, settings db |
| `electron/state-utils.js` | Tested helpers: state/config validation, URL/bid/viewer logic |
| `electron/chat-preload.js` | Minimal IPC bridge exposed to the renderer |
| `electron/launch.js` | Process launcher (strips `ELECTRON_RUN_AS_NODE`) |
| `src/chat.js`, `chat.html` | Panel UI, setup card, settings panel, error display |
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
- Chat content is never written to disk; the widget URL is stored only in
  the local settings file (`botrix-config.json` in `%AppData%`). Unexpected
  errors are logged and surfaced in the panel rather than failing silently.

## Troubleshooting

| Symptom | Cause | Resolution |
| --- | --- | --- |
| Setup card: No widget URL saved | Fresh install | Click the gear icon, paste the widget URL, press Enter, restart |
| Setup card: missing `?bid=` | Truncated URL | Re-copy the complete link from BotRix, re-enter via the gear icon |
| `widget failed to load (timeout)` | Invalid bid or offline | Verify the URL and connection, then restart |
| Viewer counts dimmed at 0 | BotRix unreachable | Automatic recovery with exponential backoff |
| `panel bridge unavailable` | Preload failure | Restart; reinstall if the problem persists |

## License

MIT — see [LICENSE](LICENSE) for details.
