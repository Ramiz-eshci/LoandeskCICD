import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';

import { UiButtonDirective } from '../../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../../shared/ui/ui-card/ui-card.component';
import { UiFormFieldComponent } from '../../../../shared/ui/ui-form-field/ui-form-field.component';
import { UiPageHeaderComponent } from '../../../../shared/ui/ui-page-header/ui-page-header.component';
import { ToastrService } from 'ngx-toastr';

import { UsersService } from '../users.service';
import { MastersService } from '../../masters/masters.service';
import { VALIDATION } from '../../masters/masters.config';
import { RoleOption } from '../users-list/user.model';
import { PASSWORD_HINT, strongPassword } from '../../../../core/util/password.validator';

/** Administration › Users › Add / Edit — profile + MULTI-ROLE assignment (real /api/user). */
@Component({
  selector: 'app-user-form',
  standalone: true,
  imports: [ReactiveFormsModule, UiButtonDirective, UiCardComponent, UiFormFieldComponent, UiPageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-form.component.html',
  styleUrl: './user-form.component.scss',
})
export class UserFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(UsersService);
  private readonly toastr = inject(ToastrService);
  private readonly mastersApi = inject(MastersService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly userId = signal<number | null>(null);
  readonly editMode = computed(() => this.userId() !== null);
  readonly roles = signal<RoleOption[]>([]);
  readonly selected = signal<Set<number>>(new Set());
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly serverErrors = signal<Record<string, string>>({});
  readonly branches = signal<{ value: unknown; label: string }[]>([]);

  readonly form = this.fb.nonNullable.group({
    full_name: ['', [Validators.required, Validators.pattern(VALIDATION.name)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, strongPassword]],
    phone: ['', Validators.pattern(VALIDATION.phone)],
    branch_id: [''],
    is_active: [true],
  });

  readonly passwordHint = PASSWORD_HINT;

  /** Change Password card (edit mode only). */
  readonly pwForm = this.fb.nonNullable.group({
    password: ['', [Validators.required, strongPassword]],
    confirmPassword: ['', Validators.required],
  });
  readonly pwSaving = signal(false);
  readonly pwServerErrors = signal<Record<string, string>>({});

  pwErr(name: 'password' | 'confirmPassword'): string {
    const server = this.pwServerErrors()[name];
    if (server) return server;
    const c = this.pwForm.controls[name];
    if (!c.touched) return '';
    if (c.errors?.['required']) return 'This field is required.';
    if (c.errors?.['passwordPolicy']) return c.errors['passwordPolicy'];
    if (name === 'confirmPassword' && c.value !== this.pwForm.controls.password.value) return 'Passwords do not match.';
    return '';
  }

  changePassword(): void {
    const id = this.userId();
    if (id === null || this.pwSaving()) return;
    this.pwServerErrors.set({});
    this.pwForm.markAllAsTouched();
    const { password, confirmPassword } = this.pwForm.getRawValue();
    if (this.pwForm.invalid || password !== confirmPassword) return;
    this.pwSaving.set(true);
    this.api.changePassword(id, password, confirmPassword)
      .pipe(
        catchError((e: { error?: { message?: string; errors?: Record<string, string[] | string> } }) => {
          this.pwSaving.set(false);
          const errs = e?.error?.errors || {};
          this.pwServerErrors.set(Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)])));
          this.toastr.error(e?.error?.message || 'Could not change the password.', 'Failed');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => {
        if (r === null) return;
        this.pwSaving.set(false);
        this.pwForm.reset();
        this.toastr.success('Password changed successfully.', 'Password');
      });
  }

  readonly subtitle = computed(() => (this.editMode() ? 'Update profile and assigned roles' : 'Create a user and assign one or more roles'));

  err(name: string): string {
    const server = this.serverErrors()[name];
    if (server) return server;
    const c = this.form.get(name);
    if (!c || !c.touched || c.valid) return '';
    if (c.errors?.['required']) return 'This field is required.';
    if (c.errors?.['email']) return 'Enter a valid email address.';
    if (c.errors?.['passwordPolicy']) return c.errors['passwordPolicy'];
    if (c.errors?.['pattern']) {
      if (name === 'phone') return 'Enter a valid phone number.';
      if (name === 'full_name') return "Only letters, spaces, . ' and - are allowed (no numbers or special characters).";
      return 'Special characters are not allowed.';
    }
    return 'Invalid value.';
  }

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    const id = idParam ? Number(idParam) : null;
    this.userId.set(id);

    if (id === null) this.form.controls.password.enable();
    else this.form.controls.password.disable();

    const roles$ = this.api.listRoles().pipe(catchError(() => of([] as RoleOption[])));

    this.mastersApi.list('branch', { perPage: 200, activeOnly: true })
      .pipe(catchError(() => of({ rows: [], meta: null })), takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => this.branches.set(res.rows.map((r) => ({ value: r['branch_id'], label: String(r['branch_name'] ?? r['branch_id']) }))));

    if (id !== null) {
      forkJoin({ roles: roles$, user: this.api.get(id).pipe(catchError(() => of(null))) })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(({ roles, user }) => {
          this.roles.set(roles);
          if (user) {
            this.form.patchValue({
              full_name: user.full_name ?? '',
              email: user.email,
              phone: (user['phone'] as string) ?? '',
              branch_id: user['branch_id'] != null ? String(user['branch_id']) : '',
              is_active: !!user.is_active,
            });
            this.selected.set(new Set((user.roles ?? []).map((r) => r.role_id)));
          } else {
            this.error.set('Could not load user.');
          }
        });
    } else {
      roles$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((roles) => this.roles.set(roles));
    }
  }

  isChecked(id: number): boolean { return this.selected().has(id); }
  toggle(id: number): void {
    const s = new Set(this.selected());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.selected.set(s);
  }

  cancel(): void { void this.router.navigate(['/administration/users']); }

  save(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); this.toastr.warning('Please fix the highlighted fields before saving.', 'Validation'); return; }
    this.saving.set(true);
    this.error.set(null);
    this.serverErrors.set({});
    const v = this.form.getRawValue();
    const roleIds = [...this.selected()];
    const base: Record<string, unknown> = {
      full_name: v.full_name,
      email: v.email.trim(),
      phone: v.phone || null,
      branch_id: v.branch_id ? Number(v.branch_id) : null,
      is_active: v.is_active,
      roleIds,
    };

    const onErr = (e: unknown) => {
      this.saving.set(false);
      const err = e as { error?: { errors?: Record<string, string>; message?: string } };
      if (err?.error?.errors) {
        // API sends { field: ['msg'] } — flatten to the first message per field.
        const flat: Record<string, string> = {};
        for (const [k, val] of Object.entries(err.error.errors as Record<string, unknown>)) {
          flat[k] = Array.isArray(val) ? String(val[0]) : typeof val === 'object' && val && 'message' in val ? String((val as { message: unknown }).message) : String(val);
        }
        this.serverErrors.set(flat);
      }
      this.error.set(err?.error?.message || 'Save failed.');
      this.toastr.error(err?.error?.message || 'Save failed.', 'Save failed');
      return of(null);
    };

    const id = this.userId();
    if (id === null) {
      this.api.create({ ...base, password: v.password })
        .pipe(catchError(onErr), takeUntilDestroyed(this.destroyRef))
        .subscribe((r) => { if (r) this.done('User created successfully.'); });
    } else {
      this.api.update(id, base)
        .pipe(catchError(onErr), takeUntilDestroyed(this.destroyRef))
        .subscribe((r) => { if (r !== null) this.done('User updated successfully.'); });
    }
  }

  private done(message: string): void { this.saving.set(false); this.toastr.success(message, 'Success'); void this.router.navigate(['/administration/users']); }
}
