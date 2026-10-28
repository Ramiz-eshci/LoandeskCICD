import { Component, ChangeDetectionStrategy, computed, signal } from '@angular/core';

import { UiBadgeComponent } from '../../../shared/ui/ui-badge/ui-badge.component';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiSearchInputComponent } from '../../../shared/ui/ui-search-input/ui-search-input.component';
import { UiTagComponent } from '../../../shared/ui/ui-tag/ui-tag.component';
import { UiCellDirective } from '../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import {
  DOCUMENTS,
  DOCUMENT_COLUMNS,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
} from './documents.data';
import { LoanDocument } from './document.model';

/** Document Centre — every uploaded file with its verification state and expiry. */
@Component({
  selector: 'app-documents-list',
  standalone: true,
  imports: [
    UiBadgeComponent,
    UiButtonDirective,
    UiCardComponent,
    UiCellDirective,
    UiDataTableComponent,
    UiPageHeaderComponent,
    UiSearchInputComponent,
    UiTagComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './documents-list.component.html',
  styleUrl: './documents-list.component.scss',
})
export class DocumentsListComponent {
  readonly rows = DOCUMENTS;
  readonly columns = DOCUMENT_COLUMNS;
  readonly types = DOCUMENT_TYPES;
  readonly statuses = DOCUMENT_STATUSES;

  readonly query = signal('');
  readonly type = signal('all');
  readonly status = signal('all');

  readonly filtered = computed<LoanDocument[]>(() => {
    const term = this.query().trim().toLowerCase();
    return this.rows.filter((r) => {
      if (this.type() !== 'all' && r.categoryKey !== this.type()) return false;
      if (this.status() !== 'all' && r.statusKey !== this.status()) return false;
      if (!term) return true;
      return [r.name, r.linkedRecord, r.uploadedBy].some((v) => v.toLowerCase().includes(term));
    });
  });

  readonly subtitle = computed(() => `${this.rows.length} documents`);
}
