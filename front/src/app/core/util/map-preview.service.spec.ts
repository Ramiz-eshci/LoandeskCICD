import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { MapPreviewService } from './map-preview.service';

describe('MapPreviewService', () => {
  let svc: MapPreviewService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), MapPreviewService],
    });
    svc = TestBed.inject(MapPreviewService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('embed() returns a SafeResourceUrl for an address', () => {
    expect(svc.embed(null, '10 High St', 'AB1 2CD')).toBeTruthy();
  });

  it('embed() returns null when a link is given but it is not a Google link', () => {
    expect(svc.embed('https://bing.com/maps')).toBeNull();
  });

  it('embed() returns null when there is nothing to show', () => {
    expect(svc.embed(null, '', '')).toBeNull();
  });

  it('openUrl() returns the link itself when it is a Google link', () => {
    const l = 'https://www.google.com/maps/place/x';
    expect(svc.openUrl(l)).toBe(l);
  });

  it('openUrl() builds a search url from the address otherwise', () => {
    expect(svc.openUrl(null, '10 High St'))
      .toBe('https://www.google.com/maps/search/?api=1&query=10%20High%20St');
  });

  it('embed() resolves a short share link once through the API', () => {
    svc.embed('https://maps.app.goo.gl/abc', '1 Fallback Rd');
    const req = http.expectOne((r) => r.url.endsWith('/meta/resolve-map-link'));
    expect(req.request.params.get('url')).toBe('https://maps.app.goo.gl/abc');
    req.flush({ status: true, message: 'ok', data: { url: 'https://www.google.com/maps?q=51.5,-0.1' } });
  });
});
