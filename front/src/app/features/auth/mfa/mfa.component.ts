import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { interval } from 'rxjs';
import { ToastrService } from 'ngx-toastr';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/auth/auth.service';
import { SessionStore } from '../../../core/session/session.store';
import { AuthBrandComponent } from '../auth-brand/auth-brand.component';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';

/** Step 2 of the sign-in journey — 6-digit one-time passcode. */
@Component({
  selector: 'app-mfa',
  standalone: true,
  imports: [AuthBrandComponent, UiButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mfa.component.html',
  styleUrl: '../auth.css',
})
export class MfaComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = inject(SessionStore);
  private readonly toastr = inject(ToastrService);
  readonly auth = inject(AuthService);

  readonly verifying = signal(false);
  readonly resending = signal(false);
  readonly otpError = signal<string | null>(null);

  // Dynamic delivery info (seeded from the login response, refreshed on resend).
  readonly maskedMobile = signal<string | null>(null);
  readonly maskedEmail = signal<string | null>(null);
  readonly hasMobile = computed(() => !!this.maskedMobile());
  readonly hasEmail = computed(() => !!this.maskedEmail());
  /** No channel info (e.g. default-OTP mode) => show a generic prompt. */
  readonly noChannel = computed(() => !this.hasMobile() && !this.hasEmail());

  readonly digits = signal<string[]>(Array(6).fill(''));
  readonly secondsLeft = signal(120);
  readonly resendIn = signal(0); // cooldown seconds before Resend is allowed again

  readonly complete = computed(() => this.digits().every((d) => d !== ''));
  readonly expired = computed(() => this.secondsLeft() === 0);
  readonly countdown = computed(() => {
    const s = this.secondsLeft();
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  });

  ngOnInit(): void {
    // Seed masked recipients + expiry from the login response.
    this.maskedMobile.set(this.auth.maskedMobile);
    this.maskedEmail.set(this.auth.maskedEmail);
    this.secondsLeft.set(this.auth.otpTtlSeconds || 120);

    interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.secondsLeft.update((s) => (s > 0 ? s - 1 : 0));
        this.resendIn.update((s) => (s > 0 ? s - 1 : 0));
      });

    // Dev convenience: prefill the fixed default OTP so the flow is testable.
    const dev = this.auth.devOtp;
    if (dev && dev.length === 6) this.digits.set(dev.split(''));
  }

  onInput(index: number, el: HTMLInputElement): void {
    const value = el.value.replace(/\D/g, '').slice(-1);
    el.value = value;
    this.digits.update((d) => d.map((old, i) => (i === index ? value : old)));
    if (value && index < 5) this.focusBox(index + 1);
  }

  onKeydown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !this.digits()[index] && index > 0) {
      event.preventDefault();
      this.digits.update((d) => d.map((old, i) => (i === index - 1 ? '' : old)));
      this.focusBox(index - 1);
    }
  }

  verify(): void {
    const code = this.digits().join('');

    // Design stage (dev only): advance without the API.
    if (!environment.production && environment.designMode) {
      this.goNext();
      return;
    }

    this.otpError.set(null);
    this.verifying.set(true);
    this.auth.verifyOtp(code).subscribe({
      next: () => {
        this.verifying.set(false);
        this.goNext();
      },
      error: (err: { status?: number; error?: { message?: string } }) => {
        this.verifying.set(false);
        // 403 = account/role blocked since step 1 (server message); else OTP problem.
        this.otpError.set(err?.status === 403 && err?.error?.message
          ? err.error.message
          : 'Incorrect or expired code. Please try again.');
      },
    });
  }

  resend(): void {
    if (this.resending() || this.resendIn() > 0) return;
    if (!environment.production && environment.designMode) {
      this.startCooldown();
      return;
    }
    this.resending.set(true);
    this.otpError.set(null);
    this.auth.resendOtp().subscribe({
      next: () => {
        this.resending.set(false);
        this.maskedMobile.set(this.auth.maskedMobile);
        this.maskedEmail.set(this.auth.maskedEmail);
        this.digits.set(Array(6).fill(''));
        this.secondsLeft.set(this.auth.otpTtlSeconds || 120);
        this.startCooldown();
        const dev = this.auth.devOtp;
        if (dev && dev.length === 6) this.digits.set(dev.split(''));
        this.toastr.success('A new code has been sent.', 'Code resent');
        this.focusBox(0);
      },
      error: () => {
        this.resending.set(false);
        this.toastr.error('Could not resend the code. Please sign in again.', 'Resend failed');
      },
    });
  }

  private startCooldown(): void {
    this.resendIn.set(30);
  }

  private goNext(): void {
    // >1 role -> pick a workspace; single role -> straight to the dashboard.
    const target = this.session.workspaces().length > 1 ? '/workspace' : '/dashboard';
    void this.router.navigate([target]);
  }

  back(): void {
    void this.router.navigate(['/login']);
  }

  private focusBox(index: number): void {
    const boxes = document.querySelectorAll<HTMLInputElement>('.mfa-box');
    boxes.item(index)?.focus();
    boxes.item(index)?.select();
  }
}
