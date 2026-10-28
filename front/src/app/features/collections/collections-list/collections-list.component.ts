import { Component, ChangeDetectionStrategy, computed, signal } from '@angular/core';

import { TabFilter, UiTabFiltersComponent } from '../../../shared/ui/ui-tab-filters/ui-tab-filters.component';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiKpiCardComponent } from '../../../shared/ui/ui-kpi-card/ui-kpi-card.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiTagComponent } from '../../../shared/ui/ui-tag/ui-tag.component';
import { UiCellDirective } from '../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import { COLLECTION_CASES, COLLECTION_COLUMNS } from './collections.data';
import { CollectionCase } from './collection.model';

/** Collections — arrears management, promises to pay and recovery. */
@Component({
  selector: 'app-collections-list',
  standalone: true,
  imports: [
    UiButtonDirective, UiCardComponent, UiCellDirective, UiDataTableComponent,
    UiKpiCardComponent, UiPageHeaderComponent, UiTabFiltersComponent, UiTagComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './collections-list.component.html',
  styleUrl: './collections-list.component.scss',
})
export class CollectionsListComponent {
  readonly rows = COLLECTION_CASES;
  readonly columns = COLLECTION_COLUMNS;
  readonly activeTab = signal('all');

  private readonly active = computed(() => this.rows.filter((r) => r.statusKey !== 'resolved'));
  private readonly early = computed(() => this.active().filter((r) => r.daysOverdue <= 30));
  private readonly late = computed(() => this.active().filter((r) => r.daysOverdue > 30));

  readonly kpis = computed(() => [
    { label: 'Cases in Arrears', value: this.active().length, caption: 'Open cases', icon: 'bi-exclamation-triangle', tone: 'default' as const },
    { label: 'Total Arrears', value: '£26.7K', caption: 'Outstanding', icon: 'bi-cash-stack', tone: 'danger' as const },
    { label: 'Over 30 Days', value: this.late().length, caption: 'Escalated', icon: 'bi-calendar-x', tone: 'warning' as const },
    { label: 'Promises to Pay', value: this.rows.filter((r) => r.statusKey === 'promise-to-pay').length, caption: 'Active arrangements', icon: 'bi-hand-thumbs-up', tone: 'accent' as const },
  ]);

  readonly tabs = computed<TabFilter[]>(() => [
    { key: 'all', label: 'All Arrears', count: this.active().length },
    { key: 'early', label: 'Under 30 Days', count: this.early().length },
    { key: 'late', label: 'Over 30 Days', count: this.late().length },
  ]);

  readonly filtered = computed<CollectionCase[]>(() => {
    switch (this.activeTab()) {
      case 'early': return this.early();
      case 'late': return this.late();
      default: return this.active();
    }
  });

  readonly subtitle = computed(() => `${this.active().length} loans currently in arrears`);

  statusTone(key: CollectionCase['statusKey']): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
    switch (key) {
      case 'resolved': return 'success';
      case 'legal': return 'danger';
      case 'promise-to-pay': return 'info';
      default: return 'warning';
    }
  }
}
