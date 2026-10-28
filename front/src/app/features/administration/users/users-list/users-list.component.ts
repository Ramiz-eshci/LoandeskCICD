import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, of } from 'rxjs';

import { HasPermissionDirective } from '../../../../core/auth/has-permission.directive';
import { UiButtonDirective } from '../../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../../shared/ui/ui-card/ui-card.component';
import { UiModalComponent } from '../../../../shared/ui/ui-modal/ui-modal.component';
import { UiPageHeaderComponent } from '../../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiPaginationComponent } from '../../../../shared/ui/ui-pagination/ui-pagination.component';
import { UiSearchInputComponent } from '../../../../shared/ui/ui-search-input/ui-search-input.component';
import { UiTagComponent } from '../../../../shared/ui/ui-tag/ui-tag.component';
import { UiCellDirective } from '../../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../../shared/ui/table/ui-data-table.component';
import { TableColumn } from '../../../../shared/ui/table/table-column.model';
import { ToastrService } from 'ngx-toastr';

import { UsersService } from '../users.service';
import { AdminUser, RoleOption } from './user.model';
import { FormsModule } from '@angular/forms';
import { loadErrorMessage } from '../../../../core/util/load-error.util';

/** Administration › Users — server-paged list (same query/format as the Masters module). */
@Component({
  selector: 'app-users-list',
  standalone: true,
  imports: [
    HasPermissionDirective, UiButtonDirective, UiCardComponent, UiCellDirective, UiDataTableComponent, UiModalComponent,
    UiPageHeaderComponent, UiPaginationComponent, UiSearchInputComponent, UiTagComponent, FormsModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './users-list.component.html',
  styleUrl: './users-list.component.scss',
})
export class UsersListComponent implements OnInit {
  private readonly api = inject(UsersService);
  private readonly toastr = inject(ToastrService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly rows = signal<AdminUser[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly perPage = 10;
  readonly search = signal('');
  readonly roleOptions = signal<RoleOption[]>([]);
  readonly roleId = signal<number | null>(null);
  readonly error = signal<string | null>(null);
  readonly pending = signal<AdminUser | null>(null);
  readonly pendingDelete = signal<AdminUser | null>(null);
  readonly deleting = signal(false);

  readonly columns: TableColumn<AdminUser>[] = [
    { key: 'user_id', header: 'ID', width: '70px', mono: true },
    { key: 'full_name', header: 'Name', width: '190px' },
    { key: 'email', header: 'Email', width: '230px' },
    { key: 'rolesText', header: 'Roles', width: '240px' },
    { key: 'is_active', header: 'Status', width: '110px' },
    { key: 'actions', header: 'Actions', width: '290px' },
  ];

  readonly hasNext = computed(() => this.page() * this.perPage < this.total());
  readonly subtitle = computed(() => `${this.total()} user(s)`);
  readonly pageSummary = computed(() => {
    const from = this.total() ? (this.page() - 1) * this.perPage + 1 : 0;
    const to = Math.min(this.page() * this.perPage, this.total());
    return `Showing ${from}–${to} of ${this.total()}`;
  });

  ngOnInit(): void {
    this.load();
    this.api.listRoles().pipe(catchError(() => of([] as RoleOption[])), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => this.roleOptions.set(r));
  }

  private load(): void {
    this.api.list({ page: this.page(), per_page: this.perPage, search: this.search(), role_id: this.roleId() })
      .pipe(
        catchError((e) => {
          this.error.set(loadErrorMessage(e, 'users'));
          return of({ rows: [] as AdminUser[], meta: null });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.rows.set(res.rows);
        this.total.set(res.meta && typeof res.meta.total === 'number' ? res.meta.total : res.rows.length);
      });
  }

  applySearch(): void { this.page.set(1); this.load(); }
  applyRoleFilter(v: unknown): void { this.roleId.set(v ? Number(v) : null); this.page.set(1); this.load(); }
  prev(): void { if (this.page() > 1) { this.page.update((p) => p - 1); this.load(); } }
  next(): void { if (this.hasNext()) { this.page.update((p) => p + 1); this.load(); } }

  rolesText(u: AdminUser): string {
    if (u.roles_text) return u.roles_text;
    if (u.roles && u.roles.length) return u.roles.map((r) => r.role_name).join(', ');
    return '—';
  }

  create(): void { void this.router.navigate(['/administration/users/new']); }
  edit(u: AdminUser): void { void this.router.navigate(['/administration/users', u.user_id, 'edit']); }
  ask(u: AdminUser): void { if (!u.is_super_admin) this.pending.set(u); }
  confirm(u: AdminUser): void { this.setActive(u, false); this.pending.set(null); }

  askDelete(u: AdminUser): void { if (!u.is_super_admin) this.pendingDelete.set(u); }

  /** Soft delete — row disappears from the list; the user can no longer sign in. */
  confirmDelete(u: AdminUser): void {
    const FAIL = Symbol('fail');
    this.deleting.set(true);
    this.api.remove(u.user_id)
      .pipe(
        catchError((e: { error?: { message?: string } }) => {
          const msg = e?.error?.message || 'Delete failed.';
          this.toastr.error(msg, 'Delete failed');
          return of(FAIL);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.deleting.set(false);
        this.pendingDelete.set(null);
        if (res === FAIL) return;
        this.toastr.success('User deleted successfully.', 'Deleted');
        // Step back a page if we just removed the last row on this page.
        if (this.rows().length === 1 && this.page() > 1) this.page.update((p) => p - 1);
        this.load();
      });
  }

  setActive(u: AdminUser, active: boolean): void {
    const FAIL = Symbol('fail');
    this.api.deactivate(u.user_id, active)
      .pipe(
        catchError((e: { error?: { message?: string } }) => {
          const msg = e?.error?.message || 'Update failed.';
          this.error.set(msg);
          this.toastr.error(msg, 'Update failed');
          return of(FAIL);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        if (res === FAIL) return;
        this.toastr.success(active ? 'User activated successfully.' : 'User deactivated successfully.', 'Updated');
        this.load();
      });
  }
}
