'use strict';

jest.mock('../../../config/database', () => ({ query: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ warn: jest.fn(), info: jest.fn() }));

const db = require('../../../config/database');
const hub = require('../../../services/emailHub.service');

beforeEach(() => { hub.invalidate(); db.query.mockReset(); });

describe('emailHub / templates', () => {
  it('renders placeholders, escaping values but not the ready-made HTML blocks', () => {
    const out = hub.renderHtml('<p>Hi {{RecipientName}}</p>{{NotesBlock}}{{ Missing }}', {
      RecipientName: '<b>Jo</b>', NotesBlock: '<p>system</p>',
    }, ['NotesBlock']);
    expect(out).toBe('<p>Hi &lt;b&gt;Jo&lt;/b&gt;</p><p>system</p>');
  });

  it('renders a one-line subject', () => {
    expect(hub.renderText('Offer {{Ref}}\n- {{Borrower}}', { Ref: 'ENQ-1', Borrower: 'A&B' })).toBe('Offer ENQ-1 - A&B');
  });

  it('reports placeholders the e-mail does not supply', () => {
    expect(hub.unknownPlaceholders('ENQUIRY_OFFER', '{{Ref}} {{BDMName}}', '{{LoanAmount}}')).toEqual(['LoanAmount']);
  });

  it('strips scripts, handlers and javascript links', () => {
    const out = hub.sanitizeHtml('<p onclick="x()">a</p><script>alert(1)</script><a href="javascript:x()">l</a><iframe src="y"></iframe>');
    expect(out).toBe('<p>a</p><a>l</a>');
  });

  // Pen-test 24-10-2026: payloads that got through the old regex sanitizer
  it.each([
    ['<svg/onload=alert(1)>', ''],
    ['<a href=javascript:alert(1)>x</a>', '<a>x</a>'],
    ['<a href=" JaVaScRiPt:alert(1)">x</a>', '<a>x</a>'],
    ['<img src="https://x/logo.png" onerror="alert(1)">', '<img src="https://x/logo.png">'],
    ['<img/src=x/onerror=alert(1)>', ''],
    ['<a href="java&#x09;script:alert(1)">x</a>', '<a>x</a>'],
    ['<p style="background:url(javascript:alert(1))">s</p>', '<p style>s</p>'],
    ['<details open ontoggle=alert(1)>t</details>', 't'],
    ['<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>', '<table><img>'],
    ['<form action="https://evil"><input name=p></form>', ''],
  ])('neutralises %s', (input, expected) => {
    const out = hub.sanitizeHtml(input);
    expect(out).toBe(expected);
    expect(out).not.toMatch(/on[a-z]+=|javascript:|<script|<svg|<form/i);
  });

  it('keeps template formatting and {{placeholders}}', () => {
    const html = '<p style="color:#0f2244">Hi {{RecipientName}},</p><table cellpadding="0"><tr><td style="padding:3px">a</td></tr></table><ul><li><b>x</b></li></ul><a href="{{Link}}">Reset</a>';
    expect(hub.sanitizeHtml(html)).toBe(html);
  });
});

describe('emailHub / prepare', () => {
  const base = {
    event: 'ENQUIRY_OFFER', ref: { module: 'ENQUIRY', id: 5, number: 'ENQ-5' },
    to: ['broker@x.com'], cc: ['bdm@x.com'], subject: 'Sys subject', html: '<p>sys</p>', attachments: [],
    vars: { Ref: 'ENQ-5', RecipientName: 'Bob' }, req: { userData: { userId: 1 } },
  };

  it('returns the e-mail unchanged when the event was never configured', async () => {
    db.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]) // settings, rules, files
      .mockResolvedValueOnce([{ email: 'me@x.com', full_name: 'Me' }]) // sender
      .mockResolvedValueOnce([]); // people
    const out = await hub.prepare(base);
    expect(out).toMatchObject({ to: ['broker@x.com'], cc: ['bdm@x.com'], subject: 'Sys subject', html: '<p>sys</p>' });
  });

  it('adds users / roles / dynamic CC, drops system CC, applies custom text, dedupes', async () => {
    db.query
      .mockResolvedValueOnce([{ event_key: 'ENQUIRY_OFFER', include_default_cc: false, subject_template: 'Offer {{Ref}}', body_template: '<p>Hello {{RecipientName}}, BDM {{BDMName}}</p>' }])
      .mockResolvedValueOnce([
        { rule_type: 'USER', user_id: 7 }, { rule_type: 'ROLE', role_id: 3 }, { rule_type: 'DYNAMIC', dynamic_key: 'BDM' },
      ])
      .mockResolvedValueOnce([]) // files
      .mockResolvedValueOnce([{ email: 'me@x.com', full_name: 'Me' }]) // sender
      .mockResolvedValueOnce([{ bdm_email: 'bdm@x.com', bdm_name: 'Bea', uw_email: null }]) // people
      .mockResolvedValueOnce([{ email: 'head@x.com' }]) // users
      .mockResolvedValueOnce([{ email: 'HEAD@x.com' }, { email: 'broker@x.com' }, { email: 'ops@x.com' }]); // roles
    const out = await hub.prepare(base);
    expect(out.cc).toEqual(['head@x.com', 'ops@x.com', 'bdm@x.com']);
    expect(out.subject).toBe('Offer ENQ-5');
    expect(out.html).toBe('<p>Hello Bob, BDM Bea</p>');
  });

  it('skips extra CC when applyRules is false', async () => {
    db.query
      .mockResolvedValueOnce([{ include_default_cc: true }])
      .mockResolvedValueOnce([{ rule_type: 'USER', user_id: 7 }])
      .mockResolvedValueOnce([]);
    const out = await hub.prepare({ ...base, applyRules: false });
    expect(out.cc).toEqual(['bdm@x.com']);
  });

  it('keeps a user-typed CC even when system CC is off (ccFromUser)', async () => {
    db.query
      .mockResolvedValueOnce([{ include_default_cc: false }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const out = await hub.prepare({ ...base, event: 'REDEMPTION_STATEMENT', ref: { module: 'REDEMPTION', id: 1 } });
    expect(out.cc).toEqual(['bdm@x.com']);
  });

  it('falls back to the original e-mail when settings cannot be read', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const out = await hub.prepare(base);
    expect(out).toMatchObject({ cc: ['bdm@x.com'], subject: 'Sys subject' });
  });

  it('never touches security e-mails', async () => {
    const out = await hub.prepare({ ...base, event: 'AUTH_OTP' });
    expect(out.cc).toEqual(['bdm@x.com']);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('emailHub / log', () => {
  it('writes a row with module, ref and status; no body for security e-mails', async () => {
    db.query.mockResolvedValueOnce([]);
    await hub.log({ event: 'AUTH_OTP', to: ['a@x.com'], cc: [], subject: 'Code', html: '<p>123456</p>', result: { ok: true } });
    const params = db.query.mock.calls[0][1];
    expect(params[1]).toBe('AUTH');
    expect(params[7]).toBeNull();
    expect(params[9]).toBe('Sent');
  });

  it('returns the new email_log id (used to link reply attachments)', async () => {
    db.query.mockResolvedValueOnce([{ id: 42 }]);
    await expect(hub.log({ event: 'ENQUIRY_OFFER', to: ['a@x.com'], result: { ok: true } })).resolves.toBe(42);
  });

  it('never throws - returns null when the log write fails', async () => {
    db.query.mockRejectedValueOnce(new Error('no table'));
    await expect(hub.log({ event: 'ENQUIRY_OFFER', to: ['a@x.com'], result: { ok: false, error: 'x' } })).resolves.toBeNull();
  });
});
