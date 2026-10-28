import { Component, ChangeDetectionStrategy, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { UiBarChartComponent } from '../../../shared/ui/charts/ui-bar-chart.component';
import { UiBarListComponent } from '../../../shared/ui/charts/ui-bar-list.component';
import { UiLineChartComponent } from '../../../shared/ui/charts/ui-line-chart.component';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiKpiCardComponent } from '../../../shared/ui/ui-kpi-card/ui-kpi-card.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiPillTabsComponent } from '../../../shared/ui/ui-pill-tabs/ui-pill-tabs.component';
import { UiSearchInputComponent } from '../../../shared/ui/ui-search-input/ui-search-input.component';
import {
  BRANCH_DATA,
  BRANCH_SERIES,
  PIPELINE_MONTHS,
  PIPELINE_SERIES,
  PRODUCT_MIX,
  REPORTS,
  REPORT_CATEGORIES,
  REPORT_KPIS,
} from './reports.data';
import { ReportCategory, ReportDefinition } from './report.model';

/** Reports — category pills, headline analytics and the runnable report catalogue. */
@Component({
  selector: 'app-reports-list',
  standalone: true,
  imports: [
    RouterLink,
    UiBarChartComponent,
    UiBarListComponent,
    UiCardComponent,
    UiKpiCardComponent,
    UiLineChartComponent,
    UiPageHeaderComponent,
    UiPillTabsComponent,
    UiSearchInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reports-list.component.html',
  styleUrl: './reports-list.component.scss',
})
export class ReportsListComponent {
  readonly categories = REPORT_CATEGORIES;
  readonly kpis = REPORT_KPIS;
  readonly pipelineMonths = PIPELINE_MONTHS;
  readonly pipelineSeries = PIPELINE_SERIES;
  readonly productMix = PRODUCT_MIX;
  readonly branchSeries = BRANCH_SERIES;
  readonly branchData = BRANCH_DATA;

  readonly category = signal<string>('executive');
  readonly query = signal('');

  readonly categoryLabel = computed(
    () => this.categories.find((c) => c.key === this.category())?.label ?? '',
  );

  readonly filtered = computed<ReportDefinition[]>(() => {
    const term = this.query().trim().toLowerCase();
    return REPORTS.filter((r) => {
      if (r.category !== (this.category() as ReportCategory)) return false;
      if (!term) return true;
      return [r.title, r.description, r.type].some((v) => v.toLowerCase().includes(term));
    });
  });
}
