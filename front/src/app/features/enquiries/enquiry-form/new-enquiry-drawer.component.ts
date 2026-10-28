import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, effect, inject, output, signal } from '@angular/core';
import { SafeResourceUrl } from '@angular/platform-browser';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormArray, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, debounceTime, of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';

import { SessionStore } from '../../../core/session/session.store';
import { PermissionsStore } from '../../../core/session/permissions.store';
import { TokenStore } from '../../../core/auth/token.store';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiDrawerComponent } from '../../../shared/ui/ui-drawer/ui-drawer.component';
import { UiFormFieldComponent } from '../../../shared/ui/ui-form-field/ui-form-field.component';
import { UiSegmentedComponent, SegmentOption } from '../../../shared/ui/ui-segmented/ui-segmented.component';
import { UiStepIndicatorComponent } from '../../../shared/ui/ui-step-indicator/ui-step-indicator.component';
import { EnquiriesService } from '../enquiries.service';
import { DEAL_TYPES, EnquiryFormOptions, SolicitorOption } from '../enquiries-list/enquiry.model';
import { isGoogleMapsLink } from '../../../core/util/map-link.util';
import { MapPreviewService } from '../../../core/util/map-preview.service';
import { NumInputDirective } from '../../../shared/ui/num-input.directive';

/**
 * New Enquiry — three-step wizard in a slide-over, matching the LoanDesk Figma:
 *   Step 1 Source & BDM   : Source Type · Lead Source · Broker/Introducer · Assigned BDM · Branch
 *   Step 2 Applicant       : Applicant Type (segmented) · Full Name · Email · Phone · Date of Birth
 *   Step 3 Loan Request    : Product · Gross Amount · Term · Loan Purpose · Requested Completion ·
 *                            Security/Property Address · Estimated Property Value · Est. LTV · Deal Summary
 * Reference lists load from /enquiries/meta/form-options. Submits to POST /api/enquiries.
 */
@Component({
  selector: 'app-new-enquiry-drawer',
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, UiButtonDirective, UiDrawerComponent, UiFormFieldComponent, UiSegmentedComponent, UiStepIndicatorComponent, NumInputDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './new-enquiry-drawer.component.html',
  styleUrl: './new-enquiry-drawer.component.scss',
})
export class NewEnquiryDrawerComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(EnquiriesService);
  private readonly session = inject(SessionStore);
  private readonly perms = inject(PermissionsStore);
  private readonly tokens = inject(TokenStore);
  readonly isSuperAdmin = this.perms.isSuperAdmin;
  private readonly toastr = inject(ToastrService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly maps = inject(MapPreviewService);

  readonly closed = output<void>();
  readonly created = output<void>();

  readonly dealTypes = DEAL_TYPES;
  readonly steps = [{ label: 'Source & BDM' }, { label: 'Applicant Details' }, { label: 'Loan Request' }, { label: 'Security & Property' }, { label: 'Other Securities' }];
  readonly step = signal(0);
  /** Furthest step the user has reached; steps up to here are clickable in the rail. */
  readonly maxStep = signal(0);
  goStep(i: number): void { if (i >= 0 && i <= this.maxStep()) this.step.set(i); }
  readonly saving = signal(false);
  readonly opts = signal<EnquiryFormOptions | null>(null);

  // Quick add-new broker (client: broker dropdown + manual entry with email/phone)
  readonly brokerAddOpen = signal(false);
  readonly brokerSaving = signal(false);
  readonly brokerError = signal<string | null>(null);
  brokerDraft: { name: string; email: string; phone: string; company: string; address: string; fca_number: string } = { name: '', email: '', phone: '', company: '', address: '', fca_number: '' };
  toggleBrokerAdd(): void {
    this.brokerError.set(null);
    // Opening "Add new" cancels any in-progress edit (one broker panel at a time).
    if (this.brokerEditOpen()) this.brokerEditOpen.set(false);
    this.brokerAddOpen.update((v) => !v);
  }

  // Edit the broker currently selected in the dropdown (client 07-10-2026): the
  // SAME record is updated — a new broker is never created from here.
  readonly brokerEditOpen = signal(false);
  readonly brokerEditSaving = signal(false);
  readonly brokerEditError = signal<string | null>(null);
  brokerEditDraft: { name: string; email: string; phone: string; company: string; address: string; fca_number: string } = { name: '', email: '', phone: '', company: '', address: '', fca_number: '' };
  /** The broker id captured when the edit panel opened — the record the Update call targets. */
  private brokerEditId = 0;

  /** Is a broker chosen in the dropdown (so there is something to edit)? Method, not
   *  computed, so it re-reads the reactive form control on every change detection. */
  brokerSelected(): boolean {
    const v = this.form?.controls.broker_id.value;
    return !!v && String(v) !== '';
  }

  /** Open the edit panel, prefilled from the selected broker's option row. */
  openBrokerEdit(): void {
    const id = Number(this.form.controls.broker_id.value);
    if (!id) { this.brokerEditError.set('Select a broker to edit first.'); return; }
    const b = (this.opts()?.brokers || []).find((o) => Number(o.id) === id);
    if (!b) return;
    if (this.brokerAddOpen()) this.brokerAddOpen.set(false);
    this.brokerEditId = id;
    this.brokerEditDraft = { name: b.name || '', email: b.email || '', phone: b.phone || '', company: b.company || '', address: b.address || '', fca_number: b.fca_number || '' };
    this.brokerEditError.set(null);
    this.brokerEditOpen.set(true);
  }
  cancelBrokerEdit(): void { this.brokerEditOpen.set(false); this.brokerEditError.set(null); }

  saveBrokerEdit(): void {
    const id = this.brokerEditId;
    if (!id) return;
    const name = this.brokerEditDraft.name.trim();
    const email = this.brokerEditDraft.email.trim();
    const phone = this.brokerEditDraft.phone.trim();
    const company = this.brokerEditDraft.company.trim();
    const address = (this.brokerEditDraft.address || '').trim();
    const fca_number = (this.brokerEditDraft.fca_number || '').trim();
    if (!name) { this.brokerEditError.set('Broker name is required.'); return; }
    if (!company) { this.brokerEditError.set('Company name is required.'); return; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { this.brokerEditError.set('Enter a valid email address.'); return; }
    if (phone && !/^\+?[0-9\s()-]{6,}$/.test(phone)) { this.brokerEditError.set('Enter a valid phone number.'); return; }
    this.brokerEditSaving.set(true); this.brokerEditError.set(null);
    this.api.updateBroker(id, { name, email, phone, company, address, fca_number })
      .pipe(catchError((e: { error?: { errors?: Record<string, string>; message?: string } }) => {
        const errs = e?.error?.errors;
        this.brokerEditError.set((errs && Object.values(errs)[0]) || e?.error?.message || 'Could not update broker.');
        this.brokerEditSaving.set(false); return of(null);
      }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.brokerEditSaving.set(false);
        if (!r) return;
        // Replace the edited row in place — same id, updated fields.
        this.opts.update((o) => (o ? { ...o, brokers: o.brokers.map((b) => (Number(b.id) === id ? { ...b, name: r.name, company: r.company, email: r.email, phone: r.phone, address, fca_number } : b)) } : o));
        this.brokerEditOpen.set(false);
      });
  }
  saveBroker(): void {
    const name = this.brokerDraft.name.trim();
    const email = this.brokerDraft.email.trim();
    const phone = this.brokerDraft.phone.trim();
    const company = this.brokerDraft.company.trim();
    const address = (this.brokerDraft.address || '').trim();
    const fca_number = (this.brokerDraft.fca_number || '').trim();
    if (!name) { this.brokerError.set('Broker name is required.'); return; }
    if (!company) { this.brokerError.set('Company name is required.'); return; }
    if (!email) { this.brokerError.set('Broker email is required.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { this.brokerError.set('Enter a valid email address.'); return; }
    if (phone && !/^\+?[0-9\s()-]{6,}$/.test(phone)) { this.brokerError.set('Enter a valid phone number.'); return; }
    this.brokerSaving.set(true); this.brokerError.set(null);
    this.api.createBroker({ name, email, phone, company, address, fca_number })
      .pipe(catchError((e: { error?: { errors?: Record<string, string>; message?: string } }) => {
        const errs = e?.error?.errors;
        this.brokerError.set((errs && Object.values(errs)[0]) || e?.error?.message || 'Could not add broker.');
        this.brokerSaving.set(false); return of(null);
      }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.brokerSaving.set(false);
        if (!r) return;
        this.opts.update((o) => (o ? { ...o, brokers: [...o.brokers, { id: r.id, name: r.name, company: r.company, email, phone, address, fca_number }] } : o));
        this.form.controls.broker_id.setValue(String(r.id));
        this.brokerAddOpen.set(false);
        this.brokerDraft = { name: '', email: '', phone: '', company: '', address: '', fca_number: '' };
      });
  }
  // ── Borrower's solicitor dropdown (client 15-10-2026) ────────────────────────
  // Same pattern as the broker dropdown: pick from the Solicitor master, edit the
  // selected record in place, or add a new one. Fields = the 5 application-form fields.
  readonly solAddOpen = signal(false);
  readonly solEditOpen = signal(false);
  readonly solSaving = signal(false);
  readonly solError = signal<string | null>(null);
  solDraft: Omit<SolicitorOption, 'id'> = { firm: '', contact_name: '', address: '', telephone: '', email: '', sra_partners: '' };
  private solEditId = 0;
  private emptySol(): Omit<SolicitorOption, 'id'> { return { firm: '', contact_name: '', address: '', telephone: '', email: '', sra_partners: '' }; }
  /** The solicitor row currently picked in the dropdown (null when none). */
  selectedSolicitor(): SolicitorOption | null {
    const id = Number((this.formValue() as Record<string, unknown>)['borrower_solicitor_id']);
    return id ? ((this.opts()?.solicitors || []).find((s) => Number(s.id) === id) || null) : null;
  }
  toggleSolAdd(): void {
    this.solError.set(null);
    this.solEditOpen.set(false);
    if (!this.solAddOpen()) this.solDraft = this.emptySol();
    this.solAddOpen.update((v) => !v);
  }
  toggleSolEdit(): void {
    this.solError.set(null);
    if (this.solEditOpen()) { this.solEditOpen.set(false); return; }
    const s = this.selectedSolicitor();
    if (!s) { this.solError.set('Select a solicitor to edit first.'); return; }
    this.solAddOpen.set(false);
    this.solEditId = s.id;
    this.solDraft = { firm: s.firm || '', contact_name: s.contact_name || '', address: s.address || '', telephone: s.telephone || '', email: s.email || '', sra_partners: s.sra_partners ?? '' };
    this.solEditOpen.set(true);
  }
  cancelSol(): void { this.solAddOpen.set(false); this.solEditOpen.set(false); this.solError.set(null); }
  saveSol(): void {
    const d = {
      firm: this.solDraft.firm.trim(), contact_name: (this.solDraft.contact_name || '').trim(), address: (this.solDraft.address || '').trim(),
      telephone: (this.solDraft.telephone || '').trim(), email: (this.solDraft.email || '').trim(),
      sra_partners: this.solDraft.sra_partners === '' || this.solDraft.sra_partners == null ? null : Number(this.solDraft.sra_partners),
    };
    if (!d.firm) { this.solError.set("Borrower's solicitor / firm name is required."); return; }
    if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) { this.solError.set('Enter a valid email address.'); return; }
    if (d.telephone && !/^\+?[0-9\s()-]{6,}$/.test(d.telephone)) { this.solError.set('Enter a valid telephone number.'); return; }
    if (d.sra_partners != null && (!Number.isInteger(d.sra_partners) || d.sra_partners < 0)) { this.solError.set('Number of SRA partners must be a whole number.'); return; }
    const editing = this.solEditOpen();
    const call = editing ? this.api.updateSolicitor(this.solEditId, d) : this.api.createSolicitor(d);
    this.solSaving.set(true); this.solError.set(null);
    call.pipe(
      catchError((e: { error?: { message?: string; errors?: Record<string, string> } }) => {
        const errs = e?.error?.errors;
        this.solError.set((errs && Object.values(errs)[0]) || e?.error?.message || 'Could not save the solicitor.');
        this.solSaving.set(false); return of(null);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => {
      if (!r) return;
      this.solSaving.set(false);
      this.opts.update((o) => {
        if (!o) return o;
        const list = o.solicitors || [];
        const next = editing ? list.map((s) => (Number(s.id) === Number(r.id) ? r : s)) : [...list, r];
        return { ...o, solicitors: next.sort((a, b) => (a.firm || '').localeCompare(b.firm || '')) };
      });
      this.form.controls.borrower_solicitor_id.setValue(String(r.id));
      this.cancelSol();
      this.toastr.success(editing ? 'Solicitor updated.' : 'Solicitor added.', 'Saved');
    });
  }

  readonly applicantType = signal<string>('');
  /** True once the user has tried to advance/submit without choosing a type. */
  readonly applicantTypeTouched = signal(false);
  readonly applicantTypeError = computed(() =>
    this.applicantTypeTouched() && !this.applicantType() ? 'Applicant type is required.' : '');
  readonly serverErrors = signal<Record<string, string>>({});

  /** Enquiry intake supports Individual and Company only (client requirement). */
  readonly applicantTypeOptions = computed<SegmentOption[]>(() =>
    (this.opts()?.applicantTypes || [])
      .filter((t) => /scotland|england|wales/i.test(t.name))
      .map((t) => ({ key: String(t.id), label: t.name })),
  );

  /** Name of the selected applicant type (Individual / Company / Joint / Multi-Party). */
  readonly applicantTypeName = computed(() => {
    const id = this.applicantType();
    const t = (this.opts()?.applicantTypes || []).find((x) => String(x.id) === id);
    return t ? t.name : '';
  });
  readonly isCompany = computed(() => /compan|limited|ltd/i.test(this.applicantTypeName()));

  /** Company name is required only for a Company enquiry. */
  /** Today as YYYY-MM-DD; the `max` on the DOB / requested-completion pickers,
   *  so the browser itself refuses a date later than today. The server checks
   *  the same rule (enquiry.config `notFuture`). */
  readonly today = new Date().toLocaleDateString('en-CA');

  /** Company name is optional too (borrower details not mandatory) — kept as a hook. */
  private applyNameValidators(): void {
    const compCtrl = this.form.controls.company_name;
    compCtrl.clearValidators();
    compCtrl.updateValueAndValidity({ emitEvent: false });
  }
  onTypeChange(key: string): void {
    this.applicantType.set(key);
    if (key) this.applicantTypeTouched.set(false);
    this.applyNameValidators();
    // Company enquiries keep the full director list; Individual collapses to one applicant.
    if (!this.isCompany() && this.applicants.length > 1) {
      while (this.applicants.length > 1) this.applicants.removeAt(this.applicants.length - 1);
    }
    if (this.applicants.length === 0) this.addApplicant();
  }

  /** Build a blank applicant / director sub-form (client PDF section 4). */
  private newApplicant(_primary = false): FormGroup {
    // Borrower details are all optional (client 25-09-2026) — often unknown when
    // the enquiry arrives, e.g. through a broker. Format checks still apply.
    void _primary;
    // maxLength mirrors the real dbo.enquiry_applicants column widths so an
    // over-long value is caught on THIS step, not only on the server at submit.
    // Client 15-10-2026: no special characters - names letters / spaces / . ' - only,
    // other text without < > * ; = ` { } [ ] \ | ^ ~ $ (mirrors api/utils/textRules.js).
    const SAFE = Validators.pattern(/^[^<>*;=`{}[\]\\|^~$]*$/);
    return this.fb.nonNullable.group({
      full_name: ['', [Validators.maxLength(200), Validators.pattern(/^([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F .'\-]*)?$/)]],
      dob: [''],
      nationality: ['', [Validators.maxLength(80), SAFE]],
      address: ['', [Validators.maxLength(400), SAFE]],
      time_at_address: ['', [Validators.maxLength(80), SAFE]],
      email: ['', [Validators.email, Validators.maxLength(150)]],
      mobile: ['', [Validators.maxLength(40), Validators.pattern(/^\+?[0-9]+$/)]],
      owns_home: [''],
      occupation: ['', [Validators.maxLength(150), SAFE]],
      employer_name: ['', [Validators.maxLength(200), SAFE]],
      business_address: ['', [Validators.maxLength(400), SAFE]],
      length_of_service: ['', [Validators.maxLength(80), SAFE]],
      relationship: ['', [Validators.maxLength(120), SAFE]],
      shareholding_pct: ['', [Validators.min(0), Validators.max(100)]],
      prev_bridging: [''],
      prev_bridging_lender: ['', [Validators.maxLength(200), SAFE]],
    });
  }
  get applicants(): FormArray { return this.form.controls.applicants as FormArray; }
  applicantGroup(i: number): FormGroup { return this.applicants.at(i) as FormGroup; }
  addApplicant(): void { this.applicants.push(this.newApplicant(this.applicants.length === 0)); }
  removeApplicant(i: number): void { if (this.applicants.length > 1) this.applicants.removeAt(i); }

  /**
   * Step 3 — "Drawdowns required?" is a plain Yes / No for now (client 26-09-2026):
   * no month / amount rows are captured on the enquiry. The row helpers stay so
   * the rows can be switched back on later without rebuilding them.
   */
  private newDrawdown(month: number | '' = ''): FormGroup {
    return this.fb.nonNullable.group({
      month: [month as number | string, [Validators.min(1), Validators.max(600)]],
      amount: ['' as number | string, [Validators.min(1), Validators.max(999999999999)]],
    });
  }
  get drawdowns(): FormArray { return this.form.controls.drawdowns as FormArray; }
  drawdownGroup(i: number): FormGroup { return this.drawdowns.at(i) as FormGroup; }
  addDrawdown(): void { this.drawdowns.push(this.newDrawdown(this.drawdowns.length + 1)); }
  removeDrawdown(i: number): void { this.drawdowns.removeAt(i); }
  readonly wantsDrawdowns = computed(() => String(this.formValue().drawdowns_required) === 'true');
  onDrawdownsRequired(): void {
    // Yes / No only — never open drawdown rows from here.
    this.drawdowns.clear();
  }
  derr(i: number, name: string): string {
    const c = this.drawdownGroup(i).get(name);
    if (c && c.invalid && c.touched) return name === 'month' ? 'Month 1-600.' : 'Enter a valid amount.';
    return '';
  }

  /** Step 4 — Google Maps link -> embedded map preview. */
  readonly mapLinkInvalid = computed(() => {
    const v = String(this.formValue().map_link || '').trim();
    return !!v && !isGoogleMapsLink(v);
  });
  // Map shows from the link OR the address / postcode (client 29-09-2026);
  // debounced so the iframe does not reload on every keystroke.
  readonly mapUrl = computed<SafeResourceUrl | null>(() => {
    const fv = this.mapInputs() as Record<string, unknown>;
    return this.maps.embed(fv['map_link'] as string, fv['property_address'] as string, fv['postcode'] as string);
  });

  /**
   * Step 5 — additional securities. Each one carries the SAME fields as the main
   * Security / Property on step 4 (client 26-09-2026). Stored as JSON in
   * enquiries.additional_securities; `address` is the property address.
   */
  private newSecurity(): FormGroup {
    const money = [Validators.min(0), Validators.max(999999999999)];
    return this.fb.nonNullable.group({
      address: ['', [Validators.required, Validators.maxLength(255)]],
      map_link: ['', [Validators.maxLength(1000), (c: import('@angular/forms').AbstractControl) => (c.value && !isGoogleMapsLink(String(c.value)) ? { maplink: true } : null)]],
      postcode: ['', [Validators.maxLength(20)]],
      property_type: ['', [Validators.maxLength(80)]],
      tenure: [''],
      tenure_years: ['', [Validators.min(0), Validators.max(999)]],
      charge_type: ['', Validators.required],
      charge_amount: ['', money],   // shown only for a 2nd charge
      owns_property: [''],
      estimated_value: ['', [Validators.required, ...money]],
      gdv: ['', money],
      purchase_price: ['', money],
      purchase_date: [''],
      outstanding_loan: ['', money],
      repaid_on_completion: [''],
      lender: ['', [Validators.maxLength(150)]],
      added_value: ['', [Validators.maxLength(4000)]],
    });
  }
  /** Map preview per security — from its link OR its address / postcode (debounced, cached). */
  secMapUrl(i: number): SafeResourceUrl | null {
    const list = ((this.mapInputs() as Record<string, unknown>)['securities'] || []) as Record<string, string>[];
    const g = list[i];
    if (!g) return null;
    return this.maps.embed(g['map_link'], g['address'], g['postcode']);
  }
  get securities(): FormArray { return this.form.controls.securities as FormArray; }
  securityGroup(i: number): FormGroup { return this.securities.at(i) as FormGroup; }
  addSecurity(): void { this.securities.push(this.newSecurity()); }
  removeSecurity(i: number): void { this.securities.removeAt(i); }
  serr(i: number, name: string): string {
    const c = this.securityGroup(i).get(name);
    if (c && c.invalid && c.touched) {
      if (c.errors?.['maxlength']) return `Must be ${c.errors['maxlength'].requiredLength} characters or fewer.`;
      if (c.errors?.['maplink']) return 'Enter a valid Google Maps link (https://maps.app.goo.gl/… or https://www.google.com/maps/…).';
      if (c.errors?.['max'] != null) return `Must be ${c.errors['max'].max} or less.`;
      if (c.errors?.['min'] != null) return `Must be ${c.errors['min'].min} or more.`;
      return 'Invalid value.';
    }
    return '';
  }
  /**
   * Mobile accepts ONLY a leading '+' and digits. Strip anything else the moment
   * it is typed or pasted, so a letter or symbol can never enter the field.
   */
  sanitizeMobile(i: number, ev: Event): void {
    const el = ev.target as HTMLInputElement;
    let v = el.value.replace(/[^0-9+]/g, '');   // keep digits and '+'
    v = v.replace(/(?!^)\+/g, '');             // '+' allowed only at the start
    if (v !== el.value) {
      el.value = v;
      this.applicantGroup(i).get('mobile')?.setValue(v, { emitEvent: false });
    }
  }
  aerr(i: number, name: string): string {
    // Server errors first — this used to check only the local control, so a
    // rejection on an applicant field never reached the box it belonged to.
    const fromServer = this.serverErrors()[`applicants[${i}].${name}`];
    if (fromServer) return fromServer;
    const c = this.applicantGroup(i).get(name);
    if (c && c.invalid && c.touched) {
      if (c.errors?.['email']) return 'Enter a valid email address.';
      if (c.errors?.['maxlength']) return `Must be ${c.errors['maxlength'].requiredLength} characters or fewer.`;
      if (c.errors?.['max'] != null) return `Must be ${c.errors['max'].max} or less.`;
      if (c.errors?.['min'] != null) return `Must be ${c.errors['min'].min} or more.`;
      if (c.errors?.['pattern']) {
        if (name === 'mobile') return 'Digits only, with an optional leading +.';
        if (name === 'full_name') return "Use letters, spaces and . ' - only.";
        return 'Special characters < > * ; = ` { } [ ] \\ | ^ ~ $ are not allowed.';
      }
      return 'This field is required.';
    }
    return '';
  }

  readonly form = this.fb.nonNullable.group({
    application_source_id: [''],
    lead_source_id: [''],
    broker_id: [''],
    assigned_to: [''],
    branch_id: ['', Validators.required],
    company_name: [''],
    company_reg_no: ['', [Validators.maxLength(50), Validators.pattern(/^[A-Za-z0-9 ]*$/)]],
    applicants: this.fb.array([this.newApplicant(true)]),
    securities: this.fb.array([] as FormGroup[]),
    product_id: ['', Validators.required],
    loan_purpose_id: ['', Validators.required],
    amount_requested: ['', [Validators.required, Validators.min(1), Validators.max(999999999999)]],
    loan_basis: ['Gross'],
    term_months: ['', [Validators.required, Validators.min(1), Validators.max(600)]],
    deal_type: [''], // client 26-10-2026: Residential / Commercial / Mixed
    interest_type: ['Retained'],
    drawdowns_required: ['false'],
    drawdowns: this.fb.array([] as FormGroup[]),
    requested_completion_date: [''],
    // Client 15-10-2026: application form section 2 "Loan Details".
    total_project_cost: ['', [Validators.min(0), Validators.max(999999999999)]],
    own_contribution: ['', [Validators.min(0), Validators.max(999999999999)]],
    deposit_source: ['', Validators.maxLength(500)],
    additional_borrowing: [''],
    exit_strategy: ['', Validators.maxLength(4000)],
    summary: [''],
    // Step 3 — solicitor representation (client 15-10-2026). Single rep -> the borrower's own
    // solicitor (5 fields, same as section 5 of the application form); dual -> ours acts for both.
    rep_type: [''], // client 15-10-2026: blank by default (no Single / Dual pre-selected)
    // Borrower's solicitor = a Solicitor master row (client 15-10-2026); the server copies its
    // 5 fields onto the enquiry. The 4 credit-paper notes moved to the Convert popup.
    borrower_solicitor_id: [''],
    // Step 4 — Security / Property (client PDF section 3)
    property_address: ['', Validators.required],
    postcode: [''],
    property_type: [''],
    tenure: [''],
    tenure_years: ['', [Validators.min(0), Validators.max(999)]],
    charge_type: ['', Validators.required],
    charge_amount: ['', [Validators.min(0), Validators.max(999999999999)]], // shown only for a 2nd charge
    estimated_value: ['', [Validators.required, Validators.min(1), Validators.max(999999999999)]],
    gdv: ['', [Validators.min(0), Validators.max(999999999999)]],
    owns_property: [''],
    purchase_price: ['', [Validators.min(0), Validators.max(999999999999)]],
    purchase_date: [''],
    outstanding_loan: ['', [Validators.min(0), Validators.max(999999999999)]],
    repaid_on_completion: [''],
    lender: [''],
    added_value: [''],
    map_link: ['', [Validators.maxLength(1000), (c: import('@angular/forms').AbstractControl) => (c.value && !isGoogleMapsLink(String(c.value)) ? { maplink: true } : null)]],
  });

  /** Live form value as a signal so computed()s react to typing. */
  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  private readonly mapInputs = toSignal(this.form.valueChanges.pipe(debounceTime(600)), { initialValue: this.form.getRawValue() });
  /** Is the main security (step 4) / other security i (step 5) a 2nd charge? */
  readonly mainIs2nd = computed(() => this.formValue().charge_type === '2nd');
  secIs2nd(i: number): boolean { return this.securityGroup(i).get('charge_type')?.value === '2nd'; }

  /**
   * Est. LTV — steps 3, 4 AND 5 together. Client 19-10-2026: the loan PLUS every
   * 2nd-charge amount (step 4 main security + step 5 other securities) over all values:
   *   (loan amount + Σ 2nd-charge amounts) ÷ Σ property values × 100
   *   e.g. (100,000 + 100,000) ÷ 500,000 = 40%
   * A charge amount only counts when that security's Charge is "2nd Charge".
   * Same formula as utils/ltv.js ltvPair().total (stored as total_ltv_pct on save).
   */
  readonly ltv = computed(() => {
    const fv = this.formValue() as Record<string, unknown>;
    const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
    const charge = (s: Record<string, unknown>) => (s['charge_type'] === '2nd' ? num(s['charge_amount']) : 0);
    const a = num(fv['amount_requested']);
    let value = num(fv['estimated_value']);
    let charges = charge(fv);
    for (const x of ((fv['securities'] as Record<string, unknown>[]) || [])) {
      value += num(x['estimated_value']);
      charges += charge(x);
    }
    if (!value || !a) return '—';
    return `${Math.round(((a + charges) / value) * 10000) / 100}%`;
  });

  /** Loan basis (Gross/Net) chosen on step 3; drives the Est. LTV label. */
  readonly loanBasis = computed(() => ((this.formValue() as Record<string, unknown>)['loan_basis'] === 'Net' ? 'Net' : 'Gross'));
  readonly ltvLabel = computed(() => `Est. ${this.loanBasis()} LTV`);
  /** Single rep -> show the borrower's solicitor fields (client 15-10-2026). */
  readonly isSingleRep = computed(() => (this.formValue() as Record<string, unknown>)['rep_type'] === 'single');
  /** Representation dropdown changed: dual rep has no borrower's solicitor. */
  onRepTypeChange(): void {
    if (this.form.controls.rep_type.value !== 'single') { this.form.controls.borrower_solicitor_id.setValue(''); this.cancelSol(); }
  }

  constructor() {
    // Pre-select the logged-in BDM / branch once options arrive (Figma shows them filled).
    effect(() => {
      const o = this.opts();
      if (!o) return;
      const uid = this.tokens.user()?.userId;
      const isSuper = this.perms.isSuperAdmin();
      // BDM login -> default to own id + own branch, and lock. System Admin -> free selection.
      const selfEmail = this.tokens.user()?.email ?? this.session.userEmail();
      const self = uid != null ? o.assignees.find((a) => String(a.id) === String(uid)) : undefined;
      const selfByName = self
        || (selfEmail ? o.assignees.find((a) => a.email && a.email.toLowerCase() === String(selfEmail).toLowerCase()) : undefined)
        || o.assignees.find((a) => a.name === this.session.userName());
      if (selfByName && !this.form.controls.assigned_to.value) this.form.controls.assigned_to.setValue(String(selfByName.id));
      const branch = o.branches.find((b) => b.name === this.session.branchName() || (this.session.branchName() && b.name.includes(this.session.branchName())));
      if (branch && !this.form.controls.branch_id.value) this.form.controls.branch_id.setValue(String(branch.id));
      // Only ONE branch -> select it by default. A disabled / read-only branch box
      // (BDM login, already pre-filled with the user's own branch) is left untouched.
      else if (!branch && o.branches.length === 1 && this.form.controls.branch_id.enabled && !this.form.controls.branch_id.value) {
        this.form.controls.branch_id.setValue(String(o.branches[0].id));
      }
      if (!isSuper) {
        // lock BDM + branch for a non-admin (BDM) user
        if (this.form.controls.assigned_to.enabled) this.form.controls.assigned_to.disable({ emitEvent: false });
        if (branch && this.form.controls.branch_id.enabled) this.form.controls.branch_id.disable({ emitEvent: false });
      } else {
        if (this.form.controls.assigned_to.disabled) this.form.controls.assigned_to.enable({ emitEvent: false });
        if (this.form.controls.branch_id.disabled) this.form.controls.branch_id.enable({ emitEvent: false });
      }
      // Applicant type must be chosen explicitly (client 09-10-2026) — no auto-default; the field is required before submit.
    });
  }

  ngOnInit(): void {
    this.api.formOptions()
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((o) => this.opts.set(o));
  }

  err(name: string): string {
    const c = this.form.get(name);
    if (this.serverErrors()[name]) return this.serverErrors()[name];
    if (c && c.invalid && c.touched) {
      if (c.errors?.['email']) return 'Enter a valid email address.';
      if (c.errors?.['maxlength']) return `Must be ${c.errors['maxlength'].requiredLength} characters or fewer.`;
      if (c.errors?.['max'] != null) return `Must be ${c.errors['max'].max} or less.`;
      if (c.errors?.['min'] != null) return `Must be ${c.errors['min'].min} or more.`;
      if (c.errors?.['pattern']) return 'Letters and numbers only.';
      return 'This field is required.';
    }
    return '';
  }

  /* ---- server-side validation feedback ------------------------------- */

  /**
   * Which wizard step each field lives on, so a rejected save can take the user
   * straight to the problem instead of leaving them on the last step with a red
   * toast and no idea which box is wrong.
   */
  private readonly FIELD_STEP: Record<string, number> = {
    application_source_id: 0, lead_source_id: 0, broker_id: 0, broker_name: 0, assigned_to: 0, branch_id: 0,
    company_name: 1, company_reg_no: 1, applicant_type_id: 1,
    applicant_name: 1, email: 1, phone: 1, dob: 1,
    product_id: 2, amount_requested: 2, loan_basis: 2, term_months: 2, interest_type: 2, loan_purpose_id: 2, deal_type: 2,
    requested_completion_date: 2, summary: 2, drawdowns_required: 2,
    total_project_cost: 2, own_contribution: 2, deposit_source: 2, additional_borrowing: 2, exit_strategy: 2,
    rep_type: 2, borrower_solicitor_id: 2,
    property_address: 3, postcode: 3, property_type: 3, tenure: 3, tenure_years: 3,
    charge_type: 3, charge_amount: 3, owns_property: 3, estimated_value: 3, gdv: 3, purchase_price: 3,
    purchase_date: 3, outstanding_loan: 3, repaid_on_completion: 3, lender: 3, added_value: 3, map_link: 3,
  };

  /**
   * Four enquiry columns are derived from the PRIMARY APPLICANT at submit time,
   * so the server rejects e.g. `phone` while the only box on screen is the
   * applicant's Mobile. Without this mapping those errors pointed at controls
   * that do not exist and were never displayed at all.
   */
  private readonly DERIVED_FROM_PRIMARY: Record<string, string> = {
    phone: 'mobile', email: 'email', applicant_name: 'full_name', dob: 'dob',
  };

  /** Human label for the summary line. */
  private readonly FIELD_LABEL: Record<string, string> = {
    phone: 'Mobile', email: 'Email', applicant_name: 'Full name', dob: 'Date of birth',
    term_months: 'Term (months)', amount_requested: 'Loan amount',
    loan_purpose_id: 'Loan purpose', product_id: 'Product', branch_id: 'Branch',
    property_address: 'Property address',
    borrower_solicitor_id: "Borrower's solicitor",
  };

  readonly serverErrorList = signal<{ field: string; label: string; message: string; step: number }[]>([]);

  private labelFor(field: string): string {
    if (this.FIELD_LABEL[field]) return this.FIELD_LABEL[field];
    const m = field.match(/^applicants\[(\d+)\]\.(.+)$/);
    if (m) return `Applicant ${Number(m[1]) + 1} — ${m[2].replace(/_/g, ' ')}`;
    return field.replace(/_id$/, '').replace(/_/g, ' ');
  }

  private stepFor(field: string): number {
    if (/^applicants\[/.test(field)) return 1;
    return this.FIELD_STEP[field] ?? 0;
  }

  /**
   * Take the server's field errors, mirror them onto the controls the user can
   * actually see, list them, and jump to the earliest step that has one.
   */
  private applyServerErrors(errors: Record<string, string>): void {
    const mapped: Record<string, string> = { ...errors };

    // enquiry-level -> the primary applicant box it came from
    for (const [serverField, applicantField] of Object.entries(this.DERIVED_FROM_PRIMARY)) {
      if (errors[serverField]) mapped[`applicants[0].${applicantField}`] = errors[serverField];
    }
    this.serverErrors.set(mapped);

    const list = Object.entries(errors).map(([field, message]) => ({
      field, message, label: this.labelFor(field), step: this.stepFor(field),
    })).sort((a, b) => a.step - b.step);
    this.serverErrorList.set(list);

    if (list.length) this.step.set(list[0].step);
  }

  /** One-line toast summary naming the fields, not just "Validation Error". */
  private serverErrorSummary(): string {
    const list = this.serverErrorList();
    if (!list.length) return '';
    const names = list.map((x) => x.label);
    return names.length === 1
      ? `${names[0]}: ${list[0].message}`
      : `Check these fields: ${names.join(', ')}`;
  }

  /** Errors that belong to a step other than the one on screen. */
  errorsElsewhere(): { label: string; message: string; step: number }[] {
    return this.serverErrorList().filter((x) => x.step !== this.step());
  }

  goToErrorStep(n: number): void { this.step.set(n); }

  stepName(n: number): string {
    return ['Source & BDM', 'Applicant Details', 'Loan Request', 'Security & Property', 'Other Securities'][n] || `Step ${n + 1}`;
  }

  /** Every reactive control that lives on a given wizard step (0-3). */
  private stepControls(step: number): import('@angular/forms').AbstractControl[] {
    const out: import('@angular/forms').AbstractControl[] = [];
    // Flat enquiry fields, taken from the same FIELD_STEP map the error list uses.
    for (const [name, s] of Object.entries(this.FIELD_STEP)) {
      if (s !== step) continue;
      const c = this.form.get(name);
      if (c) out.push(c);
    }
    // Step 2 (Applicant Details) owns the whole applicant / director array — so
    // every row's Full name, Email and Mobile is validated, not only the primary.
    if (step === 1) {
      this.applicants.controls.forEach((g) => {
        const grp = g as FormGroup;
        Object.keys(grp.controls).forEach((k) => { const c = grp.get(k); if (c) out.push(c); });
      });
    }
    if (step === 2) {
      this.drawdowns.controls.forEach((g) => {
        const grp = g as FormGroup;
        Object.keys(grp.controls).forEach((k) => { const c = grp.get(k); if (c) out.push(c); });
      });
    }
    if (step === 4) {
      this.securities.controls.forEach((g) => {
        const grp = g as FormGroup;
        Object.keys(grp.controls).forEach((k) => { const c = grp.get(k); if (c) out.push(c); });
      });
    }
    return out;
  }

  /** Earliest step (0-3) that still has an invalid, enabled control. */
  private firstInvalidStep(): number {
    for (let s = 0; s < this.steps.length; s++) {
      if (this.stepControls(s).some((c) => c.enabled && c.invalid)) return s;
    }
    return this.step();
  }

  next(): void {
    // Validate EVERY field on the current step before advancing — not a
    // hand-picked few — and cover every applicant/director row, so no bad value
    // slips past a step to reach a later step or the final submit.
    const controls = this.stepControls(this.step());
    let invalid = false;
    controls.forEach((c) => { c.markAsTouched(); if (c.enabled && c.invalid) invalid = true; });
    if (this.step() === 1 && !this.applicantType()) { this.applicantTypeTouched.set(true); invalid = true; }
    if (invalid) return;
    this.step.update((s) => Math.min(this.steps.length - 1, s + 1));
    this.maxStep.update((m) => Math.max(m, this.step()));
  }
  back(): void { this.step.update((s) => Math.max(0, s - 1)); }

  submit(): void {
    this.maxStep.set(this.steps.length - 1);
    if (this.form.invalid) { this.form.markAllAsTouched(); this.step.set(this.firstInvalidStep()); return; }
    if (!this.applicantType()) { this.applicantTypeTouched.set(true); this.step.set(1); return; }
    this.saving.set(true);
    this.serverErrors.set({});
    this.serverErrorList.set([]);
    const raw = this.form.getRawValue() as Record<string, unknown>;
    const applicants = (raw['applicants'] as Record<string, unknown>[]) || [];
    delete raw['applicants'];
    const securities = ((raw['securities'] as Record<string, unknown>[]) || [])
      .filter((row) => Object.values(row).some((v) => v !== '' && v !== null && v !== undefined));
    delete raw['securities'];
    const drawdowns = ((raw['drawdowns'] as Record<string, unknown>[]) || [])
      .filter((row) => row['amount'] !== '' && row['amount'] !== null && row['amount'] !== undefined)
      .map((row) => ({ month: row['month'] === '' ? null : Number(row['month']), amount: Number(row['amount']) }));
    delete raw['drawdowns'];
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v !== '' && v !== null && v !== undefined) payload[k] = v;
    }
    if (this.applicantType()) payload['applicant_type_id'] = Number(this.applicantType());
    // The primary applicant populates the enquiry-level contact columns (list / search).
    const primary = applicants[0] || {};
    if (primary['full_name']) payload['applicant_name'] = primary['full_name'];
    if (primary['email']) payload['email'] = primary['email'];
    if (primary['mobile']) payload['phone'] = primary['mobile'];
    if (primary['dob']) payload['dob'] = primary['dob'];
    // Tag ordering / primary flag and send the full list.
    payload['applicants'] = applicants.map((a, i) => ({ ...a, sort_order: i, is_primary: i === 0 }));
    if (payload['charge_type'] !== '2nd') delete payload['charge_amount'];
    // Dual rep: no separate borrower's solicitor (server clears them too).
    if (payload['rep_type'] !== 'single') delete payload['borrower_solicitor_id'];
    else if (payload['borrower_solicitor_id']) payload['borrower_solicitor_id'] = Number(payload['borrower_solicitor_id']);
    securities.forEach((row) => { if (row['charge_type'] !== '2nd') delete row['charge_amount']; });
    if (securities.length) payload['additional_securities'] = securities;
    if (payload['drawdowns_required'] === 'true' && drawdowns.length) payload['drawdowns'] = drawdowns;
    this.api.create(payload)
      .pipe(
        catchError((e: unknown) => {
          this.saving.set(false);
          const err = e as { error?: { message?: string; errors?: Record<string, string> } };
          if (err?.error?.errors) this.applyServerErrors(err.error.errors);
          this.toastr.error(this.serverErrorSummary() || err?.error?.message || 'Could not create the enquiry.', 'Create failed');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        if (res === null) return;
        this.saving.set(false);
        this.toastr.success(`Enquiry ${res.enquiry_ref} created.`, 'Created');
        this.created.emit();
      });
  }
}
