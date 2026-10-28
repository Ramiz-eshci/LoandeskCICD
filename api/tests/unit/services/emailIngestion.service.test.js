'use strict';

/** Email -> enquiry ingestion: parsing helpers + idempotent ingest flow. */

jest.mock('../../../config/database', () => ({ query: jest.fn() }));
jest.mock('fs', () => ({ ...jest.requireActual('fs'), existsSync: jest.fn(() => true), mkdirSync: jest.fn(), writeFileSync: jest.fn() }));
jest.mock('../../../services/enquiry.service', () => ({ create: jest.fn() }));
jest.mock('../../../services/emailExtractor.service', () => ({
  extractFormFields: jest.fn(),
  htmlToText: jest.fn((c) => String(c || '')),
}));

const fs = require('fs');
const db = require('../../../config/database');
const enquiryService = require('../../../services/enquiry.service');
const { extractFormFields } = require('../../../services/emailExtractor.service');
const ing = require('../../../services/emailIngestion.service');

describe('emailIngestion helpers', () => {
  it.each([['£250,000.50', 250000.5], ['250000', 250000], ['GBP 1,000', 1000], ['none', null], ['', null], ['0', null]])(
    'parseAmount(%p) -> %p', (v, n) => expect(ing.parseAmount(v)).toBe(n));

  it.each([['12 months', 12], ['2 years', 24], ['18', 18], ['3 yrs', 36], ['soon', null], [null, null]])(
    'parseTermMonths(%p) -> %p', (v, n) => expect(ing.parseTermMonths(v)).toBe(n));

  it('sanitizeText keeps only the enquiry-safe charset and caps the length', () => {
    expect(ing.sanitizeText('<script>alert(1)</script> 10 High St; DROP')).toBe('script alert(1) /script 10 High St DROP');
    expect(ing.sanitizeText('a'.repeat(50), 10)).toHaveLength(10);
    expect(ing.sanitizeText('***')).toBeNull();
    expect(ing.sanitizeText(null)).toBeNull();
  });
});

describe('emailIngestion.ingestMessage', () => {
  const message = {
    id: 'MSG-1',
    subject: 'Bridging loan',
    body: { content: 'Need £100,000', contentType: 'text' },
    from: { emailAddress: { address: 'john.doe@broker.co.uk', name: '' } },
  };

  beforeEach(() => {
    db.query.mockReset();
    extractFormFields.mockResolvedValue({ val: '£100,000', wantsUpTo: '12 months', property: '1 Road, EH1 1AA', loanApply: '' });
  });

  it('skips a message that was already ingested (idempotent)', async () => {
    db.query.mockResolvedValueOnce([{ outlook_email_id: 1, enquiry_id: 77 }]);
    expect(await ing.ingestMessage(message)).toEqual({ skipped: true, enquiryId: 77, reason: 'already processed' });
    expect(enquiryService.create).not.toHaveBeenCalled();
  });

  it('refuses a message without an id', async () => {
    expect(await ing.ingestMessage({})).toEqual({ ok: false, reason: 'missing message id' });
  });

  it('creates the enquiry through the shared service and archives the email', async () => {
    db.query
      .mockResolvedValueOnce([])                 // not processed yet
      .mockResolvedValueOnce([{ id: 9 }])        // EMAIL source id
      .mockResolvedValue([]);                    // archive insert
    enquiryService.create.mockResolvedValueOnce({ ok: true, id: 501, ref: 'ENQ-2026-00501' });

    expect(await ing.ingestMessage(message, [])).toEqual({ ok: true, enquiryId: 501, ref: 'ENQ-2026-00501' });
    const [body, user, opts] = enquiryService.create.mock.calls[0];
    expect(body).toMatchObject({
      applicant_name: 'John Doe',           // derived from the sender address
      amount_requested: 100000,
      term_months: 12,
      email: 'john.doe@broker.co.uk',
      lead_source: 'Email',
      application_source_id: 9,
    });
    expect(user).toBeNull();
    expect(opts).toEqual({ source: 'email' });
    const archive = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO outlook_processed_emails'));
    expect(archive[1][0]).toBe('MSG-1');
    expect(archive[1][13]).toBe('processed');
  });

  it('archives a validation failure without throwing', async () => {
    db.query.mockResolvedValueOnce([]).mockResolvedValue([]);
    enquiryService.create.mockResolvedValueOnce({ ok: false, errors: { applicant_name: 'required' } });
    const out = await ing.ingestMessage({ ...message, id: 'MSG-2' });
    expect(out).toMatchObject({ ok: false, reason: 'validation_failed' });
    const archive = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO outlook_processed_emails'));
    expect(archive[1][13]).toBe('validation_failed');
  });

  it('treats a concurrent duplicate archive insert (SQL 2627) as success', async () => {
    db.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockRejectedValueOnce(Object.assign(new Error('dup'), { number: 2627 }));
    enquiryService.create.mockResolvedValueOnce({ ok: true, id: 1, ref: 'ENQ-1' });
    await expect(ing.ingestMessage({ ...message, id: 'MSG-3' })).resolves.toMatchObject({ ok: true });
  });
});

describe('emailIngestion attachments (pen-test 24-10-2026)', () => {
  const message = { id: 'MSG-ATT', body: { content: 'x', contentType: 'text' }, from: { emailAddress: { address: 'a@b.co.uk' } } };
  const att = (name, buf) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name, contentBytes: Buffer.from(buf).toString('base64') });

  beforeEach(() => {
    db.query.mockReset().mockResolvedValue([]);
    fs.writeFileSync.mockClear();
    extractFormFields.mockResolvedValue({ val: '', wantsUpTo: '', property: '', loanApply: '' });
    enquiryService.create.mockResolvedValue({ ok: true, id: 7, ref: 'ENQ-7' });
  });

  it('stores genuine documents and skips executables / disallowed types', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await ing.ingestMessage(message, [
      att('Valuation.pdf', '%PDF-1.7 report'),
      att('invoice.pdf', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(60)])),
      att('setup.exe', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(60)])),
      att('x.html', '<script>alert(1)</script>'),
    ]);
    const written = fs.writeFileSync.mock.calls.map(([p]) => String(p));
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/_Valuation\.pdf$/);
    const docs = db.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO enquiry_documents'));
    expect(docs.map((c) => c[1][1])).toEqual(['Valuation.pdf']);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});
