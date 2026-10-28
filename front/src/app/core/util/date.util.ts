/**
 * The one date format for LoanDesk: dd-mm-yyyy.
 *
 * Every screen used to carry its own copy of a `dt()` helper rendering
 * "15 Sep 2026", so the UI and the generated PDFs disagreed. Import from here
 * instead — the API's PDF builder (services/pdf/enquiry-pdf.service.js fmtDate)
 * produces the identical string.
 */

/** dd-mm-yyyy, or `empty` when the value is missing or unparseable. */
export function formatDate(v: string | Date | null | undefined, empty = '—'): string {
  if (v === null || v === undefined || v === '') return empty;

  // Split a plain yyyy-mm-dd by hand: parsing it as a Date makes it midnight UTC,
  // which renders as the previous day for anyone west of Greenwich.
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }

  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return empty;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** dd-mm-yyyy HH:mm — for audit trails and sent-at stamps. */
export function formatDateTime(v: string | Date | null | undefined, empty = '—'): string {
  if (v === null || v === undefined || v === '') return empty;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return empty;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${formatDate(d, empty)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** yyyy-mm-dd for <input type="date">, which only accepts that shape. */
export function toDateInput(v: string | Date | null | undefined): string {
  if (!v) return '';
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
