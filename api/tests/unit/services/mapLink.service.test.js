'use strict';

/** Google Maps link helpers - incl. SSRF protection of the short-link resolver. */

const { resolveMapLink } = require('../../../services/mapLink.service');
const { securityMapLinks } = require('../../../services/mapLinks.service');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const redirect = (location) => ({ headers: { get: (h) => (h === 'location' ? location : null) } });

describe('mapLink.resolveMapLink', () => {
  it('returns long Google Maps URLs unchanged without any network call', async () => {
    global.fetch = jest.fn();
    const url = 'https://www.google.com/maps/place/@55.95,-3.19,17z';
    expect(await resolveMapLink(url)).toBe(url);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    'http://maps.app.goo.gl/abc',          // not https
    'https://evil.example.com/maps',       // not Google
    'https://maps.app.goo.gl.evil.com/x',  // look-alike host
    'javascript:alert(1)',
    'not a url',
  ])('refuses %s (SSRF guard)', async (link) => {
    global.fetch = jest.fn();
    expect(await resolveMapLink(link)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('follows a short link to the long URL', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(redirect('https://www.google.com/maps/place/X'));
    expect(await resolveMapLink('https://maps.app.goo.gl/ok1')).toBe('https://www.google.com/maps/place/X');
    expect(global.fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('stops at a redirect to a non-Google host (never fetches it)', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(redirect('https://169.254.169.254/latest/meta-data'));
    expect(await resolveMapLink('https://maps.app.goo.gl/evil1')).toBe('https://maps.app.goo.gl/evil1');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('unwraps the EU consent interstitial', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(
      redirect('https://consent.google.com/m?continue=' + encodeURIComponent('https://www.google.com/maps/place/Y')),
    );
    expect(await resolveMapLink('https://maps.app.goo.gl/consent1')).toBe('https://www.google.com/maps/place/Y');
  });

  it('gives up after 5 hops and caches the result', async () => {
    global.fetch = jest.fn().mockImplementation(async () => redirect('https://goo.gl/loop'));
    await resolveMapLink('https://maps.app.goo.gl/loop1');
    expect(global.fetch).toHaveBeenCalledTimes(5);
    await resolveMapLink('https://maps.app.goo.gl/loop1');
    expect(global.fetch).toHaveBeenCalledTimes(5);
  });

  it('survives network errors', async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('timeout'));
    expect(await resolveMapLink('https://maps.app.goo.gl/down1')).toBe('https://maps.app.goo.gl/down1');
  });
});

describe('mapLinks.securityMapLinks', () => {
  it('uses the entered https link, else a Maps search for address + postcode, else drops the row', () => {
    expect(securityMapLinks([
      { label: 'S1', link: 'https://maps.app.goo.gl/a', address: '1 Road', postcode: 'EH1 1AA' },
      { label: 'S2', link: 'javascript:alert(1)', address: '2 Road', postcode: 'EH2 2BB' },
      { label: 'S3', link: '', address: '', postcode: '' },
    ])).toEqual([
      { label: 'S1', address: '1 Road, EH1 1AA', url: 'https://maps.app.goo.gl/a' },
      { label: 'S2', address: '2 Road, EH2 2BB', url: 'https://www.google.com/maps/search/?api=1&query=2%20Road%2C%20EH2%202BB' },
    ]);
    expect(securityMapLinks(null)).toEqual([]);
  });
});
