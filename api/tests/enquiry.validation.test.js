'use strict';

/**
 * Field-size and range validation for the enquiry module.
 *
 * Regression: a 40-character phone number passed the phone regex, reached
 * NVARCHAR(30) and SQL Server aborted the insert with
 *   "String or binary data would be truncated in table ... column 'phone'"
 * which surfaced to the user as a raw database error naming the schema.
 * Nothing over-long must ever reach SQL again.
 */

const enquiry = require('../services/enquiry.service');

// 40 digits: over the enquiry's own phone column (NVARCHAR(30)) — this is the
// value from the crashing payload. The applicant mobile column is NVARCHAR(40),
// so 40 fits there and only 41+ is a failure.
const LONG_PHONE = '1'.repeat(40);
const OVER_APPLICANT_MOBILE = '1'.repeat(41);

describe('enquiry validate — length limits', () => {
  it('rejects a phone longer than the column, instead of letting SQL truncate', () => {
    const { ok, errors } = enquiry.validate({ email: 'a@b.com', loan_purpose_id: 1, phone: LONG_PHONE });
    expect(ok).toBe(false);
    expect(errors.phone).toMatch(/30 characters or fewer/);
  });

  it('accepts a phone at exactly the limit', () => {
    const { errors } = enquiry.validate({ email: 'a@b.com', loan_purpose_id: 1, phone: '1'.repeat(30) });
    expect(errors.phone).toBeUndefined();
  });

  it('rejects an over-long applicant name', () => {
    const { errors } = enquiry.validate({ email: 'a@b.com', loan_purpose_id: 1, applicant_name: 'x'.repeat(201) });
    expect(errors.applicant_name).toMatch(/200 characters or fewer/);
  });

  it('rejects an over-long property address', () => {
    const { errors } = enquiry.validate({ email: 'a@b.com', loan_purpose_id: 1, property_address: 'x'.repeat(256) });
    expect(errors.property_address).toMatch(/255 characters or fewer/);
  });
});

describe('enquiry validate — numeric ranges', () => {
  it('rejects a nonsense term', () => {
    const { ok, errors } = enquiry.validate({ email: 'a@b.com', loan_purpose_id: 1, term_months: 900000 });
    expect(ok).toBe(false);
    expect(errors.term_months).toMatch(/600 or less/);
  });

  it('accepts a normal term', () => {
    const { errors } = enquiry.validate({ email: 'a@b.com', loan_purpose_id: 1, term_months: 12 });
    expect(errors.term_months).toBeUndefined();
  });

  it('rejects a zero-month term', () => {
    const { errors } = enquiry.validate({ email: 'a@b.com', loan_purpose_id: 1, term_months: 0 });
    expect(errors.term_months).toMatch(/1 or more/);
  });
});

describe('enquiry validate — applicant rows', () => {
  it('rejects an over-long mobile on an applicant', () => {
    const errors = enquiry.validateApplicants([{ full_name: 'A', mobile: OVER_APPLICANT_MOBILE }]);
    expect(errors['applicants[0].mobile']).toMatch(/40 characters or fewer/);
  });

  it('rejects an over-long nationality — silently truncated before', () => {
    const errors = enquiry.validateApplicants([{ full_name: 'A', nationality: 'x'.repeat(100) }]);
    expect(errors['applicants[0].nationality']).toMatch(/80 characters or fewer/);
  });

  it('reports the row index so the client can point at the right applicant', () => {
    const errors = enquiry.validateApplicants([{ full_name: 'A' }, { full_name: 'B', mobile: OVER_APPLICANT_MOBILE }]);
    expect(Object.keys(errors)).toEqual(['applicants[1].mobile']);
  });

  it('passes a clean list', () => {
    expect(enquiry.validateApplicants([{ full_name: 'A', email: 'a@b.com', mobile: '07700 900000' }])).toEqual({});
  });
});

describe('the exact payload that crashed', () => {
  it('is rejected with field errors, not a database error', () => {
    const payload = {
      application_source_id: '3', lead_source: 'Broker Introduction', broker_id: '1',
      branch_id: '2', product_id: '5', loan_purpose_id: '1',
      amount_requested: 89000, term_months: 900000,
      property_address: 'stereee', applicant_type_id: 1,
      applicant_name: 'nimit shahhhhhhhhhhh', email: 'zachhhhhhhhhhhhhhhhhh@gmail.com',
      phone: LONG_PHONE, dob: '2026-09-11',
    };
    const { ok, errors } = enquiry.validate(payload);
    expect(ok).toBe(false);
    // The two that would have reached SQL: phone busts NVARCHAR(30), term is absurd.
    expect(errors.phone).toMatch(/30 characters or fewer/);
    expect(errors.term_months).toMatch(/600 or less/);
    // The applicant's 40-char mobile is legal — NVARCHAR(40) — and must NOT error.
    expect(enquiry.validateApplicants([{ full_name: 'nimit', mobile: LONG_PHONE }])).toEqual({});
  });
});

/**
 * The application module has a SECOND write path — updateApplicant /
 * updateSecurity go through buildSets(), not validate(). It sliced every text
 * value to a blanket 255 and let a 52-character phone reach NVARCHAR(30):
 *   PUT /api/applications/1012/applicant/1012
 *   -> "String or binary data would be truncated ... column 'phone'"
 * Both write paths must now refuse over-long values.
 */
describe('application updateApplicant — the second write path', () => {
  const application = require('../services/application.service');

  it('config-driven path rejects an over-long phone', () => {
    const CFG = require('../config/application.config');
    const { ok, errors } = application.validate(
      { phone: '4'.repeat(52) }, { partial: true, fields: CFG.APPLICANT_FIELDS },
    );
    expect(ok).toBe(false);
    expect(errors.phone).toMatch(/30 characters or fewer/);
  });

  it('config-driven path rejects an over-long first name', () => {
    const CFG = require('../config/application.config');
    const { errors } = application.validate(
      { first_name: 'x'.repeat(101) }, { partial: true, fields: CFG.APPLICANT_FIELDS },
    );
    expect(errors.first_name).toMatch(/100 characters or fewer/);
  });

  it('accepts a normal phone', () => {
    const CFG = require('../config/application.config');
    const { ok } = application.validate(
      { phone: '07700 900123' }, { partial: true, fields: CFG.APPLICANT_FIELDS },
    );
    expect(ok).toBe(true);
  });
});


/**
 * Angular ↔ API parity for the staff New Enquiry drawer.
 *
 * The drawer marks Branch, Product, Gross amount, Term and Property address
 * with `*` and blocks submit without them, but the API used to accept a POST
 * missing every one. `staffRequired` now mirrors the form for manual creation
 * while leaving the lighter public website intake (source === 'website') alone.
 */
describe('enquiry validate — staff-required parity with the Angular form', () => {
  const STAFF = { staff: true };
  const full = {
    email: 'a@b.com', loan_purpose_id: 1, branch_id: 2, product_id: 5,
    amount_requested: 89000, term_months: 12, property_address: '10 High St',
    estimated_value: 250000,
  };

  it('requires the `*` fields for staff creation', () => {
    const { ok, errors } = enquiry.validate({ email: 'a@b.com', loan_purpose_id: 1 }, STAFF);
    expect(ok).toBe(false);
    expect(errors.branch_id).toMatch(/required/i);
    expect(errors.product_id).toMatch(/required/i);
    expect(errors.amount_requested).toMatch(/required/i);
    expect(errors.term_months).toMatch(/required/i);
    expect(errors.property_address).toMatch(/required/i);
  });

  it('accepts a complete staff payload', () => {
    const { ok, errors } = enquiry.validate(full, STAFF);
    expect(errors).toEqual({});
    expect(ok).toBe(true);
  });

  it('does NOT force those fields on the public website intake', () => {
    const { errors } = enquiry.validate({ email: 'a@b.com', loan_purpose_id: 1 });
    expect(errors.branch_id).toBeUndefined();
    expect(errors.product_id).toBeUndefined();
    expect(errors.amount_requested).toBeUndefined();
    expect(errors.term_months).toBeUndefined();
    expect(errors.property_address).toBeUndefined();
  });
});

describe('enquiry validateApplicants — borrower optional on the staff form (client 25-09-2026)', () => {
  // The borrower is often unknown when a staff enquiry arrives, so name / email /
  // mobile are NOT required on the staff form (validateApplicants ignores `staff`).
  it('does NOT require the primary applicant full name for staff creation', () => {
    const errors = enquiry.validateApplicants([{ email: 'a@b.com', is_primary: true }], { staff: true });
    expect(errors['applicants[0].full_name']).toBeUndefined();
  });

  it('does NOT flag a nameless primary row', () => {
    const errors = enquiry.validateApplicants([{ full_name: 'A' }, { is_primary: true }], { staff: true });
    expect(errors['applicants[1].full_name']).toBeUndefined();
  });

  it('still passes a named primary', () => {
    expect(enquiry.validateApplicants([{ full_name: 'A', is_primary: true }], { staff: true })).toEqual({});
  });

  it('does not require it on the public intake', () => {
    expect(enquiry.validateApplicants([{ email: 'a@b.com' }])).toEqual({});
  });
});


describe('enquiry validateApplicants — numeric range (overflow guard)', () => {
  it('rejects a shareholding % beyond the DECIMAL(6,2) column instead of letting SQL overflow', () => {
    const errors = enquiry.validateApplicants([{ shareholding_pct: 9999999 }]);
    expect(errors['applicants[0].shareholding_pct']).toMatch(/between 0 and 100/);
  });

  it('rejects a negative shareholding %', () => {
    const errors = enquiry.validateApplicants([{ shareholding_pct: -5 }]);
    expect(errors['applicants[0].shareholding_pct']).toMatch(/between 0 and 100/);
  });

  it('rejects a non-numeric shareholding %', () => {
    const errors = enquiry.validateApplicants([{ shareholding_pct: 'abc' }]);
    expect(errors['applicants[0].shareholding_pct']).toMatch(/valid number/);
  });

  it('accepts a shareholding % at the 100 limit', () => {
    const errors = enquiry.validateApplicants([{ shareholding_pct: 100 }]);
    expect(errors['applicants[0].shareholding_pct']).toBeUndefined();
  });

  it('accepts an empty shareholding % (optional field)', () => {
    const errors = enquiry.validateApplicants([{ shareholding_pct: '' }]);
    expect(errors['applicants[0].shareholding_pct']).toBeUndefined();
  });
});
