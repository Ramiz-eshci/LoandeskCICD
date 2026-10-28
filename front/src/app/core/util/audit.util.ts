/**
 * Shared audit-trail presentation for the Enquiry, Application and Underwriting
 * modules, so one action reads the same way wherever it is shown.
 *
 * All three now answer the same three questions: WHO changed it, WHAT changed,
 * and WHEN. Each module keeps its own source table — audit_logs for enquiries
 * and applications, underwriting_audit for cases — but the rendering is this.
 */

/** Row shape common to every module's trail. */
export interface AuditRowLike {
  /** Which stage of the case this happened in: Enquiry / Application / Underwriting. */
  module?: string | null;
  action?: string | null;
  details?: Record<string, unknown> | string | null;
  reason?: string | null;
  to_status?: string | null;
  from_status?: string | null;
  step_no?: number | null;
}

/** "OFFER_EMAILED" -> "Offer Emailed" */
export function auditAction(a: string | null | undefined): string {
  return String(a || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** `details` may arrive parsed or as raw JSON text; never throw on bad data. */
function asObject(d: AuditRowLike['details']): Record<string, unknown> | null {
  if (!d) return null;
  if (typeof d === 'string') {
    try { return JSON.parse(d) as Record<string, unknown>; } catch { return null; }
  }
  return d;
}

/**
 * One readable line saying WHAT changed — a field-level diff where the action
 * recorded one, otherwise the key facts it did record.
 */
/**
 * Turn a raw column/field name into something a person reads:
 * "branch_id" -> "Branch", "loan_purpose_id" -> "Loan Purpose",
 * "requested_completion_date" -> "Requested Completion Date".
 */
function humanizeField(k: string): string {
  return String(k || '')
    .replace(/_/g, ' ')
    .replace(/\bid\b/gi, '')      // drop a trailing/standalone "id"
    .replace(/\bpct\b/gi, '%')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || String(k || '');
}

export function auditSummary(r: AuditRowLike): string {
  const meta: string[] = [];
  const lines: string[] = [];
  if (r.step_no != null) meta.push(`Step ${r.step_no}`);

  const d = asObject(r.details);
  if (d) {
    if (d['version_no'] != null) meta.push(`v${d['version_no']}`);

    const changed = d['changed_fields'] as Record<string, { from?: unknown; to?: unknown }> | undefined;
    if (changed && typeof changed === 'object') {
      for (const [k, v] of Object.entries(changed)) {
        lines.push(`${humanizeField(k)}: ${fmt(v?.from)} → ${fmt(v?.to)}`);
      }
    }
    if (Array.isArray(d['fields']) && (d['fields'] as string[]).length) {
      lines.push(`Updated: ${(d['fields'] as string[]).map(humanizeField).join(', ')}`);
    }
    if (d['applicationRef']) lines.push(String(d['applicationRef']));
    if (d['file_name']) lines.push(String(d['file_name']));
    if (d['to'] && !r.to_status) lines.push(`→ ${String(d['to'])}`);
  }

  if (r.from_status && r.to_status) lines.push(`${r.from_status} → ${r.to_status}`);
  else if (r.to_status) lines.push(`→ ${r.to_status}`);

  const reason = r.reason || (d ? d['reason'] : null);
  if (reason) lines.push(String(reason));

  const body = lines.join('\n');
  if (meta.length && body) return `${meta.join(' · ')}\n${body}`;
  return meta.join(' · ') || body;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}
