import { Component, ChangeDetectionStrategy, computed, signal } from '@angular/core';

import { TabFilter, UiTabFiltersComponent } from '../../../shared/ui/ui-tab-filters/ui-tab-filters.component';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiKpiCardComponent } from '../../../shared/ui/ui-kpi-card/ui-kpi-card.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiTagComponent } from '../../../shared/ui/ui-tag/ui-tag.component';
import { UiCellDirective } from '../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import { AUDIT_ENTRIES, AUDIT_COLUMNS } from './audit.data';
import { AuditEntry } from './audit.model';

/** Audit Trail — immutable log of important actions across the platform. */
@Component({
  selector: 'app-audit-list',
  standalone: true,
  imports: [
    UiCardComponent, UiCellDirective, UiDataTableComponent,
    UiKpiCardComponent, UiPageHeaderComponent, UiTabFiltersComponent, UiTagComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './audit-list.component.html',
  styleUrl: './audit-list.component.scss',
})
export class AuditListComponent {
  readonly rows = AUDIT_ENTRIES;
  readonly columns = AUDIT_COLUMNS;
  readonly activeTab = signal('all');

  private readonly security = computed(() => this.rows.filter((r) => r.category === 'security'));
  private readonly config = computed(() => this.rows.filter((r) => r.category === 'config'));

  readonly kpis = computed(() => [
    { label: 'Events Today', value: this.rows.length, caption: 'Logged today', icon: 'bi-journal-text', tone: 'default' as const },
    { label: 'Active Users', value: 3, caption: 'Signed in today', icon: 'bi-people', tone: 'accent' as const },
    { label: 'Failed Logins', value: this.security().length, caption: 'Security events', icon: 'bi-shield-exclamation', tone: 'danger' as const },
    { label: 'Config Changes', value: this.config().length, caption: 'Settings/roles', icon: 'bi-gear', tone: 'warning' as const },
  ]);

  readonly tabs = computed<TabFilter[]>(() => [
    { key: 'all', label: 'All Events', count: this.rows.length },
    { key: 'security', label: 'Security', count: this.security().length },
    { key: 'config', label: 'Config Changes', count: this.config().length },
  ]);

  readonly filtered = computed<AuditEntry[]>(() => {
    switch (this.activeTab()) {
      case 'security': return this.security();
      case 'config': return this.config();
      default: return this.rows;
    }
  });

  readonly subtitle = computed(() => `${this.rows.length} events in the audit log`);

  actionTone(cat: AuditEntry['category']): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
    switch (cat) {
      case 'security': return 'danger';
      case 'config': return 'warning';
      default: return 'info';
    }
  }
}
