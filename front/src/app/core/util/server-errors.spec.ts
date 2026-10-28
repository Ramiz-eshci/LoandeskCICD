import { extractFieldErrors, fieldLabel, toFieldErrorList, errorSummary } from './server-errors';

describe('server-errors / extractFieldErrors', () => {
  it('pulls the field map out of an HttpErrorResponse shape', () => {
    const e = { error: { errors: { phone: 'Too long', term_months: 'Required' } } };
    expect(extractFieldErrors(e)).toEqual({ phone: 'Too long', term_months: 'Required' });
  });

  it('returns an empty object when there is no map', () => {
    expect(extractFieldErrors(undefined)).toEqual({});
    expect(extractFieldErrors({})).toEqual({});
    expect(extractFieldErrors({ error: {} })).toEqual({});
  });

  it('drops non-string values', () => {
    const e = { error: { errors: { a: 'ok', b: 123 as unknown as string } } };
    expect(extractFieldErrors(e)).toEqual({ a: 'ok' });
  });
});

describe('server-errors / fieldLabel', () => {
  it('uses an override when present', () => {
    expect(fieldLabel('phone', { phone: 'Mobile number' })).toBe('Mobile number');
  });

  it('expands an applicants[n] path to a 1-based label', () => {
    expect(fieldLabel('applicants[0].mobile')).toBe('Applicant 1 — mobile');
  });

  it('humanises _id, _pct and underscores', () => {
    expect(fieldLabel('category_id')).toBe('Category');
    expect(fieldLabel('interest_pct')).toBe('Interest %');
    expect(fieldLabel('amount_requested')).toBe('Amount requested');
  });
});

describe('server-errors / toFieldErrorList', () => {
  it('maps each entry to field, message and label', () => {
    const list = toFieldErrorList({ amount_requested: 'Required' });
    expect(list).toEqual([{ field: 'amount_requested', message: 'Required', label: 'Amount requested' }]);
  });
});

describe('server-errors / errorSummary', () => {
  it('returns the fallback for an empty list', () => {
    expect(errorSummary([])).toBe('Please check the highlighted fields.');
  });

  it('shows the full message for a single error', () => {
    expect(errorSummary([{ field: 'phone', label: 'Phone', message: 'Too long' }])).toBe('Phone: Too long');
  });

  it('names the fields for several errors', () => {
    const out = errorSummary([
      { field: 'phone', label: 'Phone', message: 'x' },
      { field: 'term', label: 'Term', message: 'y' },
    ]);
    expect(out).toBe('Check these fields: Phone, Term');
  });
});
