import { Component, ChangeDetectionStrategy, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ToastrService } from 'ngx-toastr';

import { AuthService } from '../../../core/auth/auth.service';
import { AuthBrandComponent } from '../auth-brand/auth-brand.component';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiFormFieldComponent } from '../../../shared/ui/ui-form-field/ui-form-field.component';

/**
 * Forgot password — step 1: user enters their email; the API emails a
 * single-use reset link (valid 1 hour).
 * Unknown emails get "Email does not exist."; deactivated accounts get the
 * deactivated message. Only existing, active users receive a link.
 */
@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, AuthBrandComponent, UiButtonDirective, UiFormFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './forgot-password.component.html',
  styleUrl: '../auth.css',
})
export class ForgotPasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly toastr = inject(ToastrService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(false);
  readonly sent = signal(false);
  readonly sentTo = signal('');
  readonly message = signal('');
  readonly errorMsg = signal<string | null>(null);
  /** Dev only: API returns the link when not in production (no SMTP needed to test). */
  readonly devLink = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  emailError(): string {
    const c = this.form.controls.email;
    if (!(c.invalid && (c.touched || c.dirty))) return '';
    if (c.hasError('required')) return 'Email address is required.';
    if (c.hasError('email')) return 'Enter a valid email address.';
    return '';
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const email = this.form.controls.email.value.trim();
    this.loading.set(true);
    this.errorMsg.set(null);
    this.auth
      .forgotPassword(email)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.loading.set(false);
          this.sent.set(true);
          this.sentTo.set(email);
          this.message.set(res?.message || 'If an account exists for this email, a password reset link has been sent to it.');
          this.devLink.set(res?.data?.devResetLink ?? null);
        },
        error: (err: { status?: number; error?: { message?: string } }) => {
          this.loading.set(false);
          // Unknown / deactivated e-mails get the normal success answer (pen-test 24-10-2026);
          // errors here are validation, rate limit (429) or server problems.
          const msg = err?.error?.message && err.error.message !== 'Validation Error'
            ? err.error.message
            : 'Could not send the reset link. Please try again.';
          this.errorMsg.set(msg);
          this.toastr.error(msg, 'Forgot password');
        },
      });
  }

  /** Back to the email form (e.g. typo in the address). */
  again(): void {
    this.sent.set(false);
    this.devLink.set(null);
  }
}
