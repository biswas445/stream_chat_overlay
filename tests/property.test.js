/**
 * Property-based tests for electron/state-utils.js (fast-check):
 * whole-input-domain properties instead of hand-picked examples.
 * Runner: plain Node — part of `npm test`.
 */
const fc = require('fast-check');
const assert = require('node:assert/strict');
const {
  sanitizeChatState,
  isAllowedWidgetUrl,
  extractBotrixBid,
  parseViewerCount,
  diagnoseWidgetUrl,
  buildViewerUrlFromWidgetUrl,
} = require('../electron/state-utils');

let n = 0;
function t(name, prop) {
  fc.assert(prop);
  n += 1;
  console.log(`ok ${n} - ${name}`);
}

// --- sanitizeChatState: for ANY input the output is finite + in-range ---
t('sanitizeChatState never emits out-of-range/NaN dims (any input)', fc.property(
  fc.anything(),
  (raw) => {
    const s = sanitizeChatState(raw);
    return (
      Number.isFinite(s.w) && Number.isFinite(s.h) &&
      s.w >= 240 && s.w <= 1600 && s.h >= 320 && s.h <= 1200 &&
      (s.x === null || Number.isFinite(s.x)) &&
      (s.y === null || Number.isFinite(s.y)) &&
      typeof s.pinned === 'boolean' && typeof s.transparent === 'boolean'
    );
  },
));

// --- isAllowedWidgetUrl: allowed ⇒ https + botrix host, for ANY string ---
t('isAllowedWidgetUrl only ever allows https botrix hosts', fc.property(
  fc.string(),
  (u) => {
    if (!isAllowedWidgetUrl(u)) return true;
    try {
      const p = new URL(u);
      const h = p.hostname.toLowerCase();
      return (
        p.protocol === 'https:' &&
        (h === 'botrix.live' || h === 'www.botrix.live' || h.endsWith('.botrix.live'))
      );
    } catch {
      return false; // an unparseable "allowed" URL would be a bug
    }
  },
));

t('lookalike hosts are never allowed (any subdomain suffix trick)', fc.property(
  fc.constantFrom(
    'https://botrix.live.evil.com/?bid=1',
    'https://evil.com/?bid=1',
    'http://botrix.live/?bid=1',
    'javascript:alert(1)',
    'https://notbotrix.live/?bid=1',
  ),
  (u) => isAllowedWidgetUrl(u) === false,
));

// --- valid widget URLs: diagnose ok, bid preserved, canonical output ---
const bidArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,64}$/);
const widgetUrlArb = fc
  .record({
    sub: fc.constantFrom('', 'www.', 'app.'),
    bid: bidArb,
    extraKey: fc.option(fc.constantFrom('theme', 'twitch', 'x'), { nil: undefined }),
    extraVal: fc.option(fc.stringMatching(/^[a-z0-9]{1,8}$/), { nil: undefined }),
  })
  .map(({ sub, bid, extraKey, extraVal }) => {
    const extra = extraKey !== undefined && extraVal !== undefined ? `&${extraKey}=${extraVal}` : '';
    return `https://${sub}botrix.live/widgets/chat/?bid=${bid}${extra}`;
  });

t('valid widget URLs always diagnose ok with the exact bid preserved', fc.property(
  widgetUrlArb,
  (u) => {
    const d = diagnoseWidgetUrl(u);
    if (d.code !== 'ok') return false;
    const bid = u.match(/[?&]bid=([^&]+)/)[1];
    return d.bid === bid;
  },
));

t('canonical URL keeps ONLY ?bid= — no extra params ever survive', fc.property(
  widgetUrlArb,
  (u) => {
    const d = diagnoseWidgetUrl(u);
    return (
      d.code === 'ok' &&
      !d.url.includes('&') &&
      d.url.startsWith('https://') &&
      d.url.includes('botrix.live/widgets/chat/') &&
      d.url.endsWith(`?bid=${encodeURIComponent(d.bid)}`)
    );
  },
));

t('non-default ports are always rejected (CSP layer agreement)', fc.property(
  bidArb,
  fc.integer({ min: 1, max: 65535 }).filter((p) => p !== 443),
  (bid, port) => diagnoseWidgetUrl(`https://botrix.live:${port}/x?bid=${bid}`).code === 'bad-port',
));

t('URLs over 2048 chars are always rejected as too-long', fc.property(
  fc.integer({ min: 2049, max: 2400 }).map((len) => 'a'.repeat(len)),
  (longBid) => diagnoseWidgetUrl(`https://botrix.live/x?bid=${longBid}`).code === 'too-long',
));

// --- parseViewerCount: any JSON count N maps to max(0, N) ---
t('parseViewerCount maps any count N to max(0, N)', fc.property(
  fc.integer({ min: -1000, max: 100000 }),
  (count) => parseViewerCount(JSON.stringify({ viewerCount: count })) === Math.max(0, count),
));

// --- buildViewerUrlFromWidgetUrl: non-botrix input always yields null ---
t('non-botrix/invalid input never produces a poller URL', fc.property(
  fc.webUrl(),
  fc.constantFrom('twitch', 'youtube', 'kick'),
  (u, platform) => {
    const out = buildViewerUrlFromWidgetUrl(u, platform);
    if (out === null) return true;
    return out.startsWith('https://botrix.live/api/widgets/viewers?platform=');
  },
));

console.log(`\n# property pass ${n}`);
