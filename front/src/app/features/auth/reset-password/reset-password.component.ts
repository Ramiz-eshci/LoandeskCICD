import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ToastrService } from 'ngx-toastr';

import { AuthService } from '../../../core/auth/auth.service';
import { AuthBrandComponent } from '../auth-brand/auth-brand.component';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiFormFieldComponent } from '../../../shared/ui/ui-form-field/ui-form-field.component';
import { PASSWORD_HINT, strongPassword } from '../../../core/util/password.validator';

type ResetState = 'checking' | 'invalid' | 'form' | 'done';

/** Group validator: confirm password must equal password. */
function matchPasswords(group: AbstractControl): ValidationErrors | null {
  const p = group.get('password')?.value;
  const c = group.get('confirmPassword')?.value;
  return p && c && p !== c ? { mismatch: true } : null;
}

/**
 * Forgot password — step 2: opened from the emailed link
 * (/reset-password?token=...). The token is checked first; a used or
 * expired (> 1 hour) link shows the "link expired" state. The API consumes
 * the token atomically, so a link can change the password only once.
 */
@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, AuthBrandComponent, UiButtonDirective, UiFormFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reset-password.component.html',
  styleUrl: '../auth.css',
})
export class ResetPasswordComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toastr = inject(ToastrService);
  private readonly destroyRef = inject(DestroyRef);

  private token = '';
  readonly state = signal<ResetState>('checking');
  readonly maskedEmail = signal<string | null>(null);
  readonly invalidMsg = signal('This password reset link is invalid or has expired. Please request a new one.');
  readonly saving = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly reveal = signal(false);
  readonly revealConfirm = signal(false);
  readonly passwordHint = PASSWORD_HINT;

  readonly form = this.fb.nonNullable.group(
    {
      password: ['', [Validators.required, strongPassword]],
      confirmPassword: ['', Validators.required],
    },
    { validators: matchPasswords },
  );

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (!this.token) {
      this.state.set('invalid');
      return;
    }
    this.auth
      .validateResetToken(this.token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (d) => {
          this.maskedEmail.set(d?.maskedEmail ?? null);
          this.state.set(d?.valid ? 'form' : 'invalid');
        },
        error: (err: { error?: { message?: string } }) => {
          if (err?.error?.message) this.invalidMsg.set(err.error.message);
          this.state.set('invalid');
        },
      });
  }

  passwordError(): string {
    const c = this.form.controls.password;
    if (!(c.invalid && (c.touched || c.dirty))) return '';
    if (c.hasError('required')) return 'New password is required.';
    if (c.hasError('passwordPolicy')) return c.getError('passwordPolicy');
    return '';
  }

  confirmError(): string {
    const c = this.form.controls.confirmPassword;
    if (!(c.touched || c.dirty)) return '';
    if (c.hasError('required')) return 'Please confirm your new password.';
    if (this.form.hasError('mismatch')) return 'Passwords do not match.';
    return '';
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { password, confirmPassword } = this.form.getRawValue();
    this.saving.set(true);
    this.errorMsg.set(null);
    this.auth
      .resetPassword(this.token, password, confirmPassword)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          this.state.set('done');
          this.toastr.success(res?.message || 'Your password has been reset.', 'Password reset');
          // Drop the (now used) token from the address bar.
          void this.router.navigate([], { queryParams: {}, replaceUrl: true });
        },
        error: (err: { error?: { message?: string; errors?: Record<string, string[] | string> } }) => {
          this.saving.set(false);
          const fieldErrs = err?.error?.errors;
          if (fieldErrs) {
            const first = Object.values(fieldErrs)[0];
            this.errorMsg.set(Array.isArray(first) ? first[0] : String(first));
            return;
          }
          // Used / expired while the form was open.
          if (err?.error?.message) this.invalidMsg.set(err.error.message);
          this.state.set('invalid');
        },
      });
  }
}
