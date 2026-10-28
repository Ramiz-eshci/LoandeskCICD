'use strict';

/**
 * Google Maps short-link resolver (client 29-09-2026).
 *
 * Share links such as https://maps.app.goo.gl/AbCd carry no location the
 * browser can read — the location only appears after Google's redirect. The
 * browser cannot follow that redirect (CORS), so the API follows it and hands
 * back the long https://www.google.com/maps/... URL, which has the pin in it.
 *
 * SSRF-safe: only https, only Google hosts at every hop, max 5 hops, 5s timeout.
 */

const HOSTS = /^((www\.|maps\.)?google\.(com|co\.uk)|goo\.gl|maps\.app\.goo\.gl|consent\.google\.com)$/i;
const SHORT = /^(maps\.app\.goo\.gl|goo\.gl)$/i;
const cache = new Map();

function safeUrl(v, base) {
  try {
    const u = new URL(String(v).trim(), base);
    return u.protocol === 'https:' && HOSTS.test(u.hostname) ? u : null;
  } catch (_) { return null; }
}

/** Returns the long Google Maps URL for a link (unchanged when already long), or null when not a Google Maps link. */
async function resolveMapLink(link) {
  let cur = safeUrl(link);
  if (!cur) return null;
  if (!SHORT.test(cur.hostname)) return cur.toString();
  const key = cur.toString();
  if (cache.has(key)) return cache.get(key);

  for (let hop = 0; hop < 5; hop++) {
    // EU consent interstitial wraps the real target in ?continue=
    if (/^consent\.google\.com$/i.test(cur.hostname)) {
      const next = safeUrl(cur.searchParams.get('continue') || '');
      if (!next) break;
      cur = next;
      continue;
    }
    if (!SHORT.test(cur.hostname)) break;
    let r;
    try {
      r = await fetch(cur.toString(), { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(5000) });
    } catch (_) { break; }
    const loc = r.headers.get('location');
    if (!loc) break;
    const next = safeUrl(loc, cur.toString());
    if (!next) break;
    cur = next;
  }
  const out = cur.toString();
  if (cache.size > 500) cache.clear();
  cache.set(key, out);
  return out;
}

module.exports = { resolveMapLink };
