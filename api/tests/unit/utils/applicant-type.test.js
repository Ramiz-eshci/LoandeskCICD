'use strict';

const { classifyApplicantType } = require('../../../utils/applicant-type');

describe('classifyApplicantType', () => {
  it.each([
    ['Scotland - Individual', { isCompany: false, region: 'SCOTLAND' }],
    ['Scotland - Limited Companies', { isCompany: true, region: 'SCOTLAND' }],
    ['England/Wales - Individual', { isCompany: false, region: 'EW' }],
    ['England & Wales - Limited Companies', { isCompany: true, region: 'EW' }],
    ['SCOT_LTD', { isCompany: true, region: 'SCOTLAND' }],
    ['Company', { isCompany: true, region: 'EW' }],
    ['Individual', { isCompany: false, region: 'EW' }],
    ['Corporate Trustee', { isCompany: true, region: 'EW' }],
  ])('%s', (input, expected) => {
    expect(classifyApplicantType(input)).toEqual(expected);
  });

  it('defaults to an individual in England/Wales for empty input', () => {
    expect(classifyApplicantType(null)).toEqual({ isCompany: false, region: 'EW' });
    expect(classifyApplicantType('')).toEqual({ isCompany: false, region: 'EW' });
  });
});
