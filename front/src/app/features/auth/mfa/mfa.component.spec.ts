import { ComponentFixture, TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';

import { AuthService } from '../../../core/auth/auth.service';
import { SessionStore } from '../../../core/session/session.store';
import { MfaComponent } from './mfa.component';

describe('MfaComponent', () => {
  let fixture: ComponentFixture<MfaComponent>;
  let cmp: MfaComponent;
  let navigate: jest.SpyInstance;
  const workspaces = signal<unknown[]>([]);
  const auth = {
    maskedMobile: null as string | null,
    maskedEmail: 'ja**@lender.co.uk' as string | null,
    otpTtlSeconds: 300,
    devOtp: null as string | null,
    verifyOtp: jest.fn(),
    resendOtp: jest.fn(),
  };
  const toastr = { success: jest.fn(), error: jest.fn() };

  function create(): void {
    TestBed.configureTestingModule({
      imports: [MfaComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: ToastrService, useValue: toastr },
        { provide: SessionStore, useValue: { workspaces } },
      ],
    });
    fixture = TestBed.createComponent(MfaComponent);
    cmp = fixture.componentInstance;
    navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    auth.devOtp = null;
    workspaces.set([]);
  });

  const typeCode = (code: string) => code.split('').forEach((d, i) => {
    const el = document.createElement('input');
    el.value = d;
    cmp.onInput(i, el);
  });

  it('seeds the masked e-mail and the expiry from the login response', fakeAsync(() => {
    create();
    fixture.detectChanges();
    expect(cmp.maskedEmail()).toBe('ja**@lender.co.uk');
    expect(cmp.noChannel()).toBe(false);
    expect(cmp.countdown()).toBe('05:00');
    tick(1000);
    expect(cmp.countdown()).toBe('04:59');
    discardPeriodicTasks();
  }));

  it('accepts digits only and knows when the code is complete', fakeAsync(() => {
    create();
    fixture.detectChanges();
    const el = document.createElement('input');
    el.value = 'a7';
    cmp.onInput(0, el);
    expect(el.value).toBe('7');
    expect(cmp.complete()).toBe(false);
    typeCode('123456');
    expect(cmp.digits()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(cmp.complete()).toBe(true);
    discardPeriodicTasks();
  }));

  it('backspace on an empty box clears the previous one', fakeAsync(() => {
    create();
    fixture.detectChanges();
    typeCode('12');
    const ev = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
    cmp.onKeydown(2, ev);
    expect(cmp.digits().slice(0, 3)).toEqual(['1', '', '']);
    discardPeriodicTasks();
  }));

  it('verifies the code and goes to the dashboard (single role) or workspace picker', fakeAsync(() => {
    create();
    fixture.detectChanges();
    auth.verifyOtp.mockReturnValue(of({}));
    typeCode('482913');
    cmp.verify();
    expect(auth.verifyOtp).toHaveBeenCalledWith('482913');
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);

    workspaces.set([{}, {}]);
    cmp.verify();
    expect(navigate).toHaveBeenLastCalledWith(['/workspace']);
    discardPeriodicTasks();
  }));

  it('shows a generic error for a wrong / expired code', fakeAsync(() => {
    create();
    fixture.detectChanges();
    auth.verifyOtp.mockReturnValue(throwError(() => ({ status: 400, error: { message: 'Incorrect code' } })));
    cmp.verify();
    expect(cmp.otpError()).toBe('Incorrect or expired code. Please try again.');
    expect(navigate).not.toHaveBeenCalled();
    discardPeriodicTasks();
  }));

  it('resend clears the boxes, restarts the timer and enforces a 30s cooldown', fakeAsync(() => {
    create();
    fixture.detectChanges();
    auth.resendOtp.mockReturnValue(of({}));
    typeCode('111111');
    cmp.resend();
    expect(cmp.digits()).toEqual(['', '', '', '', '', '']);
    expect(cmp.resendIn()).toBe(30);
    expect(toastr.success).toHaveBeenCalled();
    cmp.resend();
    expect(auth.resendOtp).toHaveBeenCalledTimes(1);
    tick(30000);
    cmp.resend();
    expect(auth.resendOtp).toHaveBeenCalledTimes(2);
    discardPeriodicTasks();
  }));

  it('back returns to the login page', fakeAsync(() => {
    create();
    fixture.detectChanges();
    cmp.back();
    expect(navigate).toHaveBeenCalledWith(['/login']);
    discardPeriodicTasks();
  }));
});
