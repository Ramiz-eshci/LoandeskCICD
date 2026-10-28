import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let svc: NotificationsService;
  let http: HttpTestingController;
  const base = '/api/notifications';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(NotificationsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() applies the limit query and defaults data to []', () => {
    let out: unknown;
    svc.list(5).subscribe((r) => (out = r));
    const req = http.expectOne(`${base}?limit=5`);
    expect(req.request.method).toBe('GET');
    req.flush({ status: true, message: 'ok', data: null });
    expect(out).toEqual([]);
  });

  it('unreadCount() unwraps the count (0 by default)', () => {
    let out: number | undefined;
    svc.unreadCount().subscribe((r) => (out = r));
    http.expectOne(`${base}/unread-count`).flush({ status: true, message: 'ok', data: {} });
    expect(out).toBe(0);
  });

  it('markRead() PATCHes /:id/read', () => {
    svc.markRead(3).subscribe();
    const req = http.expectOne(`${base}/3/read`);
    expect(req.request.method).toBe('PATCH');
    req.flush({});
  });

  it('markAllRead() POSTs /read-all', () => {
    svc.markAllRead().subscribe();
    const req = http.expectOne(`${base}/read-all`);
    expect(req.request.method).toBe('POST');
    req.flush({});
  });
});
