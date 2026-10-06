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
 * The widget URL comes from the main process (BOTRIX_WIDGET_URL in the
 * app-root .env), so the bid/session is configured in one place.
 */

const api = window.chatPanel;

const statusEl = document.getElementById('chat-status');
const pinBtn = document.getElementById('btn-pin');
const transparentBtn = document.getElementById('btn-transparent');
const frame = document.getElementById('chat-frame');
const setupCard = document.getElementById('setup-card');
const viewerWrap = document.getElementById('viewer-counts');

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
  // (no .env, empty key, http:, wrong host, missing/invalid bid) instead
  // of a blank iframe. getWidgetUrl stays as the embed source of truth.
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

  const SETUP_COPY = {
    'no-env': [
      'Setup needed — .env file not found',
      [
        ['Copy .env.example to .env next to the app, then paste your BotRix multistream widget URL in it.', false],
        ['BOTRIX_WIDGET_URL="https://botrix.live/widgets/chat/?bid=YOUR_BID"', true],
      ],
    ],
    missing: [
      'Setup needed — BOTRIX_WIDGET_URL not found',
      [
        ['Your .env exists but has no BOTRIX_WIDGET_URL line. Add it:', false],
        ['BOTRIX_WIDGET_URL="https://botrix.live/widgets/chat/?bid=YOUR_BID"', true],
      ],
    ],
    empty: [
      'Setup needed — widget URL is empty',
      [
        ['BOTRIX_WIDGET_URL is blank. Paste your BotRix multistream widget URL (the exact URL an OBS browser source loads).', false],
      ],
    ],
    'bad-protocol': [
      'Widget URL must be https://',
      [
        ['The configured URL is not https — the panel refuses to embed it. Fix BOTRIX_WIDGET_URL:', false],
        ['BOTRIX_WIDGET_URL="https://botrix.live/widgets/chat/?bid=YOUR_BID"', true],
      ],
    ],
    'bad-host': [
      'Widget URL host not allowed',
      [
        ['Only botrix.live widget URLs can be embedded. Check BOTRIX_WIDGET_URL for typos.', false],
      ],
    ],
    'no-bid': [
      'Widget URL is missing ?bid=',
      [
        ['Copy the FULL widget URL from BotRix — it carries the session id as ?bid=...', false],
        ['BOTRIX_WIDGET_URL="https://botrix.live/widgets/chat/?bid=YOUR_BID"', true],
      ],
    ],
    'bad-bid': [
      'Widget bid looks invalid',
      [
        ['The ?bid= value has illegal characters. Re-copy the URL from BotRix without editing it.', false],
      ],
    ],
  };

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
        setStatus(`widget failed to load (${why}) — check BOTRIX_WIDGET_URL`, false);
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
      h.textContent = 'Only botrix.live widget URLs can be embedded. Check BOTRIX_WIDGET_URL for typos.';
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
    h.textContent = 'The app could not read BOTRIX_WIDGET_URL. Restart the app; if it persists, re-copy .env.example to .env.';
    setupCard.appendChild(h);
    setupCard.classList.add('show');
    setStatus('no widget url configured — see panel', false);
  }
})();
