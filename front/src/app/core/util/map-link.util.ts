/**
 * Google Maps link helpers for the enquiry Security tab (client 25-09-2026).
 *
 * The user pastes a Google Maps link for the security. We never iframe that
 * link directly (Google blocks framing of normal map pages). Instead we read the
 * location out of it and build Google's key-less embed URL ourselves:
 *   https://www.google.com/maps?q=<location>&z=16&output=embed
 * Short share links (maps.app.goo.gl/...) carry no location we can read in the
 * browser, so for those the map falls back to the property address / postcode.
 */

const HOSTS = /^((www\.|maps\.)?google\.(com|co\.uk)|goo\.gl|maps\.app\.goo\.gl)$/i;

/** True for an https Google Maps link (same rule the API applies). */
export function isGoogleMapsLink(link: string | null | undefined): boolean {
  if (!link) return false;
  try {
    const u = new URL(String(link).trim());
    if (u.protocol !== 'https:' || !HOSTS.test(u.hostname)) return false;
    if (/^goo\.gl$/i.test(u.hostname) && !u.pathname.startsWith('/maps')) return false;
    return true;
  } catch {
    return false;
  }
}

/** maps.app.goo.gl / goo.gl/maps share links — no location until the redirect is followed. */
export function isShortMapsLink(link: string | null | undefined): boolean {
  if (!isGoogleMapsLink(link)) return false;
  return /^(maps\.app\.goo\.gl|goo\.gl)$/i.test(new URL(String(link).trim()).hostname);
}

/** Pull a searchable location ("lat,lng" or a place / address) out of a Google Maps link. */
export function locationFromLink(link: string | null | undefined): string | null {
  if (!isGoogleMapsLink(link)) return null;
  const u = new URL(String(link).trim());
  const full = decodeURIComponent(u.pathname + u.search);
  // exact pin: !3d<lat>!4d<lng> (place pages), then @<lat>,<lng> (map view)
  const pin = full.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (pin) return `${pin[1]},${pin[2]}`;
  const at = full.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) return `${at[1]},${at[2]}`;
  const q = u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('destination') || u.searchParams.get('ll');
  if (q) return q;
  const place = u.pathname.match(/\/maps\/(?:place|search)\/([^/]+)/);
  if (place) return decodeURIComponent(place[1].replace(/\+/g, ' '));
  return null;
}

/**
 * Embed URL for the map. Uses the link's location when it has one, else the
 * address (+ postcode). null when there is nothing to show.
 */
export function mapEmbedUrl(link: string | null | undefined, address?: string | null, postcode?: string | null): string | null {
  const where = locationFromLink(link)
    || [address, postcode].map((x) => String(x ?? '').trim()).filter(Boolean).join(', ');
  if (!where) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(where)}&z=16&output=embed`;
}
