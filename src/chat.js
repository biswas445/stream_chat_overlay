/**
 * Chat panel renderer: the SAME panel frontend as before (header chrome,
 * heart title, status dot, drag handle, pin / transparency / close buttons,
 * glass + solid themes) — with the official BotRix multistream widget
 * embedded where the message list used to be.
 *
 * Why embed: the widget page (the exact URL OBS loads) is BotRix's own
 * display client. It maintains every platform connection — twitch,
 * youtube AND kick — normalizes, styles, and scrolls the messages itself.
 * All three platforms work with zero protocol code on our side, and the
 * panel keeps its native look around it.
 *
 * The widget URL lives in the main process's local settings db (entered
 * via the panel's gear icon), so the bid/session is configured in one
 * place without any config files in the app folder.
 */

const api = window.chatPanel;

const statusEl = document.getElementById('chat-status');
const pinBtn = document.getElementById('btn-pin');
const transparentBtn = document.getElementById('btn-transparent');
const frame = document.getElementById('chat-frame');
const setupCard = document.getElementById('setup-card');
const viewerWrap = document.getElementById('viewer-counts');
const frameWrap = document.getElementById('chat-frame-wrap');
const settingsBtn = document.getElementById('btn-settings');
const settingsPanel = document.getElementById('settings-panel');
const settingsUrlInput = document.getElementById('settings-url');
const settingsCurrent = document.getElementById('settings-current');
const settingsMsg = document.getElementById('settings-msg');
const saveUrlBtn = document.getElementById('btn-save-url');
const changeUrlBtn = document.getElementById('btn-change-url');

// Status line (built with DOM APIs, never innerHTML). Hoisted as a
// function declaration so the bridge guard below can report through it.
function setStatus(text, live) {
  statusEl.classList.toggle('live', Boolean(live));
  statusEl.replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'dot';
  statusEl.appendChild(dot);
  const label = document.createElement('span');
  label.textContent = text;
  statusEl.appendChild(label);
}

// Preload bridge missing (wrong preload path, sandbox regression, dev
// serving without Electron): fail LOUD with a setup card, not a silent
// dead panel where every api.* call throws TypeError.
if (!api || typeof api.getState !== 'function') {
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = 'Panel bridge unavailable';
  const h = document.createElement('div');
  h.className = 'hint';
  h.textContent =
    'The app shell did not expose the panel API (preload failed). Restart the app; if it persists, reinstall.';
  setupCard.replaceChildren(t, h);
  setupCard.classList.add('show');
  try {
    frame.remove();
  } catch {
    /* already gone */
  }
  setStatus('panel bridge unavailable — restart the app', false);
  throw new Error('[chat] window.chatPanel missing — aborting boot');
}
const viewerPills = {
  twitch: viewerWrap.querySelector('.vc-twitch .n'),
  youtube: viewerWrap.querySelector('.vc-youtube .n'),
  kick: viewerWrap.querySelector('.vc-kick .n'),
};
const viewerPillEls = {
  twitch: viewerWrap.querySelector('.vc-twitch'),
  youtube: viewerWrap.querySelector('.vc-youtube'),
  kick: viewerWrap.querySelector('.vc-kick'),
};

// ---- wire buttons ------------------------------------------------------------

async function safeInvoke(fn, label) {
  try {
    return await fn();
  } catch (err) {
    // Main process gone / window closing mid-click: never an unhandled
    // rejection — surface it in the status line and keep the UI usable.
    console.error(`[chat] ${label} failed:`, err && err.message ? err.message : err);
    setStatus(`${label} failed — restarting the app may help`, false);
    return null;
  }
}

pinBtn.addEventListener('click', async () => {
  const on = await safeInvoke(() => api.togglePin(), 'pin toggle');
  if (on !== null) pinBtn.classList.toggle('active', on); // invoke() returns
  // a Promise — await it, or the button state desyncs
});

transparentBtn.addEventListener('click', async () => {
  const on = await safeInvoke(() => api.toggleTransparent(), 'theme toggle');
  if (on === null) return; // true = transparent OFF (solid)
  document.body.classList.toggle('opaque', on);
  transparentBtn.classList.toggle('active', !on);
});

document.getElementById('btn-close').addEventListener('click', () => api.close());

// ---- settings panel (gear icon) ------------------------------------------
// First-launch flow: no saved URL → the boot setup card points here; the
// user clicks the gear, pastes the widget URL, presses Enter. The URL is
// validated + canonicalized by the main process (chat:save-url) and
// stored in its local settings db; the NEXT startup reads the db and
// loads the widget. Real-life scenarios handled: empty input, invalid
// URL (per-code message), unchanged re-save, Change with nothing saved,
// IPC failure, corrupt db (falls back to "no URL saved", never crashes).

let settingsOpen = false;

function showSettingsMsg(text, ok) {
  settingsMsg.textContent = text;
  settingsMsg.classList.toggle('ok', Boolean(ok));
}

function renderSavedStatus(st) {
  if (st && st.url) {
    // The bid is masked: the panel is designed to be captured on stream —
    // opening settings while live must not broadcast the session id.
    try {
      const u = new URL(st.url);
      settingsCurrent.textContent = `Saved: ${u.origin}${u.pathname}?bid=••••••`;
    } catch {
      settingsCurrent.textContent = 'Saved widget URL.';
    }
  } else {
    settingsCurrent.textContent = 'No widget URL saved yet.';
  }
}

async function openSettings() {
  settingsOpen = true;
  settingsBtn.classList.add('active');
  // The settings card replaces the widget/setup card while open; closing
  // restores whatever was there (the iframe keeps its state while hidden).
  frameWrap.style.display = 'none';
  setupCard.style.display = 'none';
  settingsPanel.classList.add('show');
  settingsUrlInput.value = '';
  showSettingsMsg('', false);
  const st = await safeInvoke(() => api.getConfigStatus(), 'config status');
  if (settingsOpen) renderSavedStatus(st);
  settingsUrlInput.focus();
}

function closeSettings() {
  settingsOpen = false;
  settingsBtn.classList.remove('active');
  settingsPanel.classList.remove('show');
  // Reset inline overrides — CSS defaults bring back the widget iframe
  // (or the boot setup card, which keeps its own .show class).
  frameWrap.style.display = '';
  setupCard.style.display = '';
}

settingsBtn.addEventListener('click', () => {
  if (settingsOpen) closeSettings();
  else openSettings().catch(() => {});
});

// After a successful save, the boot setup card (if it was showing) must
// not keep claiming "no URL saved" — replace it with the restart note.
function showSavedRestartCard() {
  if (!setupCard.classList.contains('show')) return;
  setupCard.replaceChildren();
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = 'Widget URL saved ✓';
  setupCard.appendChild(t);
  const h = document.createElement('div');
  h.className = 'hint';
  h.textContent =
    'Restart the app (tray → Quit, or the X button) — the widget loads on the next startup.';
  setupCard.appendChild(h);
}

async function saveUrlFromPanel() {
  const raw = settingsUrlInput.value.trim();
  if (!raw) {
    showSettingsMsg('Enter a BotRix widget URL first — paste the full link from BotRix.', false);
    settingsUrlInput.focus();
    return;
  }
  const res = await safeInvoke(() => api.saveUrl(raw), 'save url');
  if (res === null) return; // safeInvoke already surfaced the failure
  if (res.ok) {
    renderSavedStatus(res);
    settingsUrlInput.value = '';
    showSettingsMsg(
      res.code === 'unchanged'
        ? 'This URL is already saved ✓ — restart the app to load it.'
        : 'Saved ✓ — restart the app and the widget loads on the next startup.',
      true,
    );
    showSavedRestartCard();
    setStatus('widget url saved — restart to load', false);
  } else {
    const copy = SETUP_COPY[res.code];
    showSettingsMsg(
      copy ? `Not saved — ${copy[0].toLowerCase()}` : `Not saved — invalid URL (${res.code}).`,
      false,
    );
    settingsUrlInput.focus();
    settingsUrlInput.select();
  }
}

async function changeUrlFromPanel() {
  const st = await safeInvoke(() => api.getConfigStatus(), 'config status');
  if (st === null) return; // safeInvoke already surfaced the failure
  if (st.url) {
    settingsUrlInput.value = st.url;
    showSettingsMsg('Edit the URL, then press Enter to save the change.', false);
  } else {
    showSettingsMsg('No URL saved yet — paste one above and press Enter.', false);
  }
  settingsUrlInput.focus();
  settingsUrlInput.select();
}

saveUrlBtn.addEventListener('click', () => saveUrlFromPanel().catch(() => {}));
changeUrlBtn.addEventListener('click', () => changeUrlFromPanel().catch(() => {}));
// Enter in the field = save (same as the Enter button).
settingsUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveUrlFromPanel().catch(() => {});
  }
});

// Copy for every config diagnosis code — shown on the boot setup card
// AND reused as the settings-panel error text (single source of truth).
const SETUP_COPY = {
  missing: [
    'No widget URL saved',
    [
      ['Click the gear (settings) icon in the top bar, paste your BotRix multistream widget URL, and press Enter.', false],
      ['Then restart the app — the widget loads on the next startup.', false],
      ['https://botrix.live/widgets/chat/?bid=YOUR_BID', true],
    ],
  ],
  empty: [
    'Widget URL is empty',
    [
      ['The saved URL is blank. Click the gear icon, paste your BotRix multistream widget URL, and press Enter.', false],
    ],
  ],
  'bad-protocol': [
    'Widget URL must be https://',
    [
      ['The saved URL is not https — the panel refuses to embed it. Click the gear icon and re-enter it:', false],
      ['https://botrix.live/widgets/chat/?bid=YOUR_BID', true],
    ],
  ],
  'bad-host': [
    'Widget URL host not allowed',
    [
      ['Only botrix.live widget URLs can be embedded. Click the gear icon and check for typos.', false],
    ],
  ],
  'bad-port': [
    'Widget URL port not allowed',
    [
      ['The saved URL has a non-standard port — the panel embeds only standard https. Click the gear icon and re-enter the plain botrix.live URL.', false],
    ],
  ],
  'too-long': [
    'Widget URL is too long',
    [
      ['The pasted URL exceeds 2048 characters. Re-copy the widget link from BotRix without extra data, then click the gear icon and re-enter it.', false],
    ],
  ],
  'no-bid': [
    'Widget URL is missing ?bid=',
    [
      ['Copy the FULL widget URL from BotRix — it carries the session id as ?bid=... Click the gear icon and re-enter it.', false],
      ['https://botrix.live/widgets/chat/?bid=YOUR_BID', true],
    ],
  ],
  'bad-bid': [
    'Widget bid looks invalid',
    [
      ['The ?bid= value has illegal characters. Re-copy the URL from Botrix without editing it, then click the gear icon and re-enter it.', false],
    ],
  ],
};

// ---- viewer counts ------------------------------------------------------------
// Pushed from the main process every ~30s (BotRix viewers REST polling).
// One pill per platform behind the title: [icon] count; green when that
// platform has viewers, gray at 0. Counts are textContent — safe updates.

// Keep the unsubscribe so a re-init (HMR/tests) never stacks listeners.
const offViewers = api.onViewers((v) => {
  viewerWrap.style.display = 'inline-flex';
  // error/stale: the poller failed (offline API), not "0 viewers" — dim
  // the pills and surface it in the tooltip instead of lying with 0s.
  const degraded = Boolean(v && (v.error || v.stale));
  viewerWrap.classList.toggle('stale', degraded);
  viewerWrap.title = degraded ? 'viewer counts unavailable (offline)' : '';
  // Iterate the array literal directly (Object.entries on an array yields
  // [index, element] pairs — platform would read '0'/'1'/'2', numEl would
  // be the inner array, and pillEl undefined → TypeError every poll).
  for (const [platform, numEl, pillEl] of [
    ['twitch', viewerPills.twitch, viewerPillEls.twitch],
    ['youtube', viewerPills.youtube, viewerPillEls.youtube],
    ['kick', viewerPills.kick, viewerPillEls.kick],
  ]) {
    const n = v && Number.isFinite(Number(v[platform])) ? Math.max(0, Number(v[platform])) : 0;
    numEl.textContent = String(n);
    pillEl.classList.toggle('live', n > 0 && !degraded);
  }
});
window.addEventListener('beforeunload', () => {
  try {
    if (typeof offViewers === 'function') offViewers();
  } catch {
    /* listener already gone */
  }
  try {
    if (typeof offError === 'function') offError();
  } catch {
    /* listener already gone */
  }
});

// Unexpected main-process / renderer errors: status line ALWAYS says what
// broke (no silent blank), console keeps the full detail for bug reports.
function showUnexpected(where, message) {
  console.error(`[chat:unexpected:${where}]`, message);
  setStatus(`error (${where}) — see console, tray reopen keeps working`, false);
}
window.addEventListener('error', (e) => {
  showUnexpected('renderer', (e && e.message) || 'unknown');
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e && e.reason;
  showUnexpected(
    'promise',
    (r && (r.message || String(r))) || 'unknown',
  );
});
const offError =
  api && typeof api.onError === 'function'
    ? api.onError((p) =>
        showUnexpected(
          (p && p.where) || 'main',
          (p && p.message) || 'unknown',
        ),
      )
    : null;

// ---- initial state ------------------------------------------------------------

(async () => {
  let st = null;
  try {
    st = await api.getState();
  } catch (err) {
    console.error('[chat] getState failed:', err && err.message ? err.message : err);
  }
  // Corrupt disk state could yield non-booleans — coerce, never trust.
  const pinned = st ? st.pinned === true : true;
  const transparent = st ? st.transparent !== false : true;
  pinBtn.classList.toggle('active', pinned);
  document.body.classList.toggle('opaque', !transparent);
  transparentBtn.classList.toggle('active', !transparent);

  // Diagnose config FIRST so every failure mode gets an actionable card
  // (nothing saved, empty value, http:, wrong host, missing/invalid bid)
  // instead of a blank iframe. getWidgetUrl stays as the embed source of
  // truth.
  function showSetup(title, lines) {
    frame.remove();
    setupCard.replaceChildren();
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = title;
    setupCard.appendChild(t);
    for (const [text, isCode] of lines) {
      const el = document.createElement(isCode ? 'code' : 'div');
      if (!isCode) el.className = 'hint';
      el.textContent = text;
      setupCard.appendChild(el);
    }
    setupCard.classList.add('show');
  }

  let status = { code: 'missing', url: null, bid: null };
  try {
    if (typeof api.getConfigStatus === 'function') {
      status = (await api.getConfigStatus()) || status;
    }
  } catch (err) {
    console.error('[chat] getConfigStatus failed:', err && err.message ? err.message : err);
  }
  if (status.code !== 'ok') {
    const copy = SETUP_COPY[status.code] || SETUP_COPY.missing;
    showSetup(copy[0], copy[1]);
    setStatus(`${copy[0].toLowerCase()} — see panel`, false);
    return;
  }

  // load the widget (the main process supplies the URL)
  let url = null;
  try {
    url = await api.getWidgetUrl();
  } catch (err) {
    console.error('[chat] getWidgetUrl failed:', err && err.message ? err.message : err);
  }
  if (url) {
    let parsed = null;
    try {
      parsed = new URL(url);
    } catch {
      /* malformed config — treated as unloadable below */
    }
    const hostOk =
      parsed &&
      parsed.protocol === 'https:' &&
      (() => {
        const h = parsed.hostname.toLowerCase();
        if (h === 'botrix.live' || h === 'www.botrix.live') return true;
        return h.endsWith('.botrix.live');
      })();
    if (hostOk) {
      // CSP permits only https: frames; the host allowlist (mirrored from
      // the main process) blocks phishing iframes — say so instead.
      frame.src = url;
      setStatus(`botrix multistream · ${parsed.hostname}`, true);
      // A load failure (bad bid, widget down, host refuses embedding)
      // leaves the frame blank — surface it three ways so no failure is
      // silent: (1) iframe error event, (2) 15s no-load grace timer, (3)
      // blank-frame probe — an HTTP error page still fires `load`, so a
      // zero-size document after load means the widget never rendered.
      let settled = false;
      const fail = (why) => {
        if (settled) return;
        settled = true;
        clearTimeout(loadWatch);
        setStatus(`widget failed to load (${why}) — check the saved URL via the gear icon`, false);
      };
      const loadWatch = setTimeout(() => fail('timeout'), 15000);
      frame.addEventListener('load', () => {
        // Give the widget a beat to paint, then probe for a real document.
        setTimeout(() => {
          let blank = false;
          try {
            const doc = frame.contentDocument;
            // Cross-origin widget: contentDocument throws/reads null — that
            // PROVES the frame navigated somewhere (good). Same-origin
            // about:blank (blocked embed) reads empty — that is failure.
            if (doc) {
              const len = (doc.body && doc.body.innerHTML.length) || 0;
              blank = len < 20;
            }
          } catch {
            blank = false; // cross-origin readable-block = loaded
          }
          if (blank) fail('blank');
          else if (!settled) {
            settled = true;
            clearTimeout(loadWatch);
          }
        }, 2500);
      }, { once: true });
      frame.addEventListener('error', () => fail('error'), { once: true });
    } else {
      // Defence-in-depth rejection (main process already filtered): reuse
      // the setup card so the reason is visible, not just a status line.
      frame.remove();
      setupCard.replaceChildren();
      const t = document.createElement('div');
      t.className = 't';
      t.textContent = 'Widget URL host not allowed';
      setupCard.appendChild(t);
      const h = document.createElement('div');
      h.className = 'hint';
      h.textContent = 'Only botrix.live widget URLs can be embedded. Click the gear icon and check for typos.';
      setupCard.appendChild(h);
      setupCard.classList.add('show');
      setStatus('widget url not allowed — see panel', false);
    }
  } else {
    // Main-process diagnosis said ok but supplied no URL (race): generic card.
    frame.remove();
    setupCard.replaceChildren();
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = 'Widget URL unavailable';
    setupCard.appendChild(t);
    const h = document.createElement('div');
    h.className = 'hint';
    h.textContent = 'The app could not read the saved widget URL. Restart the app; if it persists, re-enter it via the gear icon.';
    setupCard.appendChild(h);
    setupCard.classList.add('show');
    setStatus('no widget url configured — see panel', false);
  }
})();
