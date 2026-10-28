import { Component, ChangeDetectionStrategy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { PermissionsStore } from '../../../core/session/permissions.store';

import { extractFieldErrors, toFieldErrorList, errorSummary } from '../../../core/util/server-errors';

import { UiBadgeComponent } from '../../../shared/ui/ui-badge/ui-badge.component';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal/ui-modal.component';
import { UiTabFiltersComponent, TabFilter } from '../../../shared/ui/ui-tab-filters/ui-tab-filters.component';
import { PortfolioCustomerDetail, PortfolioService } from '../portfolio.service';
import { PortfolioDocUploadComponent, DocUploadResult } from '../shared/portfolio-doc-upload.component';

@Component({
  selector: 'app-customer-360',
  standalone: true,
  imports: [CommonModule, FormsModule, UiBadgeComponent, UiButtonDirective, UiCardComponent, UiModalComponent, UiTabFiltersComponent, PortfolioDocUploadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customer-360.component.html',
  styleUrl: './customer-360.component.scss',
})
export class Customer360Component implements OnInit {
  private readonly api = inject(PortfolioService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly perms = inject(PermissionsStore);
  /** Customer documents are their own screen (CUSTOMERS.DOCUMENT) in the Roles matrix: view / upload / delete. */
  private cd(a: string): boolean { return !this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.can('CUSTOMERS.DOCUMENT', a); }
  /** View = Documents tab + View + Download buttons. */
  readonly canDocView = computed(() => this.cd('view'));
  readonly canDocAdd = computed(() => this.cd('add'));
  readonly canDocDelete = computed(() => this.cd('delete'));
  /** Client 16-10-2026: edit basic customer details (CUSTOMERS edit). */
  readonly canEdit = computed(() => !this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.can('CUSTOMERS', 'edit'));
  readonly editOpen = signal(false);
  readonly editSaving = signal(false);
  readonly editErrors = signal<Record<string, string>>({});
  editDraft = { first_name: '', last_name: '', company_name: '', email: '', phone: '' };
  /** Journey links jump into other modules — only when the role can open that module. */
  private allowed(module: string): boolean {
    if (!this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.hasModule(module)) return true;
    this.toastr.info('You do not have permission to open this record.', 'Not allowed');
    return false;
  }
  private readonly toastr = inject(ToastrService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly detail = signal<PortfolioCustomerDetail | null>(null);
  readonly activeTab = signal('overview');

  private readonly allTabs: TabFilter[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'journey', label: 'Journey' },
    { key: 'applications', label: 'Applications' },
    { key: 'facilities', label: 'Facilities' },
    { key: 'documents', label: 'Documents' },
    { key: 'contacts', label: 'Contacts' },
    { key: 'exposure', label: 'Exposure' },
    { key: 'audit', label: 'Audit' },
  ];
  /** Documents tab only for roles with CUSTOMERS.DOCUMENT view. */
  readonly tabs = computed<TabFilter[]>(() => this.allTabs.filter((t) => t.key !== 'documents' || this.canDocView()));

  readonly profile = computed(() => this.detail()?.profile ?? null);
  readonly facilities = computed(() => this.detail()?.facilities ?? []);
  readonly applications = computed(() => this.detail()?.applications ?? []);
  readonly documents = computed(() => this.detail()?.documents ?? []);
  readonly contacts = computed(() => this.detail()?.contacts ?? []);
  readonly documentTypes = computed(() => this.detail()?.documentTypes ?? []);
  readonly enquiries = computed(() => this.detail()?.enquiries ?? []);
  readonly underwriting = computed(() => this.detail()?.underwriting ?? []);
  readonly allDocuments = computed(() => this.detail()?.allDocuments ?? []);
  readonly uploadOpen = signal(false);
  readonly uploadSaving = signal(false);
  readonly uploadError = signal<string | null>(null);
  readonly auditRows = computed(() => this.detail()?.audit ?? []);

  readonly customerId = computed(() => {
    const id = this.profile()?.applicant_id ?? 0;
    return `CUST-${String(id).padStart(4, '0')}`;
  });

  readonly initials = computed(() => {
    const name = this.profile()?.customer_name ?? '';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '—';
  });

  readonly customerType = computed(() => {
    const p = this.profile();
    if (!p) return '—';
    if (p.applicant_type) return p.applicant_type;
    return p.company_name ? 'Company' : 'Individual';
  });

  readonly branch = computed(() => this.applications()[0]?.branch_name || '—');

  /** Client 23-10-2026: exposure shown Gross or Net (same switch as the broker page). */
  readonly basis = signal<'gross' | 'net'>('net');
  /** Net = what is still owed on the facilities (net outstanding after payments). */
  private readonly netExposure = computed(() =>
    this.facilities().reduce((sum, f) => sum + Number(f.outstanding_balance ?? f.principal ?? 0), 0),
  );
  /** Gross = gross loan of the facilities still running (not redeemed / written off). */
  private readonly grossExposure = computed(() =>
    this.facilities().filter((f) => !['Redeemed', 'Recovered', 'Written Off'].includes(String(f.status ?? '')))
      .reduce((sum, f) => sum + Number(f.principal ?? 0), 0),
  );
  readonly totalExposure = computed(() => (this.basis() === 'gross' ? this.grossExposure() : this.netExposure()));
  /** Total lent across the customer's facilities, gross or net. */
  readonly totalLent = computed(() => this.facilities().reduce((sum, f) =>
    sum + Number(this.basis() === 'gross' ? (f.principal ?? 0) : (f.net_amount ?? f.principal ?? 0)), 0));

  readonly arrearsTotal = computed(() =>
    this.facilities().reduce((sum, f) => sum + Number((f as { arrears_amount?: number }).arrears_amount || 0), 0),
  );

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    this.api
      .customerDetail(id)
      .pipe(
        catchError((e) => {
          this.error.set(e?.error?.message || 'Could not load customer.');
          return of(null);
        }),
      )
      .subscribe((detail) => {
        this.detail.set(detail);
        this.loading.set(false);
      });
  }

  back(): void {
    void this.router.navigate(['/customers']);
  }

  private docBlob(kind: unknown, docId: number) {
    const id = this.profile()?.applicant_id as number;
    return String(kind) === 'enquiry'
      ? this.api.downloadCustomerEnquiryDocument(id, docId)
      : this.api.downloadCustomerDocument(id, docId);
  }

  /** Open a document (application or enquiry) in a new tab. */
  viewDocument(docId: unknown, kind: unknown = 'application'): void {
    const id = this.profile()?.applicant_id;
    const doc = Number(docId);
    if (!id || !doc) return;
    this.docBlob(kind, doc).pipe(catchError(() => of(null))).subscribe((blob) => {
      if (blob) window.open(URL.createObjectURL(blob as Blob), '_blank');
    });
  }

  /** Download a document (application or enquiry) to disk. */
  downloadDocument(docId: unknown, kind: unknown = 'application'): void {
    const id = this.profile()?.applicant_id;
    const doc = Number(docId);
    if (!id || !doc) return;
    this.docBlob(kind, doc).pipe(catchError(() => of(null))).subscribe((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob as Blob);
      const link = document.createElement('a');
      link.href = url; link.download = ''; link.click();
      URL.revokeObjectURL(url);
    });
  }

  // ---- Shared confirm dialog ----
  readonly confirmOpen = signal(false);
  readonly confirmMessage = signal('');
  private confirmFn: (() => void) | null = null;
  askConfirm(message: string, fn: () => void): void {
    this.confirmMessage.set(message);
    this.confirmFn = fn;
    this.confirmOpen.set(true);
  }
  confirmYes(): void {
    const fn = this.confirmFn;
    this.confirmOpen.set(false);
    this.confirmFn = null;
    if (fn) fn();
  }

  removeDocument(docId: unknown, name: unknown, kind: unknown = 'application'): void {
    const id = this.profile()?.applicant_id;
    const doc = Number(docId);
    if (!id || !doc) return;
    this.askConfirm(`Delete document "${String(name || 'Document')}"? This cannot be undone.`, () => {
      this.api.deleteCustomerDocument(id, doc, kind === 'enquiry' ? 'enquiry' : 'application').pipe(catchError(() => of(false))).subscribe((ok) => { if (ok) { this.toastr.success('Document deleted.', 'Deleted'); this.reload(); } else { this.toastr.error('Could not delete document.', 'Failed'); } });
    });
  }

  openEdit(): void {
    const p = this.profile();
    if (!p) return;
    this.editDraft = { first_name: p.first_name || '', last_name: p.last_name || '', company_name: p.company_name || '', email: p.email || '', phone: p.phone || '' };
    this.editErrors.set({});
    this.editOpen.set(true);
  }
  saveEdit(): void {
    const id = this.profile()?.applicant_id;
    if (!id) return;
    this.editSaving.set(true);
    this.api.updateCustomer(id, this.editDraft).subscribe({
      next: (r) => {
        this.editSaving.set(false);
        this.editOpen.set(false);
        this.toastr.success(r?.changed?.length ? 'Customer details updated.' : 'No changes to save.', 'Saved');
        this.reload();
      },
      error: (e) => {
        this.editSaving.set(false);
        const errs = (e?.error?.errors ?? e?.error?.data ?? {}) as Record<string, string>;
        this.editErrors.set(errs && typeof errs === 'object' ? errs : {});
        this.toastr.error(e?.error?.message || 'Could not update customer.', 'Failed');
      },
    });
  }

  private reload(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    this.api.customerDetail(id).pipe(catchError(() => of(null))).subscribe((d) => { if (d) this.detail.set(d); });
  }

  openUpload(): void { this.uploadError.set(null); this.uploadOpen.set(true); }
  onUploadSubmit(payload: DocUploadResult): void {
    const id = this.profile()?.applicant_id;
    if (!id) return;
    this.uploadSaving.set(true);
    this.uploadError.set(null);
    this.api.uploadCustomerDocument(id, {
      file_name: payload.file_name,
      content_base64: payload.content_base64,
      document_type_id: payload.document_type_id,
      application_id: payload.application_id,
    }).pipe(
      catchError((e) => {
        this.toastr.error(this.errText(e, 'Upload failed.'), 'Upload failed');
        this.uploadSaving.set(false);
        return of(null);
      }),
    ).subscribe((r) => {
      this.uploadSaving.set(false);
      if (!r) return;
      this.uploadOpen.set(false);
      this.toastr.success('Document uploaded.', 'Uploaded');
      this.reload();
    });
  }

  openEnquiry(id: unknown): void {
    const n = Number(id);
    if (n && this.allowed('ENQUIRIES')) void this.router.navigate(['/enquiries', n]);
  }

  openUnderwriting(id: unknown): void {
    const n = Number(id);
    if (n && this.allowed('UNDERWRITING.CASE')) void this.router.navigate(['/underwriting', n]);
  }

  openApplication(applicationId: number): void {
    if (this.allowed('APPLICATIONS')) void this.router.navigate(['/applications', applicationId]);
  }

  openFacility(loanNumber: string): void {
    if (this.allowed('PORTFOLIO!|PORTFOLIO.CONTACT_LOG|PORTFOLIO.EXTENSION|PORTFOLIO.FURTHER_ADVANCE|PORTFOLIO.FACILITY_OVERVIEW|PORTFOLIO.FACILITY_LOAN_STRUCTURE|PORTFOLIO.FACILITY_SCHEDULE|PORTFOLIO.FACILITY_TRANSACTIONS|PORTFOLIO.FACILITY_INTEREST|PORTFOLIO.FACILITY_FEES|PORTFOLIO.FACILITY_PAYMENTS|PORTFOLIO.FACILITY_DRAWDOWNS|PORTFOLIO.FACILITY_SECURITY|PORTFOLIO.FACILITY_VALUATION|PORTFOLIO.FACILITY_COVENANTS|PORTFOLIO.FACILITY_DOCUMENTS|PORTFOLIO.FACILITY_CONTACTS|PORTFOLIO.FACILITY_STATEMENTS|PORTFOLIO.FACILITY_AMENDMENTS|PORTFOLIO.FACILITY_COLLECTIONS|PORTFOLIO.FACILITY_REDEMPTION|PORTFOLIO.FACILITY_AUDIT')) void this.router.navigate(['/portfolio/facilities', loanNumber]);
  }

  activeTabLabel(): string {
    return this.allTabs.find((t) => t.key === this.activeTab())?.label || 'Customer';
  }

  /** Field-aware error line for toasts. */
  private errText(e: unknown, fb: string): string {
    const list = toFieldErrorList(extractFieldErrors(e));
    if (list.length) return errorSummary(list, fb);
    const m = (e as { error?: { message?: string } })?.error?.message;
    return m && m !== 'Validation Error' ? m : fb;
  }

  money(v: unknown): string {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      maximumFractionDigits: 0,
    }).format(Number(v || 0));
  }

  formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  formatDate2(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  humanizeAction(code: unknown): string {
    return String(code || 'Updated')
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  summarizeDetails(details: unknown): string {
    if (!details || typeof details !== 'string') return '—';
    try {
      const obj = JSON.parse(details) as Record<string, unknown>;
      const text = Object.entries(obj)
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join('; ');
      return text || '—';
    } catch {
      return details;
    }
  }
}
