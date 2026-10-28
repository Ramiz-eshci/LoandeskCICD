/**
 * Turning a rejected save into something the user can act on.
 *
 * The API answers a failed write with a per-field map:
 *   { "phone": "Must be 30 characters or fewer (currently 40)", "term_months": "..." }
 * Every screen used to drop that and show a single red "Validation Error"
 * toast, which told the user nothing about WHICH box was wrong.
 *
 * These helpers turn that map into a labelled list and a toast line naming the
 * fields. Shared so the enquiry, application and underwriting screens all
 * report a rejection the same way.
 */

export interface ServerFieldError {
  field: string;
  label: string;
  message: string;
}

/** Pull the field map out of an HttpErrorResponse, whatever shape it arrived in. */
export function extractFieldErrors(e: unknown): Record<string, string> {
  const err = e as { error?: { errors?: Record<string, string> } } | undefined;
  const raw = err?.error?.errors;
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/** "amount_requested" -> "Amount requested"; "applicants[0].mobile" -> "Applicant 1 — mobile". */
export function fieldLabel(field: string, overrides: Record<string, string> = {}): string {
  if (overrides[field]) return overrides[field];
  const m = field.match(/^applicants\[(\d+)\]\.(.+)$/);
  if (m) return `Applicant ${Number(m[1]) + 1} — ${m[2].replace(/_/g, ' ')}`;
  const plain = field.replace(/_id$/, '').replace(/_pct$/, ' %').replace(/_/g, ' ');
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

export function toFieldErrorList(
  errors: Record<string, string>,
  overrides: Record<string, string> = {},
): ServerFieldError[] {
  return Object.entries(errors).map(([field, message]) => ({
    field, message, label: fieldLabel(field, overrides),
  }));
}

/**
 * A toast line that names the offending fields instead of saying "Validation
 * Error". One problem shows the full message; several show the field names.
 */
export function errorSummary(list: ServerFieldError[], fallback = 'Please check the highlighted fields.'): string {
  if (!list.length) return fallback;
  if (list.length === 1) return `${list[0].label}: ${list[0].message}`;
  return `Check these fields: ${list.map((x) => x.label).join(', ')}`;
}
