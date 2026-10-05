<div align="center">

# 💬 Hikasha Chat

### Transparent multistream chat overlay for Twitch, YouTube & Kick

Float your live chat over any game or stream in a borderless,
always-on-top panel — no OBS required.

![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-supported-blue?logo=windows&logoColor=white)
![CI](https://github.com/biswas445/stream_chat_overlay/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

</div>

---

## ✨ What it does

| Feature | Details |
| --- | --- |
| 🌐 Multistream chat | Twitch + YouTube + Kick in one scroll, via your [BotRix](https://botrix.live) widget |
| 🪟 True transparency | Glass mode floats over gameplay; one click switches to a solid card |
| 📌 Always on top | Pin the panel above everything while you play |
| 👁️ Viewer counts | Live per-platform pills in the header, refreshed every 30 s |
| 🖱️ Frameless & movable | Drag the header, resize from edges — position is remembered |
| 🎨 Themed messages | Pill rows, bold names, platform icons, zebra stripes |
| 🔔 Tray app | No taskbar clutter — Show/Hide and Quit from the tray |
| 🔒 Private | Messages live only in memory; your `?bid=` stays in your local `.env` |

---

## 🚀 Get started (5 minutes)

### 1. Install

| Method | Steps |
| --- | --- |
| **Easy** | Double-click **`install.bat`** → it checks Node 18+, installs everything, creates `.env`, and self-tests |
| **Manual** | `git clone https://github.com/biswas445/stream_chat_overlay.git` → `npm install` → `npm start` |

Requires **[Node.js 18+](https://nodejs.org)** and a free [BotRix](https://botrix.live) account.

### 2. Connect your BotRix widget

1. Log in at [botrix.live](https://botrix.live) and **link Twitch, YouTube and Kick**.
2. Open **Widgets** (left sidebar) → **Chat Overlay** → scroll down and **copy the link**.
3. Paste the **whole link as-is** into `.env`:

   ```dotenv
   BOTRIX_WIDGET_URL="https://botrix.live/widgets/chat/?bid=YOUR_BID&theme=default&..."
   ```

   > No trimming needed — the app keeps only your `?bid=` internally.
   > 🔐 **Never share this link.** The `?bid=` is your private session id.
   > If it leaks, regenerate it in BotRix.

### 3. Launch

Double-click **`start.bat`** — the splash shows, then your chat panel appears.
Drag it where you like; it reopens there next time.

---

## 🛠️ Controls

| Button | Action |
| --- | --- |
| 📌 Pin | Toggle always-on-top |
| ◯ Transparency | Switch glass ↔ solid |
| ✕ Close | Quit the app (reopen with `start.bat` or the tray) |

Right-click the **tray icon** for Show/Hide and Quit.

---

## 🧰 For contributors

```bash
npm test       # syntax + 16 unit tests + production build
npm run lint   # syntax + unit tests (no build)
npm run dist:win  # Windows installer into release/
```

| Path | Role |
| --- | --- |
| `electron/main.js` | Windows, tray, viewer poller, error reporting |
| `electron/state-utils.js` | Tested parsing helpers (state, `.env`, URL, viewers) |
| `electron/chat-preload.js` | Minimal secure IPC bridge |
| `src/chat.js` + `chat.html` | Panel UI, setup card, error display |
| `tests/state-utils.test.js` | Unit suite — must stay green |
| `install.bat` / `start.bat` | Installer / launcher with preflight checks |

Security model: `contextIsolation` + `sandbox` on, `nodeIntegration` off;
widget host allow-listed to `botrix.live` (main + renderer + CSP);
popups denied, no permissions granted, isolated session partition.

---

## ❓ Troubleshooting

| You see | Why | Fix |
| --- | --- | --- |
| Setup card: `.env file not found` | Fresh install | `copy .env.example .env`, paste your link |
| Setup card: `missing ?bid=` | Truncated URL | Re-copy the **full** link from BotRix |
| `widget failed to load (timeout)` | Bad bid or offline | Check the link and connection, restart |
| Dimmed viewer pills at 0 | BotRix unreachable | Automatic — recovers with backoff |
| `panel bridge unavailable` | Preload failed | Restart; reinstall if it persists |

---

## 📄 License

MIT — see [LICENSE](LICENSE).
