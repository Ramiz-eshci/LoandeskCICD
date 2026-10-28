'use strict';

/**
 * "Open in Google Maps" links for PDFs (Credit Deal Summary, client 29-09-2026).
 * No map pictures, no API key, no network: each security gets a clickable link —
 * its own Google Maps link when one was entered, else a Google Maps search for
 * the address + postcode.
 */

/** @param {{label:string, link?:string, address?:string, postcode?:string}[]} list */
function securityMapLinks(list) {
  return (list || []).map((s) => {
    const address = [s.address, s.postcode].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
    const own = String(s.link || '').trim();
    const url = /^https:\/\//i.test(own) ? own
      : (address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null);
    return { label: s.label, address, url };
  }).filter((m) => m.url);
}

module.exports = { securityMapLinks };
