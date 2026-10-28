import { UiFileUploadComponent } from '../../../shared/ui/ui-file-upload/ui-file-upload.component';
import { Component, ChangeDetectionStrategy, DestroyRef, Input, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { UiModalComponent } from '../../../shared/ui/ui-modal/ui-modal.component';
import { UiTimelineComponent, TimelineEntry } from '../../../shared/ui/ui-timeline/ui-timeline.component';
import { catchError, of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import { PermissionsStore } from '../../../core/session/permissions.store';
import { ApplicationsService } from '../applications.service';
import { ApplicationDetail, ApplicationApplicant, ApplicationCommunication, ApplicationDocument, ApplicationFormOptions, ApplicationNote, ApplicationOffer, ApplicationIndicative, EnquiryApplicantSnapshot, applicationTone } from '../applications-list/application.model';
import { formatDate, toDateInput } from '../../../core/util/date.util';
import { MapPreviewService } from '../../../core/util/map-preview.service';
import { isGoogleMapsLink } from '../../../core/util/map-link.util';
import { auditAction, auditSummary } from '../../../core/util/audit.util';
import { ServerFieldError, errorSummary, extractFieldErrors, toFieldErrorList } from '../../../core/util/server-errors';
import { FieldErrs, applicantRules, email as emailRule, mobile as mobileRule, num as numRule, personName, regNo, req, securityRules } from '../../../core/util/enquiry-rules';

type TabKey =
  | 'summary' | 'applicant' | 'loan' | 'security' | 'broker'
  | 'documents' | 'initial_offer' | 'communications' | 'audit' | 'enquiry';

/** Application detail — 10-tab case view (Summary → Enquiry Details), wired to /api/applications/:id. */
@Component({
  selector: 'app-application-detail',
  standalone: true,
  imports: [FormsModule, UiModalComponent, UiFileUploadComponent, UiTimelineComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './application-detail.component.html',
  styleUrl: './application-detail.component.scss',
})
export class ApplicationDetailComponent implements OnInit {
  private readonly api = inject(ApplicationsService);
  private readonly perms = inject(PermissionsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toastr = inject(ToastrService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly maps = inject(MapPreviewService);

  // ---- signed offer + application form (uploaded at convert) — shown on the detail page
  // before the case is accepted into underwriting, the same card Underwriting shows. ----
  readonly signedOpen = signal(false);
  readonly signedUrl = signal<SafeResourceUrl | null>(null);
  readonly signedLoading = signal(false);
  readonly signedInline = signal(true);
  private signedRawUrl: string | null = null;
  private signedLoadedFor: number | null = null;
  private readonly signedCache = new Map<number, { raw: string; safe: SafeResourceUrl; inline: boolean }>();
  readonly signedDocs = signal<{ id: number; file_name: string }[]>([]);
  readonly signedSel = signal<number | null>(null);
  signedSelName(): string { return this.signedDocs().find((d) => d.id === this.signedSel())?.file_name || ''; }
  /** Signed offer documents = any application document carrying the SIGNED_OFFER type, plus signed_offer_doc_id. */
  private initSignedOffer(a: ApplicationDetail): void {
    const isSummary = (d: ApplicationDocument) =>
      String(d.document_type_code || '').toUpperCase() === 'DEAL_SUMMARY' || /^Credit Deal Summary/i.test(d.file_name || '');
    const docs = (a.documents || [])
      .filter((d) => isSummary(d) || String(d.document_type_code || '').toUpperCase() === 'SIGNED_OFFER' || d.app_document_id === a.signed_offer_doc_id)
      // Credit Deal Summary first, then the signed offer / application form.
      .sort((x, y) => (isSummary(x) === isSummary(y) ? 0 : isSummary(x) ? -1 : 1))
      .map((d) => ({ id: d.app_document_id, file_name: d.file_name }));
    if (!docs.length) { this.signedDocs.set([]); return; }
    if (this.signedLoadedFor === a.application_id) return;
    this.signedLoadedFor = a.application_id;
    this.signedDocs.set(docs);
    // Client 06-10-2026: the document viewer stays collapsed by default; it opens
    // only when the user clicks "View Document". The first doc is still preloaded so
    // it appears instantly on click.
    this.destroyRef.onDestroy(() => { for (const v of this.signedCache.values()) URL.revokeObjectURL(v.raw); });
    this.showSigned(docs[0].id);
  }
  showSigned(docId: number): void {
    this.signedSel.set(docId);
    const hit = this.signedCache.get(docId);
    if (hit) { this.signedRawUrl = hit.raw; this.signedInline.set(hit.inline); this.signedUrl.set(hit.safe); return; }
    const a = this.app(); if (!a) return;
    const name = this.signedDocs().find((d) => d.id === docId)?.file_name || '';
    this.signedLoading.set(true); this.signedUrl.set(null);
    this.api.downloadDocument(a.application_id, docId)
      .pipe(catchError(() => { this.signedLoading.set(false); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => {
        this.signedLoading.set(false);
        if (!blob || this.signedSel() !== docId) return;
        const raw = URL.createObjectURL(blob);
        const inline = /pdf|image\//i.test(blob.type || '') || /\.(pdf|png|jpe?g)$/i.test(name);
        const isPdf = /pdf/i.test(blob.type || '') || /\.pdf$/i.test(name);
        const safe = this.sanitizer.bypassSecurityTrustResourceUrl(raw + (isPdf ? '#toolbar=0&navpanes=0&view=FitH' : ''));
        this.signedCache.set(docId, { raw, safe, inline });
        this.signedRawUrl = raw; this.signedInline.set(inline); this.signedUrl.set(safe);
      });
  }
  openSignedInTab(): void { if (this.signedRawUrl) window.open(this.signedRawUrl, '_blank'); }
  downloadSigned(): void {
    if (!this.signedRawUrl) return;
    const link = document.createElement('a');
    link.href = this.signedRawUrl; link.download = this.signedSelName() || 'signed-offer.pdf';
    document.body.appendChild(link); link.click(); link.remove();
  }
  /** When embedded (e.g. inside the Underwriting detail before acceptance), load by this id and hide the page header. */
  @Input() applicationId?: number | string;
  @Input() embedded = false;

  readonly app = signal<ApplicationDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly tab = signal<TabKey>('summary');

  // ---- reference data + inline action forms ----
  readonly options = signal<ApplicationFormOptions | null>(null);
  readonly docModalOpen = signal(false);
  readonly uploadingDoc = signal(false);
  pickedFile: File | null = null;
  pickedFileName = '';
  pickedBase64 = '';
  newDocTypeId: number | null = null;

  readonly docEditOpen = signal(false);
  readonly savingDoc = signal(false);
  editDocId: number | null = null;
  editDocTypeId: number | null = null;
  editVerifiedStatus: string | null = null;
  editDocFile: File | null = null;
  editDocFileName = '';
  editDocBase64 = '';

  readonly showTaskForm = signal(false);
  readonly savingTask = signal(false);
  taskDraft: { task_type: string; description: string; due_date: string; assigned_to: number | null } =
    { task_type: '', description: '', due_date: '', assigned_to: null };

  readonly showCommForm = signal(false);
  readonly savingComm = signal(false);
  commDraft: { channel: string; to_party: string; subject: string; body: string } =
    { channel: 'Email', to_party: '', subject: '', body: '' };

  readonly returnOpen = signal(false);
  readonly returnMode = signal<'revert' | 'bdm'>('revert');
  readonly savingReturn = signal(false);
  returnReason = '';
  returnComments = '';
  readonly returnReasons = ['Return to Sales', 'Return for Documents', 'Return for KYC', 'Return for Valuation', 'Return for Credit Information'];
  // Rejection reasons come from the Rejection Reason master (active rows only) via options().

  readonly rejectOpen = signal(false);
  readonly savingReject = signal(false);
  rejectReason = '';
  rejectComments = '';
  readonly acting = signal(false);
  readonly acceptOpen = signal(false);
  readonly savingAccept = signal(false);
  acceptComments = '';

  readonly requestInfoOpen = signal(false);
  reqSendTo = 'Broker';
  reqItems = { bank: false, address: false, income: false, accounts: false, assets: false, creditFile: false };
  reqComments = '';
  reqDueDate = '';
  /** Today as yyyy-mm-dd (local) — used as the min for Request Info due dates. */
  get todayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
  }

  readonly showNote = signal(false);
  readonly savingNote = signal(false);
  noteDraft = '';

  /**
   * Tabs — names match the Enquiry detail tabs (client 29-09-2026). The per-tab Roles
   * modules were removed: every tab shows for Application List VIEW or All Applications
   * VIEW. Tasks + Communications tabs removed.
   */
  private readonly ALL_TABS: { key: TabKey; label: string }[] = [
    { key: 'summary', label: 'Summary' },
    { key: 'applicant', label: 'Applicant Details' },
    { key: 'loan', label: 'Loan Request' },
    { key: 'security', label: 'Security & Property' },
    { key: 'broker', label: 'Source & Broker' }, // same name as the enquiry tab (client 15-10-2026)
    { key: 'documents', label: 'Documents' },
    { key: 'initial_offer', label: 'Initial Offer' },
    { key: 'communications', label: 'Communications' },
    { key: 'audit', label: 'Audit' },
    { key: 'enquiry', label: 'Original Enquiry' },
  ];
  readonly canViewApp = computed(() => this.p(this.M.list, 'view') || this.p(this.M.all, 'view'));
  /** Tabs the active role may VIEW (super admin / perms not loaded yet: all). */
  /** Client 21-10-2026: once the case is in Portfolio (application Completed) the
   *  Security & Property details are hidden here and in Underwriting. */
  readonly inPortfolio = computed(() => String(this.app()?.status_code || '').toUpperCase() === 'COMPLETED');
  readonly tabs = computed(() => (this.canViewApp() ? this.ALL_TABS.filter((t) => !(t.key === 'security' && this.inPortfolio())) : []));
  /** If the selected tab is not viewable, fall back to the first viewable one. */
  readonly activeTab = computed<TabKey | null>(() => {
    const list = this.tabs();
    return list.some((t) => t.key === this.tab()) ? this.tab() : (list[0]?.key ?? null);
  });
  private p(module: string, action: string): boolean {
    return !this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.can(module, action);
  }

  // ---- role permissions (matrix-aligned; super admin bypasses) ----
  private readonly M = {
    submit: 'APPLICATIONS.SUBMIT_TO_UNDERWRITING',
    list: 'APPLICATIONS.APPLICATION_LIST',
    all: 'APPLICATIONS.ALL_APPLICATIONS',
  };
  /** Edit the case = Application List > EDIT (Sales/BDM, Head Sales, Underwriter). */
  readonly canWorkCase = computed(() => this.p(this.M.list, 'edit'));
  /** Accept (Draft -> Submitted) / Send to Underwriting = Submit to Underwriting > APPROVE. */
  readonly canSubmit = computed(() =>
    !this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.can(this.M.submit, 'approve'));
  readonly canAdvance = computed(() => this.canSubmit() || this.canWorkCase());
  /** "Go to Underwriting" button: only when the role has Underwriting > VIEW (UNDERWRITING.CASE.view). */
  readonly canGoUnderwriting = computed(() =>
    !this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.can('UNDERWRITING.CASE', 'view'));
  /** Underwriter-side accept of a submitted case (UNDERWRITING.CASE.approve). */
  readonly canAcceptUw = computed(() =>
    !this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.can('UNDERWRITING.CASE', 'approve'));
  /**
   * Header forward button (Accept / Send to Underwriting) hands the case over, so
   * it needs SUBMIT_TO_UNDERWRITING.approve — case-edit rights alone are NOT enough
   * (mirrors the API check in application.controller canMoveTo).
   */
  canForward(fb: { code: string }): boolean {
    if (fb.code === 'UNDERWRITING') return this.canSubmit() || this.canAcceptUw();
    if (fb.code === 'SUBMITTED') return this.canSubmit();
    return this.canAdvance();
  }
  // Return / Revert on the application screen is only available BEFORE underwriting —
  // i.e. at SUBMITTED (revert to DRAFT / BDM). Client 05-10-2026: once the application
  // has gone to Underwriting it cannot be reverted back here; the underwriter uses
  // "Return to BDM" in the underwriting screen instead.
  readonly canRevert = computed(() => (this.perms.isSuperAdmin() || this.canWorkCase())
    && String(this.app()?.status_code || '').toUpperCase() === 'SUBMITTED');
  /** Stages at which the case is locked for content edits (mirror of API LOCKED_STATUSES). */
  private readonly LOCKED_STATUSES = new Set(['APPROVED', 'LEGAL', 'COMPLETED', 'DECLINED']);
  /** True once the application is APPROVED onward — content edits blocked (super admin bypasses). */
  readonly isLocked = computed(() =>
    !this.perms.isSuperAdmin() && this.LOCKED_STATUSES.has(String(this.app()?.status_code || '').toUpperCase()));
  /** Edit application content (notes/tasks/comms/fields): needs case-edit rights AND an unlocked stage. */
  readonly canEditCase = computed(() => this.canWorkCase() && !this.isLocked());
  /** Request Info stays available until the application is converted (Completed -> loan) or declined —
      not only while content is editable, so it also shows at Approved / Legal. */
  readonly canRequestInfoApp = computed(() => this.canWorkCase()
    && !['COMPLETED', 'DECLINED'].includes(String(this.app()?.status_code || '').toUpperCase()));
  /** Documents: ADD = Upload Document, EDIT = edit / delete a document. */
  /** "Open Enquiry" (Enquiry Details tab) needs Enquiries > Enquiries List > VIEW. */
  readonly canOpenEnquiry = computed(() => this.p('ENQUIRIES.ENQUIRY_LIST', 'view'));
  /** Documents: Application List EDIT = upload / edit, DELETE = delete. */
  readonly canUploadDocs = computed(() => !this.isLocked() && this.p(this.M.list, 'edit'));
  readonly canEditDocs = computed(() => !this.isLocked() && this.p(this.M.list, 'edit'));
  readonly canDeleteDocs = computed(() => !this.isLocked() && this.p(this.M.list, 'delete'));

  // ---- per-tab field editing (Applicant / Loan / Security) ----
  private tabEdit(mod: string): boolean {
    return !this.isLocked() && (!this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.can(mod, 'edit'));
  }
  readonly canEditApplicant = computed(() => this.tabEdit(this.M.list));
  readonly canEditLoan = computed(() => this.tabEdit(this.M.list));
  readonly canEditSecurity = computed(() => this.tabEdit(this.M.list));

  readonly editApplicant = signal(false);
  readonly editLoan = signal(false);
  readonly editSecurity = signal(false);
  readonly savingEdit = signal(false);
  applicantDraft: Record<string, unknown> = {};
  loanDraft: Record<string, unknown> = {};
  securityDraft: Record<string, unknown> = {};

  beginApplicant(a: ApplicationDetail): void {
    const ap = (a.primary_applicant || {}) as Record<string, unknown>;
    const full = [ap['first_name'], ap['last_name']].filter(Boolean).join(' ').trim();
    this.applicantDraft = {
      applicant_name: full,
      applicant_type_id: ap['applicant_type_id'] ?? null, email: ap['email'] ?? '',
      phone: ap['phone'] ?? '', company_name: ap['company_name'] ?? '',
      company_reg_no: ap['company_reg_no'] ?? '',
      dob: toDateInput(ap['dob'] as string | null),
    };
    this.editApplicant.set(true);
  }
  beginLoan(a: ApplicationDetail): void {
    const r = a as unknown as Record<string, unknown>;
    this.loanDraft = {
      product_id: r['product_id'] ?? null, amount_requested: r['amount_requested'] ?? null,
      net_advance: r['net_advance'] ?? null, term_months: r['term_months'] ?? null,
      monthly_fee_pct: r['monthly_fee_pct'] ?? null, arrangement_fee_pct: r['arrangement_fee_pct'] ?? null,
      exit_fee: r['exit_fee'] ?? null, doc_fee: r['doc_fee'] ?? null,
      rolled_interest: r['rolled_interest'] ?? null, gross_redemption: r['gross_redemption'] ?? null,
    };
    this.editLoan.set(true);
  }
  beginSecurity(a: ApplicationDetail): void {
    const s = (a.security || {}) as Record<string, unknown>;
    this.securityDraft = {
      property_address: s['property_address'] ?? '', map_link: s['map_link'] ?? '', valuation_type_id: s['valuation_type_id'] ?? null,
      estimated_value: s['estimated_value'] ?? null, charge_type: s['charge_type'] ?? '', charge_amount: s['charge_amount'] ?? null,
      valuation_status: s['valuation_status'] ?? '', valuation_check: s['valuation_check'] ?? '',
      risk_rating: s['risk_rating'] ?? '', ltv_band: s['ltv_band'] ?? '', legal_check_status: s['legal_check_status'] ?? '',
      // the enquiry's property block, now the application's own editable record
      postcode: s['postcode'] ?? '', property_type: s['property_type'] ?? '',
      tenure: s['tenure'] ?? '', tenure_years: s['tenure_years'] ?? null,
      gdv: s['gdv'] ?? null,
      purchase_price: s['purchase_price'] ?? null,
      purchase_date: toDateInput(s['purchase_date'] as string | null),
      outstanding_loan: s['outstanding_loan'] ?? null,
      repaid_on_completion: s['repaid_on_completion'] ?? null,
      lender: s['lender'] ?? '', added_value: s['added_value'] ?? '',
    };
    this.editSecurity.set(true);
  }

  saveApplicant(a: ApplicationDetail): void {
    const ap = a.primary_applicant as unknown as { applicant_id: number } | null;
    if (!ap) return;
    // Mirror the enquiry: one "Applicant Name" field, split into first/last on save.
    const full = String(this.applicantDraft['applicant_name'] ?? '').trim();
    // Same format checks as the New Enquiry form (client 20-10-2026).
    {
      const errs: FieldErrs = {};
      const t = this.editAppTypeName();
      if (this.showFullName(t)) {
        personName(errs, 'applicant_name', full, 'Applicant name');
        emailRule(errs, 'email', this.applicantDraft['email']);
        mobileRule(errs, 'phone', this.applicantDraft['phone'], 'Phone');
      }
      regNo(errs, 'company_reg_no', this.applicantDraft['company_reg_no']);
      if (this.showClientErrors(errs)) return;
    }
    const sp = full.indexOf(' ');
    const payload: Record<string, unknown> = {
      first_name: sp > 0 ? full.slice(0, sp) : full,
      last_name: sp > 0 ? full.slice(sp + 1) : '',
      email: this.applicantDraft['email'] ?? '',
      phone: this.applicantDraft['phone'] ?? '',
      company_name: this.applicantDraft['company_name'] ?? '',
      company_reg_no: this.applicantDraft['company_reg_no'] ?? '',
      dob: this.applicantDraft['dob'] ?? null,
    };
    this.savingEdit.set(true);
    this.api.updateApplicant(a.application_id, ap.applicant_id, payload)
      .pipe(catchError((e) => { this.savingEdit.set(false); this.showSaveErrors(e); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.savingEdit.set(false); if (r !== null) { this.editApplicant.set(false); this.toastr.success('Applicant updated'); this.reload(a.application_id); } });
  }
  saveLoan(a: ApplicationDetail): void {
    // Same required fields / limits as the New Enquiry form (client 20-10-2026).
    {
      const errs: FieldErrs = {};
      req(errs, 'product_id', this.loanDraft['product_id'], 'Product');
      numRule(errs, 'term_months', this.loanDraft['term_months'], 'Term (months)', 1, 600, true);
      if (this.showClientErrors(errs)) return;
    }
    this.savingEdit.set(true);
    this.api.update(a.application_id, this.loanDraft)
      .pipe(catchError((e) => { this.savingEdit.set(false); this.showSaveErrors(e); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.savingEdit.set(false); if (r !== null) { this.editLoan.set(false); this.toastr.success('Loan details updated'); this.reload(a.application_id); } });
  }
  saveSecurity(a: ApplicationDetail): void {
    const sec = a.security as unknown as { security_id: number } | null;
    if (!sec) return;
    // Same required fields / limits as step 4 of the New Enquiry form (client 20-10-2026).
    {
      const errs: FieldErrs = {};
      securityRules(errs, this.securityDraft);
      if (this.showClientErrors(errs)) return;
    }
    this.savingEdit.set(true);
    this.api.updateSecurity(a.application_id, sec.security_id, this.securityDraft)
      .pipe(catchError((e) => { this.savingEdit.set(false); this.showSaveErrors(e); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.savingEdit.set(false); if (r !== null) { this.editSecurity.set(false); this.toastr.success('Security updated'); this.reload(a.application_id); } });
  }

  private readonly STAGE_FLOW: { code: string; label: string }[] = [
    { code: 'SUBMITTED', label: 'Submit' },
    { code: 'UNDERWRITING', label: 'Send to Underwriting' },
    { code: 'APPROVED', label: 'Approve' },
    { code: 'COMPLETED', label: 'Mark Completed' },
  ];

  ngOnInit(): void {
    const id = this.applicationId ?? this.route.snapshot.paramMap.get('id');
    if (!id) { this.loading.set(false); this.error.set('Missing application id'); return; }
    this.reload(id);
    this.api.formOptions()
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((o) => this.options.set(o));
  }

  private reload(id: string | number): void {
    this.loading.set(true);
    this.api.get(id)
      .pipe(
        catchError((e) => { this.error.set(this.loadErrorMessage(e)); return of(null); }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((a) => { this.app.set(a); this.loading.set(false); if (a) this.initSignedOffer(a); });
  }

  /** The next forward stage button for the header (Figma "Send to Underwriting"). */
  nextStage(a: ApplicationDetail): { code: string; label: string } | null {
    const code = String(a.status_code || '').toUpperCase();
    const idx = this.STAGE_FLOW.findIndex((s) => s.code === code);
    if (code === 'UNDERWRITING') return null; // committee approval happens inside underwriting
    if (idx === -1) return this.STAGE_FLOW[0]; // DRAFT -> Submit
    return this.STAGE_FLOW[idx + 1] || null;
  }

  /** App-detail forward action: Accept (Draft→Submitted) then Send to Underwriting (Submitted→Underwriting). None once in underwriting+. */
  forwardBtn(a: ApplicationDetail): { code: string; label: string } | null {
    const code = String(a.status_code || '').toUpperCase();
    if (code === 'DRAFT' || code === '') return { code: 'SUBMITTED', label: 'Accept' };
    if (code === 'SUBMITTED') return { code: 'UNDERWRITING', label: 'Send to Underwriting' };
    return null;
  }

  advance(a: ApplicationDetail, code: string): void {
    if (this.acting()) return; this.acting.set(true);
    this.api.changeStatus(a.application_id, code)
      .pipe(catchError((e) => { this.toastr.error(e?.error?.message || 'Could not change status'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.toastr.success('Status updated'); this.reload(a.application_id); } });
  }
  /** Previous stage in the pipeline (for Return / Revert). */
  prevStage(a: ApplicationDetail): { code: string; label: string } | null {
    const code = String(a.status_code || '').toUpperCase();
    const idx = this.STAGE_FLOW.findIndex((s) => s.code === code);
    if (idx <= 0) return null;
    return this.STAGE_FLOW[idx - 1];
  }

  /** Open the Return/Revert popup (Figma: reason dropdown + comments). */
  openReturn(a: ApplicationDetail, mode: 'revert' | 'bdm'): void {
    this.returnMode.set(mode);
    this.returnReason = '';
    this.returnComments = '';
    this.returnOpen.set(true);
  }
  confirmReturn(a: ApplicationDetail): void {
    // Client 05-10-2026 (#16): reason dropdown removed; comments optional.
    const prev = this.prevStage(a);
    const target = this.returnMode() === 'bdm' ? 'DRAFT' : (prev ? prev.code : 'DRAFT');
    const reason = this.returnComments.trim() ? `Returned — ${this.returnComments.trim()}` : 'Returned';
    this.savingReturn.set(true);
    this.api.changeStatus(a.application_id, target, reason)
      .pipe(catchError((e) => { this.savingReturn.set(false); this.toastr.error(e?.error?.message || 'Could not return this application.'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        if (r === null) return;
        const finish = () => {
          this.savingReturn.set(false);
          this.returnOpen.set(false);
          this.toastr.success('Application returned' + (this.returnMode() === 'bdm' ? ' to BDM' : ''));
          this.reload(a.application_id);
        };
        // log the note (if any) so the receiving team sees the context
        if (this.returnComments.trim()) {
          this.api.addNote(a.application_id, `Returned: ${this.returnComments.trim()}`)
            .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe(finish);
        } else { finish(); }
      });
  }

  /** SUBMITTED = awaiting underwriter acceptance (Figma review banner). */
  isAwaitingReview(a: ApplicationDetail): boolean {
    return String(a.status_code || '').toUpperCase() === 'SUBMITTED';
  }
  /** Accept the case into underwriting. */
  acceptCase(a: ApplicationDetail): void {
    this.acceptComments = '';
    this.acceptOpen.set(true);
  }
  confirmAccept(a: ApplicationDetail): void {
    if (this.savingAccept()) return;
    this.savingAccept.set(true);
    const reason = this.acceptComments.trim() ? ('Case accepted — ' + this.acceptComments.trim()) : 'Case accepted';
    this.api.changeStatus(a.application_id, 'UNDERWRITING', reason)
      .pipe(catchError((e) => { this.savingAccept.set(false); this.toastr.error(e?.error?.message || 'Could not accept case'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        if (r === null) return;
        const done = () => { this.savingAccept.set(false); this.acceptOpen.set(false); this.toastr.success('Case accepted — moved to Underwriting'); this.reload(a.application_id); };
        if (this.acceptComments.trim()) {
          this.api.addNote(a.application_id, 'Case accepted: ' + this.acceptComments.trim())
            .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe(done);
        } else { done(); }
      });
  }
  /** Reject the application. */
  reject(a: ApplicationDetail): void {
    this.rejectReason = '';
    this.rejectComments = '';
    this.rejectOpen.set(true);
  }
  confirmReject(a: ApplicationDetail): void {
    if (!this.rejectReason) { this.toastr.error('Select a rejection reason.'); return; }
    if (!this.rejectComments.trim()) { this.toastr.error('Comments are required.'); return; }
    const reason = `${this.rejectReason} — ${this.rejectComments.trim()}`;
    this.savingReject.set(true);
    this.api.changeStatus(a.application_id, 'DECLINED', reason)
      .pipe(catchError((e) => { this.savingReject.set(false); this.toastr.error(e?.error?.message || 'Could not reject this application.'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        if (r === null) return;
        this.api.addNote(a.application_id, `Rejected (${this.rejectReason}): ${this.rejectComments.trim()}`)
          .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
          .subscribe(() => {
            this.savingReject.set(false);
            this.rejectOpen.set(false);
            this.toastr.success('Application rejected');
            this.reload(a.application_id);
          });
      });
  }

  /** Request Info opens a pre-filled communication to the broker/applicant. */
  openRequestInfo(_a: ApplicationDetail): void {
    this.reqSendTo = 'Broker';
    this.reqItems = { bank: false, address: false, income: false, accounts: false, assets: false, creditFile: false };
    this.reqComments = ''; this.reqDueDate = '';
    this.requestInfoOpen.set(true);
  }
  submitRequestInfo(a: ApplicationDetail): void {
    if (this.reqDueDate && this.reqDueDate < this.todayStr) { this.toastr.error('Due date cannot be in the past.'); return; }
    const items: string[] = [];
    if (this.reqItems.bank) items.push('Bank Statements');
    if (this.reqItems.address) items.push('Proof Of Address');
    if (this.reqItems.income) items.push('Evidence Of Income');
    if (this.reqItems.accounts) items.push('Company Accounts');
    if (this.reqItems.assets) items.push('Asset & Liability Statement');
    if (this.reqItems.creditFile) items.push('Credit File');
    if (!items.length && !this.reqComments.trim()) { this.toastr.error('Select an item or add comments'); return; }
    // Client 09-10-2026: actually e-mail the chosen recipient (both properties listed; BDM
    // cc'd when sent to the broker) instead of only writing a note.
    this.api.requestInfo(a.application_id, {
      send_to: this.reqSendTo,
      items,
      comments: this.reqComments.trim(),
      due_date: this.reqDueDate || null,
    })
      .pipe(catchError((e) => { this.toastr.error(e?.error?.message || 'Could not send the request.'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        if (r === null) return;
        this.requestInfoOpen.set(false);
        const rr = r as { sent_to?: string; cc?: string[] };
        const ccNote = this.reqSendTo === 'Broker' ? ' (BDM cc\'d)' : '';
        this.toastr.success('Information request e-mailed' + (rr && rr.sent_to ? ' to ' + rr.sent_to : '') + ccNote, 'Request Sent');
        this.reload(a.application_id);
      });
  }

  // ---- Tasks ----
  submitTask(a: ApplicationDetail): void {
    const d = this.taskDraft;
    if (!d.description.trim()) { this.toastr.info('Enter a task description'); return; }
    this.savingTask.set(true);
    this.api.addTask(a.application_id, { ...d, status: 'Outstanding' })
      .pipe(catchError((e) => { this.toastr.error(e?.error?.message || 'Could not add task'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.savingTask.set(false);
        if (r !== null) {
          this.toastr.success('Task added');
          this.taskDraft = { task_type: '', description: '', due_date: '', assigned_to: null };
          this.showTaskForm.set(false);
          this.reload(a.application_id);
        }
      });
  }
  toggleTaskDone(a: ApplicationDetail, t: { task_id: number; status: string }): void {
    const status = t.status === 'Completed' ? 'Outstanding' : 'Completed';
    this.api.updateTask(a.application_id, t.task_id, { status })
      .pipe(catchError(() => { this.toastr.error('Could not update task'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r !== null) { this.reload(a.application_id); } });
  }

  // ---- Communications ----
  submitComm(a: ApplicationDetail): void {
    // Client 06-10-2026: single free-text box, same as the enquiry detail page.
    const text = (this.commDraft.body || '').trim();
    if (!text) { this.toastr.info('Write a note first'); return; }
    this.savingComm.set(true);
    this.api.addCommunication(a.application_id, { channel: 'Note', to_party: '', subject: '', body: text })
      .pipe(catchError((e) => { this.toastr.error(e?.error?.message || 'Could not log communication'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.savingComm.set(false);
        if (r !== null) {
          this.toastr.success('Communication logged');
          this.commDraft = { channel: 'Note', to_party: '', subject: '', body: '' };
          this.showCommForm.set(false);
          this.reload(a.application_id);
        }
      });
  }

  // ---- Notes ----
  submitNote(a: ApplicationDetail): void {
    const text = this.noteDraft.trim();
    if (!text) { this.toastr.info('Write a note first'); return; }
    this.savingNote.set(true);
    this.api.addNote(a.application_id, text)
      .pipe(catchError((e) => { this.toastr.error(e?.error?.message || 'Could not add note'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.savingNote.set(false);
        if (r !== null) { this.toastr.success('Note added'); this.noteDraft = ''; this.showNote.set(false); this.reload(a.application_id); }
      });
  }

  // ---- Documents ----
  openDocModal(): void {
    this.pickedFile = null; this.pickedFileName = ''; this.pickedBase64 = ''; this.newDocTypeId = null;
    this.docModalOpen.set(true);
  }
  onFilePicked(f: File | null): void {
    if (!f) { this.pickedFile = null; this.pickedFileName = ''; this.pickedBase64 = ''; return; }
    this.pickedFile = f; this.pickedFileName = f.name;
    const reader = new FileReader();
    reader.onload = () => { this.pickedBase64 = String(reader.result || ''); };
    reader.readAsDataURL(f);
  }
  uploadDoc(a: ApplicationDetail): void {
    if (!this.pickedFile || !this.pickedBase64) { this.toastr.info('Choose a file to upload'); return; }
    this.uploadingDoc.set(true);
    this.api.uploadDocument(a.application_id, { file_name: this.pickedFile.name, content_base64: this.pickedBase64, document_type_id: this.newDocTypeId })
      .pipe(catchError((e) => { this.uploadingDoc.set(false); this.toastr.error(e?.error?.message || 'Upload failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        if (r === null) return;
        this.uploadingDoc.set(false);
        this.pickedFile = null; this.pickedFileName = ''; this.pickedBase64 = ''; this.newDocTypeId = null;
        this.docModalOpen.set(false);
        this.toastr.success('Document uploaded');
        this.reload(a.application_id);
      });
  }
  openDocEdit(d: ApplicationDocument): void {
    this.editDocId = d.app_document_id;
    this.editDocTypeId = d.document_type_id ?? null;
    this.editVerifiedStatus = d.verified_status ?? null;
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
  submitDocEdit(a: ApplicationDetail): void {
    if (!this.editDocId) return;
    this.savingDoc.set(true);
    const body: Record<string, unknown> = {};
    if (this.editDocTypeId !== null) body['document_type_id'] = this.editDocTypeId;
    if (this.editVerifiedStatus) body['verified_status'] = this.editVerifiedStatus;
    if (this.editDocFile && this.editDocBase64) { body['content_base64'] = this.editDocBase64; body['file_name'] = this.editDocFile.name; }
    this.api.updateDocument(a.application_id, this.editDocId, body)
      .pipe(catchError((e) => { this.savingDoc.set(false); this.toastr.error(e?.error?.message || 'Could not update document'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        if (r === null) return;
        this.savingDoc.set(false); this.docEditOpen.set(false);
        this.toastr.success('Document updated');
        this.reload(a.application_id);
      });
  }
  deleteDoc(a: ApplicationDetail, d: ApplicationDocument): void {
    if (!confirm(`Delete "${d.file_name}"? This can be restored by an administrator.`)) return;
    this.api.deleteDocument(a.application_id, d.app_document_id)
      .pipe(catchError((e) => { this.toastr.error(e?.error?.message || 'Delete failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r !== null) { this.toastr.success('Document deleted'); this.reload(a.application_id); } });
  }
  preview(a: ApplicationDetail, docId: number): void {
    this.api.downloadDocument(a.application_id, docId)
      .pipe(catchError(() => { this.toastr.error('Preview failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => { if (blob) { window.open(URL.createObjectURL(blob), '_blank'); } });
  }

  download(a: ApplicationDetail, docId: number): void {
    this.api.downloadDocument(a.application_id, docId)
      .pipe(catchError(() => { this.toastr.error('Download failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = ''; link.click();
        URL.revokeObjectURL(url);
      });
  }

  /** Distinguish not-found (404) from auth (401/403) so the copy is honest. */
  loadErrorMessage(e: { status?: number } | null): string {
    const code = e && typeof e.status === 'number' ? e.status : 0;
    if (code === 404) return 'Application not found.';
    if (code === 401) return 'Your session has expired — please sign in again.';
    if (code === 403) return 'You do not have permission to view this application.';
    return 'Could not load this application. Please try again.';
  }

  back(): void { void this.router.navigate(['/applications']); }
  openEnquiry(id: number): void { void this.router.navigate(['/enquiries', id]); }

  tone = applicationTone;
  applicantName(a: ApplicationDetail): string {
    const ap = a.primary_applicant;
    const fromPa = ap ? (ap.company_name || [ap.first_name, ap.last_name].filter(Boolean).join(' ').trim()) : '';
    // Fall back to the server-computed name (enquiry applicant/company) so a
    // blank/missing primary applicant no longer shows "Unknown".
    return fromPa || a.applicant_name || 'Unknown';
  }
  initials(name: string): string {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase() || '?';
  }
  /** Open the underwriting case for this application (mirror of "View Application"). */
  goToUnderwriting(a: ApplicationDetail): void {
    const id = (a as unknown as Record<string, unknown>)['underwriting_case_id'];
    if (id) this.router.navigate(['/underwriting', id]);
  }

  // ---- Security map (mirror the Enquiry Security tab's Google Maps link) ----
  secMapUrl(sec: { map_link?: string | null; property_address?: string | null; postcode?: string | null }): SafeResourceUrl | null {
    return this.maps.embed(sec.map_link ?? null, sec.property_address ?? null, sec.postcode ?? null);
  }
  secMapOpenUrl(sec: { map_link?: string | null; property_address?: string | null; postcode?: string | null }): string | null {
    return this.maps.openUrl(sec.map_link ?? null, sec.property_address ?? null, sec.postcode ?? null);
  }
  editSecMapUrl(): SafeResourceUrl | null {
    return this.maps.embed(String(this.securityDraft['map_link'] ?? ''), String(this.securityDraft['property_address'] ?? ''), String(this.securityDraft['postcode'] ?? ''));
  }
  editSecMapLinkInvalid(): boolean {
    const v = String(this.securityDraft['map_link'] ?? '').trim();
    return !!v && !isGoogleMapsLink(v);
  }

  // ---- applicant type-conditional display (mirror the Enquiry Prospect tab) ----
  typeNameById(id: unknown): string {
    const n = Number(id);
    return (this.options()?.applicantTypes || []).find((t) => Number(t.id) === n)?.name || '';
  }
  /** Enquiry shows only Individual + Company; mirror that on the application. */
  prospectTypes(): { id: number; name: string }[] {
    const all = (this.options()?.applicantTypes || []);
    const four = all.filter((t) => /scotland|england|wales/i.test(t.name));
    // Keep the application's currently-saved type selectable even if it predates the four
    // jurisdiction types, so the Type dropdown preselects instead of going blank.
    const cur = this.applicantDraft['applicant_type_id'];
    const curId = cur == null ? null : Number(cur);
    if (curId != null && !four.some((t) => Number(t.id) === curId)) {
      const match = all.find((t) => Number(t.id) === curId);
      if (match) return [match, ...four];
    }
    return four;
  }

  // ---- Company directors: EDIT only (no add/remove). Saves back to the one
  //      enquiry record, so enquiry + application both reflect the change.
  readonly editingDirectorId = signal<number | null>(null);
  directorDraft: Record<string, unknown> = {};
  beginDirector(ea: EnquiryApplicantSnapshot): void {
    this.directorDraft = {
      full_name: ea['full_name'] ?? '', dob: toDateInput(ea['dob'] as string | null),
      nationality: ea['nationality'] ?? '', address: ea['address'] ?? '',
      time_at_address: ea['time_at_address'] ?? '', email: ea['email'] ?? '', mobile: ea['mobile'] ?? '',
      owns_home: ea['owns_home'] == null ? '' : (ea['owns_home'] ? 'true' : 'false'), occupation: ea['occupation'] ?? '',
      employer_name: ea['employer_name'] ?? '', business_address: ea['business_address'] ?? '',
      length_of_service: ea['length_of_service'] ?? '', relationship: ea['relationship'] ?? '',
      shareholding_pct: ea['shareholding_pct'] ?? null,
      prev_bridging: ea['prev_bridging'] == null ? '' : (ea['prev_bridging'] ? 'true' : 'false'),
      prev_bridging_lender: ea['prev_bridging_lender'] ?? '',
    };
    this.editingDirectorId.set(ea.enquiry_applicant_id);
  }
  cancelDirector(): void { this.editingDirectorId.set(null); this.directorDraft = {}; }
  saveDirector(a: ApplicationDetail, ea: EnquiryApplicantSnapshot): void {
    {
      const errs: FieldErrs = {};
      applicantRules(errs, this.directorDraft);
      if (this.showClientErrors(errs)) return;
    }
    this.savingEdit.set(true);
    this.api.updateDirector(a.application_id, ea.enquiry_applicant_id, this.directorDraft)
      .pipe(catchError((e) => { this.savingEdit.set(false); this.showSaveErrors(e); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.savingEdit.set(false); if (r !== null) { this.editingDirectorId.set(null); this.toastr.success('Director updated'); this.reload(a.application_id); } });
  }
  editAppTypeName(): string { return this.typeNameById(this.applicantDraft['applicant_type_id']); }
  showCompanyName(name: string | null | undefined): boolean { return /compan|limited|ltd/i.test(String(name || '')); }
  // Field visibility by borrower kind — works for the four jurisdiction types AND the legacy
  // Individual/Company/Joint/Multi-Party names.
  showFullName(name: string | null | undefined): boolean { return !!name && !this.showCompanyName(name); }
  showDob(name: string | null | undefined): boolean { return !!name && !this.showCompanyName(name); }
  showRegNo(name: string | null | undefined): boolean { return this.showCompanyName(name); }

  // ---- Initial Offer tab (mirror of the enquiry's offer/indicative history) ----
  appOffers(a: ApplicationDetail): ApplicationOffer[] { return a.offers || []; }
  appIndicatives(a: ApplicationDetail): ApplicationIndicative[] { return a.indicatives || []; }
  displayOffer(a: ApplicationDetail): ApplicationOffer | null {
    const o = this.appOffers(a);
    return o.find((x) => x.status === 'Accepted') || o.find((x) => x.status === 'Sent') || o[0] || null;
  }
  private indVer(a: ApplicationDetail, indId: number | null): number | null {
    if (indId == null) return null;
    return this.appIndicatives(a).find((i) => i.enquiry_indicative_id === indId)?.version_no ?? null;
  }
  acceptedOfferIndVer(a: ApplicationDetail): number | null {
    const acc = this.appOffers(a).find((x) => x.status === 'Accepted');
    return acc ? this.indVer(a, acc.indicative_id) : null;
  }
  offerIndVer(a: ApplicationDetail, o: ApplicationOffer): number | null { return this.indVer(a, o.indicative_id); }
  acceptedIndIdApp(a: ApplicationDetail): number | null {
    const acc = this.appOffers(a).find((x) => x.status === 'Accepted');
    return acc ? acc.indicative_id : null;
  }
  offerStatusLabel(a: ApplicationDetail): string {
    const d = this.displayOffer(a);
    return d ? d.status : '—';
  }
  /** Preview a source-enquiry document (Documents tab, "From Enquiry" list). */
  previewEnquiryDoc(a: ApplicationDetail, docId: number): void {
    this.api.downloadOfferDoc(a.application_id, docId)
      .pipe(catchError(() => { this.toastr.error('Preview failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => { if (blob) { window.open(URL.createObjectURL(blob as Blob), '_blank'); } });
  }
  downloadOfferDoc(a: ApplicationDetail, docId: number | null, name: string): void {
    if (!docId) return;
    this.api.downloadOfferDoc(a.application_id, docId)
      .pipe(catchError(() => { this.toastr.error('Download failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob as Blob);
        const link = document.createElement('a');
        link.href = url; link.download = name || 'document.pdf'; link.click();
        URL.revokeObjectURL(url);
      });
  }

  /* ---- server validation feedback ---------------------------------- */

  readonly fieldErrors = signal<Record<string, string>>({});
  readonly fieldErrorList = signal<ServerFieldError[]>([]);

  private readonly FIELD_LABELS: Record<string, string> = {
    amount_requested: 'Gross loan', term_months: 'Term (months)',
    first_name: 'First name', last_name: 'Last name', company_reg_no: 'Company reg no.',
    property_address: 'Security address', estimated_value: 'Estimated value',
    gdv: 'GDV', ltv_pct: 'LTV %', purchase_price: 'Purchase price',
    outstanding_loan: 'Outstanding loan', added_value: 'Added value',
  };

  /** Show WHICH fields the server rejected, not just that something failed. */
  private showSaveErrors(e: unknown): void {
    const errors = extractFieldErrors(e);
    this.fieldErrors.set(errors);
    const list = toFieldErrorList(errors, this.FIELD_LABELS);
    this.fieldErrorList.set(list);
    const msg = (e as { error?: { message?: string } })?.error?.message;
    this.toastr.error(list.length ? errorSummary(list) : (msg || 'Save failed'), 'Save failed');
  }

  /** Client-side check failed: show the same "fields need attention" box + toast as a server
   *  rejection. Returns true when there were errors (caller stops the save). */
  private showClientErrors(errs: FieldErrs): boolean {
    const keys = Object.keys(errs);
    if (!keys.length) { this.clearFieldErrors(); return false; }
    this.fieldErrors.set(errs);
    const list: ServerFieldError[] = keys.map((k) => ({ field: k, label: '', message: errs[k] }));
    this.fieldErrorList.set(list);
    this.toastr.error(keys.map((k) => errs[k]).join(' · '), 'Save failed');
    return true;
  }

  /** Inline message for one field in an edit form. */
  fErr(name: string): string { return this.fieldErrors()[name] || ''; }

  private clearFieldErrors(): void { this.fieldErrors.set({}); this.fieldErrorList.set([]); }

  statusChip(v: string | null | undefined): string {
    const s = String(v || '').toLowerCase();
    if (['verified', 'passed', 'accepted', 'completed', 'clear'].some((k) => s.includes(k))) return 'ok';
    if (['pending', 'in progress', 'review', 'instructed', 'outstanding'].some((k) => s.includes(k))) return 'pending';
    if (['failed', 'declined', 'rejected'].some((k) => s.includes(k))) return 'fail';
    return '';
  }
  auditAction = auditAction;
  auditSummary = auditSummary;
  /** Date only, house format dd-mm-yyyy - same as the enquiry screens (client 15-10-2026). */
  dOnly(d: string | null | undefined): string {
    if (!d) return '—';
    return formatDate(String(d));
  }
  /** Individual applicant: name / email / phone / DOB live in the Primary Applicant card, so
   *  the applicant row does not repeat them (client 15-10-2026, same as the enquiry). */
  hideRepeatedContact(a: ApplicationDetail, ea: { is_primary?: unknown }): boolean {
    return !this.showCompanyName(a.primary_applicant?.applicant_type_name) && !!ea.is_primary;
  }
  repLabel(v: string | null | undefined): string { return v === 'dual' ? 'Dual Representation' : (v === 'single' ? 'Single Representation' : '—'); }
  yesNo(v: unknown): string { return v == null || v === '' ? '—' : (v === true || v === 1 || v === '1' || v === 'true' ? 'Yes' : 'No'); }

  /** Agreed offer terms snapshot carried over on convert (null for older / manual applications). */
  agreed(a: ApplicationDetail): Record<string, unknown> | null {
    const t = (a as unknown as Record<string, unknown>)['agreed_terms'];
    return t && typeof t === 'object' ? (t as Record<string, unknown>) : null;
  }
  /** Numeric field from the terms snapshot. */
  tn(t: Record<string, unknown> | null | undefined, k: string): number | null { return t ? this.num(t[k]) : null; }
  /** Client 12-10-2026: show a property address with its postcode appended when present
   *  (and not already contained in the address). */
  addrPc(address: unknown, postcode: unknown): string {
    const a = String(address ?? '').trim();
    const p = String(postcode ?? '').trim();
    if (!a) return '—';
    if (!p) return a;
    return a.replace(/\s/g, '').toUpperCase().includes(p.replace(/\s/g, '').toUpperCase()) ? a : `${a}, ${p}`;
  }
  /** Broker's share of the arrangement fee — the "of which £X is payable to <broker>" amount
   *  (loan_offer.pdf). Uses the stored broker_fee_amount, else derives it from the arrangement
   *  fee and the entered broker %/£ so older saved snapshots still show it. */
  arrangementToBroker(t: Record<string, unknown> | null | undefined): number | null {
    if (!t) return null;
    const stored = this.tn(t, 'broker_fee_amount');
    if (stored != null) return stored;
    const arr = this.tn(t, 'arrangement_fee');
    const v = this.tn(t, 'broker_fee_value');
    if (arr == null || v == null) return null;
    const isPct = t['broker_fee_is_pct'] !== false;
    const amt = isPct ? arr * Math.min(v, 100) / 100 : v;
    return Math.min(amt, arr);
  }
  num(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v); return Number.isFinite(n) ? n : null;
  }
  /** Net total of the drawdowns — from the agreed terms if stored, else summed from the rows. */
  drawdownsNetTotal(a: ApplicationDetail): number | null {
    const stored = this.tn(this.agreed(a), 'drawdowns_net_total');
    if (stored != null) return stored;
    const rows = this.drawdowns(a);
    const sum = rows.reduce((acc, d) => acc + (d.net ?? 0), 0);
    return rows.some((d) => d.net != null) ? sum : null;
  }
  drawdowns(a: ApplicationDetail): { month: number | null; gross: number | null; net: number | null }[] {
    const list = this.agreed(a)?.['drawdowns'];
    return Array.isArray(list)
      ? list.map((d: Record<string, unknown>) => ({ month: this.num(d['month']), gross: this.num(d['gross']), net: this.num(d['net']) }))
      : [];
  }
  /** Security rows after the main one (other securities ticked on the offer). */
  /** '1st' / '2nd' -> "1st legal charge" / "2nd legal charge" (client 15-10-2026). */
  chargeText(v: unknown): string {
    const t = String(v ?? '').trim().toLowerCase();
    if (t.startsWith('2nd')) return '2nd legal charge';
    if (t.startsWith('1st')) return '1st legal charge';
    return t ? String(v) : '—';
  }
  otherSecurities(a: ApplicationDetail): Record<string, unknown>[] {
    const list = (a as unknown as Record<string, unknown>)['securities'];
    return Array.isArray(list) ? (list as Record<string, unknown>[]).slice(1) : [];
  }
  /**
   * Gross Loan + actual Net for the header and Loan Summary (client 15-10-2026). The
   * basis chosen on the enquiry is listed first. amount_requested is the gross unless it
   * is still the typed net (amount_basis 'Net', no offer yet) - then only Net shows.
   */
  loanAmounts(a: ApplicationDetail): { label: string; value: number }[] {
    const gross = a.amount_basis === 'Net' ? null : (a.amount_requested ?? null);
    const net = a.net_loan ?? (a.amount_basis === 'Net' ? a.amount_requested : null) ?? null;
    const g = gross != null ? { label: 'Gross Loan', value: Number(gross) } : null;
    const n = net != null ? { label: 'Net Loan', value: Number(net) } : null;
    return (a.loan_basis === 'Net' ? [n, g] : [g, n]).filter((x): x is { label: string; value: number } => !!x);
  }

  money(v: number | null | undefined): string {
    if (v == null) return '—';
    const n = Number(v);
    const dp = Number.isInteger(n) ? 0 : 2;
    return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: 2 });
  }
  pct(v: number | null | undefined): string {
    if (v == null) return '—';
    const n = Number(v);
    return (Number.isInteger(n) ? n : +n.toFixed(2)) + '%';
  }
  date(v: string | null | undefined): string {
    if (!v) return '—';
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : formatDate(d);
  }
  /**
   * Communications tab timeline — client 05-10-2026: match the Enquiry detail page.
   * One chronological <ui-timeline>, newest first, merging the application's own
   * logged communications with the communications carried over from the enquiry.
   */
  commTimeline(a: ApplicationDetail): TimelineEntry[] {
    const ts = (v: string | null | undefined) => { const t = v ? new Date(v).getTime() : 0; return Number.isFinite(t) ? t : 0; };
    const fromComms = (a.communications || []).map((c: ApplicationCommunication) => ({
      when: ts(c.comm_at),
      entry: {
        title: c.subject || c.body || c.channel,
        meta: `${c.channel}${c.to_party ? ' · to ' + c.to_party : ''} · ${c.from_user_name || 'System'} · ${this.datetime(c.comm_at)}`,
        detail: c.subject && c.body ? c.body : undefined,
      } as TimelineEntry,
    }));
    const fromEnquiry = (a.enquiry_communications || []).map((n: ApplicationNote) => ({
      when: ts(n.created_at),
      entry: {
        title: n.note,
        meta: `From enquiry · ${n.created_by_name || 'System'} · ${this.datetime(n.created_at)}`,
      } as TimelineEntry,
    }));
    return [...fromComms, ...fromEnquiry].sort((x, y) => y.when - x.when).map((x) => x.entry);
  }

  datetime(v: string | null | undefined): string {
    if (!v) return '—';
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}
