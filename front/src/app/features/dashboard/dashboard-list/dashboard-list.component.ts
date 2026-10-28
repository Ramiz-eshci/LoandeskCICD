import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';

import { SessionStore } from '../../../core/session/session.store';
import { UiBarChartComponent, BarGroup, BarSeries } from '../../../shared/ui/charts/ui-bar-chart.component';
import { UiDonutChartComponent, DonutSlice } from '../../../shared/ui/charts/ui-donut-chart.component';
import { UiBadgeComponent, BadgeStatus } from '../../../shared/ui/ui-badge/ui-badge.component';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiKpiCardComponent } from '../../../shared/ui/ui-kpi-card/ui-kpi-card.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiCellDirective } from '../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import { TableColumn } from '../../../shared/ui/table/table-column.model';
import {
  DashboardRecentApplication,
  DashboardService,
  DashboardSummary,
  DashboardTile,
} from '../dashboard.service';

/**
 * Dashboard — every figure is live and permission-scoped by the API.
 * Tiles the role may not see never arrive, so nothing here needs to hide them.
 */
@Component({
  selector: 'app-dashboard-list',
  standalone: true,
  imports: [
    UiBadgeComponent,
    UiBarChartComponent,
    UiCardComponent,
    UiCellDirective,
    UiDataTableComponent,
    UiDonutChartComponent,
    UiKpiCardComponent,
    UiPageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-list.component.html',
  styleUrl: './dashboard-list.component.scss',
})
export class DashboardListComponent implements OnInit {
  private readonly session = inject(SessionStore);
  private readonly api = inject(DashboardService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly data = signal<DashboardSummary | null>(null);

  readonly tiles = computed<DashboardTile[]>(() => this.data()?.tiles ?? []);
  readonly anyScoped = computed(() => !!this.data()?.context?.any_scoped);

  readonly pipelineSeries: BarSeries[] = [{ name: 'Enquiries', color: '#2563eb' }];
  readonly pipelineData = computed<BarGroup[]>(() =>
    (this.data()?.enquiry_pipeline ?? []).map((b) => ({ label: b.label, values: [b.value] })),
  );
  readonly productMix = computed<DonutSlice[]>(() => {
    const palette = ['#2563eb', '#0891b2', '#7c3aed', '#d97706', '#059669', '#dc2626'];
    return (this.data()?.product_mix ?? []).map((s, i) => ({
      label: s.label, value: s.value, color: palette[i % palette.length],
    }));
  });
  readonly uwStatusSeries: BarSeries[] = [{ name: 'Cases', color: '#7c3aed' }];
  readonly uwStatusData = computed<BarGroup[]>(() =>
    (this.data()?.underwriting_status ?? []).map((b) => ({ label: b.label, values: [b.value] })),
  );
  readonly maturityMix = computed<DonutSlice[]>(() => {
    const palette = ['#dc2626', '#d97706', '#2563eb', '#059669'];
    return (this.data()?.maturity_buckets ?? []).map((s, i) => ({
      label: s.label, value: s.value, color: palette[i % palette.length],
    }));
  });
  readonly recentApplications = computed<DashboardRecentApplication[]>(
    () => this.data()?.recent_applications ?? [],
  );
  readonly hasPipeline = computed(() => this.pipelineData().length > 0);
  readonly hasProductMix = computed(() => this.productMix().length > 0);
  readonly hasUwStatus = computed(() => this.uwStatusData().length > 0);
  readonly hasMaturity = computed(() => this.maturityMix().some((s) => s.value > 0));
  readonly hasRecent = computed(() => this.recentApplications().length > 0);

  readonly recentColumns: TableColumn<DashboardRecentApplication>[] = [
    { key: 'application_ref', header: 'Application', width: '150px' },
    { key: 'applicant_name', header: 'Applicant' },
    { key: 'product_name', header: 'Product' },
    { key: 'amount_requested', header: 'Amount', align: 'end', mono: true },
    { key: 'status', header: 'Status', width: '160px' },
  ];

  readonly subtitle = computed(() => {
    const today = new Date().toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    return `${today} · ${this.session.branchName()}`;
  });

  ngOnInit(): void {
    this.api.summary()
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        this.loading.set(false);
        if (!res) { this.failed.set(true); return; }
        this.data.set(res);
      });
  }

  /** Currency tiles are formatted here; plain counts pass straight through. */
  tileValue(t: DashboardTile): string {
    if (t.format === 'currency') {
      return '£' + Number(t.value || 0).toLocaleString('en-GB', { maximumFractionDigits: 0 });
    }
    return String(t.value ?? 0);
  }

  statusTone(row: DashboardRecentApplication): BadgeStatus {
    const code = String(row.status_code || '').toUpperCase();
    if (code === 'COMPLETED') return 'completed';
    if (code === 'APPROVED') return 'approved';
    if (code === 'DECLINED') return 'declined';
    if (code === 'CREDIT_REVIEW' || code === 'UNDERWRITING') return 'review';
    if (code === 'DRAFT') return 'pending';
    return 'info';
  }

  money(v: number): string {
    return '£' + Number(v || 0).toLocaleString('en-GB', { maximumFractionDigits: 0 });
  }
}
