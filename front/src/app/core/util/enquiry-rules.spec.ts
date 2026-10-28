import {
  FieldErrs, MAX_MONEY, applicantRules, email, errsText, isBlank, mobile, money, num, personName, regNo, req, securityRules,
} from './enquiry-rules';

describe('enquiry-rules', () => {
  let e: FieldErrs;
  beforeEach(() => (e = {}));

  it('isBlank', () => {
    expect([null, undefined, '', '   '].every(isBlank)).toBe(true);
    expect([0, 'a', false].some(isBlank)).toBe(false);
  });

  it('req flags blanks only', () => {
    req(e, 'branch', ' ', 'Branch');
    req(e, 'ok', 'x', 'Ok');
    expect(e).toEqual({ branch: 'Branch is required.' });
  });

  it('num checks numeric range and optional required', () => {
    num(e, 'a', 'abc', 'Term', 1, 600);
    num(e, 'b', 0, 'Term', 1, 600);
    num(e, 'c', 601, 'Term', 1, 600);
    num(e, 'd', '', 'Term', 1, 600);
    num(e, 'f', '', 'LTV', 0, 100, true);
    num(e, 'g', '12', 'Term', 1, 600);
    expect(e).toEqual({
      a: 'Term must be a number.', b: 'Term must be 1 or more.', c: 'Term must be 600 or less.', f: 'LTV is required.',
    });
  });

  it('money caps at MAX_MONEY and honours min', () => {
    money(e, 'a', MAX_MONEY + 1, 'Value');
    money(e, 'b', -1, 'Value');
    money(e, 'c', 0, 'Value', true, 1);
    money(e, 'd', 250000.5, 'Value', true, 1);
    expect(Object.keys(e)).toEqual(['a', 'b', 'c']);
  });

  it('email / mobile / name / reg no formats (blank allowed)', () => {
    email(e, 'e1', 'jane@x.co.uk');
    email(e, 'e2', 'jane@x');
    mobile(e, 'm1', '+44 (0) 7700-900123');
    mobile(e, 'm2', '07700abc');
    personName(e, 'n1', "Jean-Luc O'Neil");
    personName(e, 'n2', 'SELECT * FROM users');
    regNo(e, 'r1', 'SC123 456');
    regNo(e, 'r2', 'SC-123');
    email(e, 'e3', '');
    expect(Object.keys(e)).toEqual(['e2', 'm2', 'n2', 'r2']);
    expect(e['n2']).toBe("Name: letters, spaces, . ' - only.");
  });

  it('securityRules: required fields, 2nd charge needs the charge amount check', () => {
    securityRules(e, { charge_type: '2nd', estimated_value: 0, tenure_years: 1000, charge_amount: 'x' }, 'sec.0.', 'Security 1: ');
    expect(e).toEqual({
      'sec.0.property_address': 'Security 1: Property address is required.',
      'sec.0.estimated_value': 'Security 1: Property value must be 1 or more.',
      'sec.0.tenure_years': 'Security 1: Years remaining must be 999 or less.',
      'sec.0.charge_amount': 'Security 1: Charge amount must be a number.',
    });
  });

  it('securityRules: a valid 1st charge passes, custom address key', () => {
    securityRules(e, { address: '1 Road', charge_type: '1st', estimated_value: 300000 }, '', '', 'address');
    expect(e).toEqual({});
  });

  it('applicantRules', () => {
    applicantRules(e, { full_name: 'Jane 2', email: 'bad', mobile: 'x', shareholding_pct: 101 }, 'a.', 'Director: ');
    expect(Object.keys(e)).toEqual(['a.full_name', 'a.email', 'a.mobile', 'a.shareholding_pct']);
  });

  it('errsText joins messages for a toast', () => {
    expect(errsText({ a: 'One.', b: 'Two.' })).toBe('One. · Two.');
    expect(errsText({})).toBe('');
  });
});
