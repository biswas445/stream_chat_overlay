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

// Resource resolution: repo layout (electron/ at root), legacy parent
// layout, and packaged install (resources/app) — plus the portable
// exe directory for asset lookup (tray icon).
function resourceRoots() {
  const roots = [path.join(__dirname, '..'), path.join(__dirname, '..', '..')];
  try {
    if (app.isPackaged) {
      roots.unshift(path.dirname(app.getPath('exe')));
      roots.unshift(process.resourcesPath);
    }
  } catch {
    /* app not ready — dev defaults above suffice */
  }
  return roots;
}
const RESOURCE_ROOTS = resourceRoots();

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

const {
  sanitizeChatState,
  sanitizeConfig,
  parseViewerCount,
  extractBotrixBid,
  diagnoseWidgetUrl,
  buildViewerUrlFromWidgetUrl,
} = require('./state-utils');

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (saved.chat && typeof saved.chat === 'object') {
      // Validated allow-list merge (H-02): a corrupt overlay-state.json
      // (NaN/Infinity/strings) can never reach BrowserWindow dims.
      Object.assign(chatState, sanitizeChatState(saved.chat));
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

/* -------------------------------------------------- widget config db --- */

// The BotRix widget URL lives in a JSON settings db in userData —
// botrix-config.json (same proven pattern as overlay-state.json; a real
// DB engine for one key would be unjustified complexity). It is written
// ONLY through the settings UI (chat:save-url, validated + canonicalized
// BEFORE it is stored) and read on every boot; a corrupt file falls back
// to "no URL saved" instead of crashing boot.
function configFile() {
  return path.join(app.getPath('userData'), 'botrix-config.json');
}

function loadBotrixConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    return sanitizeConfig(saved);
  } catch {
    /* no config db yet / unreadable — first run */
    return { widgetUrl: null };
  }
}

function writeBotrixConfig(cfg) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2));
}

/* ------------------------------------------------------------------ tray */

/** Tray icon: the application logo, resized for the tray. Falls back to a
 * small accent-colored dot (same technique as the original project's
 * tray icon) when the logo file is missing or unreadable. */
function createTrayIcon() {
  // Prefer the prebuilt 16px icon (public/tray-icon.png): the 256px logo
  // no longer needs decoding + downscaling on every boot (M-10).
  const roots = resourceRoots();
  const trayPath = firstExisting(
    roots.map((root) => path.join(root, 'public', 'tray-icon.png')),
  );
  if (trayPath) {
    const img = nativeImage.createFromPath(trayPath);
    if (!img.isEmpty()) return img;
  }
  const logoPath = firstExisting(
    roots.map((root) => path.join(root, 'public', 'chat-logo.png')),
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
  const open = Boolean(chatWin && !chatWin.isDestroyed());
  return Menu.buildFromTemplate([
    {
      label: open ? 'Hide chat panel' : 'Show chat panel',
      click: () => setChatOpen(!open),
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
      sandbox: true,
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
  const splashReady = (async () => {
    try {
      if (devUrl) {
        await splashWin.loadURL(new URL('splash.html', devUrl).toString());
      } else {
        await splashWin.loadFile(
          path.join(__dirname, '..', 'dist', 'renderer', 'splash.html'),
        );
      }
      return true;
    } catch (err) {
      console.error('[splash] failed to load:', err.message);
      return false;
    }
  })();

  // Hard cap: the splash is a fixed ~2.5s intro (FL-Studio-style), NOT a
  // wait-for-widget gate. The chat panel is created hidden UP FRONT so a
  // splash load failure can never leave the app windowless (L-01); the
  // timer only dismisses the splash and reveals the ready panel.
  createChatWindow({ hidden: true });
  splashReady.then((ok) => {
    setTimeout(
      () => {
        dismissSplash();
        if (chatWin && !chatWin.isDestroyed()) chatWin.show();
        else createChatWindow();
      },
      ok ? 2500 : 0,
    );
  });
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
function createChatWindow(opts = {}) {
  const { hidden = false } = opts;
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
      sandbox: true,
      // Isolated persistent partition for the widget iframe (H-05): the
      // bid-bearing BotRix session (cookies/cache/storage) never mixes with
      // the default session. Chat messages still live only in DOM.
      partition: 'persist:botrix-chat',
      // The panel embeds the BotRix widget iframe — webview/iframe needs
      // this ON for the remote page to run its scripts inside Electron.
      backgroundThrottling: false,
    },
  });

  if (chatState.pinned) chatWin.setAlwaysOnTop(true, 'screen-saver');

  // Never let embedded widget content open popups or claim permissions:
  // target=_blank / window.open inside the BotRix iframe must not spawn
  // new Electron windows, and no media/fullscreen grants (M-03).
  chatWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // NOTE: session lives on webContents (BrowserWindow has no .session) —
  // wrong handle here crashed boot (TypeError on undefined).
  try {
    chatWin.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) =>
      cb(false),
    );
  } catch (err) {
    reportUnexpected('permissions', err);
  }

  // hidden:true (boot behind splash) defers show() to the splash timer;
  // normal opens (tray reopen) show immediately.
  if (hidden) chatWin.once('ready-to-show', () => chatWin.setSkipTaskbar(true));
  else
    chatWin.once('ready-to-show', () => {
      chatWin.show();
      // Windows: show() can re-register a taskbar button even with
      // skipTaskbar:true in the options — re-assert it after showing.
      chatWin.setSkipTaskbar(true);
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

  // Renderer crash (GPU/OOM/widget blowup): never leave a dead white box —
  // report it and offer the tray reopen path.
  chatWin.webContents.on('render-process-gone', (_e, details) => {
    reportUnexpected('render-gone', new Error(details && details.reason ? `reason=${details.reason}` : 'unknown'));
  });
  chatWin.webContents.on('unresponsive', () => {
    reportUnexpected('unresponsive', new Error('renderer unresponsive'));
  });
  chatWin.webContents.on('did-fail-load', (_e, code, desc, url, _main) => {
    reportUnexpected('panel-load', new Error(`code=${code} desc=${desc} url=${url}`));
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const chatReady = (async () => {
    try {
      if (devUrl) {
        await chatWin.loadURL(new URL('chat.html', devUrl).toString());
      } else {
        await chatWin.loadFile(
          path.join(__dirname, '..', 'dist', 'renderer', 'chat.html'),
        );
      }
      return true;
    } catch (err) {
      reportUnexpected('panel-load', err);
      return false;
    }
  })();
  chatWin.once('closed', () => {
    // swallow: load promise outlives the window on fast close
    chatReady.catch(() => {});
  });

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

/**
 * Full config diagnosis from the persisted settings db (not just the
 * URL): distinguishes every way a configuration can be broken — nothing
 * saved yet, empty value, wrong protocol/host, missing/invalid bid.
 * The renderer renders an actionable setup card per code (pointing at
 * the gear icon); the viewer poller stays silent.
 */
function diagnoseBotrixConfig() {
  const d = diagnoseWidgetUrl(loadBotrixConfig().widgetUrl);
  return { code: d.code, url: d.url, bid: d.bid || null };
}

function getBotrixWidgetUrl() {
  const d = diagnoseBotrixConfig();
  return d.code === 'ok' ? d.url : null;
}

/* -------------------------------------------------- viewer counts --- */

// BotRix's viewers JSON API: /api/widgets/viewers?platform=X&bid=BID
// (verified live: returns {"viewerCount":N} directly — twitch
// {"viewerCount":0,"ok":false}, youtube {"viewerCount":0}, kick
// {"viewerCount":-1} while offline; garbage bid returns an empty body.
// The /widgets/viewers page is client-rendered HTML whose body never
// contains the count — polling it always parsed null, which is why the
// header pills used to stay dimmed at 0). We poll the JSON API per
// platform from the main process and push the parsed counts to the chat
// panel's header — same bid, same session.
const VIEWER_POLL_S = 30; // the widget's own cadence
let viewerTimer = null;

const VIEWER_PLATFORMS = ['twitch', 'youtube', 'kick'];

async function fetchPlatformViewers(widgetUrl, platform) {
  // One request per platform, derived from the USER's saved widget URL:
  //   <base>/api/widgets/viewers?platform=twitch&bid=<bid-from-env>
  //   <base>/api/widgets/viewers?platform=kick&bid=<bid-from-env>
  //   <base>/api/widgets/viewers?platform=youtube&bid=<bid-from-env>
  // Platforms are never comma-joined into one URL. Null when unconfigured.
  const url = buildViewerUrlFromWidgetUrl(widgetUrl, platform);
  if (!url) return null;
  try {
    // 8s abort so a blackholed endpoint can't hang the 30s poll slot.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res;
    try {
      // NOTE: no Referer header. A custom Referer is a fetch-spec forbidden
      // header that Electron's network service rejects outright in some
      // contexts (ERR_BLOCKED_BY_CLIENT — the whole poll fails with it).
      // The browser UA stays — plain net.fetch sends the Electron UA
      // otherwise (the API serves identical JSON to the browser UA,
      // verified live with the same "Mozilla/5.0" header).
      res = await net.fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null; // network-level failure: distinct from 0 viewers
    const text = await res.text();
    return parseViewerCount(text); // null when unparseable: outage, not 0
  } catch {
    return null; // timeout / abort / DNS: caller tracks the streak
  }
}

let viewerFailStreak = 0;
let viewerPollDelayMs = VIEWER_POLL_S * 1000;
// Poll-loop generation: start/stop bump it, so an in-flight poll from a
// previous loop can never reschedule. Without this, a panel closed and
// reopened while a poll's network requests are still outstanding leaves
// TWO live poll chains (the stale tick's `viewerTimer = setTimeout(...)`
// overwrites the variable but does not cancel the old timer) — BotRix
// gets double-polled and backoff state splits across both chains.
let viewerPollGen = 0;

/** Poll all platforms' viewer counts and push them to the chat panel.
 * Failures are signalled explicitly (`error:true`, `stale` after 2+
 * consecutive failures) with exponential backoff up to 5 min — the UI
 * never mistakes an outage for "0 viewers", and a dead endpoint isn't
 * hammered every 30 s forever (M-09). Backoff ladder:
 * 30s → 60s → 120s → 240s → 300s (5-min plateau at streak ≥ 4). */
async function pollViewerCounts() {
  const widgetUrl = getBotrixWidgetUrl();
  if (!widgetUrl || !getBotrixBid()) return; // unconfigured: stay silent
  const [twitch, youtube, kick] = await Promise.all(
    VIEWER_PLATFORMS.map((p) => fetchPlatformViewers(widgetUrl, p)),
  );
  const failures = [twitch, youtube, kick].filter((r) => r === null).length;
  if (failures > 0) {
    viewerFailStreak += 1;
    // Exponent cap 4: 30s * 2^4 = 480s, clamped by the 5-min (300000 ms)
    // ceiling — the plateau the contract above documents. (A cap of 3
    // plateaued at 4 min and made the ceiling unreachable.)
    viewerPollDelayMs = Math.min(
      300000,
      VIEWER_POLL_S * 1000 * 2 ** Math.min(viewerFailStreak, 4),
    );
  } else {
    viewerFailStreak = 0;
    viewerPollDelayMs = VIEWER_POLL_S * 1000;
  }
  const payload = {
    total: (twitch ?? 0) + (youtube ?? 0) + (kick ?? 0),
    twitch: twitch ?? 0,
    youtube: youtube ?? 0,
    kick: kick ?? 0,
    error: failures > 0,
    stale: viewerFailStreak > 1,
  };
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send('chat:viewers', payload);
  }
}

/** Extract the bid from the configured widget URL (single source of truth:
 * the saved widget URL in the settings db carries the session id).
 * Delegates to the tested shared helper (state-utils.js). */
function getBotrixBid() {
  return extractBotrixBid(getBotrixWidgetUrl());
}

function scheduleViewerPoll() {
  if (viewerTimer) return;
  const gen = viewerPollGen;
  const tick = async () => {
    viewerTimer = null;
    await pollViewerCounts();
    if (gen === viewerPollGen && chatWin && !chatWin.isDestroyed()) {
      viewerTimer = setTimeout(tick, viewerPollDelayMs);
    }
  };
  viewerTimer = setTimeout(tick, 0); // immediate first count
}

function startViewerPolling() {
  viewerFailStreak = 0;
  viewerPollDelayMs = VIEWER_POLL_S * 1000;
  viewerPollGen += 1; // invalidate any in-flight poll from a previous loop
  scheduleViewerPoll();
}

function stopViewerPolling() {
  if (viewerTimer) {
    clearTimeout(viewerTimer);
    viewerTimer = null;
  }
  viewerPollGen += 1; // in-flight poll must not reschedule after close
  viewerFailStreak = 0;
  viewerPollDelayMs = VIEWER_POLL_S * 1000;
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
    /* Scoped to chat rows only (M-06): the old global * + grayscale rules
       killed emotes, badges, donation art and links across the widget. */
    .chatMsg, .chatMsg .hik-name, .chatMsg .hik-sep, .chatMsg .hik-msg,
    .chatMsg .name, .chatMsg .user, .chatMsg .link {
      color: ${fg} !important; text-shadow: ${shadow} !important;
    }
    /* strip the widget's own platform favicons; rows are tagged hik-pl-* */
    .chatMsg img.badge { display: none !important; }
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
    /* slim themed scrollbar (was fully hidden: keyboard/touch users lost
       all scroll affordance). Mouse wheel still scrolls either way. */
    #chatlist::-webkit-scrollbar { width: 6px !important; }
    #chatlist::-webkit-scrollbar-thumb { background: ${thumb} !important; border-radius: 8px; }
    #chatlist { scrollbar-width: thin !important; scrollbar-color: ${thumb} transparent !important; }
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
  const code = `(() => {
    const id = 'hikasha-widget-style';
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('style'); el.id = id; }
    el.textContent = ${JSON.stringify(css)};
    (document.head || document.documentElement).appendChild(el);
    ${observerJs}
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

/** Wrap an IPC handler so a throw becomes a logged rejection the
 * renderer's safeInvoke can display — never an unhandled crash. */
function guarded(channel, fn) {
  ipcMain.handle(channel, async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      reportUnexpected(`ipc:${channel}`, err);
      throw err; // renderer safeInvoke turns this into status text
    }
  });
}

function registerIpc() {
  guarded('chat:toggle-pin', () => {
    chatState.pinned = !chatState.pinned;
    try {
      if (chatWin) chatWin.setAlwaysOnTop(chatState.pinned, 'screen-saver');
    } catch (err) {
      reportUnexpected('ipc:toggle-pin:always-on-top', err);
    }
    saveState();
    refreshTray();
    return chatState.pinned;
  });

  guarded('chat:toggle-transparent', () => {
    chatState.transparent = !chatState.transparent;
    saveState();
    // re-theme the embedded widget live (white <-> black text)
    try {
      injectChatWidgetStyle();
    } catch (err) {
      reportUnexpected('ipc:toggle-transparent:inject', err);
    }
    refreshTray();
    // true = now OPAQUE (transparent off) — the renderer styles accordingly
    return !chatState.transparent;
  });

  guarded('chat:get-state', () => ({
    pinned: chatState.pinned === true,
    transparent: chatState.transparent !== false,
    // NOTE: no `connected`/`recent` fields — the chat-reader pipeline was
    // removed (the panel embeds the BotRix widget, which manages its own
    // connection); those legacy fields would always read as dead values.
  }));

  // The BotRix widget URL for the panel's iframe (from the settings db).
  guarded('chat:get-widget-url', () => getBotrixWidgetUrl());

  // Machine-readable config diagnosis for the setup card:
  // { code, url, bid } — code is one of ok|missing|empty|
  // bad-protocol|bad-host|no-bid|bad-bid.
  guarded('chat:get-config-status', () => diagnoseBotrixConfig());

  // Settings UI: validate + persist the BotRix widget URL into the
  // settings db. Returns { ok, code, url?, bid? } — ok:false carries the
  // diagnosis code so the panel can say exactly what was wrong; ok:true
  // code 'unchanged' means the exact same canonical URL was already
  // stored. The URL is canonicalized (only ?bid= kept) BEFORE it is
  // written, so the db only ever holds a clean embeddable https: BotRix
  // URL. Saving does NOT hot-swap the running widget: the next startup
  // reads the db and loads it (the poller picks the new bid up on its
  // next tick either way).
  guarded('chat:save-url', (rawUrl) => {
    const d = diagnoseWidgetUrl(typeof rawUrl === 'string' ? rawUrl.trim() : null);
    if (d.code !== 'ok') return { ok: false, code: d.code, url: d.url };
    const current = loadBotrixConfig().widgetUrl;
    if (current === d.url) {
      return { ok: true, code: 'unchanged', url: d.url, bid: d.bid };
    }
    writeBotrixConfig({ widgetUrl: d.url });
    return { ok: true, code: 'ok', url: d.url, bid: d.bid };
  });

  // Panel X button — explicit user intent to exit the overlay ENTIRELY:
  // no window, no tray, no background process, ever. (Hide-to-tray on X
  // confused users: "X doesn't close the program"; hiding stays available
  // via the tray menu or OS window controls like Alt+F4, which keep the
  // tray alive for reopen.) The close path is hardened so termination is
  // guaranteed even if quit is ever blocked: flush the pending state
  // save, destroy the panel + tray up front, then quit — with a
  // force-exit fallback in case a hung window or future handler ever
  // stops app.quit() from completing.
  ipcMain.on('chat:close', () => {
    try {
      // Flush the debounced save FIRST so the last position/size is never
      // lost — app.exit() below skips before-quit.
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
        writeState();
      }
      // destroy(), not close(): forceful, synchronous, no close-event
      // dance — works even when the renderer is hung or crashed.
      if (chatWin && !chatWin.isDestroyed()) chatWin.destroy();
      if (tray) {
        try {
          tray.destroy();
        } catch {
          /* already gone */
        }
        tray = null;
      }
      app.quit();
      // Belt-and-braces: if quit is ever blocked (hung window, a future
      // before-quit/will-quit preventDefault), force-exit so NO process
      // ever survives the X button. When quit completes, this timer dies
      // with the process and never runs.
      setTimeout(() => {
        try {
          app.exit(0);
        } catch {
          /* process already exiting */
        }
      }, 1500);
    } catch (err) {
      reportUnexpected('ipc:chat:close', err);
      try {
        app.exit(0);
      } catch {
        /* process already exiting */
      }
    }
  });
}

/* --------------------------------------------------- crash safety --- */

// An unexpected throw must never take the whole overlay down silently.
// Log it, keep the tray alive (so the user can reopen/quit), and surface
// it in the open panel when possible instead of a dead window.
function reportUnexpected(where, err) {
  const msg = (err && (err.stack || err.message)) || String(err);
  console.error(`[unexpected:${where}]`, msg);
  try {
    if (chatWin && !chatWin.isDestroyed()) {
      chatWin.webContents.send('chat:error', {
        where: String(where),
        message: String((err && err.message) || err).slice(0, 300),
      });
    }
  } catch {
    /* window gone — tray still alive */
  }
}

process.on('uncaughtException', (err) => reportUnexpected('main', err));
process.on('unhandledRejection', (reason) =>
  reportUnexpected('main-promise', reason),
);

/* ------------------------------------------------------------------ boot */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Focus, not just show: a minimized/background panel must come forward.
    // Guard the splash window: a relaunch during the 2.5s intro must not
    // create a duplicate panel — the boot timer reveals it already.
    if (chatWin && !chatWin.isDestroyed()) {
      if (chatWin.isMinimized()) chatWin.restore();
      chatWin.show();
      chatWin.focus();
    } else if (!splashWin || splashWin.isDestroyed()) {
      setChatOpen(true); // tray-resident: a relaunch re-opens the panel
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('ai-assistant.chat-overlay');

    loadState();
    registerIpc();
    // FL-Studio-style intro: the logo splash (~2.5s, screen center,
    // animated) shows first, and the chat panel is created hidden UP FRONT
    // behind it (L-01: a splash load failure can never leave the app
    // windowless). The splash timer only dismisses the splash and reveals
    // the ready panel — the panel never paints while the logo is up.
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
