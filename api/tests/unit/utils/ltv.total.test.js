'use strict';

/** Client 17-10-2026: Total LTV on the Summary tab of Enquiry / Application / Underwriting. */
const { totalLtv } = require('../../../utils/ltv');

describe('utils/ltv totalLtv', () => {
  it('adds the 1st charge ahead of a 2nd-charge loan', () => {
    // property 500,000 - 1st charge 100,000 - gross 100,000 -> 40%
    expect(totalLtv(100000, [{ estimated_value: 500000, charge_type: '2nd', charge_amount: 100000 }])).toBe(40);
  });

  it('equals the plain LTV when there is no other charge', () => {
    expect(totalLtv(100000, [{ estimated_value: 500000, charge_type: '1st' }])).toBe(20);
  });

  it('uses every security (enquiry existing_charge / application outstanding_loan)', () => {
    expect(totalLtv(100000, [
      { value: 300000, charge_type: '2nd', existing_charge: 100000 },
      { estimated_value: 200000, charge_type: '2nd', outstanding_loan: 50000 },
    ])).toBe(50);
  });

  it('is null without a gross loan or a security value', () => {
    expect(totalLtv(0, [{ estimated_value: 500000 }])).toBeNull();
    expect(totalLtv(100000, [])).toBeNull();
  });
});

describe('utils/ltv ltvPair (client 17-10-2026 split)', () => {
  const { ltvPair } = require('../../../utils/ltv');
  it('LTV = loan only, Total LTV = loan + charge ahead', () => {
    const p = ltvPair(100000, [{ estimated_value: 500000, charge_type: '2nd', charge_amount: 100000 }]);
    expect(p.our).toBe(20);
    expect(p.total).toBe(40);
  });
  it('no charge -> LTV and Total LTV are the same', () => {
    const p = ltvPair(100000, [{ estimated_value: 500000, charge_type: '1st' }]);
    expect(p.our).toBe(20);
    expect(p.total).toBe(20);
  });
});
