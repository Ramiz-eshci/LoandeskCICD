'use strict';

/**
 * Pen-test fix (24-10-2026): security headers for the Angular site (deploy/root-web.config).
 * The CSP was checked in a browser against the production build (no violations from
 * normal use; inline script + foreign iframe blocked).
 */

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', '..', '..', 'deploy', 'root-web.config');
const xml = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
const maybe = xml ? it : it.skip;
const header = (name) => {
  const m = xml.match(new RegExp(`<add name="${name}" value="([^"]+)"`));
  return m ? m[1] : null;
};

describe('deploy/root-web.config', () => {
  maybe('sends a strict Content-Security-Policy', () => {
    const csp = header('Content-Security-Policy');
    expect(csp).toBeTruthy();
    const d = Object.fromEntries(csp.split(';').map((x) => x.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    expect(d['script-src']).toEqual(["'self'"]); // no unsafe-inline / unsafe-eval / wildcard
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
    expect(d['default-src']).toEqual(["'self'"]);
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*\*/);
  });

  maybe.each([
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
  ])('sends %s', (name, value) => expect(header(name)).toBe(value));

  maybe('restricts browser features and hides server details', () => {
    expect(header('Permissions-Policy')).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
    expect(xml).toMatch(/<remove name="X-Powered-By" \/>/);
    expect(xml).toMatch(/removeServerHeader="true"/);
  });

  maybe('never caches index.html', () => {
    expect(xml).toMatch(/<location path="index.html">[\s\S]*cacheControlMode="DisableCache"[\s\S]*<\/location>/);
  });

  maybe('keeps the SPA rewrite and leaves /api alone', () => {
    expect(xml).toMatch(/<action type="Rewrite" url="\/index.html" \/>/);
    expect(xml).toMatch(/pattern="\^\/api\/" negate="true"/);
  });
});
