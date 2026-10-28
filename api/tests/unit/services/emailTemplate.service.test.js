'use strict';

const { otpEmail, resetPasswordEmail, shell } = require('../../../services/emailTemplate.service');

describe('emailTemplate.service', () => {
  it('shell wraps content in the branded layout', () => {
    const html = shell('<p>BODY</p>');
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<p>BODY</p>');
    expect(html).toContain('LoanDesk');
    expect(html).toContain(String(new Date().getFullYear()));
  });

  it('otpEmail shows each digit and the expiry in minutes', () => {
    const { subject, html } = otpEmail({ code: '482913', ttlSeconds: 300 });
    expect(subject).toBeTruthy();
    for (const d of '482913') expect(html).toContain(`>${d}<`);
    expect(html).toMatch(/5 minutes?/);
  });

  it('otpEmail rounds very short TTLs up to 1 minute', () => {
    expect(otpEmail({ code: '1', ttlSeconds: 10 }).html).toMatch(/1 minute/);
  });

  it('resetPasswordEmail contains the reset link and lifetime', () => {
    const out = resetPasswordEmail({ link: 'https://app/reset?t=abc', name: 'Jane', ttlMinutes: 60 });
    expect(out.subject).toBeTruthy();
    expect(out.html).toContain('href="https://app/reset?t=abc"');
    expect(out.html).toContain('Hi Jane,');
    expect(out.html).toContain('1 hour');
    expect(resetPasswordEmail({ link: 'x', ttlMinutes: 30 }).html).toContain('30 minutes');
    expect(resetPasswordEmail({ link: 'x' }).html).toContain('Hello,');
  });

  it('resetPasswordEmail HTML-escapes the name and link (no injection into the e-mail)', () => {
    const out = resetPasswordEmail({ link: 'https://x/"><script>alert(1)</script>', name: '<img src=x onerror=alert(1)>' });
    expect(out.html).not.toContain('<script>alert(1)</script>');
    expect(out.html).not.toContain('<img src=x');
    expect(out.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out.html).toContain('&quot;&gt;&lt;script&gt;');
  });
});
