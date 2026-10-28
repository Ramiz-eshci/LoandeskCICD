import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, forkJoin, of, map } from 'rxjs';

import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiFormFieldComponent } from '../../../shared/ui/ui-form-field/ui-form-field.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { ToastrService } from 'ngx-toastr';

import { RolesService } from '../roles.service';
import { VALIDATION } from '../../administration/masters/masters.config';
import { ModuleDef, PermissionDef } from '../roles-list/role.model';

/** Preferred action order + short header labels for the permission matrix. */
/**
 * Matrix actions are compressed to 7: View, Add, Edit, Delete, Approve, Reject, Export.
 * Merged (seeder 20260101000049): assign/submit/convert/query/upload/accept/act/respond -> add,
 * decide -> approve. Hidden actions (view_all, configure, download, proceed) are unchanged.
 */
const ACTION_ORDER = ['view', 'view_all', 'add', 'edit', 'delete', 'configure', 'approve', 'reject', 'proceed', 'export', 'download'];
const ACTION_LABEL: Record<string, string> = {
  view: 'View', view_all: 'View All', add: 'Add', edit: 'Edit', delete: 'Delete', configure: 'Config',
  approve: 'Approve', reject: 'Reject', proceed: 'Proceed', export: 'Export', download: 'Download',
};

interface MatrixGroup { code: string; name: string; leaves: { code: string; name: string }[]; }

/** Masters › Roles › Add / Edit — role details + DYNAMIC module-wise permission matrix (sheet-driven). */
/**
 * Row label for a top module's own permissions when it also has children —
 * PORTFOLIO / CUSTOMERS view is now the 'assigned only' list, next to
 * 'All Portfolio' / 'All Customers' (client 29-09-2026).
 */
const TOP_LEAF_LABEL: Record<string, string> = { PORTFOLIO: 'Portfolio List', CUSTOMERS: 'Customer List', BROKERS: 'Broker List' };

@Component({
  selector: 'app-role-form',
  standalone: true,
  imports: [ReactiveFormsModule, UiButtonDirective, UiCardComponent, UiFormFieldComponent, UiPageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './role-form.component.html',
  styleUrl: './role-form.component.scss',
})
export class RoleFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(RolesService);
  private readonly toastr = inject(ToastrService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly roleId = signal<number | null>(null);
  readonly editMode = computed(() => this.roleId() !== null);

  readonly allPerms = signal<PermissionDef[]>([]);
  readonly modules = signal<ModuleDef[]>([]);
  readonly selected = signal<Set<number>>(new Set());
  /** Perm ids for hidden actions (e.g. configure) that were already granted — preserved on save, never shown. */
  private readonly hiddenGranted = signal<Set<number>>(new Set());
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly serverErrors = signal<Record<string, string>>({});

  readonly form = this.fb.nonNullable.group({
    roleName: ['', [Validators.required, Validators.pattern(VALIDATION.name)]],
    description: [''],
    isActive: [true],
  });

  /** Actions never shown as matrix columns (seeded but not enforced anywhere). */
  private static readonly HIDDEN_ACTIONS = new Set(['configure', 'view_all', 'download']);
  /** Hidden actions that ARE enforced on specific screens — shown as a column only for these modules.
   *  (CUSTOMERS.DOCUMENT upload is now the Add column.) */
  private static readonly SCOPED_ACTIONS: Record<string, Set<string>> = {};

  /** True when this permission row is a visible matrix cell. */
  private isVisiblePerm(moduleKey: string, action: string): boolean {
    if (!RoleFormComponent.HIDDEN_ACTIONS.has(action)) return true;
    return RoleFormComponent.SCOPED_ACTIONS[action]?.has(moduleKey) ?? false;
  }

  readonly actions = computed(() => {
    const present = new Set(this.allPerms().filter((p) => this.isVisiblePerm(p.module_key, p.permission_key)).map((p) => p.permission_key));
    const ordered = ACTION_ORDER.filter((a) => present.has(a));
    const extras = [...present].filter((a) => !ACTION_ORDER.includes(a)).sort();
    return [...ordered, ...extras];
  });

  /** Perm ids whose action is a visible matrix column. */
  private visiblePermIds(): Set<number> {
    return new Set(this.allPerms().filter((p) => this.isVisiblePerm(p.module_key, p.permission_key)).map((p) => p.permission_id));
  }

  /** Group leaf screens (that have permissions) under their top module. */
  readonly grouped = computed<MatrixGroup[]>(() => {
    const permCodes = new Set(this.allPerms().map((p) => p.module_key));
    const mods = this.modules();
    if (!mods.length) return [];
    const bySort = (a: ModuleDef, b: ModuleDef) => a.sort_order - b.sort_order;
    const tops = mods.filter((m) => !m.parent_code).sort(bySort);
    const groups: MatrixGroup[] = [];
    for (const top of tops) {
      const leaves = mods
        .filter((m) => m.parent_code === top.module_code && permCodes.has(m.module_code))
        .sort(bySort)
        .map((m) => ({ code: m.module_code, name: m.module_name }));
      const topHasPerms = permCodes.has(top.module_code);
      if (topHasPerms) {
        groups.push({ code: top.module_code, name: top.module_name, leaves: [{ code: top.module_code, name: TOP_LEAF_LABEL[top.module_code] || top.module_name }, ...leaves] });
      } else if (leaves.length) {
        groups.push({ code: top.module_code, name: top.module_name, leaves });
      }
    }
    return groups;
  });

  readonly selectedCount = computed(() => this.selected().size);

  readonly subtitle = computed(() =>
    this.editMode() ? 'Update role details and module-wise permissions' : 'Create a role and assign module-wise permissions',
  );

  nameError(): string {
    const server = this.serverErrors()['roleName'];
    if (server) return server;
    const c = this.form.controls.roleName;
    if (!c.touched || c.valid) return '';
    if (c.errors?.['required']) return 'Role name is required.';
    if (c.errors?.['pattern']) return "Only letters, spaces, . ' and - are allowed (no numbers or special characters).";
    return '';
  }

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    const id = idParam ? Number(idParam) : null;
    this.roleId.set(id);

    const perms$ = this.api.listPermissions().pipe(catchError(() => of([] as PermissionDef[])));
    const modules$ = this.api.listModules().pipe(catchError(() => of([] as ModuleDef[])));

    if (id !== null) {
      forkJoin({
        perms: perms$,
        modules: modules$,
        granted: this.api.getRolePermissions(id).pipe(catchError(() => of([] as PermissionDef[]))),
        roles: this.api.listRoles({ per_page: 100 }).pipe(map((pg) => pg.rows), catchError(() => of([] as { role_id: number; role_name: string; description: string | null; is_active: boolean | number }[]))),
      })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(({ perms, modules, granted, roles }) => {
          this.allPerms.set(perms);
          this.modules.set(modules);
          const visIds = this.visiblePermIds();
          const sel = new Set<number>();
          const hid = new Set<number>();
          for (const g of granted) { (visIds.has(g.permission_id) ? sel : hid).add(g.permission_id); }
          this.selected.set(sel);
          this.hiddenGranted.set(hid);
          const role = roles.find((r) => r.role_id === id);
          if (role) {
            this.form.patchValue({ roleName: role.role_name, description: role.description ?? '', isActive: !!role.is_active });
          }
          if (!perms.length || !modules.length) this.error.set('You do not have permission to manage roles and permissions. Please contact your administrator.');
          this.loading.set(false);
        });
    } else {
      forkJoin({ perms: perms$, modules: modules$ })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(({ perms, modules }) => {
          this.allPerms.set(perms);
          this.modules.set(modules);
          if (!perms.length || !modules.length) this.error.set('You do not have permission to manage roles and permissions. Please contact your administrator.');
          this.loading.set(false);
        });
    }
  }

  label(action: string): string {
    return ACTION_LABEL[action] ?? action;
  }

  permId(moduleCode: string, action: string): number | null {
    if (!this.isVisiblePerm(moduleCode, action)) return null;
    const p = this.allPerms().find((x) => x.module_key === moduleCode && x.permission_key === action);
    return p ? p.permission_id : null;
  }

  isChecked(pid: number): boolean {
    return this.selected().has(pid);
  }

  toggle(pid: number): void {
    const s = new Set(this.selected());
    if (s.has(pid)) s.delete(pid);
    else s.add(pid);
    this.selected.set(s);
  }

  private moduleIds(moduleCode: string): number[] {
    return this.allPerms().filter((p) => p.module_key === moduleCode && this.isVisiblePerm(p.module_key, p.permission_key)).map((p) => p.permission_id);
  }

  moduleAllChecked(moduleCode: string): boolean {
    const ids = this.moduleIds(moduleCode);
    return ids.length > 0 && ids.every((id) => this.selected().has(id));
  }

  toggleModule(moduleCode: string): void {
    const ids = this.moduleIds(moduleCode);
    const s = new Set(this.selected());
    const allOn = ids.every((id) => s.has(id));
    for (const id of ids) {
      if (allOn) s.delete(id);
      else s.add(id);
    }
    this.selected.set(s);
  }

  selectAll(): void {
    this.selected.set(this.visiblePermIds());
  }

  clearAll(): void {
    this.selected.set(new Set());
  }

  cancel(): void {
    void this.router.navigate(['/masters/roles']);
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toastr.warning('Please fix the highlighted fields before saving.', 'Validation');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    const { roleName, description, isActive } = this.form.getRawValue();
    const ids = [...this.selected(), ...this.hiddenGranted()];
    const id = this.roleId();

    if (id === null) {
      this.api.createRole({ roleName, description })
        .pipe(catchError(() => { this.fail('Create role failed.'); return of(null); }), takeUntilDestroyed(this.destroyRef))
        .subscribe((res) => {
          if (!res) return;
          this.api.setRolePermissions(res.roleId, ids)
            .pipe(catchError(() => { this.fail('Role created, but saving permissions failed.'); return of(null); }), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.done('Role created successfully.'));
        });
    } else {
      this.api.updateRole(id, { roleName, description, is_active: isActive })
        .pipe(catchError(() => { this.fail('Update role failed.'); return of(null); }), takeUntilDestroyed(this.destroyRef))
        .subscribe((res) => {
          if (res === null) return;
          this.api.setRolePermissions(id, ids)
            .pipe(catchError(() => { this.fail('Saving permissions failed.'); return of(null); }), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.done('Role updated successfully.'));
        });
    }
  }

  private done(message: string): void {
    this.saving.set(false);
    this.toastr.success(message, 'Success');
    void this.router.navigate(['/masters/roles']);
  }

  private fail(msg: string): void {
    this.saving.set(false);
    this.error.set(msg);
    this.toastr.error(msg, 'Save failed');
  }

  private failFrom(e: unknown, fallback: string): void {
    this.saving.set(false);
    const err = e as { error?: { errors?: Record<string, string>; message?: string } };
    if (err?.error?.errors) this.serverErrors.set(err.error.errors);
    this.error.set(err?.error?.message || fallback);
  }
}
