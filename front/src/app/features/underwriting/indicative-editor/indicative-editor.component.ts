import { Component, ChangeDetectionStrategy, DestroyRef, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError, of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { UiModalComponent } from '../../../shared/ui/ui-modal/ui-modal.component';
import { NumInputDirective } from '../../../shared/ui/num-input.directive';
import { EnquiriesService } from '../../enquiries/enquiries.service';
import { Enquiry, IndicativeCalc, IndicativeVersion, IndSecurity } from '../../enquiries/enquiries-list/enquiry.model';
import { UnderwritingApi } from '../underwriting.api';

type IndDrawdown = { month: number | null; amount: number | null; net: number | null };

/**
 * Client 12-10-2026: a standalone copy of the enquiry "Send Indicatives" popup, used from the
 * Underwriting "Edit loan" button. It preloads the accepted/latest indicative, lets the underwriter
 * change the figures (live recalc via the same engine), then saves as a new indicative version,
 * emails the borrower and pushes the figures onto the application + portfolio (server-side).
 */
@Component({
  selector: 'uw-indicative-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, UiModalComponent, NumInputDirective],
  templateUrl: './indicative-editor.component.html',
  styleUrl: './indicative-editor.component.scss',
})
export class IndicativeEditorComponent implements OnInit {
  @Input({ required: true }) enquiryId!: number;
  @Input({ required: true }) caseId!: number | string;
  /** Client 16-10-2026: default CC of the revised-offer e-mail (underwriter + BDM); editable here. */
  @Input() ccDefaults: { label: string; email: string }[] = [];
  @Output() saved = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  private readonly api = inject(EnquiriesService);
  private readonly uwApi = inject(UnderwritingApi);
  private readonly toastr = inject(ToastrService);
  private readonly destroyRef = inject(DestroyRef);

  enquiry: Enquiry | null = null;
  versions: IndicativeVersion[] = [];
  indInputs: Record<string, unknown> = {};
  readonly indCalc = signal<IndicativeCalc | null>(null);
  readonly indWarnings = signal<string[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);

  grossField: number | null = null;
  netField: number | null = null;
  indEditing: 'gross' | 'net' | 'day1net' | null = null;
  /** Day 1 Net box on the Drawdowns table's Day 1 row (client 20-10-2026). */
  day1NetField: number | null = null;
  private pendingLtvSyncFromAmount = false;

  ngOnInit(): void {
    this.initCc();
    this.api.get(this.enquiryId).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe((e) => {
      this.enquiry = e;
      this.api.listIndicatives(this.enquiryId).pipe(catchError(() => of([] as IndicativeVersion[])), takeUntilDestroyed(this.destroyRef)).subscribe((v) => {
        this.versions = v || [];
        this.loading.set(false);
        this.openIndicative();
      });
    });
  }

  close(): void { this.closed.emit(); }

  // ---- revised-offer e-mail CC (client 16-10-2026) ----
  ccList: { label: string; email: string; on: boolean }[] = [];
  ccDraft = '';
  readonly ccError = signal<string | null>(null);
  private initCc(): void {
    const seen = new Set<string>();
    this.ccList = (this.ccDefaults || [])
      .filter((c) => c && c.email && !seen.has(c.email.toLowerCase()) && !!seen.add(c.email.toLowerCase()))
      .map((c) => ({ label: c.label, email: c.email, on: true }));
  }
  addCc(): void {
    const e = this.ccDraft.trim();
    if (!e) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { this.ccError.set('Enter a valid email address.'); return; }
    if (this.ccList.some((c) => c.email.toLowerCase() === e.toLowerCase())) { this.ccError.set('That email is already in the list.'); return; }
    this.ccList = [...this.ccList, { label: '', email: e, on: true }];
    this.ccDraft = ''; this.ccError.set(null);
  }
  toggleCc(i: number): void { this.ccList = this.ccList.map((c, k) => (k === i ? { ...c, on: !c.on } : c)); }
  removeCc(i: number): void { this.ccList = this.ccList.filter((_, k) => k !== i); }

  recipient(): { email: string | null; label: string } {
    const e = this.enquiry;
    if (!e) return { email: null, label: '' };
    if (e.broker_id && e.broker_email) return { email: e.broker_email, label: `the broker (${e.broker_email})` };
    const list = Array.isArray(e.applicants) ? e.applicants : [];
    const primary = list.find((a) => a && (a.is_primary === 1 || a.is_primary === true)) || list[0];
    const email = e.email || (primary && primary.email) || null;
    return { email, label: `the applicant (${email || 'no email on file'})` };
  }

  private openIndicative(): void {
    const e = this.enquiry;
    this.indInputs = {
      ltv_pct: null, monthly_rate_pct: null,
      arrangement_fee_pct: null, arrangement_fee_is_pct: true,
      broker_fee: null, broker_fee_is_pct: true, document_fee: null,
      value_model: null, security_value: null, charges_total: null,
      main_security_value: null, main_charges: null, additional_securities: [],
      property_value: e?.estimated_value ?? null,
      gdv: (e as { gdv?: number })?.gdv ?? null,
      first_charge: this.mainDebt(e),
      term_months: (e as { term_months?: number })?.term_months ?? null,
      interest_type: (e as { interest_type?: string })?.interest_type || 'Retained',
      gross_loan: null,
      ltv_mode: 'pct',
      drawdowns: [],
      calc_type: (e as { interest_type?: string })?.interest_type === 'Serviced' ? 'serviced' : 'dds', annual_rate_pct: null,
    };
    const enqDd = ((e as { drawdowns?: { month?: number | null; amount?: number | null }[] })?.drawdowns || []).filter((d) => d && d.amount);
    if (enqDd.length) this.indInputs['drawdowns'] = enqDd.map((d) => ({ month: d.month ?? null, amount: d.amount ?? null, net: null }));
    this.padDrawdowns();
    const enqSecs = this.enquirySecurities();
    this.indInputs['additional_securities'] = enqSecs;
    const last = this.versions[0];
    if (last && last.inputs) {
      const inp = last.inputs as Record<string, unknown>;
      this.indInputs = { ...this.indInputs, ...inp };
      if (Array.isArray(inp['drawdowns'])) {
        this.indInputs['drawdowns'] = (inp['drawdowns'] as Record<string, unknown>[]).map((d) => ({ month: d['month'] ?? null, amount: d['amount'] ?? null, net: d['net'] ?? null }));
      }
    }
    this.indInputs['additional_securities'] = enqSecs;
    if (!last || !last.inputs) {
      this.fillPropertyValue(e, enqSecs);
    }
    if (!last || !last.inputs) {
      const enqLtv = (e as { ltv_pct?: number | null })?.ltv_pct;
      this.indInputs['ltv_mode'] = 'pct';
      this.indInputs['gross_loan'] = null;
      this.indInputs['ltv_pct'] = enqLtv != null && Number.isFinite(Number(enqLtv)) ? Number(enqLtv) : null;
    }
    this.padDrawdowns();
    this.indCalc.set(null); this.indWarnings.set([]); this.indEditing = null; this.grossField = null; this.netField = null; this.day1NetField = null;
    this.recalcIndicative();
  }

  private mainDebt(e: unknown): number | null {
    const x = (e || {}) as { outstanding_loan?: unknown; charge_type?: unknown; charge_amount?: unknown };
    const n = (v: unknown) => { const k = Number(v); return Number.isFinite(k) && k > 0 ? k : 0; };
    const d = n(x.outstanding_loan) + (x.charge_type === '2nd' ? n(x.charge_amount) : 0);
    return d || null;
  }

  private fillPropertyValue(e: Enquiry | null, secs: IndSecurity[]): void {
    const n = (v: unknown) => { const k = Number(v); return Number.isFinite(k) && k > 0 ? k : 0; };
    const mainValue = n(e?.estimated_value);
    const mainCharges = this.mainDebt(e) || 0;
    const secValue = mainValue + secs.reduce((a, x) => a + n(x.value), 0);
    const charges = mainCharges + secs.reduce((a, x) => a + n(x.existing_charge), 0);
    const r2 = (v: number) => Math.round(v * 100) / 100;
    this.indInputs['value_model'] = 'net';
    this.indInputs['main_security_value'] = mainValue || null;
    this.indInputs['main_charges'] = mainCharges || null;
    this.indInputs['first_charge'] = mainCharges || null;
    this.indInputs['security_value'] = secValue ? r2(secValue) : null;
    this.indInputs['charges_total'] = r2(charges);
    this.indInputs['property_value'] = secValue ? r2(secValue) : null;
    const gdvSum = n((e as { gdv?: number })?.gdv) + secs.reduce((a, x) => a + n(x.gdv), 0);
    this.indInputs['gdv'] = gdvSum ? r2(gdvSum) : null;
  }

  private enquirySecurities(): IndSecurity[] {
    const toNum = (v: unknown): number | null => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(String(v).replace(/[£,\s]/g, ''));
      return Number.isFinite(n) ? n : null;
    };
    const list = ((this.enquiry as { additional_securities?: Record<string, unknown>[] })?.additional_securities || []);
    return list
      .map((x) => ({
        address: String(x['address'] || x['description'] || '').trim(),
        security_type: String(x['security_type'] || '').trim(),
        value: toNum(x['estimated_value']),
        gdv: toNum(x['gdv']),
        existing_charge: (() => {
          if (x['outstanding_loan'] === undefined) return toNum(x['existing_charge']);
          const d = (toNum(x['outstanding_loan']) || 0) + (x['charge_type'] === '2nd' ? (toNum(x['charge_amount']) || 0) : 0);
          return d || null;
        })(),
        include: true,
      }))
      .filter((x) => x.address || x.value || x.existing_charge);
  }

  get indSecurities(): IndSecurity[] { return (this.indInputs['additional_securities'] as IndSecurity[]) || []; }
  get indDrawdowns(): IndDrawdown[] { return (this.indInputs['drawdowns'] as IndDrawdown[]) || []; }

  private padDrawdowns(): void {
    const rows = [...this.indDrawdowns];
    while (rows.length < 4) rows.push({ month: rows.length + 1, amount: null, net: null });
    this.indInputs['drawdowns'] = rows;
  }

  indDebt(): number { return Number(this.indInputs['charges_total']) || 0; }
  indPropertyValue(): number { return Number(this.indInputs['property_value']) || 0; }
  indMaxLtv(): number | null {
    const pv = this.indPropertyValue();
    const ltv = Number(this.indInputs['ltv_pct']) || 0;
    if (pv <= 0 || ltv <= 0) return null;
    return Math.round(pv * (ltv / 100) * 100) / 100;
  }
  indLtvMode(): 'pct' | 'amount' { return this.indInputs['ltv_mode'] === 'amount' ? 'amount' : 'pct'; }
  onIndLtvChange(v: unknown): void {
    this.indInputs['ltv_mode'] = 'pct';
    this.indInputs['gross_loan'] = null;
    this.indInputs['ltv_pct'] = (v === '' || v === null || v === undefined) ? null : Number(v);
    this.recalcIndicative();
  }
  indLtvFromAmount(): number | null {
    const pv = this.indPropertyValue();
    const amt = Number(this.indInputs['gross_loan']) || 0;
    if (pv <= 0 || amt <= 0) return null;
    return Math.round((amt / pv) * 10000) / 100;
  }

  indFocusLoan(f: 'gross' | 'net' | 'day1net'): void { this.indEditing = f; }
  indBlurLoan(): void { this.indEditing = null; this.syncLoanFields(); }
  syncLoanFields(): void {
    const c = this.indCalc();
    if (this.indEditing !== 'gross') this.grossField = c ? (c.base_gross ?? null) : null;
    if (this.indEditing !== 'net') this.netField = c ? ((c.total_net_incl_drawdowns != null ? c.total_net_incl_drawdowns : c.day1_net) ?? null) : null;

    if (this.indEditing !== 'day1net') this.day1NetField = c ? (c.day1_net ?? null) : null;
  }

  /** Day 1 Net typed (Drawdowns table, Day 1 row): back-solve the Day 1 Gross Loan from it. */
  onIndDay1NetChange(v: unknown): void {
    const net = Number(v);
    this.indInputs['ltv_mode'] = 'amount';
    this.indInputs['gross_loan'] = Number.isFinite(net) ? this.grossFromNet(net) : null;
    this.pendingLtvSyncFromAmount = true;
    this.recalcIndicative();
  }
  /** Drawdown GROSS typed: the net is worked out (net = gross - interest). */
  setDdGross(dd: IndDrawdown, v: unknown): void {
    const n = v === '' || v === null || v === undefined ? NaN : Number(v);
    dd.amount = Number.isFinite(n) ? n : null;
    dd.net = null;
    this.recalcIndicative();
  }
  /** Drawdown NET typed (client 20-10-2026): the gross back-solves (gross = net / (1 - months x rate)). */
  setDdNet(dd: IndDrawdown, v: unknown): void {
    const n = v === '' || v === null || v === undefined ? NaN : Number(v);
    dd.net = Number.isFinite(n) ? n : null;
    dd.amount = null;
    this.recalcIndicative();
  }
  onIndGrossChange(v: unknown): void {
    const g = Number(v);
    this.indInputs['ltv_mode'] = 'amount';
    this.indInputs['gross_loan'] = Number.isFinite(g) && g > 0 ? Math.round(g * 100) / 100 : null;
    this.pendingLtvSyncFromAmount = true;
    this.recalcIndicative();
  }
  onIndNetChange(v: unknown): void {
    const net = Number(v);
    const c = this.indCalc();
    const ddNet = c && c.total_net_incl_drawdowns != null && c.day1_net != null ? (c.total_net_incl_drawdowns - c.day1_net) : 0;
    const day1 = Number.isFinite(net) ? net - ddNet : null;
    this.indInputs['ltv_mode'] = 'amount';
    this.indInputs['gross_loan'] = this.grossFromNet(day1);
    this.pendingLtvSyncFromAmount = true;
    this.recalcIndicative();
  }
  private grossFromNet(net: number | null): number | null {
    if (net === null || !(net > 0)) return null;
    const num = (x: unknown) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
    const serviced = this.indCalcType() === 'serviced' || this.indInputs['interest_type'] === 'Serviced';
    const rate = num(this.indInputs['monthly_rate_pct']) / 100;
    const term = num(this.indInputs['term_months']);
    const retainedCoef = serviced ? 0 : rate * term;
    const arrIsPct = this.indInputs['arrangement_fee_is_pct'] !== false;
    const brkIsPct = this.indInputs['broker_fee_is_pct'] !== false;
    const arrV = num(this.indInputs['arrangement_fee_pct']);
    const brkV = num(this.indInputs['broker_fee']);
    const doc = num(this.indInputs['document_fee']);
    const feePct = (arrIsPct ? arrV / 100 : 0) + (brkIsPct ? brkV / 100 : 0);
    const feeFlat = (arrIsPct ? 0 : arrV) + (brkIsPct ? 0 : brkV) + doc;
    const ddSum = num(this.indCalc()?.drawdowns_total);
    const denom = 1 - feePct - retainedCoef;
    if (!(denom > 0)) return null;
    const gross = (net + feePct * ddSum + feeFlat) / denom;
    return gross > 0 ? Math.round(gross * 100) / 100 : null;
  }

  ddMonthsLeft(dd: IndDrawdown): number | null {
    const term = Number(this.indInputs['term_months']);
    if (!term || dd.month == null || (dd.month as unknown) === '') return null;
    return Math.max(0, term - Number(dd.month));
  }
  ddGross(dd: IndDrawdown): number | null {
    if (dd.amount != null && (dd.amount as unknown) !== '') return Number(dd.amount);
    if (!dd.net) return null;
    if (this.indInputs['interest_type'] !== 'Retained' && this.indCalcType() !== 'dds') return Number(dd.net);
    const left = this.ddMonthsLeft(dd);
    const rate = Number(this.indInputs['monthly_rate_pct']);
    if (left == null || !rate) return null;
    const k = left * (rate / 100);
    if (k >= 1) return null;
    return Math.round((Number(dd.net) / (1 - k)) * 100) / 100;
  }
  ddInterest(dd: IndDrawdown): number | null {
    const g = this.ddGross(dd);
    if (g == null) return null;
    if (!dd.net) {
      const left = this.ddMonthsLeft(dd);
      const rate = Number(this.indInputs['monthly_rate_pct']);
      return left == null || !rate ? null : Math.round(g * left * (rate / 100) * 100) / 100;
    }
    return Math.round((g - Number(dd.net)) * 100) / 100;
  }
  ddNet(dd: IndDrawdown): number | null {
    if (dd.amount != null && (dd.amount as unknown) !== '') {
      const g = this.ddGross(dd); const i = this.ddInterest(dd);
      return g == null || i == null ? null : Math.round((g - i) * 100) / 100;
    }
    return dd.net != null ? Number(dd.net) : null;
  }
  /** Client 20-10-2026: a new drawdown is PRE-FILLED with the next month (was only a placeholder, read as filled). */
  addDrawdown(): void {
    const last = this.indDrawdowns.reduce((m, d, i) => Math.max(m, Number(d.month) || (i + 1)), 0);
    this.indDrawdowns.push({ month: last + 1, amount: null, net: null });
    this.recalcIndicative();
  }
  removeDrawdown(i: number): void { this.indDrawdowns.splice(i, 1); this.recalcIndicative(); }

  indCalcType(): string { return String(this.indInputs['calc_type'] || 'dds'); }
  setCalcType(t: string): void {
    this.indInputs['calc_type'] = t;
    if (t === 'serviced') this.applyRateCard();
    this.recalcIndicative();
  }
  private applyRateCard(): void {
    const m = Number(this.indInputs['monthly_rate_pct']);
    if (!Number.isFinite(m) || !m) return;
    this.indInputs['annual_rate_pct'] = Math.round((m * 16 - 2.4) * 100) / 100;
  }
  onRate2Change(): void {
    if (this.indCalcType() === 'serviced') this.applyRateCard();
    this.recalcIndicative();
  }

  private indPayload(): Record<string, unknown> {
    const t = this.indCalcType();
    const amountMode = this.indLtvMode() === 'amount';
    const drawdowns = this.indDrawdowns.map((d) => ({ month: d.month, amount: d.amount ?? null, net: d.amount != null ? null : (d.net ?? null) }));
    const ltv = amountMode
      ? { ltv_mode: 'amount', gross_loan: this.indInputs['gross_loan'] ?? null, ltv_pct: null }
      : { ltv_mode: 'pct', gross_loan: null };
    if (t === 'dds') return { ...this.indInputs, ...ltv, drawdowns, interest_type: 'Retained' };
    const p: Record<string, unknown> = { ...this.indInputs, ...ltv, drawdowns: [], gdv: null };
    if (t === 'serviced') { p['interest_type'] = 'Serviced'; }
    else { p['interest_type'] = 'Retained'; p['annual_rate_pct'] = null; }
    if (t === 'second_charge') { p['value_model'] = null; p['additional_securities'] = []; }
    return p;
  }

  recalcIndicative(): void {
    this.api.previewIndicative(this.enquiryId, this.indPayload())
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        if (!r) return;
        this.indCalc.set(r.calc); this.indWarnings.set(r.warnings || []); this.syncLoanFields();
        if (this.pendingLtvSyncFromAmount) {
          this.pendingLtvSyncFromAmount = false;
          const p = r.calc ? Number(r.calc.ltv_pct) : NaN;
          if (Number.isFinite(p) && p > 0) {
            this.indInputs['ltv_pct'] = p;
            this.indInputs['ltv_mode'] = 'pct';
            this.indInputs['gross_loan'] = null;
          }
        }
      });
  }

  save(): void {
    this.saving.set(true);
    this.uwApi.saveIndicativeEdit(this.caseId, this.indPayload(), this.ccList.filter((c) => c.on).map((c) => c.email))
      .pipe(catchError((e: { error?: { message?: string } }) => { this.saving.set(false); this.toastr.error(e?.error?.message || 'Could not save the indicative.', 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.saving.set(false);
        if (!r) return;
        if (r.emailed) this.toastr.success('Deal figures updated and the revised offer e-mailed' + (r.email_to ? ' to ' + r.email_to : '') + ' for signing. Upload the signed offer when it comes back.', 'Saved');
        else this.toastr.warning('Deal figures updated and the revised offer created, but the e-mail failed' + (r.email_error ? ': ' + r.email_error : '') + '.', 'Saved');
        this.saved.emit();
      });
  }
}
