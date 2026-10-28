import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, of } from 'rxjs';

import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiTagComponent } from '../../../shared/ui/ui-tag/ui-tag.component';
import { UiCellDirective } from '../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import { TableColumn } from '../../../shared/ui/table/table-column.model';
import { UiTabFiltersComponent, TabFilter } from '../../../shared/ui/ui-tab-filters/ui-tab-filters.component';
import { loadErrorMessage } from '../../../core/util/load-error.util';
import { EmailEventRow, EmailService } from '../email.service';

/**
 * Masters > Email Settings (client 17-10-2026): every automatic e-mail the system sends,
 * with who it goes to and who is copied in. Click a row to change the CC, text or files.
 */
@Component({
  selector: 'app-email-settings-list',
  standalone: true,
  imports: [UiButtonDirective, UiCardComponent, UiCellDirective, UiDataTableComponent, UiPageHeaderComponent, UiTabFiltersComponent, UiTagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './email-settings-list.component.html',
  styleUrl: './email-settings-list.component.scss',
})
export class EmailSettingsListComponent implements OnInit {
  private readonly api = inject(EmailService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly rows = signal<EmailEventRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly activeTab = signal('all');

  readonly tabs = computed<TabFilter[]>(() => {
    const all = this.rows();
    const mods: { key: string; label: string }[] = [];
    all.forEach((r) => { if (!mods.some((m) => m.key === r.module)) mods.push({ key: r.module, label: r.module_name }); });
    return [{ key: 'all', label: 'All', count: all.length }, ...mods.map((m) => ({ ...m, count: all.filter((r) => r.module === m.key).length }))];
  });

  readonly filtered = computed(() => (this.activeTab() === 'all' ? this.rows() : this.rows().filter((r) => r.module === this.activeTab())));
  readonly subtitle = computed(() => `${this.rows().length} automatic e-mail(s) · choose who is copied in, the wording and extra files`);

  readonly columns: TableColumn<EmailEventRow>[] = [
    { key: 'module_name', header: 'Module', width: '120px' },
    { key: 'name', header: 'Email', bold: true },
    { key: 'to', header: 'Sent to' },
    { key: 'cc', header: 'Copied in (CC)' },
    { key: 'text', header: 'Wording', width: '120px' },
    { key: 'extra_files', header: 'Extra files', width: '100px', align: 'center' },
    { key: 'actions', header: '', width: '90px', align: 'end' },
  ];

  ngOnInit(): void {
    this.api.list()
      .pipe(catchError((e) => { this.error.set(loadErrorMessage(e, 'email settings')); return of([] as EmailEventRow[]); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((rows) => { this.rows.set(rows); this.loading.set(false); });
  }

  systemCc(r: EmailEventRow): string {
    if (r.default_cc === 'None') return '';
    return r.keep_default_cc || r.cc_from_user ? r.default_cc : '';
  }

  open(r: EmailEventRow): void {
    this.router.navigate(['/masters/email-settings', r.event_key]);
  }
}
