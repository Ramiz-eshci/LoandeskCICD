import { isGoogleMapsLink, isShortMapsLink, locationFromLink, mapEmbedUrl } from './map-link.util';

describe('map-link.util / isGoogleMapsLink', () => {
  it('accepts https google / goo.gl maps hosts', () => {
    expect(isGoogleMapsLink('https://www.google.com/maps/place/x')).toBe(true);
    expect(isGoogleMapsLink('https://maps.app.goo.gl/abc')).toBe(true);
    expect(isGoogleMapsLink('https://goo.gl/maps/abc')).toBe(true);
  });

  it('rejects empty, non-https and non-google links', () => {
    expect(isGoogleMapsLink(null)).toBe(false);
    expect(isGoogleMapsLink('http://www.google.com/maps')).toBe(false);
    expect(isGoogleMapsLink('https://bing.com/maps')).toBe(false);
    expect(isGoogleMapsLink('not a url')).toBe(false);
  });

  it('rejects goo.gl links that are not /maps', () => {
    expect(isGoogleMapsLink('https://goo.gl/abc')).toBe(false);
  });
});

describe('map-link.util / isShortMapsLink', () => {
  it('is true only for the share-link hosts', () => {
    expect(isShortMapsLink('https://maps.app.goo.gl/abc')).toBe(true);
    expect(isShortMapsLink('https://goo.gl/maps/abc')).toBe(true);
    expect(isShortMapsLink('https://www.google.com/maps/place/x')).toBe(false);
  });
});

describe('map-link.util / locationFromLink', () => {
  it('prefers the exact pin !3d<lat>!4d<lng> over the @ map view', () => {
    expect(locationFromLink('https://www.google.com/maps/place/x/@51.5,-0.1,17z/data=!3d51.5074!4d-0.1278'))
      .toBe('51.5074,-0.1278');
  });

  it('falls back to the @lat,lng map view', () => {
    expect(locationFromLink('https://www.google.com/maps/@51.5074,-0.1278,15z')).toBe('51.5074,-0.1278');
  });

  it('reads the q query parameter', () => {
    expect(locationFromLink('https://www.google.com/maps?q=10+High+St')).toBe('10 High St');
  });

  it('reads a place path segment', () => {
    expect(locationFromLink('https://www.google.com/maps/place/Big+Ben')).toBe('Big Ben');
  });

  it('returns null for a non-google link', () => {
    expect(locationFromLink('https://bing.com/maps')).toBeNull();
  });
});

describe('map-link.util / mapEmbedUrl', () => {
  it('builds the keyless embed url from a link location', () => {
    const url = mapEmbedUrl('https://www.google.com/maps?q=10 High St');
    expect(url).toBe('https://www.google.com/maps?q=10%20High%20St&z=16&output=embed');
  });

  it('falls back to the address + postcode when no link', () => {
    expect(mapEmbedUrl(null, '10 High St', 'AB1 2CD'))
      .toBe('https://www.google.com/maps?q=10%20High%20St%2C%20AB1%202CD&z=16&output=embed');
  });

  it('returns null when there is nothing to show', () => {
    expect(mapEmbedUrl(null, '', '')).toBeNull();
  });
});
