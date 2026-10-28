import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';

import { TabFilter, UiTabFiltersComponent } from '../../../shared/ui/ui-tab-filters/ui-tab-filters.component';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiKpiCardComponent } from '../../../shared/ui/ui-kpi-card/ui-kpi-card.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiTagComponent } from '../../../shared/ui/ui-tag/ui-tag.component';
import { UiCellDirective } from '../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import { TableColumn } from '../../../shared/ui/table/table-column.model';
import { AdministrationService } from '../administration.service';
import { AdminRole, AdminUser } from './administration.model';
import { loadErrorMessage } from '../../../core/util/load-error.util';

/** Administration — Users & Roles master maintenance (wired to real /api/user, /api/roles). */
@Component({
  selector: 'app-administration-list',
  standalone: true,
  imports: [
    UiCardComponent, UiCellDirective, UiDataTableComponent, UiKpiCardComponent,
    UiPageHeaderComponent, UiTabFiltersComponent, UiTagComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './administration-list.component.html',
  styleUrl: './administration-list.component.scss',
})
export class AdministrationListComponent implements OnInit {
  private readonly api = inject(AdministrationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly users = signal<AdminUser[]>([]);
  readonly roles = signal<AdminRole[]>([]);
  readonly live = signal(false);
  readonly error = signal<string | null>(null);
  readonly activeTab = signal('users');

  readonly activeUsers = computed(() => this.users().filter((u) => !!u.is_active).length);

  readonly tabs = computed<TabFilter[]>(() => [
    { key: 'users', label: 'Users', count: this.users().length },
    { key: 'roles', label: 'Roles', count: this.roles().length },
  ]);

  readonly subtitle = computed(() =>
    `${this.users().length} users · ${this.roles().length} roles`,
  );

  readonly userColumns: TableColumn<AdminUser>[] = [
    { key: 'user_id', header: 'ID', width: '70px', mono: true },
    { key: 'full_name', header: 'Name', width: '200px' },
    { key: 'email', header: 'Email', width: '240px' },
    { key: 'is_active', header: 'Status', width: '120px' },
    { key: 'is_super_admin', header: 'Access', width: '140px' },
  ];

  readonly roleColumns: TableColumn<AdminRole>[] = [
    { key: 'role_id', header: 'ID', width: '70px', mono: true },
    { key: 'role_name', header: 'Role', width: '220px', bold: true },
    { key: 'description', header: 'Description', width: '320px' },
    { key: 'is_active', header: 'Status', width: '120px' },
  ];

  ngOnInit(): void {
    this.api.getUsers()
      .pipe(
        catchError((e) => {
          this.error.set(loadErrorMessage(e, 'users'));
          return of([] as AdminUser[]);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((rows) => {
        this.users.set(rows);
        if (rows.length) this.live.set(true);
      });

    this.api.getRoles()
      .pipe(
        catchError(() => of([] as AdminRole[])),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((rows) => {
        this.roles.set(rows);
        if (rows.length) this.live.set(true);
      });
  }
}
