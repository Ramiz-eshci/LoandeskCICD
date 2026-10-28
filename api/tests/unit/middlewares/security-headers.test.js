'use strict';

const securityHeaders = require('../../../middlewares/security-headers');

function mockRes() {
  return {
    headers: {}, removed: [],
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    removeHeader(k) { this.removed.push(k); delete this.headers[k]; },
    on() { return this; },
  };
}

describe('middleware/security-headers', () => {
  it('sets the static hardening headers and strips X-Powered-By', () => {
    const res = mockRes();
    const next = jest.fn();
    securityHeaders()({ path: '/enquiries' }, res, next);
    expect(res.removed).toContain('X-Powered-By');
    expect(res.getHeader('X-Content-Type-Options')).toBe('nosniff');
    expect(res.getHeader('X-Frame-Options')).toBe('DENY');
    expect(res.getHeader('Content-Security-Policy')).toContain("default-src 'none'");
    expect(next).toHaveBeenCalled();
  });

  it('adds no-store on sensitive paths', () => {
    const res = mockRes();
    securityHeaders()({ path: '/auth/login' }, res, jest.fn());
    expect(res.getHeader('Cache-Control')).toContain('no-store');
  });

  it('does not set no-store on non-sensitive paths', () => {
    const res = mockRes();
    securityHeaders()({ path: '/enquiries' }, res, jest.fn());
    expect(res.getHeader('Cache-Control')).toBeUndefined();
  });

  it('treats the /api-mounted prefix the same', () => {
    const res = mockRes();
    securityHeaders()({ path: '/api/user/5' }, res, jest.fn());
    expect(res.getHeader('Cache-Control')).toContain('no-store');
  });
});
