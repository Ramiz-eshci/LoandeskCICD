import { auditAction, auditSummary, AuditRowLike } from './audit.util';

describe('audit.util / auditAction', () => {
  it('title-cases an UPPER_SNAKE action', () => {
    expect(auditAction('OFFER_EMAILED')).toBe('Offer Emailed');
  });

  it('returns an empty string for null/undefined', () => {
    expect(auditAction(null)).toBe('');
    expect(auditAction(undefined)).toBe('');
  });
});

describe('audit.util / auditSummary', () => {
  it('renders a field-level diff from changed_fields', () => {
    const row: AuditRowLike = {
      details: { changed_fields: { branch_id: { from: 1, to: 2 }, term_months: { from: null, to: 12 } } },
    };
    const out = auditSummary(row);
    expect(out).toContain('Branch: 1 → 2');
    expect(out).toContain('Term Months: — → 12');
  });

  it('parses details given as raw JSON text and never throws on bad JSON', () => {
    expect(auditSummary({ details: '{"fields":["phone","email"]}' })).toContain('Updated: Phone, Email');
    expect(auditSummary({ details: '{bad json' })).toBe('');
  });

  it('prefixes step and version meta, then the body', () => {
    const out = auditSummary({ step_no: 3, details: { version_no: 2, fields: ['phone'] } });
    expect(out.startsWith('Step 3 · v2')).toBe(true);
    expect(out).toContain('Updated: Phone');
  });

  it('shows a status transition', () => {
    expect(auditSummary({ from_status: 'Draft', to_status: 'Submitted' })).toBe('Draft → Submitted');
    expect(auditSummary({ to_status: 'Submitted' })).toBe('→ Submitted');
  });

  it('appends a reason from the row or the details', () => {
    expect(auditSummary({ reason: 'client asked' })).toBe('client asked');
    expect(auditSummary({ details: { reason: 'from details' } })).toContain('from details');
  });
});
