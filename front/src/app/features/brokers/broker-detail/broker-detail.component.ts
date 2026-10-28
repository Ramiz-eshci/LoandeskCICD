import { Component, ChangeDetectionStrategy, OnInit, computed, inject, signal } from '@angular/core';
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
import { UiDonutChartComponent, DonutSlice } from '../../../shared/ui/charts/ui-donut-chart.component';
import { UiSegmentedComponent, SegmentOption } from '../../../shared/ui/ui-segmented/ui-segmented.component';
import { PortfolioDocUploadComponent, DocUploadResult } from '../../portfolio/shared/portfolio-doc-upload.component';
import { BrokerDetail, BrokersService } from '../brokers.service';

/**
 * Broker dashboard (client 22-10-2026) - same format as Customer 360:
 * hero with headline figures, then Overview / Enquiries / Applications / Facilities /
 * Documents tabs. Documents hold e.g. the signed broker agreement.
 * View = Broker master view; upload = Broker master edit; delete = Broker master delete.
 */
@Component({
  selector: 'app-broker-detail',
  standalone: true,
  imports: [UiBadgeComponent, UiButtonDirective, UiCardComponent, UiModalComponent, UiTabFiltersComponent, PortfolioDocUploadComponent, UiDonutChartComponent, UiSegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './broker-detail.component.html',
  styleUrls: ['../../portfolio/customer-360/customer-360.component.scss', './broker-detail.component.scss'],
})
export class BrokerDetailComponent implements OnInit {
  private readonly api = inject(BrokersService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly perms = inject(PermissionsStore);
  private readonly toastr = inject(ToastrService);

  // Client 26-10-2026: BROKERS = broker profile, BROKERS.DOCUMENT = documents (like Customers).
  private can(mod: string, a: string): boolean { return !this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.can(mod, a); }
  readonly canEdit = computed(() => this.can('BROKERS', 'edit'));
  readonly canDocView = computed(() => this.can('BROKERS.DOCUMENT', 'view'));
  readonly canDocAdd = computed(() => this.can('BROKERS.DOCUMENT', 'add'));
  readonly canDocDelete = computed(() => this.can('BROKERS.DOCUMENT', 'delete'));

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly detail = signal<BrokerDetail | null>(null);
  readonly activeTab = signal('overview');

  readonly tabs = computed<TabFilter[]>(() => [
    { key: 'overview', label: 'Overview' },
    { key: 'enquiries', label: 'Enquiries' },
    { key: 'applications', label: 'Applications' },
    { key: 'facilities', label: 'Facilities' },
    ...(this.canDocView() ? [{ key: 'documents', label: 'Documents' }] : []),
  ]);

  readonly profile = computed(() => this.detail()?.profile ?? null);
  readonly s = computed(() => this.detail()?.summary ?? null);
  readonly enquiries = computed(() => this.detail()?.enquiries ?? []);
  readonly applications = computed(() => this.detail()?.applications ?? []);
  readonly facilities = computed(() => this.detail()?.facilities ?? []);
  readonly documents = computed(() => this.detail()?.documents ?? []);
  /** Upload modal expects {id, name}; the API stores the type name. */
  readonly docTypes = computed(() => (this.detail()?.documentTypes ?? []).map((name, i) => ({ id: i + 1, name })));

  readonly brokerRef = computed(() => this.profile()?.code || `BRK-${String(this.profile()?.broker_id ?? 0).padStart(4, '0')}`);
  readonly initials = computed(() => {
    const parts = (this.profile()?.name ?? '').trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '—';
  });
  readonly active = computed(() => { const a = this.profile()?.is_active; return a === true || a === 1; });

  /** Client 23-10-2026: Portfolio shown as Gross or Net. */
  readonly basis = signal<'gross' | 'net'>('gross');

  /** Client 23-10-2026: completed vs still-left chart (Number / Value). */
  readonly journeyViews: SegmentOption[] = [{ key: 'loans', label: 'Loans £ (Net)' }, { key: 'count', label: 'Deals · Number' }, { key: 'value', label: 'Deals · Value' }];
  readonly journeyView = signal('loans');
  private static readonly JOURNEY_COLOUR: Record<string, string> = {
    Completed: '#2e8b57', 'Live loans': '#0f2244', 'In pipeline': '#eaab00', Declined: '#d64545', 'Bad debt / other': '#8b1e1e',
    'Completed (redeemed)': '#2e8b57', 'Paid so far (live loans)': '#8fc79a', 'Left to pay': '#eaab00',
  };
  readonly journeySlices = computed<DonutSlice[]>(() => this.journeyView() === 'loans'
    ? (this.s()?.loan_progress ?? []).map((j) => ({ label: j.label, value: j.value, color: BrokerDetailComponent.JOURNEY_COLOUR[j.label] ?? '#a8bed6' })).filter((j) => j.value > 0)
    : (this.s()?.journey ?? [])
    .map((j) => ({ label: j.label, value: this.journeyView() === 'value' ? j.value : j.count, color: BrokerDetailComponent.JOURNEY_COLOUR[j.label] ?? '#a8bed6' }))
    .filter((j) => j.value > 0));
  private readonly journeyTotal = computed(() => this.journeySlices().reduce((a, b) => a + b.value, 0));
  readonly journeyCentre = computed(() => (this.journeyView() === 'count' ? String(this.journeyTotal()) : this.money(this.journeyTotal())));
  journeyShare(v: number): string { const t = this.journeyTotal(); return t ? `${Math.round((v / t) * 1000) / 10}%` : ''; }

  readonly uploadOpen = signal(false);
  readonly uploadSaving = signal(false);
  readonly uploadError = signal<string | null>(null);

  ngOnInit(): void { this.load(true); }

  private load(first = false): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    this.api.detail(id).pipe(catchError((e) => {
      if (first) this.error.set(e?.error?.message || 'Could not load broker.');
      return of(null);
    })).subscribe((d) => {
      if (d) this.detail.set(d);
      this.loading.set(false);
    });
  }

  back(): void { void this.router.navigate(['/brokers']); }
  editBroker(): void {
    const id = this.profile()?.broker_id;
    if (id) void this.router.navigate(['/masters', 'broker', id, 'edit'], { queryParams: { from: 'brokers' } });
  }

  private allowed(module: string): boolean {
    if (!this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.hasModule(module)) return true;
    this.toastr.info('You do not have permission to open this record.', 'Not allowed');
    return false;
  }
  openEnquiry(id: number): void { if (id && this.allowed('ENQUIRIES')) void this.router.navigate(['/enquiries', id]); }
  openApplication(id: number): void { if (id && this.allowed('APPLICATIONS')) void this.router.navigate(['/applications', id]); }
  openFacility(loanNumber: string): void { if (loanNumber && this.allowed('PORTFOLIO')) void this.router.navigate(['/portfolio/facilities', loanNumber]); }

  /* ---- documents ---- */
  openUpload(): void { this.uploadError.set(null); this.uploadOpen.set(true); }
  onUploadSubmit(payload: DocUploadResult): void {
    const id = this.profile()?.broker_id;
    if (!id) return;
    const type = this.docTypes().find((t) => t.id === payload.document_type_id)?.name || '';
    if (!type) { this.uploadError.set('Please choose a document type.'); return; }
    this.uploadSaving.set(true);
    this.uploadError.set(null);
    this.api.uploadDocument(id, { file_name: payload.file_name, content_base64: payload.content_base64, document_type: type })
      .pipe(catchError((e) => { this.uploadError.set(this.errText(e, 'Upload failed.')); this.uploadSaving.set(false); return of(null); }))
      .subscribe((r) => {
        this.uploadSaving.set(false);
        if (!r) return;
        this.uploadOpen.set(false);
        this.toastr.success('Document uploaded.', 'Uploaded');
        this.load();
      });
  }
  viewDocument(docId: number): void {
    const id = this.profile()?.broker_id;
    if (!id) return;
    this.api.downloadDocument(id, docId).pipe(catchError(() => { this.toastr.error('Could not open document.'); return of(null); }))
      .subscribe((blob) => { if (blob) window.open(URL.createObjectURL(blob), '_blank'); });
  }
  downloadDocument(docId: number, name: string): void {
    const id = this.profile()?.broker_id;
    if (!id) return;
    this.api.downloadDocument(id, docId).pipe(catchError(() => { this.toastr.error('Could not download document.'); return of(null); }))
      .subscribe((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name || 'document'; a.click();
        URL.revokeObjectURL(url);
      });
  }

  readonly confirmOpen = signal(false);
  readonly confirmMessage = signal('');
  private confirmFn: (() => void) | null = null;
  removeDocument(docId: number, name: string): void {
    const id = this.profile()?.broker_id;
    if (!id) return;
    this.confirmMessage.set(`Delete document "${name || 'Document'}"? This cannot be undone.`);
    this.confirmFn = () => this.api.deleteDocument(id, docId).pipe(catchError(() => of(false))).subscribe((ok) => {
      if (ok) { this.toastr.success('Document deleted.', 'Deleted'); this.load(); } else { this.toastr.error('Could not delete document.', 'Failed'); }
    });
    this.confirmOpen.set(true);
  }
  confirmYes(): void { const fn = this.confirmFn; this.confirmOpen.set(false); this.confirmFn = null; if (fn) fn(); }

  /* ---- formatting ---- */
  private errText(e: unknown, fb: string): string {
    const list = toFieldErrorList(extractFieldErrors(e));
    if (list.length) return errorSummary(list, fb);
    const m = (e as { error?: { message?: string } })?.error?.message;
    return m && m !== 'Validation Error' ? m : fb;
  }
  money(v: unknown): string {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(Number(v || 0));
  }
  pct(v: number | null | undefined, suffix = '%'): string { return v == null ? '—' : `${v}${suffix}`; }
  formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
