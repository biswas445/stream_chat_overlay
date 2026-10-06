/**
 * Pure, testable state/env helpers extracted from main.js (company-grade
 * QA: these run under plain Node with zero Electron dependency).
 */

const BOTRIX_WIDGET_HOSTS = ['botrix.live', 'www.botrix.live'];

function numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function boolOr(v, fallback) {
  return typeof v === 'boolean' ? v : fallback;
}

/** Validate a raw `chat` state payload (e.g. from overlay-state.json).
 * Never throws; corrupt values fall back to safe defaults. */
function sanitizeChatState(raw) {
  const c =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    x:
      c.x === null || c.x === undefined
        ? null
        : Number.isFinite(Number(c.x))
          ? Number(c.x)
          : null,
    y:
      c.y === null || c.y === undefined
        ? null
        : Number.isFinite(Number(c.y))
          ? Number(c.y)
          : null,
    w: Math.min(1600, Math.max(240, Math.round(numOr(c.w, 340)))),
    h: Math.min(1200, Math.max(320, Math.round(numOr(c.h, 480)))),
    pinned: boolOr(c.pinned, true),
    transparent: boolOr(c.transparent, true),
  };
}

/** True when `u` is an embeddable https: BotRix widget URL. */
function isAllowedWidgetUrl(u) {
  try {
    const p = new URL(u);
    if (p.protocol !== 'https:') return false;
    const host = p.hostname.toLowerCase();
    if (BOTRIX_WIDGET_HOSTS.includes(host)) return true;
    return BOTRIX_WIDGET_HOSTS.some((h) => host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Validate a raw persisted-config payload (e.g. botrix-config.json).
 * Never throws; corrupt values fall back to "no URL saved". */
function sanitizeConfig(raw) {
  const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    widgetUrl: typeof c.widgetUrl === 'string' && c.widgetUrl ? c.widgetUrl : null,
  };
}

/** Extract + validate the bid session id from a widget URL. */
function extractBotrixBid(url) {
  if (!url || !isAllowedWidgetUrl(url)) return null;
  const m = url.match(/[?&]bid=([^&#]+)/);
  if (!m) return null;
  let bid = m[1];
  try {
    bid = decodeURIComponent(bid);
  } catch {
    return null;
  }
  return /^[A-Za-z0-9_-]+$/.test(bid) ? bid : null;
}

/**
 * Diagnose a raw widget URL value into a machine-readable reason.
 * Every failure mode gets its own code so the UI can tell the user
 * EXACTLY what to fix (no more guessing at a blank panel).
 * Codes: ok | missing | empty | bad-protocol | bad-host | no-bid | bad-bid
 */
function diagnoseWidgetUrl(raw) {
  if (raw === null || raw === undefined) return { code: 'missing', url: null };
  const url = String(raw).trim();
  if (!url) return { code: 'empty', url: null };
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    return { code: 'bad-protocol', url };
  }
  if (parsed.protocol !== 'https:') return { code: 'bad-protocol', url };
  if (!isAllowedWidgetUrl(url)) return { code: 'bad-host', url };
  const bid = extractBotrixBid(url);
  if (!/[?&]bid=/.test(url)) return { code: 'no-bid', url };
  if (!bid) return { code: 'bad-bid', url };
  return { code: 'ok', url: canonicalWidgetUrl(url, bid), bid };
}

/**
 * Canonicalize a user-pasted BotRix widget URL: keep origin + /widgets/chat/
 * path + ONLY ?bid= (drop theme/sound/animation/toggles — display prefs the
 * panel manages itself). Extra params never reach the iframe or poller,
 * so users paste the whole BotRix link verbatim, no manual trimming.
 */
function canonicalWidgetUrl(url, bid) {
  try {
    const p = new URL(url);
    const path = p.pathname.endsWith('/') ? p.pathname : `${p.pathname}/`;
    return `${p.protocol}//${p.host}${path}?bid=${encodeURIComponent(bid || extractBotrixBid(url) || '')}`;
  } catch {
    return url;
  }
}

/** Extract a viewer count from a widget page body. Handles JSON
 * ({"viewerCount":N,...}) and HTML-embedded variants
 * (viewerCount: N, "viewerCount":N, data-viewer-count="N"). */
function parseViewerCount(body) {
  if (!body) return null;
  const m =
    String(body).match(/["']?viewerCount["']?\s*[:=]\s*["']?(-?\d+)/i) ||
    String(body).match(/data-viewer-count\s*=\s*["'](-?\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return n > 0 ? n : 0; // -1 (offline) and 0 read as 0
}

/** Build the per-platform BotRix viewers JSON API URL the poller fetches.
 * Verified live (and matching the widget's own bundle): the endpoint at
 * /api/widgets/viewers returns {"viewerCount":N} directly; the /widgets/
 * pages are client-rendered HTML whose bodies never contain the count. */
function buildViewerUrl(bid, platform) {
  return `https://botrix.live/api/widgets/viewers?platform=${encodeURIComponent(platform)}&bid=${encodeURIComponent(bid)}`;
}

/**
 * Build the viewer URL FROM the user's saved widget URL (settings db):
 * keeps the bid, forces the /api/widgets/viewers JSON endpoint,
 * appends one `?platform=<name>&bid=<bid>` per call — exactly:
 *   <widget-base>/api/widgets/viewers?platform=twitch&bid=<bid-from-env>
 *   <widget-base>/api/widgets/viewers?platform=kick&bid=<bid-from-env>
 *   <widget-base>/api/widgets/viewers?platform=youtube&bid=<bid-from-env>
 * Never comma-joins platforms; one request per platform. Returns null
 * when the configured URL has no usable bid.
 */
function buildViewerUrlFromWidgetUrl(widgetUrl, platform) {
  const bid = extractBotrixBid(widgetUrl);
  if (!bid) return null;
  let origin = 'https://botrix.live';
  try {
    const p = new URL(widgetUrl);
    if (p.protocol === 'https:' && isAllowedWidgetUrl(widgetUrl)) {
      origin = `${p.protocol}//${p.host}`;
    }
  } catch {
    /* fall back to canonical origin */
  }
  return `${origin}/api/widgets/viewers?platform=${encodeURIComponent(platform)}&bid=${encodeURIComponent(bid)}`;
}

/** Normalize a viewer payload for the header pills. */
function normalizeViewerCounts(v) {
  const pick = (k) => {
    const n = v ? Number(v[k]) : NaN;
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  };
  return {
    twitch: pick('twitch'),
    youtube: pick('youtube'),
    kick: pick('kick'),
  };
}

module.exports = {
  BOTRIX_WIDGET_HOSTS,
  numOr,
  boolOr,
  sanitizeChatState,
  sanitizeConfig,
  isAllowedWidgetUrl,
  extractBotrixBid,
  diagnoseWidgetUrl,
  parseViewerCount,
  buildViewerUrl,
  buildViewerUrlFromWidgetUrl,
  canonicalWidgetUrl,
  normalizeViewerCounts,
};
