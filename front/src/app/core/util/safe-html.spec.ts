import { cleanEmailHtml } from './safe-html';

describe('cleanEmailHtml (pen-test 24-10-2026)', () => {
  it.each([
    ['<svg/onload=alert(1)>', ''],
    ['<img src=x onerror=alert(1)>', '<img>'],
    ['<p style="background:url(javascript:alert(1))">s</p>', '<p>s</p>'],
    ['<a href="javascript:alert(1)">x</a>', '<a>x</a>'],
    ['<a href=" JaVaScRiPt:alert(1)">x</a>', '<a>x</a>'],
    ['<p onclick="x()">a</p>', '<p>a</p>'],
    ['<script>alert(1)</script>ok', 'ok'],
    ['<iframe src="https://evil"></iframe>t', 't'],
    ['<form action="https://evil"><input name="p"></form>', ''],
    ['<details open ontoggle=alert(1)>t</details>', 't'],
  ])('neutralises %s', (input, expected) => {
    const out = cleanEmailHtml(input);
    expect(out).toBe(expected);
    expect(out).not.toMatch(/on[a-z]+=|javascript:|<script|<svg|<iframe|<form/i);
  });

  it('keeps template formatting, links and {{placeholders}}', () => {
    const html = '<p style="color:#0f2244">Hi {{RecipientName}},</p><table cellpadding="0" cellspacing="0" border="0"><tbody><tr><td style="padding:3px">a</td></tr></tbody></table>'
      + '<ul><li><b>x</b></li></ul><a href="{{Link}}">Reset</a><a href="https://scotlend.co.uk">s</a><a href="mailto:a@b.com">m</a>';
    expect(cleanEmailHtml(html)).toBe(html);
  });

  it('handles empty input', () => {
    expect(cleanEmailHtml(null)).toBe('');
    expect(cleanEmailHtml(undefined)).toBe('');
  });
});
