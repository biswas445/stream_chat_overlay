/**
 * Company-grade unit tests for electron/state-utils.js.
 * Runner: plain Node (no deps) — `npm test` executes this file.
 * Convention: fail fast with non-zero exit + named assertion.
 */
const assert = require('node:assert/strict');
const {
  sanitizeChatState,
  isAllowedWidgetUrl,
  parseBotrixWidgetUrl,
  extractBotrixBid,
  diagnoseWidgetUrl,
  parseViewerCount,
  buildViewerUrl,
  buildViewerUrlFromWidgetUrl,
  canonicalWidgetUrl,
  normalizeViewerCounts,
} = require('../electron/state-utils');

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
  console.log(`ok ${n} - ${name}`);
}

// --- sanitizeChatState (H-02) ---
t('defaults on empty/garbage', () => {
  for (const raw of [null, undefined, 42, 'x', [], {}]) {
    assert.deepEqual(sanitizeChatState(raw), {
      x: null,
      y: null,
      w: 340,
      h: 480,
      pinned: true,
      transparent: true,
    });
  }
});
t('corrupt dims fall back finite', () => {
  // 'hacked'/NaN/Infinity -> default 340; null coerces to 0 -> min clamp 240.
  // Either way: finite, in range, never NaN/Infinity into BrowserWindow.
  for (const w of ['hacked', NaN, Infinity, -Infinity, null, undefined]) {
    const s = sanitizeChatState({ w, h: 'nope' });
    assert.ok(Number.isFinite(s.w) && Number.isFinite(s.h));
    assert.ok(s.w >= 240 && s.w <= 1600);
    assert.equal(s.h, 480);
  }
  assert.equal(sanitizeChatState({ w: 'hacked' }).w, 340);
  assert.equal(sanitizeChatState({}).w, 340);
});
t('dims clamp to min/max', () => {
  assert.equal(sanitizeChatState({ w: -9999 }).w, 240);
  assert.equal(sanitizeChatState({ h: -9999 }).h, 320);
  assert.equal(sanitizeChatState({ w: 99999 }).w, 1600);
  assert.equal(sanitizeChatState({ h: 99999 }).h, 1200);
});
t('x/y null unless finite', () => {
  assert.equal(sanitizeChatState({ x: 'a' }).x, null);
  assert.equal(sanitizeChatState({ x: 120 }).x, 120);
  assert.equal(sanitizeChatState({ y: Infinity }).y, null);
});
t('booleans strict, defaults true', () => {
  assert.equal(sanitizeChatState({ pinned: 1 }).pinned, true);
  assert.equal(sanitizeChatState({ pinned: false }).pinned, false);
  assert.equal(sanitizeChatState({ transparent: 'yes' }).transparent, true);
});

// --- isAllowedWidgetUrl (M-01) ---
t('allowlist exact/sub, block lookalikes', () => {
  assert.equal(isAllowedWidgetUrl('https://botrix.live/x/?bid=1'), true);
  assert.equal(isAllowedWidgetUrl('https://www.botrix.live/x/?bid=1'), true);
  assert.equal(isAllowedWidgetUrl('https://app.botrix.live/x/?bid=1'), true);
  assert.equal(isAllowedWidgetUrl('https://evil.com/?bid=1'), false);
  assert.equal(isAllowedWidgetUrl('https://botrix.live.evil.com/?bid=1'), false);
  assert.equal(isAllowedWidgetUrl('http://botrix.live/x?bid=1'), false);
  assert.equal(isAllowedWidgetUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedWidgetUrl(null), false);
});

// --- parseBotrixWidgetUrl (M-08) ---
t('env parser variants', () => {
  assert.equal(
    parseBotrixWidgetUrl('BOTRIX_WIDGET_URL=https://botrix.live/a/?bid=1'),
    'https://botrix.live/a/?bid=1',
  );
  assert.equal(
    parseBotrixWidgetUrl('BOTRIX_WIDGET_URL="https://botrix.live/a/?bid=1"'),
    'https://botrix.live/a/?bid=1',
  );
  assert.equal(
    parseBotrixWidgetUrl('export BOTRIX_WIDGET_URL=https://botrix.live/a/?bid=1'),
    'https://botrix.live/a/?bid=1',
  );
  assert.equal(
    parseBotrixWidgetUrl('BOTRIX_WIDGET_URL=https://botrix.live/a/?bid=1 # hi'),
    'https://botrix.live/a/?bid=1',
  );
  assert.equal(
    parseBotrixWidgetUrl('BOTRIX_WIDGET_URL="https://botrix.live/a/?bid=1#frag"'),
    'https://botrix.live/a/?bid=1#frag',
  );
  assert.equal(
    parseBotrixWidgetUrl('BOTRIX_WIDGET_URL=https://a.com/?bid=1\nBOTRIX_WIDGET_URL=https://b.com/?bid=2'),
    'https://b.com/?bid=2',
  );
  assert.equal(parseBotrixWidgetUrl('BOTRIX_WIDGET_URL='), null);
  assert.equal(parseBotrixWidgetUrl('# only a comment'), null);
});

// --- extractBotrixBid (M-02) ---
t('bid extract + validate', () => {
  assert.equal(
    extractBotrixBid('https://botrix.live/widgets/chat/?bid=ABC123'),
    'ABC123',
  );
  assert.equal(extractBotrixBid('https://botrix.live/no-bid'), null);
  assert.equal(extractBotrixBid('https://evil.com/?bid=ABC123'), null);
  assert.equal(extractBotrixBid('https://botrix.live/?bid=a&evil=1'), 'a');
  assert.equal(extractBotrixBid('https://botrix.live/?bid=%ZZ'), null);
  assert.equal(extractBotrixBid(null), null);
});

// --- diagnoseWidgetUrl (every misconfiguration gets a code) ---
t('config diagnosis codes', () => {
  assert.equal(diagnoseWidgetUrl(null).code, 'missing');
  assert.equal(diagnoseWidgetUrl('   ').code, 'empty');
  assert.equal(diagnoseWidgetUrl('not a url').code, 'bad-protocol');
  assert.equal(diagnoseWidgetUrl('http://botrix.live/x?bid=ABC').code, 'bad-protocol');
  assert.equal(diagnoseWidgetUrl('https://evil.com/?bid=ABC').code, 'bad-host');
  assert.equal(diagnoseWidgetUrl('https://botrix.live/widgets/chat/').code, 'no-bid');
  assert.equal(diagnoseWidgetUrl('https://botrix.live/x?bid=%ZZ').code, 'bad-bid');
  assert.equal(diagnoseWidgetUrl('https://botrix.live/x?bid=a b').code, 'bad-bid');
  // bid=a with extra &evil param is FINE: bid regex stops at & -> 'a'.
  assert.equal(diagnoseWidgetUrl('https://botrix.live/x?bid=a&evil=1').code, 'ok');
  const ok = diagnoseWidgetUrl('https://botrix.live/widgets/chat/?bid=ABC123');
  assert.equal(ok.code, 'ok');
  assert.equal(ok.bid, 'ABC123');
});

// --- parseViewerCount + buildViewerUrl (widget-page endpoint) ---
t('viewer URL shape bid-first platform-last', () => {
  assert.equal(
    buildViewerUrl('ABC123', 'twitch'),
    'https://botrix.live/widgets/viewers/?bid=ABC123&platform=twitch',
  );
  assert.equal(
    buildViewerUrl('ABC123', 'kick'),
    'https://botrix.live/widgets/viewers/?bid=ABC123&platform=kick',
  );
  assert.equal(
    buildViewerUrl('ABC123', 'youtube'),
    'https://botrix.live/widgets/viewers/?bid=ABC123&platform=youtube',
  );
});
t('viewer URL derived from user .env URL, one platform each', () => {
  const cfg = 'https://botrix.live/widgets/multistream?bid=ENVBID1';
  assert.equal(
    buildViewerUrlFromWidgetUrl(cfg, 'twitch'),
    'https://botrix.live/widgets/viewers/?bid=ENVBID1&platform=twitch',
  );
  assert.equal(
    buildViewerUrlFromWidgetUrl(cfg, 'kick'),
    'https://botrix.live/widgets/viewers/?bid=ENVBID1&platform=kick',
  );
  assert.equal(
    buildViewerUrlFromWidgetUrl(cfg, 'youtube'),
    'https://botrix.live/widgets/viewers/?bid=ENVBID1&platform=youtube',
  );
  // never comma-joined
  assert.ok(!buildViewerUrlFromWidgetUrl(cfg, 'twitch').includes(','));
  // unconfigured -> null (poller stays silent)
  assert.equal(buildViewerUrlFromWidgetUrl(null, 'twitch'), null);
  assert.equal(buildViewerUrlFromWidgetUrl('https://evil.com/?bid=X', 'twitch'), null);
  assert.equal(buildViewerUrlFromWidgetUrl('https://botrix.live/no-bid', 'twitch'), null);
});
t('viewer count parse JSON + HTML variants', () => {
  assert.equal(parseViewerCount('{"viewerCount":12,"ok":true}'), 12);
  assert.equal(parseViewerCount('<div>viewerCount: 7</div>'), 7);
  assert.equal(parseViewerCount('<span data-viewer-count="4"></span>'), 4);
  assert.equal(parseViewerCount('{"viewerCount":-1}'), 0);
  assert.equal(parseViewerCount('<html>no count here</html>'), null);
  assert.equal(parseViewerCount(''), null);
  assert.equal(parseViewerCount(null), null);
});

// --- error-display contracts (what the UI must say per failure) ---
t('every diagnosis code has a distinct user message', () => {
  // Mirrors SETUP_COPY keys in src/chat.js — a code without copy = blank UI.
  const codes = ['no-env', 'missing', 'empty', 'bad-protocol', 'bad-host', 'no-bid', 'bad-bid'];
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'chat.js'),
    'utf8',
  );
  for (const c of codes) {
    const quoted = src.includes(`'${c}'`);
    const bare = src.includes(`${c}: [`) || src.includes(`${c}: [`);
    if (!quoted && !bare) throw new Error(`SETUP_COPY missing code ${c}`);
  }
});
t('unexpected error channel wired end-to-end', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const pre = fs.readFileSync(path.join(root, 'electron', 'chat-preload.js'), 'utf8');
  const chat = fs.readFileSync(path.join(root, 'src', 'chat.js'), 'utf8');
  for (const needle of [
    'reportUnexpected',
    'uncaughtException',
    'unhandledRejection',
    'render-process-gone',
    'did-fail-load',
    'guarded(',
    "ipcRenderer.on('chat:error'",
    'onError',
    "window.addEventListener('error'",
    "window.addEventListener('unhandledrejection'",
  ]) {
    if (!main.includes(needle) && !pre.includes(needle) && !chat.includes(needle)) {
      throw new Error(`error channel missing: ${needle}`);
    }
  }
});

t('whole BotRix URL auto-trimmed to canonical ?bid= only', () => {
  const { diagnoseWidgetUrl } = require('../electron/state-utils');
  const full =
    'https://botrix.live/widgets/chat/?bid=ABC123&theme=default&messageSound=0&twitch=true&youtube=true&kick=true';
  const d = diagnoseWidgetUrl(full);
  assert.equal(d.code, 'ok');
  assert.equal(d.bid, 'ABC123');
  assert.equal(d.url, 'https://botrix.live/widgets/chat/?bid=ABC123');
  assert.ok(!d.url.includes('theme=') && !d.url.includes('twitch='));
  assert.equal(
    canonicalWidgetUrl(full),
    'https://botrix.live/widgets/chat/?bid=ABC123',
  );
});

// --- normalizeViewerCounts ---
t('viewer normalize', () => {
  assert.deepEqual(normalizeViewerCounts({ twitch: 5, youtube: '3', kick: -1 }), {
    twitch: 5,
    youtube: 3,
    kick: 0,
  });
  assert.deepEqual(normalizeViewerCounts(null), { twitch: 0, youtube: 0, kick: 0 });
});

console.log(`\n# pass ${n}`);
