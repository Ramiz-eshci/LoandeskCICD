import { UiFileUploadComponent, UiFileItem } from '../../../shared/ui/ui-file-upload/ui-file-upload.component';
import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { PermissionsStore } from '../../../core/session/permissions.store';

import { TabFilter, UiTabFiltersComponent } from '../../../shared/ui/ui-tab-filters/ui-tab-filters.component';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiKpiCardComponent } from '../../../shared/ui/ui-kpi-card/ui-kpi-card.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiPaginationComponent } from '../../../shared/ui/ui-pagination/ui-pagination.component';
import { StepItem, UiStepIndicatorComponent } from '../../../shared/ui/ui-step-indicator/ui-step-indicator.component';
import { UiTagComponent } from '../../../shared/ui/ui-tag/ui-tag.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal/ui-modal.component';
import { UiCellDirective } from '../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import { TableColumn } from '../../../shared/ui/table/table-column.model';
import { LegalService } from '../legal.service';
import { CreditPaperDoc, LegalCaseRow, LegalCondition, LegalKpis } from './legal-case.model';
import { formatDate } from '../../../core/util/date.util';

/** Legal & Completion — post-credit pipeline, conditions precedent, completion. */
@Component({
  selector: 'app-legal-list',
  standalone: true,
  imports: [
    UiButtonDirective, UiCardComponent, UiCellDirective, UiDataTableComponent, UiKpiCardComponent,
    UiPageHeaderComponent, UiStepIndicatorComponent, UiTabFiltersComponent, UiTagComponent, UiModalComponent,
    UiPaginationComponent, UiFileUploadComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './legal-list.component.html',
  styleUrl: './legal-list.component.scss',
})
export class LegalListComponent implements OnInit {
  private readonly api = inject(LegalService);
  private readonly router = inject(Router);
  private readonly toastr = inject(ToastrService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly perms = inject(PermissionsStore);
  private p(m: string, a: string): boolean { return !this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.can(m, a); }
  /** Legal module is its own permission (LEGAL.*), separate from underwriting. */
  readonly canEdit = computed(() => this.p('LEGAL', 'edit'));
  /** "Open" goes to Application Detail, which needs the Applications permission. */
  readonly canOpenApp = computed(() => this.p('APPLICATIONS.APPLICATION_LIST', 'view'));

  readonly active = signal<LegalCaseRow[]>([]);
  readonly completedCases = signal<LegalCaseRow[]>([]);
  readonly stages = signal<string[]>(['Offer Issued', 'Enquiries', 'Replies to Enquiries', 'Mortgage Deed', 'Completion']);
  readonly kpiData = signal<LegalKpis>({ in_legal: 0, ready_to_complete: 0, completing_this_week: 0, completed: 0 });
  readonly loading = signal(true);
  readonly activeTab = signal('active');
  readonly totals = signal({ active: 0, completed: 0 });
  // ---- Server-side paging (same pattern as Enquiries / Applications) ----
  readonly page = signal(1);
  readonly perPage = 10;
  readonly total = signal(0);
  readonly hasNext = computed(() => this.page() * this.perPage < this.total());
  readonly pageSummary = computed(() => {
    const t = this.total();
    const from = t ? (this.page() - 1) * this.perPage + 1 : 0;
    const to = Math.min(this.page() * this.perPage, t);
    return `Showing ${from}–${to} of ${t} cases`;
  });
  prev(): void { if (this.page() > 1) { this.page.update((p) => p - 1); this.load(); } }
  next(): void { if (this.hasNext()) { this.page.update((p) => p + 1); this.load(); } }
  onTab(key: string): void { this.activeTab.set(key); this.page.set(1); this.load(); }


  // Conditions modal
  readonly condOpen = signal(false);
  readonly condRow = signal<LegalCaseRow | null>(null);
  readonly conditions = signal<LegalCondition[]>([]);
  readonly savingCond = signal(false);

  // Credit Paper modal (underwriting step 8, filled by the Legal team)
  readonly cpOpen = signal(false);
  readonly cpRow = signal<LegalCaseRow | null>(null);
  readonly cpLoading = signal(false);
  readonly cpSaving = signal(false);
  readonly cpEditable = signal(false);
  readonly cpLabel = signal('Credit Paper Document');
  readonly cpDocs = signal<CreditPaperDoc[]>([]);
  readonly cpUploading = signal(false);

  // Complete modal
  readonly completeOpen = signal(false);
  readonly completeRow = signal<LegalCaseRow | null>(null);
  readonly completing = signal(false);

  readonly pipeline = computed<StepItem[]>(() => this.stages().map((s) => ({ label: s })));

  readonly kpis = computed(() => {
    const k = this.kpiData();
    return [
      { label: 'In Legal', value: k.in_legal, caption: 'Active cases', icon: 'bi-bank', tone: 'default' as const },
      { label: 'Ready to Complete', value: k.ready_to_complete, caption: 'All conditions met', icon: 'bi-check2-circle', tone: 'accent' as const },
      { label: 'Completing This Week', value: k.completing_this_week, caption: 'Scheduled', icon: 'bi-clock', tone: 'default' as const },
      { label: 'Completed', value: k.completed, caption: 'Total completed', icon: 'bi-file-earmark-text', tone: 'default' as const },
    ];
  });

  readonly tabs = computed<TabFilter[]>(() => [
    { key: 'active', label: 'Active Cases', count: this.totals().active },
    { key: 'completed', label: 'Completed', count: this.totals().completed },
  ]);

  readonly subtitle = computed(() => {
    const n = this.totals().active + this.totals().completed;
    return `${n} case${n === 1 ? '' : 's'} in legal pipeline`;
  });

  readonly filtered = computed<LegalCaseRow[]>(() => this.activeTab() === 'completed' ? this.completedCases() : this.active());

  readonly columns: TableColumn<LegalCaseRow & Record<string, unknown>>[] = [
    { key: 'application_ref', header: 'App ID', width: '120px', mono: true, bold: true },
    { key: 'applicant_name', header: 'Applicant', width: '170px' },
    { key: 'amount_requested', header: 'Amount', width: '120px', mono: true, bold: true },
    { key: 'property_address', header: 'Property', width: '200px' },
    { key: 'borrower_solicitor', header: 'Borrower Solicitor', width: '160px' },
    { key: 'lender_solicitor', header: 'Lender Solicitor', width: '160px' },
    { key: 'offer_date', header: 'Offer Date', width: '120px', mono: true },
    { key: 'target_completion_date', header: 'Target Completion', width: '140px', mono: true },
    { key: 'conditions', header: 'Conditions', width: '110px' },
    { key: 'legal_stage', header: 'Legal Stage', width: '150px' },
    { key: 'actions', header: 'Actions', width: '220px' },
  ];

  ngOnInit(): void { this.load(); }

  private load(): void {
    this.loading.set(true);
    this.api.list({ tab: this.activeTab(), page: this.page(), per_page: this.perPage }).pipe(catchError(() => { this.toastr.error('Could not load the legal pipeline.'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.loading.set(false);
        if (!r) return;
        this.active.set(r.active || []);
        this.completedCases.set(r.completed || []);
        if (r.stages?.length) this.stages.set(r.stages);
        this.kpiData.set(r.kpis || this.kpiData());
        if (r.totals) this.totals.set(r.totals);
        this.total.set(r.meta?.total ?? (this.activeTab() === 'completed' ? (r.completed || []).length : (r.active || []).length));
      });
  }

  stageIndex(stage: string): number { const i = this.stages().indexOf(stage); return i < 0 ? 0 : i; }

  open(row: LegalCaseRow): void { void this.router.navigate(['/applications', row.application_id]); }

  openConditions(row: LegalCaseRow): void {
    this.condRow.set(row); this.conditions.set([]); this.condOpen.set(true);
    this.reloadConditions(row.application_id);
  }
  private reloadConditions(id: number): void {
    this.api.conditions(id).pipe(catchError(() => of([])), takeUntilDestroyed(this.destroyRef))
      .subscribe((c) => this.conditions.set(c));
  }
  toggleCond(c: LegalCondition): void {
    const row = this.condRow(); if (!row) return;
    this.savingCond.set(true);
    this.api.toggleCondition(row.application_id, c.legal_condition_id)
      .pipe(catchError(() => { this.savingCond.set(false); this.toastr.error('Could not update condition.'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.savingCond.set(false); if (r !== null) this.reloadConditions(row.application_id); });
  }
  condDone(): void { this.condOpen.set(false); this.load(); }

  openComplete(row: LegalCaseRow): void { this.completeRow.set(row); this.completeOpen.set(true); }
  confirmComplete(): void {
    const row = this.completeRow(); if (!row) return;
    this.completing.set(true);
    this.api.complete(row.application_id)
      .pipe(catchError((e: { error?: { message?: string } }) => { this.completing.set(false); this.toastr.error(e?.error?.message || 'Completion failed.'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.completing.set(false);
        if (r === null) return;
        this.toastr.success('Application marked as completed.');
        this.completeOpen.set(false);
        this.load();
      });
  }

  money(v: number | null | undefined): string { return v == null ? '—' : '£' + Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 }); }
  dt(v: string | null): string { return formatDate(v); }

  /* ---- Credit Paper — uploaded document, no manual fields ------------ */

  openCreditPaper(row: LegalCaseRow): void {
    this.cpRow.set(row);
    this.cpOpen.set(true);
    this.loadCreditPaper();
  }

  private loadCreditPaper(): void {
    const row = this.cpRow();
    if (!row) return;
    this.cpLoading.set(true);
    this.api.creditPaper(row.application_id)
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        this.cpLoading.set(false);
        if (!res) { this.toastr.error('Could not load the credit paper.', 'Failed'); return; }
        this.cpLabel.set(res.label || 'Credit Paper Document');
        this.cpDocs.set(res.documents || []);
        this.cpEditable.set(!!res.editable);
      });
  }

  /** Tiles for the shared upload component. */
  cpItems(): UiFileItem[] { return this.cpDocs().map((d) => ({ id: d.id, name: d.file_name })); }
  viewCreditPaperById(id: number | string): void { const d = this.cpDocs().find((x) => x.id === id); if (d) this.viewCreditPaper(d); }
  removeCreditPaperById(id: number | string): void { const d = this.cpDocs().find((x) => x.id === id); if (d) this.removeCreditPaper(d); }
  onCreditPaperFiles(files: File[]): void {
    const row = this.cpRow();
    if (!files.length || !row) return;
    this.cpUploading.set(true);
    let pending = files.length;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        this.api.uploadCreditPaper(row.application_id, {
          file_name: file.name, content_base64: String(reader.result || ''), content_type: file.type,
        }).pipe(catchError((e: any) => { this.toastr.error(e?.error?.message || 'Upload failed.', 'Failed'); return of(null); }),
                takeUntilDestroyed(this.destroyRef))
          .subscribe(() => { if (--pending <= 0) { this.cpUploading.set(false); this.loadCreditPaper(); } });
      };
      reader.readAsDataURL(file);
    });
  }

  /** View the document in a new tab (the browser previews PDFs and images). */
  viewCreditPaper(doc: CreditPaperDoc): void {
    const row = this.cpRow();
    if (!row) return;
    this.api.downloadCreditPaper(row.application_id, doc.id)
      .pipe(catchError(() => { this.toastr.error('Could not open the document.', 'Failed'); return of(null); }),
            takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob as Blob);
        const win = window.open(url, '_blank');
        if (!win) { this.toastr.info('Allow pop-ups to view the document, or use Download.', 'Blocked'); }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      });
  }

  downloadCreditPaper(doc: CreditPaperDoc): void {
    const row = this.cpRow();
    if (!row) return;
    this.api.downloadCreditPaper(row.application_id, doc.id)
      .pipe(catchError(() => { this.toastr.error('Download failed.', 'Failed'); return of(null); }),
            takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob as Blob);
        const a = document.createElement('a');
        a.href = url; a.download = doc.file_name; a.click();
        URL.revokeObjectURL(url);
      });
  }

  removeCreditPaper(doc: CreditPaperDoc): void {
    const row = this.cpRow();
    if (!row) return;
    this.api.deleteCreditPaper(row.application_id, doc.id)
      .pipe(catchError(() => { this.toastr.error('Remove failed.', 'Failed'); return of(null); }),
            takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadCreditPaper());
  }
}
