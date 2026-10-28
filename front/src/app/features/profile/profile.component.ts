import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ToastrService } from 'ngx-toastr';
import { catchError, of } from 'rxjs';

import { SessionStore } from '../../core/session/session.store';
import { PASSWORD_HINT, strongPassword } from '../../core/util/password.validator';
import { VALIDATION } from '../administration/masters/masters.config';
import { UiAvatarComponent } from '../../shared/ui/ui-avatar/ui-avatar.component';
import { UiButtonDirective } from '../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../shared/ui/ui-card/ui-card.component';
import { UiFormFieldComponent } from '../../shared/ui/ui-form-field/ui-form-field.component';
import { UiPageHeaderComponent } from '../../shared/ui/ui-page-header/ui-page-header.component';
import { MyProfile, ProfileService } from './profile.service';

type ApiErr = { error?: { message?: string; errors?: Record<string, string[] | string> } };
const AVATAR_PX = 256;
const MAX_INPUT_BYTES = 10 * 1024 * 1024;

/**
 * Profile & preferences (client 26-10-2026): the signed-in user edits their own name /
 * phone, changes their password (current password required) and sets a profile picture
 * that replaces the initials in the header and sidebar.
 */
@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [ReactiveFormsModule, UiAvatarComponent, UiButtonDirective, UiCardComponent, UiFormFieldComponent, UiPageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ProfileService);
  private readonly toastr = inject(ToastrService);
  private readonly destroyRef = inject(DestroyRef);
  readonly session = inject(SessionStore);

  readonly passwordHint = PASSWORD_HINT;
  readonly profile = signal<MyProfile | null>(null);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly pwSaving = signal(false);
  readonly avatarSaving = signal(false);
  readonly serverErrors = signal<Record<string, string>>({});

  readonly form = this.fb.nonNullable.group({
    full_name: ['', [Validators.required, Validators.pattern(VALIDATION.name)]],
    phone: ['', Validators.pattern(VALIDATION.phone)],
  });

  readonly pwForm = this.fb.nonNullable.group({
    currentPassword: ['', Validators.required],
    password: ['', [Validators.required, strongPassword]],
    confirmPassword: ['', Validators.required],
  });

  ngOnInit(): void {
    this.api.get()
      .pipe(catchError(() => { this.error.set('Could not load your profile.'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((p) => { if (p) this.apply(p); });
  }

  private apply(p: MyProfile): void {
    this.profile.set(p);
    this.form.patchValue({ full_name: p.fullName ?? '', phone: p.phone ?? '' });
    this.session.displayName.set(p.fullName ?? '');
    this.session.avatar.set(p.avatar ?? null);
  }

  private flatErrors(e: ApiErr): Record<string, string> {
    const errs = e?.error?.errors || {};
    return Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)]));
  }

  err(name: 'full_name' | 'phone'): string {
    const server = this.serverErrors()[name];
    if (server) return server;
    const c = this.form.controls[name];
    if (!c.touched || c.valid) return '';
    if (c.errors?.['required']) return 'This field is required.';
    if (name === 'phone') return 'Enter a valid phone number.';
    return "Only letters, spaces, . ' and - are allowed (no numbers or special characters).";
  }

  pwErr(name: 'currentPassword' | 'password' | 'confirmPassword'): string {
    const server = this.serverErrors()[name];
    if (server) return server;
    const c = this.pwForm.controls[name];
    if (!c.touched) return '';
    if (c.errors?.['required']) return 'This field is required.';
    if (c.errors?.['passwordPolicy']) return c.errors['passwordPolicy'];
    if (name === 'confirmPassword' && c.value !== this.pwForm.controls.password.value) return 'Passwords do not match.';
    return '';
  }

  save(): void {
    this.serverErrors.set({});
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.saving.set(true);
    const v = this.form.getRawValue();
    this.api.update({ full_name: v.full_name.trim(), phone: v.phone.trim() })
      .pipe(
        catchError((e: ApiErr) => {
          this.saving.set(false);
          this.serverErrors.set(this.flatErrors(e));
          this.toastr.error(e?.error?.message || 'Could not save your details.', 'Failed');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((p) => {
        if (!p) return;
        this.saving.set(false);
        this.apply(p);
        this.toastr.success('Your details have been saved.', 'Profile');
      });
  }

  changePassword(): void {
    this.serverErrors.set({});
    this.pwForm.markAllAsTouched();
    const v = this.pwForm.getRawValue();
    if (this.pwForm.invalid || v.password !== v.confirmPassword || this.pwSaving()) return;
    this.pwSaving.set(true);
    this.api.changePassword(v)
      .pipe(
        catchError((e: ApiErr) => {
          this.pwSaving.set(false);
          this.serverErrors.set(this.flatErrors(e));
          this.toastr.error(e?.error?.message || 'Could not change your password.', 'Failed');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => {
        if (r === null) return;
        this.pwSaving.set(false);
        this.pwForm.reset();
        this.toastr.success('Your password has been changed.', 'Password');
      });
  }

  /** Picked file -> centre-cropped 256px JPEG data URL -> API. */
  onFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { this.toastr.warning('Choose a PNG, JPG or WEBP image.', 'Profile picture'); return; }
    if (file.size > MAX_INPUT_BYTES) { this.toastr.warning('The image is too large (max 10 MB).', 'Profile picture'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = AVATAR_PX;
      canvas.height = AVATAR_PX;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, AVATAR_PX, AVATAR_PX);
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
      URL.revokeObjectURL(url);
      this.saveAvatar(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); this.toastr.warning('The file is not a valid image.', 'Profile picture'); };
    img.src = url;
  }

  removeAvatar(): void { this.saveAvatar(null); }

  private saveAvatar(dataUrl: string | null): void {
    this.avatarSaving.set(true);
    this.api.setAvatar(dataUrl)
      .pipe(
        catchError((e: ApiErr) => {
          this.avatarSaving.set(false);
          const msg = this.flatErrors(e)['avatar'] || e?.error?.message || 'Could not update your profile picture.';
          this.toastr.error(msg, 'Profile picture');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => {
        if (!r) return;
        this.avatarSaving.set(false);
        this.session.avatar.set(r.avatar);
        const p = this.profile();
        if (p) this.profile.set({ ...p, avatar: r.avatar });
        this.toastr.success(r.avatar ? 'Profile picture updated.' : 'Profile picture removed.', 'Profile picture');
      });
  }
}
