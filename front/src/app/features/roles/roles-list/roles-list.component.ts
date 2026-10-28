import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, of } from 'rxjs';

import { HasPermissionDirective } from '../../../core/auth/has-permission.directive';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal/ui-modal.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiPaginationComponent } from '../../../shared/ui/ui-pagination/ui-pagination.component';
import { UiSearchInputComponent } from '../../../shared/ui/ui-search-input/ui-search-input.component';
import { UiTagComponent } from '../../../shared/ui/ui-tag/ui-tag.component';
import { UiCellDirective } from '../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import { TableColumn } from '../../../shared/ui/table/table-column.model';
import { ToastrService } from 'ngx-toastr';

import { RolesService } from '../roles.service';
import { Role } from './role.model';
import { loadErrorMessage } from '../../../core/util/load-error.util';

/** Masters › Roles — server-paged list (same query/format as the Masters module). */
@Component({
  selector: 'app-roles-list',
  standalone: true,
  imports: [
    HasPermissionDirective, UiButtonDirective, UiCardComponent, UiCellDirective, UiDataTableComponent,
    UiModalComponent, UiPageHeaderComponent, UiPaginationComponent, UiSearchInputComponent, UiTagComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './roles-list.component.html',
  styleUrl: './roles-list.component.scss',
})
export class RolesListComponent implements OnInit {
  private readonly api = inject(RolesService);
  private readonly toastr = inject(ToastrService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly rows = signal<Role[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly perPage = 10;
  readonly search = signal('');
  readonly error = signal<string | null>(null);
  readonly pendingDelete = signal<Role | null>(null);

  readonly columns: TableColumn<Role>[] = [
    { key: 'role_id', header: 'ID', width: '70px', mono: true },
    { key: 'role_name', header: 'Role', width: '220px', bold: true },
    { key: 'description', header: 'Description', width: '360px' },
    { key: 'is_active', header: 'Status', width: '120px' },
    { key: 'actions', header: 'Actions', width: '200px' },
  ];

  readonly hasNext = computed(() => this.page() * this.perPage < this.total());
  readonly subtitle = computed(() => `${this.total()} roles configured`);
  readonly pageSummary = computed(() => {
    const from = this.total() ? (this.page() - 1) * this.perPage + 1 : 0;
    const to = Math.min(this.page() * this.perPage, this.total());
    return `Showing ${from}–${to} of ${this.total()}`;
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.api.listRoles({ page: this.page(), per_page: this.perPage, search: this.search() })
      .pipe(
        catchError((e) => {
          this.error.set(loadErrorMessage(e, 'roles'));
          return of({ rows: [] as Role[], meta: null });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.rows.set(res.rows);
        this.total.set(res.meta && typeof res.meta.total === 'number' ? res.meta.total : res.rows.length);
      });
  }

  applySearch(): void { this.page.set(1); this.load(); }
  prev(): void { if (this.page() > 1) { this.page.update((p) => p - 1); this.load(); } }
  next(): void { if (this.hasNext()) { this.page.update((p) => p + 1); this.load(); } }

  create(): void {
    void this.router.navigate(['/masters/roles/new']);
  }

  edit(role: Role): void {
    void this.router.navigate(['/masters/roles', role.role_id, 'edit']);
  }

  askDelete(role: Role): void {
    if (role.role_id === 1) return;
    this.pendingDelete.set(role);
  }

  confirmDelete(role: Role): void {
    const FAIL = Symbol('fail');
    this.api.deleteRole(role.role_id)
      .pipe(
        catchError(() => {
          this.error.set('Delete failed.');
          this.toastr.error('Delete failed.', 'Delete failed');
          return of(FAIL);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.pendingDelete.set(null);
        if (res === FAIL) return;
        this.toastr.success('Role deleted successfully.', 'Deleted');
        this.load();
      });
  }
}
