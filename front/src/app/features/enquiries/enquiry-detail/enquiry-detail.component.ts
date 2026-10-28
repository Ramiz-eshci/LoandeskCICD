import { UiFileUploadComponent } from '../../../shared/ui/ui-file-upload/ui-file-upload.component';
import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SafeResourceUrl } from '@angular/platform-browser';
import { catchError, of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';

import { PermissionsStore } from '../../../core/session/permissions.store';
import { FieldErrs, applicantRules, email, errsText, mobile, money, num, personName, regNo, req, securityRules } from '../../../core/util/enquiry-rules';
import { UiModalComponent } from '../../../shared/ui/ui-modal/ui-modal.component';
import { UiTimelineComponent, TimelineEntry } from '../../../shared/ui/ui-timeline/ui-timeline.component';
import { EnquiriesService } from '../enquiries.service';
import { CreditNotes, DEAL_TYPES, Enquiry, EnquiryAuditRow, EnquiryDocument, EnquiryFormOptions, IndicativeCalc, IndicativeVersion, IndSecurity, OfferVersion, statusTone } from '../enquiries-list/enquiry.model';
import { formatDate, formatDateTime } from '../../../core/util/date.util';
import { auditAction, auditSummary } from '../../../core/util/audit.util';
import { isGoogleMapsLink } from '../../../core/util/map-link.util';
import { MapPreviewService } from '../../../core/util/map-preview.service';
import { NumInputDirective } from '../../../shared/ui/num-input.directive';

interface EnquiryEdit {
  amount_requested: number | string | null;
  term_months: number | string | null;
  product_id: number | null;
  loan_purpose_id: number | null;
  branch_id: number | null;
  property_address: string | null;
  estimated_value: number | string | null;
  postcode: string | null;
  property_type: string | null;
  tenure: string | null;
  tenure_years: number | string | null;
  charge_type: string | null;
  gdv: number | string | null;
  owns_property: string | number | boolean | null;
  purchase_price: number | string | null;
  purchase_date: string | null;
  outstanding_loan: number | string | null;
  charge_amount?: number | string | null;
  repaid_on_completion: string | number | boolean | null;
  lender: string | null;
  added_value: string | null;
  interest_type?: string | null;
  deal_type?: string | null;
  additional_securities?: Record<string, unknown>[];
  applicants?: Record<string, unknown>[];
  drawdowns_required?: string | null;
  drawdowns?: { month: number | string | null; amount: number | string | null }[];
  map_link?: string | null;
  summary: string | null;
  applicant_name: string | null;
  company_name: string | null;
  applicant_type_id: number | null;
  email: string | null;
  phone: string | null;
  dob: string | null;
  company_reg_no: string | null;
  application_source_id: number | null;
  lead_source: string | null;
  lead_source_id: number | null;
  broker_id: number | null;
  broker_name: string | null;
  requested_completion_date: string | null;
  // Step 3 additions (client 15-10-2026)
  rep_type?: string | null;
  borrower_solicitor_id?: number | null;
  borrower_sol_firm?: string | null;
  borrower_sol_contact?: string | null;
  borrower_sol_address?: string | null;
  borrower_sol_telephone?: string | null;
  borrower_sol_email?: string | null;
  deal_appraisal?: string | null;
  exit_strategy?: string | null;
  // Application form section 2 (client 15-10-2026)
  total_project_cost?: number | string | null;
  own_contribution?: number | string | null;
  deposit_source?: string | null;
  additional_borrowing?: string | number | boolean | null;
  risk_mitigants?: string | null;
  credit_recommendation?: string | null;
}

/** Enquiry detail / edit — summary, assignment, notes timeline, status + convert-to-application. */

/** One drawdown row in the Send Indicatives popup: NET is typed, gross is calculated. */
type IndDrawdown = { month: number | null; amount: number | null; net: number | null };

@Component({
  selector: 'app-enquiry-detail',
  standalone: true,
  imports: [
    UiFileUploadComponent,
    FormsModule, DecimalPipe, NgTemplateOutlet, UiModalComponent,
    UiTimelineComponent, NumInputDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './enquiry-detail.component.html',
  styleUrl: './enquiry-detail.component.scss',
})
export class EnquiryDetailComponent implements OnInit {
  private readonly api = inject(EnquiriesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly perms = inject(PermissionsStore);
  private readonly toastr = inject(ToastrService);
  private readonly destroyRef = inject(DestroyRef);
  readonly maps = inject(MapPreviewService);

  readonly id = signal<number>(0);
  readonly enquiry = signal<Enquiry | null>(null);
  readonly dealTypes = DEAL_TYPES;
  readonly opts = signal<EnquiryFormOptions | null>(null);
  readonly error = signal<string | null>(null);
  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly savingSec = signal(false);

  readonly activeTab = signal('overview');
  readonly tabs = [
    { id: 'overview', label: 'Summary' },
    { id: 'prospect', label: 'Applicant Details' },
    { id: 'loan_request', label: 'Loan Request' },
    { id: 'security', label: 'Security & Property' },
    { id: 'broker', label: 'Source & Broker' },
    { id: 'documents', label: 'Documents' },
    { id: 'initial_offer', label: 'Initial Offer' },
    { id: 'communications', label: 'Communications' },
    { id: 'audit', label: 'Audit' },
  ];

  readonly assignOpen = signal(false);
  readonly statusOpen = signal(false);
  readonly convertOpen = signal(false);
  readonly requestInfoOpen = signal(false);
  readonly sendOfferOpen = signal(false);
  readonly sendingOffer = signal(false);
  // Accepting an offer now asks WHICH version was accepted, the same way sending
  // one asks which indicative to base it on.
  readonly acceptOpen = signal(false);
  readonly accepting = signal(false);
  readonly chosenAcceptOfferId = signal<number | null>(null);
  readonly uploadingDoc = signal(false);
  readonly docModalOpen = signal(false);
  readonly docEditOpen = signal(false);
  readonly savingDoc = signal(false);
  readonly converting = signal(false);
  readonly addingNote = signal(false);
  readonly missing = signal<{ field: string; label: string }[]>([]);
  // Decline popup (reasons from the Decline Reason master + notes) and bring-back-alive.
  readonly declineOpen = signal(false);
  readonly declining = signal(false);
  readonly deleteOpen = signal(false);
  readonly deleting = signal(false);
  readonly reopenOpen = signal(false);
  readonly reopening = signal(false);
  declineSel: number[] = [];
  declineNotes = '';
  reopenNote = '';

  assignTo: number | null = null;
  assignNote = '';
  statusCode = '';
  statusReason = '';
  newNote = '';
  reqSendTo = 'Broker';
  reqItems = { bank: false, address: false, income: false, accounts: false, assets: false, creditFile: false };
  reqComments = '';
  reqDueDate = '';
  /** Today as yyyy-mm-dd (local) — used as the min for Request Info due dates. */
  get todayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
  }
  offerAmount: number | string | null = null;
  offerRate: number | string | null = null;
  offerValidUntil = '';
  offerComments = '';

  // --- Indicatives + Offer v2 (versioned + emailed) ---
  readonly indOpen = signal(false);
  readonly offerOpen = signal(false);
  readonly acting2 = signal(false);
  readonly indCalc = signal<IndicativeCalc | null>(null);
  readonly indWarnings = signal<string[]>([]);
  readonly indicatives = signal<IndicativeVersion[]>([]);
  readonly offers = signal<OfferVersion[]>([]);
  /**
   * ONE merged indicative + offer history. Client 02-10-2026: DESCENDING so the
   * NEWEST action is on top (was ascending, client 01-10-2026). Sort key = sent_at
   * when sent, else created_at; same-timestamp ties break by version number desc.
   */
  readonly ohHistory = computed(() => {
    const key = (r: { sent_at?: string | null; created_at?: string | null }): number => {
      const t = r && (r.sent_at || r.created_at);
      const n = t ? new Date(t as string).getTime() : 0;
      return Number.isFinite(n) ? n : 0;
    };
    const items: { kind: 'ind' | 'offer'; ts: number; ver: number; ind?: IndicativeVersion; offer?: OfferVersion }[] = [];
    for (const iv of this.indicatives()) items.push({ kind: 'ind', ts: key(iv), ver: iv.version_no ?? 0, ind: iv });
    for (const ov of this.offers()) items.push({ kind: 'offer', ts: key(ov), ver: ov.version_no ?? 0, offer: ov });
    items.sort((a, b) => (b.ts - a.ts) || (b.ver - a.ver));
    return items;
  });

  /**
   * INITIAL OFFER header values. Client 02-10-2026: when the enquiry-level offer fields
   * are blank (the official offer flow stores the figures on the offer VERSION, not the
   * enquiry), fall back to the accepted offer version, else the latest sent, else the
   * latest. So an accepted offer shows its amount / rate / valid-until, not dashes.
   */
  readonly initialOffer = computed(() => {
    const e = this.enquiry();
    const offs = this.offers();
    const ov = offs.find((o) => o.status === 'Accepted')
      || [...offs].reverse().find((o) => !!o.sent_at || o.status === 'Sent')
      || (offs.length ? offs[offs.length - 1] : null);
    const oj = (ov && ov.offer) || {};
    const num = (x: unknown): number | null => { const v = Number(x); return Number.isFinite(v) ? v : null; };
    return {
      amount: (e && e.offer_amount != null) ? e.offer_amount : num((oj as Record<string, unknown>)['gross_loan_amount']),
      rate: (e && e.offer_rate != null) ? e.offer_rate : num((oj as Record<string, unknown>)['monthly_rate_pct']),
      validUntil: (e && e.offer_valid_until) || (ov && ov.valid_until) || null,
      issued: (e && e.offer_sent_at) || (ov && (ov.sent_at || ov.created_at)) || null,
      notes: (e && e.offer_notes) || null,
    };
  });
  readonly auditRows = signal<EnquiryAuditRow[]>([]);
  readonly auditLoading = signal(false);
  indInputs: Record<string, unknown> = {
    // Confirmed indicative model (see Loan_Indicative_Screenshot_Matched.xlsx):
    // base = Max LTV - 1st charge; fees on base; retained = base x rate x term;
    // drawdowns accrue retained interest for their remaining months.
    property_value: null, gdv: null, ltv_pct: null, first_charge: null,
    gross_loan: null, monthly_rate_pct: null, term_months: null,
    arrangement_fee_pct: null, arrangement_fee_is_pct: true,
    broker_fee: null, broker_fee_is_pct: true, document_fee: null,
    interest_type: 'Retained',
    calc_type: 'dds', annual_rate_pct: null,
    drawdowns: [] as { month: number | null; amount: number | null }[],
  };
  offerModel: Record<string, unknown> = {};
  /** Which indicative version the official offer is built from (client point #5). */
  readonly chosenIndicativeId = signal<number | null>(null);
  pickedFile: File | null = null;
  pickedFileName = '';
  pickedBase64 = '';
  newDocTypeId: number | 'other' | null = null;
  newDocTypeOther = '';
  editDocId: number | null = null;
  editDocTypeId: number | null = null;
  editDocFile: File | null = null;
  editDocFileName = '';
  editDocBase64 = '';
  editModel: EnquiryEdit = {
    amount_requested: null, term_months: null, product_id: null, loan_purpose_id: null,
    branch_id: null, property_address: null, estimated_value: null, summary: null,
    postcode: null, property_type: null, tenure: null, tenure_years: null, charge_type: null,
    gdv: null, owns_property: null, purchase_price: null, purchase_date: null,
    outstanding_loan: null, charge_amount: null, repaid_on_completion: null, lender: null, added_value: null,
    applicant_name: null, company_name: null, applicant_type_id: null, email: null,
    phone: null, dob: null, company_reg_no: null, application_source_id: null,
    lead_source: null, lead_source_id: null, broker_id: null, broker_name: null, requested_completion_date: null,
    applicants: [],
  };

  /**
   * Enquiry permission modules (see migrations/seeders/20260101000009_enquiry_perms_v2).
   * Request Info, Offer/Indicatives and Documents Upload are their OWN modules in the
   * Roles screen - gating them on ENQUIRY_LIST.edit showed every button to any role
   * that could merely edit an enquiry, which is what a role like "Sales Officer" has.
   */
  private readonly MK = {
    list: 'ENQUIRIES.ENQUIRY_LIST',
    reqInfo: 'ENQUIRIES.REQUEST_INFO',
    offer: 'ENQUIRIES.OFFER',
    docs: 'ENQUIRIES.DOCUMENTS_UPLOAD',
    submit: 'ENQUIRIES.SUBMIT_TO_APPLICATION',
  };
  /** True when the role holds ANY of these actions on the module (or perms are not loaded / super admin). */
  private any(moduleKey: string, ...actions: string[]): boolean {
    if (!this.perms.loaded() || this.perms.isSuperAdmin()) return true;
    return actions.some((a) => this.perms.can(moduleKey, a));
  }
  private mod(a: string): boolean { return this.any(this.MK.list, a); }
  readonly canEdit = computed(() => this.mod('edit'));
  /** Today as YYYY-MM-DD - `max` for the DOB / requested-completion pickers. */
  readonly today = new Date().toLocaleDateString('en-CA');
  readonly canAssign = computed(() => this.mod('add'));
  /** Convert to Application = Submit to Application > ADD (Enquiries List Add = New Enquiry only). */
  readonly canConvert = computed(() => this.any(this.MK.submit, 'add'));
  /** "View APP-…" after conversion needs Applications > Application List > VIEW. */
  readonly canViewApp = computed(() => this.any('APPLICATIONS.APPLICATION_LIST', 'view'));
  readonly canReject = computed(() => this.mod('reject'));
  readonly canDelete = computed(() => this.mod('delete'));
  /** Request Info tool - ENQUIRIES.REQUEST_INFO. */
  readonly canReqInfo = computed(() => this.any(this.MK.reqInfo, 'add', 'edit'));
  /** Indicatives and offers both live under the ENQUIRIES.OFFER module. */
  readonly canOffer = computed(() => this.any(this.MK.offer, 'add', 'edit'));
  /** Mark Accepted = Offer > ACCEPT in the Roles matrix. */
  readonly canAcceptOffer = computed(() => this.any(this.MK.offer, 'add'));
  /** Upload / edit / delete enquiry documents - ENQUIRIES.DOCUMENTS_UPLOAD. */
  readonly canDocs = computed(() => this.any(this.MK.docs, 'add', 'edit'));
  readonly canDocDelete = computed(() => this.any(this.MK.docs, 'delete'));

  readonly timeline = computed<TimelineEntry[]>(() =>
    (this.enquiry()?.notes || []).map((n) => ({
      title: n.note,
      meta: `${n.created_by_name || 'System'} · ${this.dt(n.created_at)}`,
    })),
  );
  readonly assignmentTimeline = computed<TimelineEntry[]>(() =>
    (this.enquiry()?.assignments || []).map((a) => ({
      title: `${a.previous_assigned_to_name ? a.previous_assigned_to_name + ' → ' : ''}${a.assigned_to_name || '—'}`,
      meta: `by ${a.assigned_by_name || 'System'} · ${this.dt(a.assigned_at)}`,
      detail: a.note || undefined,
    })),
  );

  /**
   * Assignee (BDM) dropdown options. Several distinct user accounts can share a
   * display name (e.g. two separate "nimit" users), so a plain name list looks
   * like it is repeating the same person. When a name is not unique we append the
   * account email to tell the accounts apart; unique names are shown plainly.
   */
  readonly assigneeOptions = computed<{ id: number; label: string }[]>(() => {
    const list = this.opts()?.assignees || [];
    const counts = new Map<string, number>();
    for (const a of list) {
      const key = (a.name || '').trim().toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return list.map((a) => {
      const key = (a.name || '').trim().toLowerCase();
      const dup = (counts.get(key) || 0) > 1;
      const label = dup && a.email ? `${a.name} (${a.email})` : a.name;
      return { id: a.id, label };
    });
  });

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((pm) => {
      this.id.set(Number(pm.get('id')));
      this.load();
    });
    this.api.formOptions().pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe((o) => this.opts.set(o));
  }

  private load(): void {
    this.api.get(this.id())
      .pipe(catchError(() => { this.error.set('Could not load this enquiry.'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((e) => {
        if (!e) return;
        this.enquiry.set(e);
        this.error.set(null);
        this.loadOfferHistory();
        // Every action here ends in load(), so refreshing the trail from this one
        // place covers status changes, notes, assignment, indicatives and offers
        // without each caller having to remember. Only refetch once the tab has
        // been opened at least once - otherwise every action costs a wasted call.
        if (this.activeTab() === 'audit' || this.auditRows().length) this.loadAudit();
      });
  }

  toggleEdit(): void {
    const e = this.enquiry();
    if (!this.editing() && e) {
      this.editModel = {
        amount_requested: e.amount_requested, term_months: e.term_months, product_id: e.product_id,
        loan_purpose_id: e.loan_purpose_id, branch_id: e.branch_id, property_address: e.property_address,
        estimated_value: e.estimated_value, summary: e.summary,
        postcode: e.postcode ?? null, property_type: e.property_type ?? null, tenure: e.tenure ?? null,
        tenure_years: e.tenure_years ?? null, charge_type: e.charge_type ?? null, gdv: e.gdv ?? null,
        owns_property: e.owns_property == null ? null : (e.owns_property ? 'true' : 'false'),
        purchase_price: e.purchase_price ?? null,
        purchase_date: e.purchase_date ? String(e.purchase_date).slice(0, 10) : null,
        outstanding_loan: e.outstanding_loan ?? null,
        charge_amount: (e as { charge_amount?: number | null }).charge_amount ?? null,
        repaid_on_completion: e.repaid_on_completion == null ? null : (e.repaid_on_completion ? 'true' : 'false'),
        lender: e.lender ?? null, added_value: e.added_value ?? null,
        interest_type: (e as { interest_type?: string })?.interest_type ?? 'Retained',
        deal_type: e.deal_type ?? null,
        drawdowns_required: e.drawdowns_required == null ? null : (e.drawdowns_required ? 'true' : 'false'),
        drawdowns: (e.drawdowns || []).map((d) => ({ month: d.month ?? null, amount: d.amount ?? null })),
        map_link: e.map_link ?? null,
        additional_securities: ((e as { additional_securities?: unknown[] })?.additional_securities || []).map((x) => ({ ...(x as object) })),
        applicant_name: e.applicant_name, company_name: e.company_name, applicant_type_id: e.applicant_type_id,
        email: e.email, phone: e.phone, dob: e.dob ? String(e.dob).slice(0, 10) : null, company_reg_no: e.company_reg_no ?? null,
        application_source_id: e.application_source_id, lead_source: e.lead_source ?? null, lead_source_id: e.lead_source_id ?? null,
        broker_id: e.broker_id, broker_name: e.broker_name_text ?? null,
        requested_completion_date: e.requested_completion_date ? String(e.requested_completion_date).slice(0, 10) : null,
        rep_type: e.rep_type ?? null,
        borrower_solicitor_id: e.borrower_solicitor_id ?? null,
        borrower_sol_firm: e.borrower_sol_firm ?? null, borrower_sol_contact: e.borrower_sol_contact ?? null,
        borrower_sol_address: e.borrower_sol_address ?? null, borrower_sol_telephone: e.borrower_sol_telephone ?? null,
        borrower_sol_email: e.borrower_sol_email ?? null,
        deal_appraisal: e.deal_appraisal ?? null, exit_strategy: e.exit_strategy ?? null,
        total_project_cost: e.total_project_cost ?? null, own_contribution: e.own_contribution ?? null,
        deposit_source: e.deposit_source ?? null,
        additional_borrowing: e.additional_borrowing == null ? null : (e.additional_borrowing ? 'true' : 'false'),
        risk_mitigants: e.risk_mitigants ?? null, credit_recommendation: e.credit_recommendation ?? null,
        applicants: (((e as { applicants?: Record<string, unknown>[] }).applicants) || []).map((a) => ({
          enquiry_applicant_id: a['enquiry_applicant_id'] ?? null,
          is_primary: a['is_primary'] ? 1 : 0,
          full_name: a['full_name'] ?? '',
          dob: a['dob'] ? String(a['dob']).slice(0, 10) : '',
          nationality: a['nationality'] ?? '',
          address: a['address'] ?? '',
          time_at_address: a['time_at_address'] ?? '',
          email: a['email'] ?? '',
          mobile: a['mobile'] ?? '',
          owns_home: a['owns_home'] == null ? '' : (a['owns_home'] ? 'true' : 'false'),
          occupation: a['occupation'] ?? '',
          employer_name: a['employer_name'] ?? '',
          business_address: a['business_address'] ?? '',
          length_of_service: a['length_of_service'] ?? '',
          relationship: a['relationship'] ?? '',
          shareholding_pct: a['shareholding_pct'] ?? '',
          prev_bridging: a['prev_bridging'] == null ? '' : (a['prev_bridging'] ? 'true' : 'false'),
          prev_bridging_lender: a['prev_bridging_lender'] ?? '',
        })),
      };
      // Client 05-10-2026 (#3): the detail page now edits the full applicant field
      // set for Individuals too (not only Company directors). Seed one blank row so
      // an enquiry that has no applicant captured yet still has somewhere to type.
      if (!this.editModel.applicants || !this.editModel.applicants.length) {
        this.editModel.applicants = [];
        this.addDetailApplicant();
        (this.editModel.applicants[0] as Record<string, unknown>)['is_primary'] = 1;
      }
    }
    this.editing.update((v) => !v);
  }

  /** Loan Request tab — drawdown rows while editing. */
  addEditDrawdown(): void {
    const rows = this.editModel.drawdowns || [];
    this.editModel.drawdowns = [...rows, { month: rows.length + 1, amount: null }];
  }
  removeEditDrawdown(i: number): void {
    this.editModel.drawdowns = (this.editModel.drawdowns || []).filter((_, x) => x !== i);
  }
  onEditDrawdownsRequired(): void {
    if (this.editModel.drawdowns_required === 'true' && !(this.editModel.drawdowns || []).length) this.addEditDrawdown();
  }
  drawdownsTotal(list: { amount: number | string | null }[] | null | undefined): number {
    return (list || []).reduce((t, d) => t + (Number(d.amount) || 0), 0);
  }

  /** Security tab — map from the saved Google Maps link. */
  // Map from the link OR the address / postcode (client 29-09-2026).
  readonly mapUrl = computed<SafeResourceUrl | null>(() => {
    const e = this.enquiry();
    return e ? this.maps.embed(e.map_link, e.property_address, e.postcode) : null;
  });
  readonly mapOpenUrl = computed(() => {
    const e = this.enquiry();
    return e ? this.maps.openUrl(e.map_link, e.property_address, e.postcode) : null;
  });

  /**
   * Edit-mode map preview. Refreshed when the user leaves the address / link /
   * postcode box (blur), so the iframe does not reload on every keystroke.
   */
  private readonly mapSnapTick = signal(0);
  private readonly mapSnaps = new WeakMap<object, { l: string; a: string; p: string }>();
  snapMap(src: Record<string, unknown>, addressKey = 'property_address'): void {
    this.mapSnaps.set(src, { l: String(src['map_link'] ?? ''), a: String(src[addressKey] ?? ''), p: String(src['postcode'] ?? '') });
    this.mapSnapTick.update((n) => n + 1);
  }
  editMapUrl(src: Record<string, unknown>, addressKey = 'property_address'): SafeResourceUrl | null {
    this.mapSnapTick();
    let snap = this.mapSnaps.get(src);
    if (!snap) { snap = { l: String(src['map_link'] ?? ''), a: String(src[addressKey] ?? ''), p: String(src['postcode'] ?? '') }; this.mapSnaps.set(src, snap); }
    return this.maps.embed(snap.l, snap.a, snap.p);
  }
  editMapLinkInvalid(): boolean {
    const v = String(this.editModel.map_link || '').trim();
    return !!v && !isGoogleMapsLink(v);
  }

  /** Indicative / offer recipient: the broker (from the Brokers master) when it has an email, else the borrower. */
  readonly sendTo = computed(() => {
    const e = this.enquiry();
    if (!e) return { email: null as string | null, label: '' };
    if (e.broker_id && e.broker_email) return { email: e.broker_email, label: `the broker (${e.broker_email})` };
    // Fall back to the primary applicant / director's email when the enquiry has none of
    // its own — e.g. a company enquiry whose contact email sits on the director
    // (client 02-10-2026).
    const list = Array.isArray(e.applicants) ? e.applicants : [];
    const primary = list.find((a) => a && (a.is_primary === 1 || a.is_primary === true)) || list[0];
    const email = e.email || (primary && primary.email) || null;
    return { email, label: `the applicant (${email || 'no email on file'})` };
  });

  /** Fields belonging to each editable tab — save/validation is scoped to the active tab only. */
  private readonly tabFields: Record<string, string[]> = {
    overview: ['application_source_id', 'lead_source_id', 'branch_id', 'product_id', 'loan_purpose_id', 'requested_completion_date', 'summary'],
    prospect: ['applicant_type_id', 'applicant_name', 'company_name', 'email', 'phone', 'dob', 'company_reg_no', 'applicants'],
    loan_request: ['product_id', 'loan_purpose_id', 'amount_requested', 'term_months', 'interest_type', 'deal_type', 'requested_completion_date', 'drawdowns_required', 'drawdowns', 'summary',
      'rep_type', 'borrower_solicitor_id',
      'deal_appraisal', 'exit_strategy', 'risk_mitigants', 'credit_recommendation',
      'total_project_cost', 'own_contribution', 'deposit_source', 'additional_borrowing'],
    security: ['property_address', 'postcode', 'property_type', 'tenure', 'tenure_years', 'charge_type', 'charge_amount', 'estimated_value', 'gdv', 'purchase_price', 'purchase_date', 'outstanding_loan', 'repaid_on_completion', 'lender', 'added_value', 'map_link'],
    broker: ['application_source_id', 'lead_source_id', 'broker_id'],
  };

  /**
   * Client 20-10-2026: edit uses the SAME required fields / limits as the New Enquiry
   * drawer, scoped to the tab being saved. Returns field -> message (empty = OK).
   */
  private validateTab(tab: string): FieldErrs {
    const m = this.editModel as unknown as Record<string, unknown>;
    const errs: FieldErrs = {};
    if (tab === 'overview') {
      req(errs, 'branch_id', m['branch_id'], 'Branch');
      req(errs, 'product_id', m['product_id'], 'Product');
      req(errs, 'loan_purpose_id', m['loan_purpose_id'], 'Loan purpose');
    }
    if (tab === 'prospect') {
      req(errs, 'applicant_type_id', m['applicant_type_id'], 'Applicant type');
      if (this.showFullName(this.editTypeName())) {
        personName(errs, 'applicant_name', m['applicant_name'], 'Applicant name');
        email(errs, 'email', m['email']);
        mobile(errs, 'phone', m['phone'], 'Phone');
      }
      regNo(errs, 'company_reg_no', m['company_reg_no']);
      this.detailApplicants.forEach((a, i) => applicantRules(errs, a, `applicants.${i}.`, `Applicant ${i + 1}: `));
    }
    if (tab === 'loan_request') {
      req(errs, 'product_id', m['product_id'], 'Product');
      req(errs, 'loan_purpose_id', m['loan_purpose_id'], 'Loan purpose');
      money(errs, 'amount_requested', m['amount_requested'], 'Loan amount', true, 1);
      num(errs, 'term_months', m['term_months'], 'Term (months)', 1, 600, true);
      money(errs, 'total_project_cost', m['total_project_cost'], 'Total project cost');
      money(errs, 'own_contribution', m['own_contribution'], 'Own contribution');
      if (m['drawdowns_required'] === 'true') {
        ((m['drawdowns'] as Record<string, unknown>[]) || []).forEach((d, i) => {
          if (d['amount'] === null || d['amount'] === '' || d['amount'] === undefined) return;
          money(errs, `drawdowns.${i}.amount`, d['amount'], `Drawdown ${i + 1} amount`, false, 1);
          num(errs, `drawdowns.${i}.month`, d['month'], `Drawdown ${i + 1} month`, 1, 600);
        });
      }
    }
    if (tab === 'security') securityRules(errs, m);
    return errs;
  }

  saveEdit(): void {
    // Same required fields / limits as the add form (client 20-10-2026).
    const errs = this.validateTab(this.activeTab());
    if (Object.keys(errs).length) {
      this.toastr.error(errsText(errs), 'Save failed');
      return;
    }
    this.saving.set(true);
    // Client 05-10-2026 (#3): for an Individual the identity lives in the Prospect
    // card (Applicant Name / Email / Phone / DOB); the Applicant Details card shows
    // only the extra fields, so mirror the prospect identity onto the primary
    // applicant row to keep the stored applicant consistent (no duplicate inputs).
    if (this.activeTab() === 'prospect' && !this.showCompanyName(this.editTypeName())) {
      const apps = this.detailApplicants;
      if (apps.length) {
        apps[0]['full_name'] = this.editModel.applicant_name ?? apps[0]['full_name'] ?? '';
        apps[0]['email'] = this.editModel.email ?? apps[0]['email'] ?? '';
        apps[0]['mobile'] = this.editModel.phone ?? apps[0]['mobile'] ?? '';
        apps[0]['dob'] = this.editModel.dob ?? apps[0]['dob'] ?? '';
        apps[0]['is_primary'] = 1;
      }
    }
    const allow = this.tabFields[this.activeTab()] || Object.keys(this.editModel);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.editModel)) {
      if (!allow.includes(k)) continue;                 // only the current tab's fields
      if (k === 'additional_securities') { body[k] = Array.isArray(v) ? v : []; continue; }
      if (k === 'applicants') {
        let rows = (Array.isArray(v) ? v : []).filter((a) => Object.entries(a as Record<string, unknown>)
          .some(([kk, vv]) => kk !== 'is_primary' && kk !== 'sort_order' && kk !== 'enquiry_applicant_id' && vv !== '' && vv != null));
        // Client 05-10-2026 (#3): an Individual keeps exactly ONE applicant. Switching
        // Company -> Individual must drop the extra directors on save, not keep them.
        if (!this.showCompanyName(this.editTypeName())) {
          const prim = rows.find((a) => (a as Record<string, unknown>)['is_primary']) || rows[0];
          rows = prim ? [prim] : [];
        }
        if (rows.length && !rows.some((a) => (a as Record<string, unknown>)['is_primary'])) (rows[0] as Record<string, unknown>)['is_primary'] = 1;
        body[k] = rows;
        continue;
      }
      if (k === 'drawdowns') {
        // "No" clears them; otherwise send the filled rows (server re-validates).
        const rows = Array.isArray(v) ? (v as { month: unknown; amount: unknown }[]) : [];
        body[k] = this.editModel.drawdowns_required === 'true'
          ? rows.filter((r) => r.amount !== null && r.amount !== '' && r.amount !== undefined)
          : [];
        continue;
      }
      // Clearing the map link must reach the server (an empty value is otherwise skipped).
      if (k === 'map_link') { body[k] = v ?? ''; continue; }
      // A cleared Charge (and its amount) must reach the server too — otherwise the old
      // value is kept and "—" never removes it (client 07-10-2026). Same as the map link.
      if (k === 'charge_type' || k === 'charge_amount') { body[k] = v ?? null; continue; }
      // Borrower's solicitor: only sent when the pick changed, so an older enquiry's typed
      // solicitor details survive a save that did not touch the dropdown (client 15-10-2026).
      if (k === 'borrower_solicitor_id') { if ((v ?? null) !== (this.enquiry()?.borrower_solicitor_id ?? null)) body[k] = v ?? null; continue; }
      if (v !== null && v !== undefined && v !== '') body[k] = v;
    }
    this.api.update(this.id(), body)
      .pipe(catchError((e: unknown) => { this.saving.set(false); this.toastr.error(this.msg(e, 'Could not save.'), 'Save failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r === null) return; this.saving.set(false); this.editing.set(false); this.toastr.success('Enquiry updated.', 'Saved'); this.load(); });
  }

  /**
   * Additional / other securities have their OWN save, separate from the
   * SECURITY & PROPERTY card. Sends only the securities list so the two cards
   * never overwrite each other.
   */
  saveSecurities(): void {
    const rows = this.detailSecurities.filter(
      (row) => Object.values(row).some((v) => v !== '' && v !== null && v !== undefined),
    );
    // Same required fields / limits as step 5 of the add form (client 20-10-2026):
    // address, 1st / 2nd charge and property value on every security.
    const errs: FieldErrs = {};
    rows.forEach((row, i) => securityRules(errs, row, `sec.${i}.`, `Security ${i + 1}: `, 'address'));
    if (Object.keys(errs).length) {
      this.toastr.error(errsText(errs), 'Save failed');
      return;
    }
    this.savingSec.set(true);
    this.api.update(this.id(), { additional_securities: rows })
      .pipe(catchError((e: unknown) => { this.savingSec.set(false); this.toastr.error(this.msg(e, 'Could not save securities.'), 'Save failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r === null) return; this.savingSec.set(false); this.editing.set(false); this.toastr.success('Securities updated.', 'Saved'); this.load(); });
  }

  openAssign(): void { this.assignTo = this.enquiry()?.assigned_to ?? null; this.assignNote = ''; this.assignOpen.set(true); }
  doAssign(): void {
    if (!this.assignTo) return;
    this.api.assign(this.id(), this.assignTo, this.assignNote || undefined)
      .pipe(catchError((e: unknown) => { this.toastr.error(this.msg(e, 'Could not assign.'), 'Assign failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r === null) return; this.assignOpen.set(false); this.toastr.success('Enquiry assigned.', 'Assigned'); this.load(); });
  }

  doStatus(): void {
    if (!this.statusCode) return;
    this.api.changeStatus(this.id(), this.statusCode, this.statusReason || undefined)
      .pipe(catchError((e: unknown) => { this.toastr.error(this.msg(e, 'Status change not allowed.'), 'Status failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r === null) return; this.statusOpen.set(false); this.statusCode = ''; this.statusReason = ''; this.toastr.success('Status updated.', 'Updated'); this.load(); });
  }

  addNote(): void {
    if (!this.newNote.trim()) return;
    this.addingNote.set(true);
    this.api.addNote(this.id(), this.newNote.trim())
      .pipe(catchError((e: unknown) => { this.addingNote.set(false); this.toastr.error(this.msg(e, 'Could not add note.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r === null) return; this.addingNote.set(false); this.newNote = ''; this.load(); });
  }

  // Signed offer letter + application form + … (one or more files) - required to convert.
  // Signals, not plain fields: this component is OnPush, and FileReader finishes
  // outside a change-detection pass, so plain fields left the Convert button
  // stuck disabled after picking files (28-09-2026).
  readonly signedFiles = signal<{ name: string; base64: string }[]>([]);
  readonly signedReading = signal(0);
  onSignedPicked(files: File[]): void {
    this.signedFiles.set([]);
    this.signedReading.set(files.length);
    const out: { name: string; base64: string }[] = new Array(files.length);
    files.forEach((f, i) => {
      const reader = new FileReader();
      reader.onload = () => {
        out[i] = { name: f.name, base64: String(reader.result || '') };
        this.signedFiles.set(out.filter(Boolean));
        this.signedReading.update((n) => n - 1);
      };
      reader.onerror = () => { this.signedReading.update((n) => n - 1); };
      reader.readAsDataURL(f);
    });
  }
  signedReady(): boolean { return this.signedReading() === 0 && this.signedFiles().length > 0; }
  /** Narrative notes for the Credit Deal Summary e-mailed to Head of Application on convert. */
  summaryNotes = '';
  /** Optional credit-paper notes typed on the Convert popup (client 15-10-2026). */
  creditNotes: CreditNotes = { deal_appraisal: '', exit_strategy: '', risk_mitigants: '', credit_recommendation: '' };
  startConvert(): void {
    this.signedFiles.set([]); this.signedReading.set(0); this.summaryNotes = '';
    // Pre-fill with anything already saved on the enquiry (e.g. older enquiries).
    const en = this.enquiry();
    this.creditNotes = {
      deal_appraisal: en?.deal_appraisal || '', exit_strategy: en?.exit_strategy || '',
      risk_mitigants: en?.risk_mitigants || '', credit_recommendation: en?.credit_recommendation || '',
    };
    this.api.convertCheck(this.id())
      .pipe(catchError(() => of({ ready: false, missing: [{ field: '', label: 'Unable to validate.' }] })), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.missing.set(r.missing || []); this.convertOpen.set(true); });
  }
  doConvert(): void {
    if (!this.signedReady()) {
      this.toastr.warning('Upload the signed offer letter and application form first.', 'Upload required');
      return;
    }
    this.converting.set(true);
    const cn = this.creditNotes;
    this.api.convert(this.id(), this.signedFiles().map((d) => ({ file_name: d.name, content_base64: d.base64 })), this.summaryNotes.trim(), {
      deal_appraisal: cn.deal_appraisal.trim(), exit_strategy: cn.exit_strategy.trim(),
      risk_mitigants: cn.risk_mitigants.trim(), credit_recommendation: cn.credit_recommendation.trim(),
    })
      .pipe(catchError((e: unknown) => { this.converting.set(false); this.toastr.error(this.msg(e, 'Conversion failed.'), 'Convert failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.converting.set(false);
        if (r === null) return;
        this.convertOpen.set(false);
        // Show which figure was carried over, so a wrong gross is obvious here
        // rather than three screens later.
        const gross = r.grossAmount != null
          ? ` Gross £${Number(r.grossAmount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${r.grossSource ? ' from ' + r.grossSource : ''}.`
          : '';
        this.toastr.success(`Application ${r.applicationRef} created.${gross}`, 'Converted');
        this.load();
      });
  }

  // Button functionality mapped to status changes
  requestInfo(): void {
    this.requestInfoOpen.set(true);
  }

  readonly sendingRequest = signal(false);

  submitRequestInfo(): void {
    if (this.reqDueDate && this.reqDueDate < this.todayStr) { this.toastr.error('Due date cannot be in the past.'); return; }
    const items: string[] = [];
    if (this.reqItems.bank) items.push('Bank Statements');
    if (this.reqItems.address) items.push('Proof Of Address');
    if (this.reqItems.income) items.push('Evidence Of Income');
    if (this.reqItems.accounts) items.push('Company Accounts');
    if (this.reqItems.assets) items.push('Asset & Liability Statement');
    if (this.reqItems.creditFile) items.push('Credit File');

    // This now actually emails the chosen recipient. It used to only change the
    // status and add a note while telling the user the request had been sent.
    this.sendingRequest.set(true);
    this.api.requestInfo(this.id(), {
      send_to: this.reqSendTo,
      items,
      comments: this.reqComments.trim(),
      due_date: this.reqDueDate || '',
    })
      .pipe(
        catchError((e: unknown) => {
          this.sendingRequest.set(false);
          this.toastr.error(this.msg(e, 'Could not send the request.'), 'Failed');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => {
        this.sendingRequest.set(false);
        if (r === null) return;                  // stay open so the user can fix it
        this.requestInfoOpen.set(false);
        this.reqComments = ''; this.reqDueDate = '';
        this.reqItems = { bank: false, address: false, income: false, accounts: false, assets: false, creditFile: false };
        this.toastr.success(`Emailed ${r.recipient} at ${r.sent_to}`, 'Request Sent');
        this.load();
      });
  }

  openSendOffer(): void {
    const e = this.enquiry();
    this.offerAmount = e?.offer_amount ?? e?.amount_requested ?? null;
    this.offerRate = e?.offer_rate ?? null;
    this.offerValidUntil = e?.offer_valid_until ? String(e.offer_valid_until).slice(0, 10) : '';
    this.offerComments = e?.offer_notes ?? '';
    this.sendOfferOpen.set(true);
  }

  submitSendOffer(): void {
    this.sendingOffer.set(true);
    this.api.saveOffer(this.id(), {
      offer_amount: this.offerAmount, offer_rate: this.offerRate,
      offer_valid_until: this.offerValidUntil || null, offer_notes: this.offerComments || null, send: true,
    })
      .pipe(catchError((e: unknown) => { this.sendingOffer.set(false); this.toastr.error(this.msg(e, 'Could not send offer.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        if (r === null) return;
        this.sendingOffer.set(false);
        this.sendOfferOpen.set(false);
        this.toastr.success('Offer sent.', 'Offer Sent');
        this.load();
      });
  }

  // ---- Indicatives ----
  selectTab(id: string): void {
    this.activeTab.set(id);
    // Fetch on first open rather than with the enquiry — the trail can be long
    // and most visits never reach this tab.
    if (id === 'audit' && !this.auditLoading()) this.loadAudit();
  }

  /** Audit tab: pull the whole trail, newest first. */
  loadAudit(): void {
    this.auditLoading.set(true);
    this.api.audit(this.id())
      .pipe(catchError(() => of([])), takeUntilDestroyed(this.destroyRef))
      .subscribe((rows) => { this.auditLoading.set(false); this.auditRows.set(rows || []); });
  }

  /** dd-mm-yyyy HH:mm for the audit rows. */
  auditWhen(v: string): string { return formatDateTime(v); }

  auditAction = auditAction;
  auditSummary = auditSummary;

  openIndicative(): void {
    if (!this.canOffer()) { this.toastr.info('You do not have permission to send indicatives.', 'Not allowed'); return; }
    const e = this.enquiry();
    this.indInputs = {
      // Fresh defaults on every open — never carry over values typed but not sent.
      // The last SAVED/SENT version (merged below) is what refills on reopen.
      ltv_pct: null, monthly_rate_pct: null,
      arrangement_fee_pct: null, arrangement_fee_is_pct: true,
      broker_fee: null, broker_fee_is_pct: true, document_fee: null,
      value_model: null, security_value: null, charges_total: null,
      main_security_value: null, main_charges: null, additional_securities: [],
      // Both carried from step 4 of the enquiry form (Security & Property):
      // Current Value -> Property Value, and GDV -> GDV. GDV used to be seeded
      // from estimated_value, which quietly made them always identical.
      property_value: e?.estimated_value ?? null,
      gdv: e?.gdv ?? null,
      // Debt ahead of us on the main property: outstanding loan + 2nd-charge amount.
      first_charge: this.mainDebt(e),
      term_months: (e as { term_months?: number })?.term_months ?? null,
      // Default the interest type from what was chosen on the New Enquiry form.
      interest_type: (e as { interest_type?: string })?.interest_type || 'Retained',
      gross_loan: null,
      // LTV box: 'pct' = type LTV %, 'amount' = type the loan amount (£) itself.
      ltv_mode: 'pct',
      drawdowns: [],
      // No saved version yet: a Serviced enquiry opens on Serviced Monthly, anything else on
      // Retained with drawdowns. A saved version brings its own calculator back (below).
      calc_type: (e as { interest_type?: string })?.interest_type === 'Serviced' ? 'serviced' : 'dds', annual_rate_pct: null,
    };
    // Drawdowns captured on the enquiry (New Enquiry step 3) are the starting rows.
    const enqDd = (e?.drawdowns || []).filter((d) => d && d.amount);
    // The enquiry's drawdown amounts are what the borrower wants to receive, i.e. NET.
    // Client 20-10-2026: seed them into the NET column (gross back-solves) - they were put in
    // the Gross column, so every drawdown came out short by its retained interest.
    if (enqDd.length) this.indInputs['drawdowns'] = enqDd.map((d) => ({ month: d.month ?? null, amount: null, net: d.amount ?? null }));
    this.padDrawdowns();
    // Other / additional securities on the enquiry: all ticked by default (client point #5).
    const enqSecs = this.enquirySecurities();
    this.indInputs['additional_securities'] = enqSecs;
    // Revising: preload the LATEST version's inputs so the BDM just tweaks LTV /
    // term / securities and re-sends as a new version (client point #2).
    const last = this.indicatives()[0];
    // Notes carry over from the last version so a revision keeps them (editable).
    this.indNotes = (last && last.notes) || '';
    if (last && last.inputs) {
      const inp = last.inputs as Record<string, unknown>;
      this.indInputs = { ...this.indInputs, ...inp };
      if (Array.isArray(inp['drawdowns'])) {
        // Drawdowns are typed as GROSS (dd.amount); net is derived. On reopen keep the
        // saved gross as-is so the Gross column refills. (A previous legacy fixup here
        // converted gross->net and nulled dd.amount, which left the Gross input blank on
        // reopen — removed.)
        this.indInputs['drawdowns'] = (inp['drawdowns'] as Record<string, unknown>[]).map((d) => ({ month: d['month'] ?? null, amount: d['amount'] ?? null, net: d['net'] ?? null }));
      }
    }
    // Other securities always come from the enquiry, all included (client 28-09-2026):
    // they are no longer shown or ticked in this popup, so a revised version must not
    // carry an old untick or an old edited value.
    this.indInputs['additional_securities'] = enqSecs;
    // Client 05-10-2026 (#6): on a REVISION keep the last version's own property
    // value / GDV / security figures (merged above) so reopening shows exactly what
    // was last sent. Only seed property value / GDV from the enquiry on the FIRST
    // indicative, when there is no saved version to fall back on.
    if (!last || !last.inputs) {
      this.fillPropertyValue(e, enqSecs);
    }
    // Client 30-09-2026: LTV is NOT worked out here - it is carried from the enquiry
    // (the LTV captured when the enquiry was added / last saved), on every open, so it
    // always follows the enquiry. Editable in the popup for this version only.
    // First indicative: seed LTV from the enquiry. A saved/sent version instead keeps its
    // own last values (LTV / mode / gross) so reopening shows what was last sent (client 01-10-2026).
    if (!last || !last.inputs) {
      // The calculator's LTV % includes the charges ahead of us (2nd charge / net model),
      // so seed it with the enquiry's TOTAL LTV when there is one (client 15-10-2026: the
      // enquiry's ltv_pct is now OUR loan's LTV only).
      const enqLtv = (e as { total_ltv_pct?: number | null }).total_ltv_pct ?? (e as { ltv_pct?: number | null })?.ltv_pct;
      this.indInputs['ltv_mode'] = 'pct';
      this.indInputs['gross_loan'] = null;
      this.indInputs['ltv_pct'] = enqLtv != null && Number.isFinite(Number(enqLtv)) ? Number(enqLtv) : null;
    }
    // Client 20-10-2026: a NET enquiry's typed amount is the Net Amount (total net incl.
    // drawdowns) the borrower wants. The first indicative used to start from the enquiry LTV,
    // which was worked out on that NET figure as if it were gross - so the gross was too low and
    // the net came out wrong everywhere (indicative, offer, application, credit paper). Now the
    // gross back-solves from the typed net and keeps doing so as rate / term / fees are typed.
    this.indNetTarget = null;
    const typedNet = Number((e as { amount_requested?: unknown })?.amount_requested);
    if ((!last || !last.inputs) && e?.loan_basis === 'Net' && Number.isFinite(typedNet) && typedNet > 0) {
      this.indNetTarget = typedNet;
      this.indInputs['ltv_mode'] = 'amount';
      this.indInputs['gross_loan'] = this.grossFromNet(typedNet);
      this.pendingLtvSyncFromAmount = true;
    }
    // Saved 2nd-charge version reopened with a blank 1st Charge box: fill the total.
    if (this.indCalcType() === 'second_charge' && !(Number(this.indInputs['first_charge']) > 0)) {
      const total = this.indTotalCharges();
      if (total) this.indInputs['first_charge'] = total;
    }
    this.padDrawdowns();
    this.indCalc.set(null); this.indWarnings.set([]); this.indEditing = null; this.grossField = null; this.netField = null; this.day1NetField = null;
    this.recalcIndicative();
    this.indOpen.set(true);
  }
  /**
   * Property Value (client 30-09-2026) — same on all four calculators:
   *   Property Value = main security value + Σ other securities' values (merged, nothing deducted)
   * Auto-filled from the enquiry (editable); the LTV % is taken of it. Outstanding loans /
   * 2nd charges are still sent (charges_total) but no longer taken off the Property Value.
   */
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
    // Client 14-10-2026: the 1st Charge box (Retained with 2nd charge) = total charges
    // ahead of us across ALL securities, same as Property Value sums all their values.
    this.indInputs['first_charge'] = charges ? r2(charges) : null;
    this.indInputs['security_value'] = secValue ? r2(secValue) : null;
    this.indInputs['charges_total'] = r2(charges);
    this.indInputs['property_value'] = secValue ? r2(secValue) : null;
    const gdvSum = n(e?.gdv) + secs.reduce((a, x) => a + n(x.gdv), 0);
    this.indInputs['gdv'] = gdvSum ? r2(gdvSum) : null;
  }
  /** Outstanding loans + 2nd-charge amounts on the main property and all other securities. */
  indDebt(): number { return Number(this.indInputs['charges_total']) || 0; }
  /** Main + other securities' current values (before outstanding loans). */
  indTotalSecurity(): number | null {
    const v = Number(this.indInputs['security_value']) || 0;
    return v > 0 ? v : null;
  }
  /** Property Value the LTV % is taken of (auto-filled NET value, editable). */
  /** #6: GDV on the indicative = sum of main security + other securities (security_value). */
  indGdv(): number | null { const v = Number(this.indInputs['security_value']); return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null; }
  indPropertyValue(): number { return Number(this.indInputs['property_value']) || 0; }
  /** % mode: Max LTV £ = Property Value x LTV%. */
  indMaxLtv(): number | null {
    const pv = this.indPropertyValue();
    const ltv = Number(this.indInputs['ltv_pct']) || 0;
    if (pv <= 0 || ltv <= 0) return null;
    return Math.round(pv * (ltv / 100) * 100) / 100;
  }
  /** LTV box mode: 'pct' (type LTV %) or 'amount' (type the loan £, LTV is worked out). */
  indLtvMode(): 'pct' | 'amount' { return this.indInputs['ltv_mode'] === 'amount' ? 'amount' : 'pct'; }
  /** Client 09-10-2026: LTV is entered as % only. Typing it switches back to %-mode
   *  (clearing any typed gross/net amount) so the % takes effect. */
  onIndLtvChange(v: unknown): void {
    this.indNetTarget = null;
    this.indInputs['ltv_mode'] = 'pct';
    this.indInputs['gross_loan'] = null;
    this.indInputs['ltv_pct'] = (v === '' || v === null || v === undefined) ? null : Number(v);
    this.recalcIndicative();
  }
  /**
   * Switching % <-> £ keeps the SAME loan: % -> £ carries Property Value x LTV%,
   * £ -> % carries loan / Property Value. (Before, the 2nd-charge calculator took the
   * 1st charge off on the way to £, so the £ did not match the % typed.)
   */
  setLtvMode(m: 'pct' | 'amount'): void {
    if (m === this.indLtvMode()) return;
    this.indNetTarget = null;
    // Carry the figures the engine already computed for the CURRENT loan, so the loan is
    // unchanged across the toggle and the 1st charge is handled identically in both modes.
    // Bug (client 07-10-2026): % -> £ used to carry the Max LTV capacity (Property Value x
    // LTV%), which for the 2nd-charge calculator is BEFORE the 1st charge is taken off, so
    // the gross jumped up by the 1st charge; switching back to % re-applied the deduction.
    const c = this.indCalc();
    if (m === 'amount') {
      // % -> £: carry the actual gross loan (base gross, already net of any 1st charge).
      const v = (c && c.base_gross != null) ? c.base_gross : this.indMaxLtv();
      if (v !== null) this.indInputs['gross_loan'] = v;
    } else {
      // £ -> %: carry the implied LTV% the engine computed ((gross + 1st charge) /
      // property), so the % reproduces exactly the same gross.
      const p = (c && c.ltv_pct != null) ? c.ltv_pct : this.indLtvFromAmount();
      if (p !== null) this.indInputs['ltv_pct'] = p;
    }
    this.indInputs['ltv_mode'] = m;
    this.recalcIndicative();
  }
  /** £ mode: LTV % = loan / Property Value. */
  indLtvFromAmount(): number | null {
    const pv = this.indPropertyValue();
    const amt = Number(this.indInputs['gross_loan']) || 0;
    if (pv <= 0 || amt <= 0) return null;
    return Math.round((amt / pv) * 10000) / 100;
  }
  useMaxLtvAsGross(): void {
    const v = this.indMaxLtv();
    if (v === null) return;
    this.indNetTarget = null;
    this.indInputs['gross_loan'] = v;
    this.recalcIndicative();
  }

  // ── Linked loan boxes: Gross Loan Amount + Net Amount ───────────────────────
  // Client 06-10-2026: besides LTV, the BDM can type the Gross Loan or the Net
  // amount directly, and every figure recalculates exactly the way an LTV change
  // does. All three (LTV %, Gross, Net) are views of the one loan size: whichever
  // is typed drives the loan (ltv_mode = 'amount', gross_loan = base), the other
  // two back-solve. The boxes show the live computed figures after each recalc,
  // except the one being typed in (indEditing) so recalc never fights the caret.
  /** Which linked loan box is being edited right now ('gross' | 'net' | null). */
  indEditing: 'gross' | 'net' | 'day1net' | null = null;
  /** Net Amount (total net incl. drawdowns) the gross is back-solved to on every recalc while
   *  set: a Net enquiry's typed amount, or a figure typed in the Net box (client 20-10-2026).
   *  Cleared as soon as the BDM types the Gross, Day 1 Net or LTV instead. */
  indNetTarget: number | null = null;
  private indNetSolveRounds = 0;
  /** Notes typed on Send Indicatives — go in the e-mail to the broker (client 20-10-2026). */
  indNotes = '';
  /** Day 1 Net box on the Drawdowns table's Day 1 row (client 20-10-2026). */
  day1NetField: number | null = null;
  /** Set when the loan was typed via the Gross/Net boxes: after recalc, show the LTV as the
   *  back-solved % (client 09-10-2026) instead of flipping the LTV box to £ and mirroring the gross. */
  private pendingLtvSyncFromAmount = false;
  /** Live base gross / day-1 net shown in the two boxes (refreshed after recalc). */
  grossField: number | null = null;
  netField: number | null = null;

  indFocusLoan(f: 'gross' | 'net' | 'day1net'): void { this.indEditing = f; }
  indBlurLoan(): void { this.indEditing = null; this.syncLoanFields(); }

  /** Push the latest computed base gross / day-1 net into the boxes (not the typed one). */
  syncLoanFields(): void {
    const c = this.indCalc();
    if (this.indEditing !== 'gross') this.grossField = c ? (c.base_gross ?? null) : null;
    // Client 12-10-2026: the NET AMOUNT box shows the Total Net incl. Drawdowns (equals Day 1
    // Net when there are no drawdowns).
    if (this.indEditing !== 'net') this.netField = c ? ((c.total_net_incl_drawdowns != null ? c.total_net_incl_drawdowns : c.day1_net) ?? null) : null;

    if (this.indEditing !== 'day1net') this.day1NetField = c ? (c.day1_net ?? null) : null;
  }

  /** Day 1 Net typed (Drawdowns table, Day 1 row): back-solve the Day 1 Gross Loan from it. */
  onIndDay1NetChange(v: unknown): void {
    this.indNetTarget = null;
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

  /** Gross Loan typed: it IS the loan, LTV back-solves — same as the LTV £ mode. */
  onIndGrossChange(v: unknown): void {
    this.indNetTarget = null;
    const g = Number(v);
    this.indInputs['ltv_mode'] = 'amount';
    this.indInputs['gross_loan'] = Number.isFinite(g) && g > 0 ? Math.round(g * 100) / 100 : null;
    this.pendingLtvSyncFromAmount = true;
    this.recalcIndicative();
  }

  /** Net amount typed: back-solve the Gross Loan that yields it, then recalc as usual. */
  onIndNetChange(v: unknown): void {
    const net = Number(v);
    // The box carries the Total Net incl. Drawdowns; back-solve from the Day 1 Net
    // (subtract the drawdowns' net), which is what grossFromNet expects.
    const c = this.indCalc();
    const ddNet = c && c.total_net_incl_drawdowns != null && c.day1_net != null ? (c.total_net_incl_drawdowns - c.day1_net) : 0;
    const day1 = Number.isFinite(net) ? net - ddNet : null;
    this.indNetTarget = Number.isFinite(net) && net > 0 ? net : null;
    this.indInputs['ltv_mode'] = 'amount';
    this.indInputs['gross_loan'] = this.grossFromNet(day1);
    this.pendingLtvSyncFromAmount = true;
    this.recalcIndicative();
  }

  /**
   * Gross Loan that produces a given day-1 Net, using the SAME deduction model as the
   * engine (enquiry.calc.service.js):
   *   net   = gross·(1 − feePct − retainedCoef) − feePct·ΣDDgross − feeFlat
   *   gross = (net + feePct·ΣDDgross + feeFlat) / (1 − feePct − retainedCoef)
   * feePct / feeFlat come from arrangement + broker (each a % or a flat amount) + the
   * document fee; retainedCoef = monthlyRate × term for Retained, 0 for Serviced (whose
   * interest is paid monthly, not deducted). Fees are charged on the TOTAL gross incl DDs,
   * so the already-computed drawdowns gross is carried in. Returns null if the figures
   * can't yield that net (fees + interest ≥ 100%), which clears the loan and warns.
   */
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

  /** Financials "Property Value": main security + every other security's value (client 30-09-2026). */
  totalPropertyValue(): number | null {
    const e = this.enquiry();
    if (!e) return null;
    const n = (v: unknown) => { const k = Number(String(v ?? '').replace(/[£,\s]/g, '')); return Number.isFinite(k) && k > 0 ? k : 0; };
    const others = ((e as { additional_securities?: Record<string, unknown>[] }).additional_securities || [])
      .reduce((a, x) => a + n(x && x['estimated_value']), 0);
    const total = n(e.estimated_value) + others;
    return total > 0 ? total : (e.estimated_value ?? null);
  }

  /** Enquiry's other securities -> indicative rows (value / charge typed as text on the enquiry). */
  private enquirySecurities(): IndSecurity[] {
    const toNum = (v: unknown): number | null => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(String(v).replace(/[£,\s]/g, ''));
      return Number.isFinite(n) ? n : null;
    };
    const list = ((this.enquiry() as { additional_securities?: Record<string, unknown>[] })?.additional_securities || []);
    return list
      .map((x) => ({
        address: String(x['address'] || x['description'] || '').trim(),
        security_type: String(x['security_type'] || '').trim(),
        value: toNum(x['estimated_value']),
        gdv: toNum(x['gdv']),
        // New securities carry the step-4 style "Outstanding loan"; older ones "Existing charge".
        existing_charge: (() => {
          // New rows: outstanding loan + 2nd-charge amount. Older rows: "Existing charge".
          if (x['outstanding_loan'] === undefined) return toNum(x['existing_charge']);
          const d = (toNum(x['outstanding_loan']) || 0) + (x['charge_type'] === '2nd' ? (toNum(x['charge_amount']) || 0) : 0);
          return d || null;
        })(),
        include: true,
      }))
      .filter((x) => x.address || x.value || x.existing_charge);
  }
  get indSecurities(): IndSecurity[] {
    return (this.indInputs['additional_securities'] as IndSecurity[]) || [];
  }
  get indDrawdowns(): IndDrawdown[] {
    return (this.indInputs['drawdowns'] as IndDrawdown[]) || [];
  }
  /** Popup opens with Drawdown 1-4 (months 1-4) like the client's sheet; every row can be removed. */
  private padDrawdowns(): void {
    const rows = [...this.indDrawdowns];
    while (rows.length < 4) rows.push({ month: rows.length + 1, amount: null, net: null });
    this.indInputs['drawdowns'] = rows;
  }
  /** Feeder Info col D: Months of Interest = Term - Month. */
  ddMonthsLeft(dd: IndDrawdown): number | null {
    const term = Number(this.indInputs['term_months']);
    if (!term || dd.month == null || (dd.month as unknown) === '') return null;
    return Math.max(0, term - Number(dd.month));
  }
  /**
   * Drawdown Gross, back-solved from the NET the BDM types (client point #2):
   * Gross = Net / (1 - Months of Interest x Rate). Same maths as the engine.
   * Legacy rows (gross typed, no net) just show that gross.
   */
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
  /** Col E: Interest on Drawdown = Gross - Net. */
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
  /** Drawdown Net = Gross - Interest (gross typed, per Calc with DDs). Legacy net-typed rows show the typed net. */
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

  /** Which client calculator the popup follows (Calc with DDs is the default). */
  indCalcType(): string { return String(this.indInputs['calc_type'] || 'dds'); }
  setCalcType(t: string): void {
    this.indInputs['calc_type'] = t;
    if (t === 'serviced') this.applyRateCard();
    // Client 14-10-2026: picking "Retained with 2nd charge" auto-fills the 1st Charge box
    // with the total of every security's outstanding loan + 2nd-charge amount (editable).
    if (t === 'second_charge') {
      const total = this.indTotalCharges();
      if (total) this.indInputs['first_charge'] = total;
    }
    this.recalcIndicative();
  }
  /**
   * Serviced annual 'Interest calc' rate is DERIVED from the monthly rate along the straight
   * line through the client's example rows (1.05% -> 14.4%, 1.15% -> 16%, 1.25% -> 17.6%):
   * each +0.10 monthly adds +1.60 annual, i.e. annual = monthly*16 - 2.4. Auto-fills for ANY
   * monthly rate whenever it changes (client 02-10-2026), not just the 3 example rows.
   */
  private applyRateCard(): void {
    const m = Number(this.indInputs['monthly_rate_pct']);
    if (!Number.isFinite(m) || !m) return;
    this.indInputs['annual_rate_pct'] = Math.round((m * 16 - 2.4) * 100) / 100;
  }
  /** Monthly rate box on the 3 non-DDs calculators: Serviced also picks its annual rate off the card. */
  onRate2Change(): void {
    if (this.indCalcType() === 'serviced') this.applyRateCard();
    this.recalcIndicative();
  }
  /**
   * What is sent to the engine. Calc with DDs sends the inputs untouched; the other three
   * workbooks force their interest type and drop fields their sheet does not have, without
   * wiping what was typed (switching back to DDs keeps the drawdowns / GDV).
   */
  private indPayload(): Record<string, unknown> {
    const t = this.indCalcType();
    // Retained with drawdowns is Retained only (the client's Calc with DDs has no serviced version).
    // No 1st charge / gross override on the Calc with DDs sheet (the Advanced box was removed), so
    // an enquiry's outstanding loan can't silently reduce the gross: gross = Max LTV, like the sheet.
    // LTV box in £ mode: the typed amount IS the gross loan and LTV % is back-solved by the engine;
    // in % mode the gross is Max LTV (- 1st charge) as on the sheets.
    const amountMode = this.indLtvMode() === 'amount';
    // Drawdowns go as NET; a legacy gross-only row keeps its gross so old versions re-send unchanged.
    const drawdowns = this.indDrawdowns.map((d) => ({ month: d.month, amount: d.amount ?? null, net: d.amount != null ? null : (d.net ?? null) }));
    const ltv = amountMode
      ? { ltv_mode: 'amount', gross_loan: this.indInputs['gross_loan'] ?? null, ltv_pct: null }
      : { ltv_mode: 'pct', gross_loan: null };
    // Outstanding loans on the main property (first_charge) now count on EVERY calculator
    // (client 28-09-2026: Est. LTV must include existing loans + the new request).
    if (t === 'dds') return { ...this.indInputs, ...ltv, drawdowns, interest_type: 'Retained' };
    const p: Record<string, unknown> = { ...this.indInputs, ...ltv, drawdowns: [], gdv: null };
    if (t === 'serviced') { p['interest_type'] = 'Serviced'; }
    else { p['interest_type'] = 'Retained'; p['annual_rate_pct'] = null; }
    // 2nd charge follows its sheet: Gross = (Property Value x LTV%) - 1st Charge, so drop the
    // net model and let the engine's second_charge path subtract the typed 1st charge.
    if (t === 'second_charge') { p['value_model'] = null; p['additional_securities'] = []; }
    return p;
  }
  /** Bumped per preview call; only the LATEST response may update the popup. */
  private indPreviewSeq = 0;
  recalcIndicative(): void {
    const seq = ++this.indPreviewSeq;
    this.api.previewIndicative(this.id(), this.indPayload())
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        // Typing fires a preview per keystroke; a slower, older response must not
        // overwrite the newer figures (popup would then differ from what gets saved).
        if (!r || seq !== this.indPreviewSeq) return;
        this.indCalc.set(r.calc); this.indWarnings.set(r.warnings || []);
        // Net target (client 20-10-2026): re-solve the gross so the Net Amount stays what was
        // asked for after rate / term / fee / drawdown changes. Converges in 1-2 rounds.
        if (this.indNetTarget != null && r.calc && this.indNetSolveRounds < 4) {
          const c = r.calc;
          const ddNet = c.total_net_incl_drawdowns != null && c.day1_net != null ? c.total_net_incl_drawdowns - c.day1_net : 0;
          const want = this.grossFromNet(this.indNetTarget - ddNet);
          const have = Number(this.indInputs['gross_loan']);
          if (want != null && Math.abs(want - (Number.isFinite(have) ? have : 0)) > 0.005) {
            this.indNetSolveRounds += 1;
            this.indInputs['ltv_mode'] = 'amount';
            this.indInputs['gross_loan'] = want;
            this.pendingLtvSyncFromAmount = true;
            this.recalcIndicative();
            return;
          }
        }
        this.indNetSolveRounds = 0;
        this.syncLoanFields();
        // Typed Gross/Net: show the LTV as the back-solved %, not the £ gross (client 09-10-2026).
        // Bug 14-10-2026: this used to switch the inputs to %-mode with the ROUNDED LTV
        // (e.g. 50.18%) and drop the typed gross, without recalculating. The popup kept
        // showing the exact typed loan (£238,744.08) but Send re-ran the engine on 50.18%
        // (£238,715.00), so the email differed from the popup. Now the typed amount stays
        // the loan (ltv_mode 'amount' + gross_loan); the % is only shown in the LTV box.
        // Typing a new LTV % still switches to %-mode (onIndLtvChange).
        // Amount mode (typed loan, or a saved version reopened in it): always show the
        // engine's back-solved % in the LTV box (the saved inputs carry ltv_pct = null).
        if (this.pendingLtvSyncFromAmount || this.indLtvMode() === 'amount') {
          this.pendingLtvSyncFromAmount = false;
          const p = r.calc ? Number(r.calc.ltv_pct) : NaN;
          if (Number.isFinite(p) && p > 0) this.indInputs['ltv_pct'] = p;
        }
      });
  }
  sendIndicativeNow(): void {
    this.acting2.set(true);
    this.api.saveIndicative(this.id(), this.indPayload())
      .pipe(catchError((e: unknown) => { this.acting2.set(false); this.toastr.error(this.msg(e, 'Could not save indicative.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res) return;
        this.api.sendIndicative(this.id(), res.id, this.indNotes)
          .pipe(catchError((e: unknown) => { this.acting2.set(false); this.toastr.error(this.msg(e, 'Could not send indicative.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
          .subscribe((r) => {
            this.acting2.set(false); if (r === null) return; this.indOpen.set(false);
            if (r.emailed) this.toastr.success('Indicative emailed to applicant.', 'Sent');
            else this.toastr.warning('Indicative saved, but email failed: ' + (r.error || 'unknown'), 'Email failed');
            this.load();
          });
      });
  }

  // ---- Offer (official, emailed) ----
  openOfferModal(): void {
    if (!this.canOffer()) { this.toastr.info('You do not have permission to send offers.', 'Not allowed'); return; }
    // Client 05-10-2026: an official offer MUST be based on an indicative that has
    // actually been sent to the applicant. Without one, block the modal and tell the
    // user what to do first (otherwise the offer letter falls back to blank/hard-coded
    // figures and makes no sense).
    const list = this.indicatives();
    const sent = list.filter((v) => v.status === 'Sent' || v.status === 'Accepted' || !!v.sent_at);
    if (!sent.length) {
      this.toastr.info('Send an indicative first — an official offer must be based on an indicative that has been sent to the applicant.', 'No indicative sent');
      return;
    }
    // Default the offer to the LATEST SENT indicative. The BDM can switch versions in
    // the modal (client point #5).
    const latest = sent[0] || list[0] || null;
    this.chosenIndicativeId.set(latest?.enquiry_indicative_id ?? null);
    this.buildOfferFromIndicative(latest);
    this.offerOpen.set(true);
  }
  /** Rebuild the offer model when the BDM picks a different indicative version. */
  applyChosenIndicative(): void {
    const id = this.chosenIndicativeId();
    const v = this.indicatives().find((x) => x.enquiry_indicative_id === Number(id)) || null;
    this.buildOfferFromIndicative(v);
  }
  private buildOfferFromIndicative(v: IndicativeVersion | null): void {
    const e = this.enquiry();
    // The offer letter falls back to hard-coded figures for anything left blank,
    // so we seed the modal from the chosen indicative's real agreed terms.
    const inp = (v?.inputs || {}) as Record<string, unknown>;
    const calc = v?.calc;
    const num = (x: unknown): number | null => {
      const n = Number(x);
      return x === null || x === undefined || x === '' || !Number.isFinite(n) ? null : n;
    };
    const primary = (e?.applicants || [])[0];
    const itype = (calc?.interest_type as string) || (inp['interest_type'] as string)
      || (e as { interest_type?: string })?.interest_type || 'Retained';

    // Client 06-10-2026: a single equal-footing list of every security, each with its
    // own charge (1st/2nd), editable here before the offer goes out.
    const cAny = (calc || {}) as Record<string, unknown>;
    const enqSecs = Array.isArray((e as { additional_securities?: Record<string, unknown>[] })?.additional_securities)
      ? (e as { additional_securities?: Record<string, unknown>[] }).additional_securities as Record<string, unknown>[] : [];
    const calcSecs = Array.isArray(cAny['additional_securities']) ? cAny['additional_securities'] as Record<string, unknown>[] : [];
    const extraSecs = enqSecs.length ? enqSecs : calcSecs;
    // Client 07-10-2026: honour each security's OWN selected charge (1st/2nd); blank stays
    // blank. No inference from the product / calc type, so a 1st-charge main is not flipped
    // to 2nd just because the deal is a 2nd-charge bridge.
    const chgSel = (ct: unknown): string => ct === '2nd' ? '2nd' : (ct === '1st' ? '1st' : '');
    const normChg = (x: Record<string, unknown>): string => chgSel(x['charge_type']);
    const mainChg = chgSel((e as { charge_type?: string })?.charge_type);
    // Client 13-10-2026: every security address carries its postcode, comma-separated,
    // when one is entered (and not already inside the address). Used on the Send Offer
    // popup and the offer letter PDF (both read this list).
    const withPc = (addr: unknown, pc: unknown): string => {
      const a = String(addr || '').trim(); const c = String(pc || '').trim();
      if (!a) return '';
      if (!c || a.toUpperCase().replace(/\s/g, '').includes(c.toUpperCase().replace(/\s/g, ''))) return a;
      return `${a}, ${c}`;
    };
    const securitiesList = [
      { address: withPc(e?.property_address, (e as { postcode?: string })?.postcode), value: num(cAny['main_property_value'] ?? cAny['property_value']) ?? e?.estimated_value ?? null, charge_type: mainChg, is_main: true },
      ...extraSecs.map((x) => ({ address: withPc(x['address'] || x['description'], x['postcode']), value: num(x['value'] ?? x['estimated_value'] ?? x['security_value']), charge_type: normChg(x) })),
    ];

    this.offerModel = {
      // Tell the backend which indicative version to base the offer on (point #5).
      indicative_id: v?.enquiry_indicative_id ?? null,
      // Equal-footing securities with per-charge, editable in the modal (point #6).
      securities: securitiesList,
      borrower_name: e?.company_name || e?.applicant_name || '',
      borrower_address: primary?.address || '',
      security_address: withPc(e?.property_address, (e as { postcode?: string })?.postcode) || e?.property_address || '',
      // Interest type drives the offer letter wording (client point #6).
      interest_type: itype,
      assumed_asset_value: num(calc?.property_value) ?? e?.estimated_value ?? null,
      gross_loan_amount: num(calc?.total_gross_loan_incl_dds) ?? e?.amount_requested ?? null,
      // Term follows the chosen indicative too, so the locked block in the modal
      // is one consistent set of figures.
      term_months: num(calc?.term_months) ?? num(inp['term_months']) ?? e?.term_months ?? null,
      monthly_rate_pct: num(inp['monthly_rate_pct']),
      arrangement_fee: num(calc?.arrangement_fee),
      document_fee: num(calc?.document_fee),
      // Arrangement fee to broker (client 09-10-2026: based on the ARRANGEMENT FEE, not
      // the broker fee). The indicative's arrangement fee £ is the cap; here the user enters
      // a % OF THAT AMOUNT or a £ no higher than it. Default 100%. (Field keys kept as
      // broker_fee_* so the offer letter / save payload are unchanged — this is the £ paid
      // on to the broker out of the arrangement fee.)
      // broker_fee_base stays the indicative's broker fee — it still drives the letter's separate
      // "Less broker fee" deduction line. The "arrangement fee to broker" box below is computed
      // against the ARRANGEMENT FEE instead (client 09-10-2026), via offerBrokerAmount().
      broker_fee_base: num(calc?.broker_fee),
      broker_fee_is_pct: true,
      broker_fee_value: num(calc?.arrangement_fee) != null ? 100 : null,
      // Client 07-10-2026: the letter names the broker's COMPANY as payee, so the
      // popup preview seeds from broker_company first (then master name, then free-text).
      broker_payee_name: ((e as unknown as Record<string, unknown>)?.['broker_company'] as string)
        || ((e as unknown as Record<string, unknown>)?.['broker_name'] as string)
        || ((e as unknown as Record<string, unknown>)?.['broker_name_text'] as string) || '',
      // Type-aware headline figures for the letter.
      net_release_day1: num(calc?.total_net ?? calc?.day1_net),
      serviced_interest: num(calc?.serviced_interest_total ?? calc?.retained_interest_total),
      monthly_payment: num(calc?.monthly_payment),
      rolled_up_interest: num(calc?.rolled_up_interest),
      redemption_total: num(calc?.redemption_total),
      // Minimum term = minimum months' interest on early redemption (30-09-2026); default 3.
      min_term_months: 3,
    };
  }
  /** Arrangement fee to broker in £ for the Send Offer popup: % is of the indicative's arrangement fee, capped at it. */
  offerBrokerAmount(): number | null {
    const m = this.offerModel as Record<string, unknown>;
    const base = this.offerNum('arrangement_fee');
    const raw = m['broker_fee_value'];
    const v = Number(raw);
    if (raw === null || raw === undefined || raw === '' || !Number.isFinite(v) || v < 0) return base;
    let amt = m['broker_fee_is_pct'] === false ? v : (base != null ? base * Math.min(v, 100) / 100 : 0);
    if (base != null) amt = Math.min(amt, base);
    return Math.round(amt * 100) / 100;
  }
  /** True when the typed value goes over the indicative's arrangement fee (it gets capped). */
  offerBrokerOver(): boolean {
    const m = this.offerModel as Record<string, unknown>;
    const base = this.offerNum('arrangement_fee');
    const v = Number(m['broker_fee_value']);
    if (base == null || !Number.isFinite(v)) return false;
    return m['broker_fee_is_pct'] === false ? v > base : v > 100;
  }
  /** offerModel is a loose record; these keep the read-only block type-safe. */
  offerNum(key: string): number | null {
    const n = Number((this.offerModel as Record<string, unknown>)[key]);
    return Number.isFinite(n) ? n : null;
  }
  offerText(key: string): string {
    const v = (this.offerModel as Record<string, unknown>)[key];
    return v === null || v === undefined || v === '' ? '—' : String(v);
  }

  /** Editable securities list for the Send Offer modal (point #6). */
  offerSecurities(): { address: string; value: number | null; charge_type: string; is_main?: boolean }[] {
    const s = (this.offerModel as Record<string, unknown>)['securities'];
    return Array.isArray(s) ? s as { address: string; value: number | null; charge_type: string; is_main?: boolean }[] : [];
  }

  sendOfferOfficial(): void {
    this.acting2.set(true);
    this.api.saveOfferVersion(this.id(), this.offerModel)
      .pipe(catchError((e: unknown) => { this.acting2.set(false); this.toastr.error(this.msg(e, 'Could not save offer.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res) return;
        this.api.sendOfferVersion(this.id(), res.id)
          .pipe(catchError((e: unknown) => { this.acting2.set(false); this.toastr.error(this.msg(e, 'Could not send offer.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
          .subscribe((r) => {
            this.acting2.set(false); if (r === null) return; this.offerOpen.set(false);
            if (r.emailed) this.toastr.success('Offer emailed to applicant with both PDFs.', 'Offer Sent');
            else this.toastr.warning('Offer saved, but email failed: ' + (r.error || 'unknown'), 'Email failed');
            this.load();
          });
      });
  }
  acceptOfferNow(vid: number): void {
    this.api.acceptOffer(this.id(), vid)
      .pipe(catchError((e: unknown) => { this.toastr.error(this.msg(e, 'Could not accept offer.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r === null) return; this.toastr.success('Offer marked accepted.', 'Accepted'); this.load(); });
  }
  resendOfferNow(vid: number): void {
    this.api.resendOffer(this.id(), vid)
      .pipe(catchError((e: unknown) => { this.toastr.error(this.msg(e, 'Could not resend.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r === null) return; this.toastr.success(r.emailed ? 'Offer re-emailed.' : 'Email failed.', 'Resend'); this.load(); });
  }
  loadOfferHistory(): void {
    this.api.listIndicatives(this.id()).pipe(catchError(() => of([])), takeUntilDestroyed(this.destroyRef)).subscribe((r) => this.indicatives.set(r));
    this.api.listOffers(this.id()).pipe(catchError(() => of([])), takeUntilDestroyed(this.destroyRef)).subscribe((r) => this.offers.set(r));
  }

  onFilePicked(f: File | null): void {
    if (!f) { this.pickedFile = null; this.pickedFileName = ''; this.pickedBase64 = ''; return; }
    this.pickedFile = f; this.pickedFileName = f.name;
    const reader = new FileReader();
    reader.onload = () => { this.pickedBase64 = String(reader.result || ''); };
    reader.readAsDataURL(f);
  }

  uploadDoc(): void {
    if (!this.pickedFile || !this.pickedBase64) return;
    this.uploadingDoc.set(true);
    this.api.uploadDocument(this.id(), { file_name: this.pickedFile.name, content_base64: this.pickedBase64, document_type_id: this.newDocTypeId === 'other' ? null : this.newDocTypeId, document_type_name: this.newDocTypeId === 'other' ? this.newDocTypeOther.trim() : undefined })
      .pipe(catchError((e: unknown) => { this.uploadingDoc.set(false); this.toastr.error(this.msg(e, 'Upload failed.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        if (r === null) return;
        this.uploadingDoc.set(false);
        this.pickedFile = null; this.pickedFileName = ''; this.pickedBase64 = ''; this.newDocTypeId = null; this.newDocTypeOther = '';
        this.docModalOpen.set(false);
        this.toastr.success('Document uploaded.', 'Uploaded');
        this.load();
      });
  }

  openDocModal(): void { this.pickedFile = null; this.pickedFileName = ''; this.pickedBase64 = ''; this.newDocTypeId = null; this.newDocTypeOther = ''; this.docModalOpen.set(true); }

  openDocEdit(d: EnquiryDocument): void {
    this.editDocId = d.enquiry_document_id;
    this.editDocTypeId = d.document_type_id ?? null;
    this.editDocFile = null; this.editDocFileName = ''; this.editDocBase64 = '';
    this.docEditOpen.set(true);
  }

  onEditFilePicked(f: File | null): void {
    if (!f) { this.editDocFile = null; this.editDocFileName = ''; this.editDocBase64 = ''; return; }
    this.editDocFile = f; this.editDocFileName = f.name;
    const reader = new FileReader();
    reader.onload = () => { this.editDocBase64 = String(reader.result || ''); };
    reader.readAsDataURL(f);
  }

  submitDocEdit(): void {
    if (!this.editDocId) return;
    this.savingDoc.set(true);
    const body: Record<string, unknown> = { document_type_id: this.editDocTypeId };
    if (this.editDocFile && this.editDocBase64) { body['content_base64'] = this.editDocBase64; body['file_name'] = this.editDocFile.name; }
    this.api.updateDocument(this.id(), this.editDocId, body)
      .pipe(catchError((e: unknown) => { this.savingDoc.set(false); this.toastr.error(this.msg(e, 'Could not update document.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r === null) return; this.savingDoc.set(false); this.docEditOpen.set(false); this.toastr.success('Document updated.', 'Updated'); this.load(); });
  }

  downloadDoc(d: EnquiryDocument): void {
    this.api.downloadDocument(this.id(), d.enquiry_document_id)
      .pipe(catchError((e: unknown) => { this.toastr.error(this.msg(e, 'Download failed.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob as Blob);
        const a = document.createElement('a');
        a.href = url; a.download = d.file_name || 'document';
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  /** Indicative version with no stored PDF (never e-mailed) - built on the server on demand. */
  downloadIndicativePdf(vid: number, version: number): void {
    this.api.indicativePdf(this.id(), vid)
      .pipe(catchError((e: unknown) => { this.toastr.error(this.msg(e, 'Download failed.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob as Blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'Indicative_v' + version + '.pdf';
        a.click();
        URL.revokeObjectURL(url);
      });
  }
  downloadDocId(docId: number | null, name: string): void {
    if (!docId) return;
    this.api.downloadDocument(this.id(), docId)
      .pipe(catchError((e: unknown) => { this.toastr.error(this.msg(e, 'Download failed.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob as Blob);
        const a = document.createElement('a');
        a.href = url; a.download = name || 'document.pdf';
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  deleteDoc(d: EnquiryDocument): void {
    this.api.deleteDocument(this.id(), d.enquiry_document_id)
      .pipe(catchError((e: unknown) => { this.toastr.error(this.msg(e, 'Delete failed.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r === null) return; this.toastr.success('Document deleted.', 'Deleted'); this.load(); });
  }

  hasOffer(e: Enquiry): boolean {
    return !!(e.offer_sent_at || e.offer_amount != null || e.offer_rate != null || e.offer_notes);
  }

  /** Fields the enquiry needs before an offer can be sent (mirrors backend OFFER_RULES). */
  offerMissing(e: Enquiry): string[] {
    const m: string[] = [];
    if (!(Number(e.amount_requested) > 0)) m.push('Requested amount');
    if (!e.loan_purpose_id) m.push('Loan purpose');
    if (!e.product_id) m.push('Product');
    return m;
  }

  /** Decline button: opens the reasons popup instead of declining straight away. */
  decline(): void {
    this.declineSel = [];
    this.declineNotes = '';
    this.declineOpen.set(true);
  }
  declineReasons(): { id: number; name: string }[] { return this.opts()?.declineReasons || []; }
  isReasonPicked(id: number): boolean { return this.declineSel.includes(id); }
  toggleReason(id: number, on: boolean): void {
    this.declineSel = on ? [...new Set([...this.declineSel, id])] : this.declineSel.filter((x) => x !== id);
  }
  confirmDecline(): void {
    if (!this.declineSel.length || this.declining()) return;
    this.declining.set(true);
    this.api.decline(this.id(), this.declineSel, this.declineNotes.trim() || undefined)
      .pipe(catchError((e: unknown) => { this.declining.set(false); this.toastr.error(this.msg(e, 'Could not decline.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.declining.set(false);
        if (r === null) return;
        this.declineOpen.set(false);
        this.toastr.success('Enquiry has been declined.', 'Declined');
        this.load();
      });
  }

  /** Delete an enquiry made by mistake (client 26-10-2026) - not counted as declined anywhere. */
  confirmDelete(): void {
    if (this.deleting()) return;
    this.deleting.set(true);
    this.api.remove(this.id())
      .pipe(catchError((e: unknown) => { this.deleting.set(false); this.toastr.error(this.msg(e, 'Could not delete.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.deleting.set(false);
        if (r === null) return;
        this.deleteOpen.set(false);
        this.toastr.success('Enquiry has been deleted.', 'Deleted');
        this.back();
      });
  }

  /** Bring a declined enquiry back alive. */
  openReopen(): void { this.reopenNote = ''; this.reopenOpen.set(true); }
  confirmReopen(): void {
    if (this.reopening()) return;
    this.reopening.set(true);
    this.api.reopen(this.id(), this.reopenNote.trim() || undefined)
      .pipe(catchError((e: unknown) => { this.reopening.set(false); this.toastr.error(this.msg(e, 'Could not re-open.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.reopening.set(false);
        if (r === null) return;
        this.reopenOpen.set(false);
        this.toastr.success('Enquiry is back in the pipeline.', 'Re-opened');
        this.load();
      });
  }

  /** Offer versions the client can accept: already emailed, or already accepted. */
  acceptableOffers(): OfferVersion[] {
    // Client 05-10-2026 (#9): list EVERY offer version in the Accept popup (not only
    // Sent/Accepted), so the BDM can pick whichever version the client accepted.
    return this.offers();
  }
  /** The indicative version an offer was built from — shown in the picker's label. */
  offerIndVersion(o: OfferVersion): number | null {
    const id = Number((o.offer || {})['indicative_id']);
    if (!Number.isFinite(id) || !id) return null;
    return this.indicatives().find((v) => v.enquiry_indicative_id === id)?.version_no ?? null;
  }
  /** OFFER STATUS field: indicative version behind the accepted offer. */
  acceptedOfferIndVersion(): number | null {
    const acc = this.offers().find((o) => o.status === 'Accepted');
    return acc ? this.offerIndVersion(acc) : null;
  }
  /** #13: the indicative the ACCEPTED offer was built from (so the history can flag it). */
  acceptedIndId(): number | null {
    const acc = this.offers().find((o) => o.status === 'Accepted');
    if (!acc) return null;
    const id = Number((acc.offer || {})['indicative_id']);
    return Number.isFinite(id) && id ? id : null;
  }
  offerGross(o: OfferVersion): number | null {
    const n = Number((o.offer || {})['gross_loan_amount']);
    return Number.isFinite(n) ? n : null;
  }
  markAccepted(): void {
    const list = this.acceptableOffers();
    // No offer version on record (status set by hand) — keep the plain status change.
    if (!list.length) { this.setStatus('OFFER_ACCEPTED', 'Offer marked as accepted.', 'Offer Accepted'); return; }
    const preferred = list.find((o) => o.status === 'Accepted')
      || list.find((o) => o.status === 'Sent') || list[0];
    this.chosenAcceptOfferId.set(preferred.enquiry_offer_id);
    this.acceptOpen.set(true);
  }
  /**
   * Gross amount the application will start from — mirrors agreedGrossAmount()
   * in api/services/enquiry.service.js: accepted offer, then latest sent offer,
   * then latest sent indicative, then the enquiry's own amount requested.
   */
  private convertGrossPick(e: Enquiry): { value: number | null; source: string } {
    const num = (x: unknown): number | null => {
      const n = Number(x);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    // Client 22-10-2026: the LATEST offer version (highest version, not superseded / withdrawn).
    const latest = [...this.offers()]
      .filter((o) => o.status !== 'Superseded' && o.status !== 'Withdrawn')
      .sort((a, b) => Number(b.version_no) - Number(a.version_no));
    for (const o of latest) {
      const v = num((o.offer || {})['gross_loan_amount']);
      if (v !== null) return { value: v, source: `${o.status === 'Draft' ? 'draft ' : o.status === 'Accepted' ? 'accepted ' : ''}Offer v${o.version_no}` };
    }
    // The quick "Send Offer" popup stores its figure on the enquiry itself and
    // creates no offer version, so it has to be checked separately.
    const quick = num(e.offer_amount);
    if (quick !== null) return { value: quick, source: 'offer amount sent on this enquiry' };
    const inds = [...this.indicatives()].sort((a, b) => Number(b.version_no) - Number(a.version_no));
    const ind = inds[0];
    if (ind) {
      const v = num(ind.calc?.total_gross_loan_incl_dds);
      if (v !== null) return { value: v, source: `Indicative v${ind.version_no}` };
    }
    return { value: num(e.amount_requested), source: 'amount requested on the enquiry' };
  }
  convertGross(e: Enquiry): number | null { return this.convertGrossPick(e).value; }
  convertGrossSource(e: Enquiry): string { return this.convertGrossPick(e).source; }

  confirmAcceptOffer(): void {
    const vid = Number(this.chosenAcceptOfferId());
    if (!vid) return;
    this.accepting.set(true);
    this.api.acceptOffer(this.id(), vid)
      .pipe(catchError((e: unknown) => { this.accepting.set(false); this.toastr.error(this.msg(e, 'Could not accept offer.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.accepting.set(false);
        if (r === null) return;
        this.acceptOpen.set(false);
        this.toastr.success('Offer marked accepted.', 'Accepted');
        this.load();
      });
  }

  offerSent(e: Enquiry): boolean {
    const code = (e.status_code || '').toUpperCase();
    return (code === 'QUALIFIED' || !!e.offer_sent_at) && code !== 'OFFER_ACCEPTED' && !e.converted_application_id;
  }

  /** Centralised status -> allowed-action map (mirrors backend TRANSITIONS). */
  /** Effective step 0..6 from status + indicative/offer flags (robust to status seeding). */
  effStep(e: Enquiry): number {
    if (e.converted_application_id) return 6;
    const base = this.stepIndex(e.status_code);
    // Client 26-10-2026: the deal stays fluid - a new indicative after an offer moves the
    // status back to Indicative Sent, so from step 3 on the status itself is the truth.
    if (base >= 3) return base;
    if (e.offer_sent_at) return 4;                    // e.g. Request Info sent after the offer
    if (e.indicative_sent_at) return 3;               // indicative sent, offer not yet
    return base;
  }
  private idx(e: Enquiry): number { return this.effStep(e); }
  indDone(e: Enquiry): boolean { return this.effStep(e) >= 3; }
  /** Send Indicatives button: visible only until an indicative has been sent. */
  // Button stays available so revised indicatives can be sent as many times as needed (client point #2); each send is stored as a new version.
  // Every one of these actions posts to an endpoint guarded by
  // ENQUIRIES.ENQUIRY_LIST.edit on the server, so the button is hidden unless
  // the role actually holds that permission - otherwise the user saw the
  // button and got a 403 only after clicking it.
  // Client 26-10-2026: still available after the offer is accepted - the client may change their mind.
  canSendIndicativeBtn(e: Enquiry): boolean { const i = this.effStep(e); return this.canOffer() && !this.isTerminal(e) && i >= 1; }
  /** Request Info stays available at every stage until the enquiry is converted (or lost / closed). */
  canRequestInfo(e: Enquiry): boolean { return this.canReqInfo() && !this.isTerminal(e); }
  // Mirrors Send Indicatives: the button stays available for a further version
  // once an offer has gone out (and, client 26-10-2026, after it is accepted), and
  // only disappears once the enquiry is converted or reaches a terminal status.
  canSendOfferAction(e: Enquiry): boolean { const i = this.effStep(e); return this.canOffer() && !this.isTerminal(e) && i >= 1; }
  canMarkAccepted(e: Enquiry): boolean { return this.canOffer() && !this.isTerminal(e) && this.offerSent(e); }
  /** Has a formal offer gone out on this enquiry? (client 05-10-2026 #15: no accept/convert before an offer is sent.) */
  hasOfferBeenSent(e: Enquiry): boolean {
    const code = (e.status_code || '').toUpperCase();
    return !!e.offer_sent_at || code === 'QUALIFIED' || code === 'OFFER_ACCEPTED'
      || this.offers().some((o) => o.status === 'Sent' || o.status === 'Accepted');
  }
  canConvertNow(e: Enquiry): boolean { return this.canConvert() && !e.converted_application_id && !this.isTerminal(e) && this.idx(e) >= 1 && this.hasOfferBeenSent(e); }
  canDeclineNow(e: Enquiry): boolean { return this.canReject() && !this.isTerminal(e); }
  /** Declined = status LOST (shown as a badge in place of the stepper). */
  isDeclined(e: Enquiry): boolean { return !e.converted_application_id && (e.status_code || '').toUpperCase() === 'LOST'; }
  canDeleteNow(e: Enquiry): boolean { return this.canDelete() && !e.converted_application_id; }
  canReopenNow(e: Enquiry): boolean { return this.canReject() && this.isDeclined(e); }
  canEditNow(e: Enquiry): boolean { return this.canEdit() && !this.isTerminal(e); }
  canAssignNow(e: Enquiry): boolean { return this.canAssign() && !this.isTerminal(e); }
  assignLabel(e: Enquiry): string { return e.assigned_to ? 'Reassign BDM' : 'Assign BDM'; }

  isTerminal(e: Enquiry): boolean {
    return !!e.converted_application_id || ['CONVERTED', 'LOST', 'CLOSED'].includes((e.status_code || '').toUpperCase());
  }

  offerState(e: Enquiry): { label: string; cls: string } {
    const code = (e.status_code || '').toUpperCase();
    if (e.converted_application_id || code === 'CONVERTED') return { label: 'Converted', cls: 'f-offer-converted' };
    if (code === 'LOST') return { label: 'Rejected', cls: 'f-offer-rejected' };
    if (code === 'CLOSED') return { label: 'Closed', cls: 'f-offer-rejected' };
    if (code === 'OFFER_ACCEPTED') return { label: 'Accepted', cls: 'f-offer-converted' };
    if (code === 'QUALIFIED') return { label: 'Chasing', cls: 'f-offer-chasing' };
    return { label: 'Incomplete', cls: 'f-offer-incomplete' };
  }

  /** Editable "other securities" rows in the detail Security tab (client point #1). */
  get detailSecurities(): Record<string, unknown>[] {
    const m = this.editModel as { additional_securities?: Record<string, unknown>[] };
    if (!Array.isArray(m.additional_securities)) m.additional_securities = [];
    return m.additional_securities;
  }
  /** Total charges ahead of us on the enquiry: main security debt + every other security's
   *  outstanding loan / 2nd-charge amount. Null when there are none. */
  private indTotalCharges(): number | null {
    const t = (this.mainDebt(this.enquiry()) || 0)
      + this.enquirySecurities().reduce((a, x) => a + (Number(x.existing_charge) > 0 ? Number(x.existing_charge) : 0), 0);
    return t > 0 ? Math.round(t * 100) / 100 : null;
  }
  /** Main security debt for the indicatives: outstanding loan + charge amount (2nd charge only). */
  private mainDebt(e: unknown): number | null {
    const x = (e || {}) as { outstanding_loan?: unknown; charge_type?: unknown; charge_amount?: unknown };
    const n = (v: unknown) => { const k = Number(v); return Number.isFinite(k) && k > 0 ? k : 0; };
    const d = n(x.outstanding_loan) + (x.charge_type === '2nd' ? n(x.charge_amount) : 0);
    return d || null;
  }
  /** Same fields as the main Security / Property (client 26-09-2026). */
  addDetailSecurity(): void {
    this.detailSecurities.push({
      address: '', map_link: '', postcode: '', property_type: '', tenure: '', tenure_years: '',
      charge_type: '', charge_amount: '', owns_property: '', estimated_value: '', gdv: '', purchase_price: '', purchase_date: '',
      outstanding_loan: '', repaid_on_completion: '', lender: '', added_value: '',
    });
  }
  removeDetailSecurity(i: number): void { this.detailSecurities.splice(i, 1); }

  /** Editable applicants / directors on the detail page (client 01-10-2026) — same fields as the add drawer. */
  get detailApplicants(): Record<string, unknown>[] {
    const m = this.editModel as { applicants?: Record<string, unknown>[] };
    if (!Array.isArray(m.applicants)) m.applicants = [];
    return m.applicants;
  }
  addDetailApplicant(): void {
    this.detailApplicants.push({
      full_name: '', dob: '', nationality: '', address: '', time_at_address: '', email: '', mobile: '',
      owns_home: '', occupation: '', employer_name: '', business_address: '', length_of_service: '',
      relationship: '', shareholding_pct: '', prev_bridging: '', prev_bridging_lender: '', is_primary: 0,
    });
  }
  removeDetailApplicant(i: number): void { this.detailApplicants.splice(i, 1); }

  startEdit(): void { if (!this.editing()) this.toggleEdit(); }

  /** Header strip (client 15-10-2026): once an offer is sent, its gross / term / LTV are the
   *  loan's current figures; the Loan Request tab keeps what was first asked for. */
  headAmount(e: Enquiry): number | null { return e.current_terms?.gross_loan_amount ?? e.amount_requested ?? null; }
  headAmountBasis(e: Enquiry): string { return e.current_terms?.gross_loan_amount != null ? 'Gross' : (e.loan_basis === 'Net' ? 'Net' : 'Gross'); }
  /**
   * Header + Financials amounts (client 15-10-2026, revised). Gross = offer gross, else the
   * sent indicative's gross, else the typed amount on a Gross enquiry. Net = the offer /
   * sent-indicative net (server `net_loan`), else the typed amount on a Net enquiry. The
   * basis chosen on the enquiry is listed first; a figure not known yet is left out.
   */
  headAmounts(e: Enquiry): { label: string; value: number; title: string }[] {
    const isNet = e.loan_basis === 'Net';
    const termsSrc = e.current_terms ? (e.current_terms.source || 'the latest offer') : (e.latest_gross != null ? 'the sent indicative' : '');
    const gross = e.current_terms?.gross_loan_amount ?? e.latest_gross ?? (isNet ? null : e.amount_requested) ?? null;
    const net = e.net_loan ?? (isNet ? e.amount_requested : null) ?? null;
    const req = 'requested on the enquiry: ' + this.money(e.amount_requested) + (isNet ? ' net' : ' gross');
    const g = gross != null ? { label: 'Gross Loan', value: Number(gross), title: termsSrc ? 'From ' + termsSrc + ' (' + req + ')' : req } : null;
    const n = net != null ? { label: 'Net Amount', value: Number(net), title: termsSrc ? 'From ' + termsSrc + ' (' + req + ')' : req } : null;
    return (isNet ? [n, g] : [g, n]).filter((x): x is { label: string; value: number; title: string } => !!x);
  }
  headTerm(e: Enquiry): number | null { return e.current_terms?.term_months ?? e.term_months ?? null; }
  /** Our LTV / Total LTV on the current gross - same server figure for header + Financials (client 15-10-2026). */
  headLtv(e: Enquiry): number | null { return e.current_ltv_pct !== undefined ? (e.current_ltv_pct ?? null) : (e.current_terms?.ltv_pct ?? e.ltv_pct ?? null); }
  headTotalLtv(e: Enquiry): number | null { return e.current_total_ltv_pct !== undefined ? (e.current_total_ltv_pct ?? null) : (e.current_terms ? (e.current_terms.total_ltv_pct ?? null) : (e.total_ltv_pct ?? null)); }
  /** '1st' / '2nd' -> "1st legal charge" / "2nd legal charge" (same as Application / Underwriting). */
  chargeText(v: unknown): string {
    const t = String(v ?? '').trim().toLowerCase();
    if (t.startsWith('2nd')) return '2nd legal charge';
    if (t.startsWith('1st')) return '1st legal charge';
    return t ? String(v) : '—';
  }
  /** Representation label for the Loan Request tab. */
  repLabel(v: string | null | undefined): string { return v === 'dual' ? 'Dual Representation' : (v === 'single' ? 'Single Representation' : '—'); }

  private setStatus(code: string, successMsg: string, reason: string): void {
    this.api.changeStatus(this.id(), code, reason)
      .pipe(catchError((e: unknown) => { this.toastr.error(this.msg(e, 'That status change is not allowed from here.'), 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r === null) return; this.toastr.success(successMsg, 'Updated'); this.load(); });
  }

  goToStep(target: number): void {
    const e = this.enquiry();
    if (!e || this.isTerminal(e)) return;
    const cur = this.effStep(e);
    // Client 26-10-2026: Send Indicatives (3) / Send Offer (4) stay open at every stage
    // until conversion, so a new or revised version can always go out. Assigned (1) and
    // Awaiting Information (2) open the same popups as the Reassign BDM / Request Info
    // buttons, which are also available at every stage.
    const reopenable = target >= 1 && target <= 4;
    if (cur === target && !reopenable) return;
    if (target < cur && !reopenable) { this.toastr.info('This enquiry has moved past that step — it can only go forward.', 'Locked'); return; }
    // No permission for the step -> say so and do NOT open its popup (client 29-09-2026).
    const denied: Record<number, [boolean, string]> = {
      1: [this.canAssign(), 'assign enquiries'],
      2: [this.canReqInfo(), 'request information'],
      3: [this.canOffer(), 'send indicatives'],
      4: [this.canOffer(), 'send offers'],
      6: [this.canConvert(), 'convert enquiries to applications'],
    };
    const gate = denied[target];
    if (gate && !gate[0]) { this.toastr.info('You do not have permission to ' + gate[1] + '.', 'Not allowed'); return; }
    switch (target) {
      case 1: this.openAssign(); break; // Assigned step requires a BDM
      case 2: this.requestInfo(); break;
      case 3: this.openIndicative(); break; // Send Indicatives
      case 4: this.openOfferModal(); break;
      case 5:
        if (!this.canAcceptOffer()) { this.toastr.info('You do not have permission to accept offers.', 'Not allowed'); break; }
        if (!this.hasOfferBeenSent(e)) { this.toastr.info('Send an offer before marking it accepted.', 'Not yet'); break; }
        // Same popup as the Mark Accepted button, so the chosen offer version is stamped Accepted.
        this.markAccepted(); break;
      case 6: this.startConvert(); break;
      default: this.setStatus('NEW', 'Moved to Draft.', 'Draft');
    }
  }

  back(): void { void this.router.navigate(['/enquiries']); }
  goApp(id: number | null): void { if (id) void this.router.navigate(['/applications', id]); }

  /** Enquiry supports Individual and Company only (client requirement) — same as the add drawer. */
  prospectTypes(): { id: number; name: string }[] {
    const all = (this.opts()?.applicantTypes || []);
    // Client 09-10-2026: offer ONLY the four jurisdiction types — never prepend a legacy
    // "Company"/"Individual" as a 5th option. A legacy-typed enquiry shows the "—" blank
    // until the user picks one of the four.
    return all.filter((t) => /scotland|england|wales/i.test(t.name));
  }

  /** Applicant-type driven field visibility (mirrors the new-enquiry drawer). */
  editTypeName(): string {
    const id = this.editModel.applicant_type_id;
    const t = (this.opts()?.applicantTypes || []).find((x) => x.id === id);
    return t ? t.name : '';
  }
  showCompanyName(name: string | null | undefined): boolean { return /compan|limited|ltd/i.test(String(name || '')); }
  // Field visibility by borrower kind — works for the four jurisdiction types AND the legacy
  // Individual/Company/Joint/Multi-Party names: individuals get full name + DOB, companies get
  // company name + reg. no. (Multi-director UI is gated by showCompanyName elsewhere.)
  showFullName(name: string | null | undefined): boolean { return !!name && !this.showCompanyName(name); }
  showDob(name: string | null | undefined): boolean { return !!name && !this.showCompanyName(name); }
  showRegNo(name: string | null | undefined): boolean { return this.showCompanyName(name); }

  stepIndex(status: string | null | undefined): number {
    if (!status) return 0;
    switch (status) {
      case 'NEW':
      case 'UNASSIGNED': return 0; // Draft
      case 'ASSIGNED': return 1; // Open
      case 'CONTACTED':
      case 'FOLLOW_UP': return 2; // Awaiting Info
      case 'INDICATIVE_SENT': return 3; // Indicative Sent
      case 'QUALIFIED': return 4; // Offer Sent
      case 'OFFER_ACCEPTED': return 5;
      case 'CONVERTED': return 6;
      default: return 0;
    }
  }

  initials(name: string | null): string {
    if (!name) return '—';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }

  tone = statusTone;
  money(v: number | null): string { return v == null ? '—' : '£' + Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 }); }
  yesNo(v: unknown): string { return v == null || v === '' ? '—' : (v === true || v === 1 || v === '1' || v === 'true' ? 'Yes' : 'No'); }
  formatDate(v: string): string {
    if (!v) return '—';
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : formatDate(d);
  }
  dOnly(v: string): string { return formatDate(v, ''); }
  private dt(v: string): string { const d = new Date(v); return isNaN(d.getTime()) ? String(v) : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  private msg(e: unknown, fb: string): string { const x = e as { error?: { message?: string } }; return x?.error?.message || fb; }
}
