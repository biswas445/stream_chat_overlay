/**
 * Electron main process (chat-panel-only build): a borderless, transparent,
 * always-on-top CHAT PANEL window — an exact extraction of the multistream
 * chat panel from the ai_vtuber overlay, with no character window and no
 * voice backend.
 *
 * - The panel page (chat.html + chat.js) is byte-identical to the original
 *   project's; every IPC channel it uses is registered here unchanged.
 * - The panel embeds the official BotRix multistream widget (twitch,
 *   youtube AND kick) in an iframe; the main process themes it via
 *   frame.executeJavaScript (same injected CSS + observer as the original).
 * - Viewer counts are REST-polled from BotRix and pushed to the header.
 * - Bounds, pin and transparency state persist in overlay-state.json.
 */

const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  net,
  Tray,
  Menu,
  nativeImage,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Resource resolution supports both checkouts: this repo's own layout
// (electron/ sits at the repository root) and the legacy one where the app
// lived in a frontend/ subfolder of a larger project.
const RESOURCE_ROOTS = [
  path.join(__dirname, '..'),
  path.join(__dirname, '..', '..'),
];

function firstExisting(paths) {
  return paths.find((p) => fs.existsSync(p)) || null;
}

let chatWin = null;
let splashWin = null;
let tray = null;

const chatState = {
  x: null,
  y: null,
  w: 340,
  h: 480,
  pinned: true,
  transparent: true,
};

// Chat messages themselves are NEVER stored anywhere: no buffer, no disk,
// no database — they exist only inside the panel window's DOM while it is
// open, and die with it when it closes.

/* ------------------------------------------------------------------ state */

function stateFile() {
  return path.join(app.getPath('userData'), 'overlay-state.json');
}

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (saved.chat && typeof saved.chat === 'object') {
      Object.assign(chatState, saved.chat);
    }
  } catch {
    /* first run */
  }
}

let saveTimer = null;
function writeState() {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify({ chat: chatState }, null, 2));
  } catch (err) {
    console.error('[state] failed to save:', err.message);
  }
}
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeState();
  }, 250);
}

/* ------------------------------------------------------------------ tray */

/** Tray icon: the application logo, resized for the tray. Falls back to a
 * small accent-colored dot (same technique as the original project's
 * tray icon) when the logo file is missing or unreadable. */
function createTrayIcon() {
  const logoPath = firstExisting(
    RESOURCE_ROOTS.map((root) => path.join(root, 'public', 'chat-logo.png')),
  );
  if (logoPath) {
    const img = nativeImage.createFromPath(logoPath);
    if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
  }
  // 16x16 terracotta dot, drawn as raw BGRA (createFromBitmap is
  // Windows-only, which is the only platform this overlay targets).
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const r = 7.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > r) continue;
      buf[i + 0] = 0x57; // B
      buf[i + 1] = 0x77; // G
      buf[i + 2] = 0xd9; // R
      buf[i + 3] = d > r - 1 ? Math.round(255 * (r - d)) : 255;
    }
  }
  if (typeof nativeImage.createFromBitmap === 'function') {
    return nativeImage.createFromBitmap(buf, { width: size, height: size });
  }
  return nativeImage.createEmpty();
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Show chat panel',
      enabled: !(chatWin && !chatWin.isDestroyed()),
      click: () => setChatOpen(true),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Hikasha Chat');
  tray.setContextMenu(buildTrayMenu());
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

/* --------------------------------------------------------------- splash */

/** The startup splash: the application logo centered on the screen in a
 * themed card (same look as the panel), with a breathing halo, spinning
 * accent ring, and loading dots — dismissed by the main process once the
 * chat panel's widget is confirmed up, or after a fixed cap. */
function createSplashWindow() {
  const display = screen.getPrimaryDisplay();

  splashWin = new BrowserWindow({
    width: 300,
    height: 300,
    x: display.workArea.x + Math.round((display.workArea.width - 300) / 2),
    y: display.workArea.y + Math.round((display.workArea.height - 300) / 2),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // Pure decoration: never steal focus or intercept clicks — the panel
  // behind it must stay usable the whole time the splash is up.
  splashWin.setIgnoreMouseEvents(true);

  splashWin.once('ready-to-show', () => {
    splashWin.show();
    // Windows: show() can re-register a taskbar button even with
    // skipTaskbar:true in the options — re-assert it after showing.
    splashWin.setSkipTaskbar(true);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    splashWin.loadURL(new URL('splash.html', devUrl).toString());
  } else {
    splashWin.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'splash.html'));
  }

  // Hard cap: the splash is a fixed ~2.5s intro (FL-Studio-style), NOT a
  // wait-for-widget gate — the chat panel is created only when this fires,
  // so the panel never appears in the background behind the logo.
  setTimeout(() => {
    dismissSplash();
    createChatWindow();
  }, 2500);
}

/** Dismiss the splash: fade out via the page's .bye class, then destroy
 * the window after the fade. Idempotent. */
function dismissSplash() {
  if (!splashWin || splashWin.isDestroyed()) return;
  const win = splashWin;
  splashWin = null;
  Promise.resolve(win.webContents.executeJavaScript('document.body.classList.add("bye")', true))
    .catch(() => {})
    .finally(() => setTimeout(() => win.destroy(), 400));
}

/* ----------------------------------------------------------- chat panel --- */

/**
 * The multistream chat panel: a SEPARATE frameless window. Styled by its
 * own page (chat.html) to match the companion theme. Features per panel:
 *   - header drag handle moves it, window edges resize it (native resizable)
 *   - pin button: always-on-top overlay mode, like the character window
 *   - transparency button: translucent glass vs solid background
 *   - the BotRix multistream widget iframe renders live messages itself
 * Bounds persist in the shared state file (chatState) across restarts.
 */
function createChatWindow() {
  const display = screen.getPrimaryDisplay();

  const w = Math.max(240, Math.round(chatState.w));
  const h = Math.max(320, Math.round(chatState.h));
  let x;
  let y;
  if (Number.isFinite(chatState.x) && Number.isFinite(chatState.y)) {
    // Clamp into the display NEAREST the saved spot, not the primary: a
    // panel saved on a secondary monitor must restore there, and a spot
    // saved on a monitor that is no longer attached snaps to the nearest
    // real display (the same rule the character window's clampToDisplay
    // uses). max() on the outside: a window wider/taller than the
    // display's work area anchors at its top-left corner instead of being
    // pushed off-screen (area.x + area.width - w goes negative there).
    const area = screen.getDisplayNearestPoint({
      x: chatState.x,
      y: chatState.y,
    }).workArea;
    x = Math.max(area.x, Math.min(chatState.x, area.x + area.width - w));
    y = Math.max(area.y, Math.min(chatState.y, area.y + area.height - h));
  } else {
    x = Math.round(display.workArea.x + 24);
    y = Math.round(display.workArea.y + 24);
  }

  chatWin = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 240,
    minHeight: 320,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true, // the chat card wants its soft shadow
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: chatState.pinned,
    roundedCorners: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'chat-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The panel embeds the BotRix widget iframe — webview/iframe needs
      // this ON for the remote page to run its scripts inside Electron.
      backgroundThrottling: false,
    },
  });

  if (chatState.pinned) chatWin.setAlwaysOnTop(true, 'screen-saver');

  chatWin.once('ready-to-show', () => {
    chatWin.show();
    // Windows: show() can re-register a taskbar button even with
    // skipTaskbar:true in the options — re-assert it after showing.
    chatWin.setSkipTaskbar(true);
  });

  // TEMP-DIAG: forward the widget frame's console to the app console so
  // one row's real HTML can be inspected. Attached BEFORE load so nothing
  // is missed. Single-argument form: the legacy (event, level, message, ...)
  // signature is deprecated and leaves `message` undefined on current
  // Electron (the relay would never fire).
  chatWin.webContents.on('console-message', (event) => {
    const msg = String(event.message || '');
    if (msg.includes('[hik-diag]')) {
      console.log('[chat-frame]', msg.slice(0, 900));
    }
  });

  chatWin.on('moved', () => {
    if (!chatWin) return;
    const [wx, wy] = chatWin.getPosition();
    chatState.x = wx;
    chatState.y = wy;
    saveState();
  });
  chatWin.on('resized', () => {
    if (!chatWin) return;
    const [ww, wh] = chatWin.getSize();
    chatState.w = ww;
    chatState.h = wh;
    saveState();
  });
  chatWin.on('closed', () => {
    chatWin = null;
    saveState();
    // Panel closed = hide to tray: the app stays alive there (this is a
    // tray-resident app — no taskbar presence at all), reopenable from
    // the tray menu's "Show chat panel".
    refreshTray();
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    chatWin.loadURL(new URL('chat.html', devUrl).toString());
  } else {
    chatWin.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'chat.html'));
  }

  // viewer counts: poll while the panel is open, stop when it closes
  startViewerPolling();
  chatWin.once('closed', () => stopViewerPolling());

  chatWin.webContents.once('did-finish-load', () => {
    // Theme the embedded BotRix widget (panel-matched look) once its frame
    // appears — the iframe loads after the panel page, so poll briefly.
    // Keep injecting until the widget frame is up AND has rendered real
    // chat rows (the styling — and the one-shot structure diagnostic —
    // must land on actual messages), then stop: the injected
    // MutationObserver keeps normalizing rows that arrive later, and
    // re-theming is redone on demand by the transparency toggle. The 30 s
    // cap ends the poll for widgets that never load at all.
    const frameTimer = setInterval(() => {
      if (!chatWin || chatWin.isDestroyed()) {
        clearInterval(frameTimer);
        return;
      }
      if (!injectChatWidgetStyle()) return; // widget frame not up yet
      widgetHasChatRows()
        .then((hasRows) => {
          if (!hasRows) return; // keep polling until real messages exist
          clearInterval(frameTimer);
          injectChatWidgetStyle(); // one final injection, then stop
        })
        .catch(() => {});
    }, 1500);
    setTimeout(() => clearInterval(frameTimer), 30000);
    chatWin.once('closed', () => clearInterval(frameTimer));
  });
}

function setChatOpen(open) {
  if (open && !chatWin) {
    createChatWindow();
  } else if (!open && chatWin) {
    chatWin.close(); // 'closed' handler clears state
    return;
  }
}

/** The BotRix multistream widget URL for the chat panel's iframe — the
 * exact page an OBS browser source loads. Configured once in .env at the
 * app root (single config location for this standalone panel); the legacy
 * parent-of-app-root location is checked too. */
function getBotrixWidgetUrl() {
  for (const root of RESOURCE_ROOTS) {
    try {
      const envText = fs.readFileSync(path.join(root, '.env'), 'utf8');
      const m = envText.match(/^\s*BOTRIX_WIDGET_URL\s*=\s*(.+)$/m);
      let url = m ? m[1].trim() : '';
      if (url.startsWith('"') && url.endsWith('"')) url = url.slice(1, -1);
      if (url.startsWith("'") && url.endsWith("'")) url = url.slice(1, -1);
      if (url) return url;
    } catch {
      /* no .env at this root — try the next */
    }
  }
  return null;
}

/* -------------------------------------------------- viewer counts --- */

// BotRix's viewers widget uses plain REST polling (decoded from their
// bundle): /api/widgets/viewers?platform=X&bid=Y returns the live count
// per platform. We poll the same endpoint from the main process and push
// the counts to the chat panel's header — same bid, same session.
const VIEWER_POLL_S = 30; // the widget's own cadence
let viewerTimer = null;

async function fetchPlatformViewers(bid, platform) {
  try {
    const url = `https://botrix.live/api/widgets/viewers?platform=${platform}&bid=${bid}`;
    // NOTE: no Referer header. A custom Referer is a fetch-spec forbidden
    // header that Electron's network service rejects outright in some
    // contexts (ERR_BLOCKED_BY_CLIENT — the whole poll fails with it), and
    // the live endpoint returns the identical body without it (verified:
    // {"viewerCount":N,"ok":...} both ways), so it was never needed. The
    // browser UA stays — plain net.fetch sends the Electron UA otherwise.
    const res = await net.fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const n = Number(data && data.viewerCount);
    return Number.isFinite(n) && n > 0 ? n : 0; // -1 (offline) and 0 read as 0
  } catch {
    return 0;
  }
}

/** Poll all platforms' viewer counts and push them to the chat panel.
 * Failure of any platform just reads as 0 — the poller never crashes. */
async function pollViewerCounts() {
  const bid = getBotrixBid();
  if (!bid) return;
  const [twitch, youtube, kick] = await Promise.all([
    fetchPlatformViewers(bid, 'twitch'),
    fetchPlatformViewers(bid, 'youtube'),
    fetchPlatformViewers(bid, 'kick'),
  ]);
  const total = twitch + youtube + kick;
  const payload = { total, twitch, youtube, kick };
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send('chat:viewers', payload);
  }
}

/** Extract the bid from the configured widget URL (single source of truth:
 * BOTRIX_WIDGET_URL carries the session id). */
function getBotrixBid() {
  const url = getBotrixWidgetUrl();
  if (!url) return null;
  const m = url.match(/[?&]bid=([^&]+)/);
  return m ? m[1] : null;
}

function startViewerPolling() {
  if (viewerTimer) return;
  pollViewerCounts(); // immediate first count
  viewerTimer = setInterval(pollViewerCounts, VIEWER_POLL_S * 1000);
}

function stopViewerPolling() {
  if (viewerTimer) {
    clearInterval(viewerTimer);
    viewerTimer = null;
  }
}

/* ------------------------------------------- chat widget panel-theme --- */

// Platform icon paths (24x24 library shapes, same as the old panel used).
const CHAT_ICON_PATHS = {
  youtube:
    'M23 7.3c-.3-1-1-1.8-2-2C19.2 4.8 12 4.8 12 4.8s-7.2 0-9 .5c-1 .2-1.7 1-2 2C.5 9 .5 12 .5 12s0 3 .5 4.7c.3 1 1 1.8 2 2 1.8.5 9 .5 9 .5s7.2 0 9-.5c1-.2 1.7-1 2-2 .5-1.7.5-4.7.5-4.7s0-3-.5-4.7zM9.8 15.5v-7l6.2 3.5-6.2 3.5z',
  twitch:
    'M4.3 3 3 6.2v13.2h4.6L10.3 22h2.4l2.7-2.6h4.2L22 15V3H4.3zm15.4 11.2-2.6 2.5h-4.2l-2.7 2.6v-2.6H7V4.8h12.7v9.4zM11 8.4h1.8v5H11V8.4zm4.7 0h1.8v5h-1.8v-5z',
  kick:
    'M5 3h4v4h2V5h2V3h6v4h-2v2h2v4h-2v2h2v6h-6v-2h-2v-2H9v2H5V3z',
};

/** Build the panel-theme CSS injected into the embedded BotRix frame —
 * makes the messages look like the OLD panel: Segoe UI 12.5px pills that
 * hug their content, bold usernames, library platform icons, faint
 * zebra rows. Text color follows the panel mode: WHITE text (with soft
 * dark shadow for readability over any background) in transparent/glass
 * mode, BLACK text in solid mode — usernames included, no other colors. */
function buildChatWidgetCss() {
  const light = chatState.transparent; // glass mode -> white text
  const fg = light ? '#ffffff' : '#000000';
  const pill = light ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.045)';
  const zebra = light ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.07)';
  const shadow = light ? '0 1px 3px rgba(0,0,0,0.7)' : 'none';
  const thumb = light ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.18)';
  const svg = (d) =>
    `url("data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='${fg}'><path d='${d}'/></svg>`
    )}")`;
  const iconRow = (cls, platform) => `
    .chatMsg.hik-pl-${cls}::before {
      content: ${svg(CHAT_ICON_PATHS[platform])} !important;
      display: inline-block !important;
      width: 16px !important; height: 16px !important;
      margin-right: 3px !important; vertical-align: -3px !important;
      background-repeat: no-repeat !important; background-size: contain !important;
    }`;
  return `
    *, *::before, *::after { color: ${fg} !important; text-shadow: ${shadow} !important; }
    img, video { filter: grayscale(1) !important; }
    /* strip the widget's own platform favicons; rows are tagged hik-pl-* */
    img.badge { display: none !important; }
    /* message container: rows stack from the TOP (old panel behavior),
       full width so every pill lines up — padded off the panel borders */
    #chatlist {
      display: flex !important;
      flex-direction: column !important;
      justify-content: flex-start !important;
      height: 100% !important;
      overflow-y: auto !important;
      padding: 4px 10px 10px 12px !important;
      box-sizing: border-box !important;
    }
    .chatMsg {
      font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif !important;
      font-size: 12.5px !important;
      line-height: 1.45 !important;
      background-color: ${pill} !important;
      border-radius: 10px !important;
      padding: 4px 10px !important;
      margin: 0 0 2px 0 !important;
      width: fit-content !important;
      max-width: 100% !important;
      min-width: 0 !important;
      box-sizing: border-box !important;
      flex: 0 0 auto !important;
      text-align: left !important;
      word-wrap: break-word !important; overflow-wrap: anywhere !important;
    }
    .chatMsg:nth-child(even) { background-color: ${zebra} !important; }
    /* message inner text: same size as the old panel — the widget ships
       larger; normalize ALL message text spans inside the row */
    .chatMsg, .chatMsg * {
      font-size: 12.5px !important;
      line-height: 1.45 !important;
    }
    /* Rebuilt rows (see the normalizer): EXACT old-panel format —
       [icon] <b>name:</b> message. Bold lives ONLY on .hik-name; the colon
       (.hik-sep) and message (.hik-msg) are forced to regular weight so
       the widget's own b/strong inheritance can never leak boldness. */
    .chatMsg .hik-name {
      font-weight: 700 !important;
      color: ${fg} !important;
      font-size: 12.5px !important;
      margin: 0 !important;
    }
    .chatMsg .hik-sep,
    .chatMsg .hik-msg,
    .chatMsg .hik-msg *,
    .chatMsg .hik-msg b,
    .chatMsg .hik-msg strong {
      font-weight: 400 !important;
    }
    /* hide the widget's scrollbar entirely (mouse wheel still scrolls) */
    #chatlist::-webkit-scrollbar { width: 0 !important; display: none !important; }
    #chatlist { scrollbar-width: none !important; -ms-overflow-style: none !important; }
    /* donation/redemption rows keep their native DOM — bold their names
       through the widget's own .name class there */
    .chatMsg .name {
      font-weight: 700 !important;
      color: ${fg} !important;
      font-size: 12.5px !important;
      margin-left: 0 !important;
    }
    .chatMsg .user, .chatMsg .link { color: ${fg} !important; font-weight: 400 !important; }
    ${iconRow('youtube', 'youtube')}
    ${iconRow('twitch', 'twitch')}
    ${iconRow('kick', 'kick')}
    ::-webkit-scrollbar-thumb { background: ${thumb} !important; border-radius: 8px; }
    ::-webkit-scrollbar { width: 8px; }
  `;
}

/** Runs INSIDE the widget frame: normalizes every message row into the
 * EXACT old-panel format regardless of the widget's internal markup:
 *
 *   <icon> <b>name:</b> message
 *
 * Extraction notes (measured from the live widget):
 *   - kick rows NEST the .message element INSIDE the .name element, so
 *     name.textContent alone reads "username message". The name text is
 *     extracted from a clone with .message/.badges stripped, plus an
 *     endsWith fallback for bare text nodes.
 *   - no permanent skip flag: if the widget re-renders a row (emotes,
 *     updates), .name/.message reappear and the row is re-normalized —
 *     the observer wins the render war by always converging to our format.
 *   - rows without .name/.message (already rebuilt, system rows) are
 *     naturally skipped.
 *   - donation/redemption rows keep their native layouts.
 */
function buildChatWidgetObserverJs() {
  return `(() => {
    const PLATFORMS = {
      youtube: /youtube|ytimg|gstatic/,
      twitch: /twitch|jtvnw/,
      kick: /kick/,
    };
    const seen = [];
    const normalize = (row) => {
      if (!row || !row.classList) return;
      if (row.querySelector('.donation-container, .redemption-container, [class*="gift"]')) return;
      const nameEl = row.querySelector('.name');
      const msgEl = row.querySelector('.message');
      if (!nameEl || !msgEl) return; // rebuilt already / not a chat row

      // platform icon tag (before the badge is hidden by CSS/rebuild)
      const badge = row.querySelector('img.badge');
      const src = badge ? (badge.src || '') : '';
      const cls = row.className || '';
      let platform = '';
      for (const [pl, re] of Object.entries(PLATFORMS)) {
        if (re.test(src) || cls.includes(pl)) { row.classList.add('hik-pl-' + pl); platform = pl; break; }
      }
      if (!platform) platform = (cls.match(/hik-pl-(\\w+)/) || [])[1] || '';

      // username text WITHOUT the message: clone the name, strip nested
      // .message/.badges/img (kick nests them), read the remainder
      const nameClone = nameEl.cloneNode(true);
      nameClone.querySelectorAll('.message, .badges, img, span[class*="name"]').forEach((n) => n.remove());
      let nameText = (nameClone.textContent || '').trim();
      const msgText = (msgEl.textContent || '').trim();
      // fallback: message still trailing in the name text (bare text node)
      if (msgText && nameText.endsWith(msgText)) {
        nameText = nameText.slice(0, nameText.length - msgText.length).trim();
      }
      if (!nameText) nameText = (nameEl.textContent || '').trim().replace(msgText, '').trim();
      if (!nameText || !msgText) return;

      const msgKids = [...msgEl.childNodes];

      row.textContent = '';
      const name = document.createElement('span');
      name.className = 'hik-name';
      name.textContent = nameText;
      const sep = document.createElement('span');
      sep.className = 'hik-sep';
      sep.textContent = ': ';
      const msg = document.createElement('span');
      msg.className = 'hik-msg';
      msg.append(...msgKids);
      row.append(name, sep, msg);
    };
    const scan = () => document.querySelectorAll('.chatMsg').forEach(normalize);
    scan();
    if (!window.__hikObs) {
      window.__hikObs = new MutationObserver(() => scan());
      window.__hikObs.observe(document.body, { childList: true, subtree: true });
    }
  })()`;
}

/** Inject (or re-theme) the panel-theme style + platform tagger inside the
 * embedded BotRix widget frame. The panel window is the embedder, so it may
 * script the cross-origin frame. Re-running replaces the same style tag, so
 * the transparency toggle re-themes the widget live.
 * Returns true when the widget frame was found and injected into. */
function injectChatWidgetStyle() {
  if (!chatWin || chatWin.isDestroyed()) return false;
  const css = buildChatWidgetCss();
  const observerJs = buildChatWidgetObserverJs();
  // TEMP-DIAG: dump the LAST row's full structure (children tags + classes)
  // so the username/message selectors match the real DOM, not guesses.
  const diagJs = `(() => {
    const rows = document.querySelectorAll('.chatMsg');
    if (rows.length && !window.__hikDiagDone) {
      window.__hikDiagDone = true;
      const r = rows[rows.length - 1];
      const shape = (el, d) => {
        const kids = [...el.children].map((c) => shape(c, d + 1)).join(' ');
        return '<' + el.tagName.toLowerCase() + (el.className ? ' class=' + JSON.stringify(el.className) : '') + '>' + (kids ? ' [' + kids + ']' : '"' + (el.textContent || '').slice(0, 40) + '"');
      };
      console.log('[hik-diag] row:', shape(r, 0));
    }
  })()`;
  const code = `(() => {
    const id = 'hikasha-widget-style';
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('style'); el.id = id; }
    el.textContent = ${JSON.stringify(css)};
    (document.head || document.documentElement).appendChild(el);
    ${observerJs}
    ${diagJs}
  })()`;
  let frames = [];
  try {
    frames = chatWin.webContents.mainFrame.frames;
  } catch {
    return false;
  }
  let injected = false;
  for (const frame of frames) {
    if (frame && frame.url && frame.url.includes('botrix.live')) {
      injected = true;
      Promise.resolve(frame.executeJavaScript(code, false)).catch(() => {});
    }
  }
  return injected;
}

/** True when the embedded BotRix widget frame has rendered at least one
 * real chat row (.chatMsg) — the "widget is fully up" stop condition for
 * the styling poll. Resolves false when the frame isn't up yet (or on any
 * error: keep polling until the 30 s cap). */
async function widgetHasChatRows() {
  if (!chatWin || chatWin.isDestroyed()) return false;
  let frames = [];
  try {
    frames = chatWin.webContents.mainFrame.frames;
  } catch {
    return false;
  }
  for (const frame of frames) {
    if (frame && frame.url && frame.url.includes('botrix.live')) {
      try {
        const rows = await frame.executeJavaScript(
          'document.querySelectorAll(".chatMsg").length',
          false,
        );
        if (Number(rows) > 0) return true;
      } catch {
        /* frame navigated away mid-probe — keep polling */
      }
    }
  }
  return false;
}

/* -------------------------------------------------------------------- ipc */

function registerIpc() {
  ipcMain.handle('chat:toggle-pin', () => {
    chatState.pinned = !chatState.pinned;
    if (chatWin) chatWin.setAlwaysOnTop(chatState.pinned, 'screen-saver');
    saveState();
    refreshTray();
    return chatState.pinned;
  });

  ipcMain.handle('chat:toggle-transparent', () => {
    chatState.transparent = !chatState.transparent;
    saveState();
    // re-theme the embedded widget live (white <-> black text)
    injectChatWidgetStyle();
    refreshTray();
    // true = now OPAQUE (transparent off) — the renderer styles accordingly
    return !chatState.transparent;
  });

  ipcMain.handle('chat:get-state', () => ({
    pinned: chatState.pinned,
    transparent: chatState.transparent,
    // NOTE: no `connected`/`recent` fields — the chat-reader pipeline was
    // removed (the panel embeds the BotRix widget, which manages its own
    // connection); those legacy fields would always read as dead values.
  }));

  // The BotRix widget URL for the panel's iframe (from BOTRIX_WIDGET_URL).
  ipcMain.handle('chat:get-widget-url', () => getBotrixWidgetUrl());

  // Panel close button — same path as toggling off from the character menu.
  ipcMain.on('chat:close', () => {
    setChatOpen(false);
  });
}

/* ------------------------------------------------------------------ boot */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (chatWin) chatWin.show();
    else setChatOpen(true); // tray-resident: a relaunch re-opens the panel
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('ai-assistant.chat-overlay');

    loadState();
    registerIpc();
    // FL-Studio-style intro: ONLY the logo splash first (~2.5s, screen
    // center, animated) — no chat panel behind it. When the timer fires
    // the splash fades out and the panel is created then, so the panel
    // never appears in the background while the logo is up.
    createSplashWindow();
    createTray();
  });

  app.on('window-all-closed', () => {
    // Tray-resident app: with the tray holding presence, closing every
    // window must NOT quit — the panel is reopened from the tray. The app
    // only exits via tray -> Quit.
  });

  // Flush a pending (debounced) state save so the last window position is
  // not lost when the app quits within the debounce window.
  app.on('before-quit', () => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
      writeState();
    }
  });
}
