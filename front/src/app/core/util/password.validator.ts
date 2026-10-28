import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/** Shown under every "new password" field. */
export const PASSWORD_HINT = '8+ characters with an upper case letter, a lower case letter, a digit and a special character';

/**
 * Password policy (client 26-10-2026) - mirrors api/utils/validators.js passwordProblem.
 * Returns the first problem as a message, or null when the password is fine.
 */
export function passwordProblem(pw: string): string | null {
  const p = String(pw || '');
  if (p.length < 8) return 'Password must be at least 8 characters.';
  if (p.length > 128) return 'Password must be at most 128 characters.';
  if (!/[A-Z]/.test(p)) return 'Password must contain at least one upper case letter.';
  if (!/[a-z]/.test(p)) return 'Password must contain at least one lower case letter.';
  if (!/[0-9]/.test(p)) return 'Password must contain at least one digit.';
  if (!/[^A-Za-z0-9]/.test(p)) return 'Password must contain at least one special character.';
  return null;
}

/** Form validator: `{ passwordPolicy: '<message>' }` when the policy fails (empty value is left to `required`). */
export const strongPassword: ValidatorFn = (c: AbstractControl): ValidationErrors | null => {
  const v = c.value as string;
  if (!v) return null;
  const problem = passwordProblem(v);
  return problem ? { passwordPolicy: problem } : null;
};
