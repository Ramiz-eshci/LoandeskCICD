/**
 * Client-side checks for the enquiry / application EDIT screens - the same required
 * fields and limits as the New Enquiry drawer (new-enquiry-drawer.component.ts), so a
 * record can't be saved in edit with something the add form would have refused
 * (client 20-10-2026). The server still re-validates.
 *
 * Each helper writes "field -> message" into `errs` when the value fails.
 */
export type FieldErrs = Record<string, string>;

export const MAX_MONEY = 999999999999;
const NAME_RE = /^([A-Za-zÀ-ɏ][A-Za-zÀ-ɏ .'\-]*)?$/;
const MOBILE_RE = /^\+?[0-9]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGNO_RE = /^[A-Za-z0-9 ]*$/;

export const isBlank = (v: unknown): boolean => v === null || v === undefined || String(v).trim() === '';

/** Required (select / text). */
export function req(errs: FieldErrs, key: string, v: unknown, label: string): void {
  if (isBlank(v)) errs[key] = `${label} is required.`;
}
/** Number in [min, max]; `required` adds the blank check. */
export function num(errs: FieldErrs, key: string, v: unknown, label: string, min: number, max: number, required = false): void {
  if (isBlank(v)) { if (required) errs[key] = `${label} is required.`; return; }
  const n = Number(v);
  if (!Number.isFinite(n)) errs[key] = `${label} must be a number.`;
  else if (n < min) errs[key] = `${label} must be ${min} or more.`;
  else if (n > max) errs[key] = `${label} must be ${max} or less.`;
}
export function money(errs: FieldErrs, key: string, v: unknown, label: string, required = false, min = 0): void {
  num(errs, key, v, label, min, MAX_MONEY, required);
}
export function email(errs: FieldErrs, key: string, v: unknown, label = 'Email'): void {
  if (!isBlank(v) && !EMAIL_RE.test(String(v).trim())) errs[key] = `${label}: enter a valid email address.`;
}
export function mobile(errs: FieldErrs, key: string, v: unknown, label = 'Mobile'): void {
  if (!isBlank(v) && !MOBILE_RE.test(String(v).replace(/[\s()-]/g, ''))) errs[key] = `${label}: digits only (optional leading +).`;
}
export function personName(errs: FieldErrs, key: string, v: unknown, label = 'Name'): void {
  if (!isBlank(v) && !NAME_RE.test(String(v).trim())) errs[key] = `${label}: letters, spaces, . ' - only.`;
}
export function regNo(errs: FieldErrs, key: string, v: unknown, label = 'Company reg no.'): void {
  if (!isBlank(v) && !REGNO_RE.test(String(v))) errs[key] = `${label}: letters and numbers only.`;
}

/** Security block - same rules as step 4 / step 5 of the add form.
 *  keyPrefix e.g. "sec.0." / labelPrefix e.g. "Security 1: ". */
export function securityRules(errs: FieldErrs, s: Record<string, unknown>, keyPrefix = '', labelPrefix = '', addressKey = 'property_address'): void {
  const k = (x: string) => keyPrefix + x;
  const l = (x: string) => labelPrefix + x;
  req(errs, k(addressKey), s[addressKey], l('Property address'));
  req(errs, k('charge_type'), s['charge_type'], l('Charge (1st / 2nd)'));
  money(errs, k('estimated_value'), s['estimated_value'], l('Property value'), true, 1);
  num(errs, k('tenure_years'), s['tenure_years'], l('Years remaining'), 0, 999);
  if (s['charge_type'] === '2nd') money(errs, k('charge_amount'), s['charge_amount'], l('Charge amount'));
  money(errs, k('gdv'), s['gdv'], l('GDV'));
  money(errs, k('purchase_price'), s['purchase_price'], l('Purchase price'));
  money(errs, k('outstanding_loan'), s['outstanding_loan'], l('Outstanding loan'));
}

/** Applicant / director row - same format checks as the add form's applicant sub-form. */
export function applicantRules(errs: FieldErrs, a: Record<string, unknown>, keyPrefix = '', labelPrefix = ''): void {
  personName(errs, keyPrefix + 'full_name', a['full_name'], labelPrefix + 'Full name');
  email(errs, keyPrefix + 'email', a['email'], labelPrefix + 'Email');
  mobile(errs, keyPrefix + 'mobile', a['mobile'], labelPrefix + 'Mobile');
  num(errs, keyPrefix + 'shareholding_pct', a['shareholding_pct'], labelPrefix + 'Shareholding %', 0, 100);
}

/** One toast-friendly line: "Branch is required. · Term must be 600 or less." */
export function errsText(errs: FieldErrs): string {
  return Object.values(errs).join(' · ');
}
