import { Component, ChangeDetectionStrategy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, catchError, of, switchMap } from 'rxjs';
import { ToastrService } from 'ngx-toastr';

import { PermissionsStore } from '../../../core/session/permissions.store';
import { extractFieldErrors, toFieldErrorList, errorSummary } from '../../../core/util/server-errors';
import { UiBadgeComponent } from '../../../shared/ui/ui-badge/ui-badge.component';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal/ui-modal.component';
import { UiFileUploadComponent } from '../../../shared/ui/ui-file-upload/ui-file-upload.component';
import { Extension, ExtensionDoc, ExtensionFeeRow, ExtensionPaper, ExtensionSavePayload, ExtensionService, HeadUser, PAY_METHODS, extensionTone } from '../extension.service';
import { MAX_UPLOAD_MB } from '../../../core/util/upload-policy.util';

/** Wizard steps (client 30-09-2026: step-wise screen). */
const STEPS = [
  { key: 'terms', label: 'Terms & Fees', hint: 'Months, fees, interest and exit plan' },
  { key: 'agreement', label: 'Extension Agreement', hint: 'Preview and send to the broker' },
  { key: 'signed', label: 'Signed Agreement', hint: 'Upload the signed copy, then send to the Head of Extension' },
  { key: 'approval', label: 'Approval', hint: 'Head of Extension decision' },
] as const;

/** Furthest step each status may open (earlier steps stay viewable). */
const REACHED: Record<string, number> = {
  'Draft': 1, 'Agreement Sent': 2, 'Agreement Signed': 3, 'Pending Approval': 3, 'Approved': 3, 'Rejected': 3, 'Cancelled': 3,
};
/** Step the page opens on for each status (the next thing to do). */
const OPEN_ON: Record<string, number> = {
  'Draft': 0, 'Agreement Sent': 2, 'Agreement Signed': 2, 'Pending Approval': 3, 'Approved': 3, 'Rejected': 3, 'Cancelled': 0,
};

/** Paper fields shown on the Extension Request card (label, key, multi-line). */
const PAPER_FIELDS: { key: keyof ExtensionPaper; label: string; area?: boolean; wide?: boolean }[] = [
  { key: 'case_owner', label: 'Case Owner' },
  { key: 'funding_line', label: 'Funding Line' },
  { key: 'borrower_name', label: 'Borrower (as on agreement)' },
  { key: 'security_address', label: 'Security Address (as on agreement)' },
  { key: 'borrower_background', label: 'Borrower Background & Experience', area: true, wide: true },
  { key: 'purchase_info', label: 'Purchase Details' },
  { key: 'title_number', label: 'Title Number' },
  { key: 'value_text', label: 'Value' },
  { key: 'valuation_type', label: 'Valuation Type' },
  { key: 'valuer', label: 'Valuer' },
  { key: 'site_visit', label: 'Site Visit' },
  { key: 'deal_type', label: 'Deal Type' },
  { key: 'property_description', label: 'Property Description' },
  { key: 'extension_request', label: 'Extension Request (why, re-finance / sale status, months needed)', area: true, wide: true },
  { key: 'credit_recommendation', label: 'Credit Recommendation', area: true, wide: true },
];

/**
 * One extension, end to end (client 30-09-2026):
 * terms & fees -> Extension Agreement to borrower -> signed copy back ->
 * Extension Request paper to the Head of Extension -> approve / reject.
 */
@Component({
  selector: 'app-extension-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, UiBadgeComponent, UiButtonDirective, UiCardComponent, UiModalComponent, UiFileUploadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './extension-detail.component.html',
  styleUrl: './extension-detail.component.scss',
})
export class ExtensionDetailComponent implements OnInit {
  private readonly api = inject(ExtensionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toastr = inject(ToastrService);
  private readonly perms = inject(PermissionsStore);

  readonly steps = STEPS;
  readonly paperFields = PAPER_FIELDS;
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly ext = signal<Extension | null>(null);
  readonly busy = signal<string | null>(null);

  draft: ExtensionSavePayload = this.blank();
  private snapshot = '';
  /** Bumped on every form change so the computed previews re-run (draft is a plain object). */
  readonly tick = signal(0);

  // ---- permissions (admin bypass; API is the final gate) ----
  private can(mod: string, act: string): boolean {
    if (!this.perms.loaded() || this.perms.isSuperAdmin()) return true;
    return this.perms.can(mod, act);
  }
  readonly canEdit = computed(() => this.can('PORTFOLIO.EXTENSION', 'edit'));
  readonly isHead = computed(() => this.can('PORTFOLIO.HEAD_OF_EXTENSION', 'view'));
  readonly editable = computed(() => !!this.ext()?.editable && this.canEdit());

  // ---- wizard ----
  /** Step on screen. */
  readonly view = signal(0);
  /** Furthest step this extension's status allows. */
  readonly reached = computed(() => REACHED[this.ext()?.status ?? 'Draft'] ?? 0);
  /** Step whose work is done (drives the check marks). */
  readonly doneUpTo = computed(() => {
    const s = this.ext()?.status ?? 'Draft';
    return ({ 'Draft': -1, 'Agreement Sent': 1, 'Agreement Signed': 2, 'Pending Approval': 2, 'Approved': 3, 'Rejected': 2, 'Cancelled': -1 } as Record<string, number>)[s] ?? -1;
  });
  go(i: number): void {
    if (i < 0 || i > this.reached()) return;
    this.view.set(i);
    requestAnimationFrame(() => document.querySelector('.ext-steps')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  /** Step 1 "Save & Continue": save pending changes, then open the agreement step. */
  nextFromTerms(): void {
    if (!this.dirty()) { this.go(1); return; }
    const x = this.ext();
    if (!x) return;
    this.busy.set('save');
    this.api.save(x.extension_id, this.draft).pipe(
      catchError((e) => { this.toastr.error(this.errText(e, 'Could not save the extension.'), 'Validation Error'); return of(null); }),
    ).subscribe((r) => { this.busy.set(null); if (r) { this.apply(r); this.toastr.success('Terms saved.', 'Saved'); this.go(1); } });
  }
  private firstLoad = true;

  readonly docs = computed<ExtensionDoc[]>(() => this.ext()?.documents ?? []);
  readonly exitDocs = computed(() => this.docs().filter((d) => d.kind === 'EXIT_EVIDENCE' || d.kind === 'OTHER'));
  readonly signedDoc = computed(() => this.docs().find((d) => d.app_document_id === this.ext()?.signed_document_id) ?? null);
  readonly agreementDoc = computed(() => this.docs().find((d) => d.app_document_id === this.ext()?.agreement_document_id) ?? null);
  readonly requestDoc = computed(() => this.docs().find((d) => d.app_document_id === this.ext()?.request_document_id) ?? null);

  // ---- live figures (mirror of the API's derive()) ----
  readonly figures = computed(() => {
    this.tick();
    const x = this.ext();
    const d = this.draft;
    const gross = Number(x?.gross_amount || 0);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    // Fee % is always on the ORIGINAL gross (client 28-10-2026).
    const fee = (t: string, v: number | null) => (v == null || v <= 0 ? 0 : r2(t === 'PCT' ? (gross * v) / 100 : v));
    const extFee = fee(d.ext_fee_type, d.ext_fee_value);
    const docFee = fee(d.doc_fee_type, d.doc_fee_value);
    // Retained fees are added to the gross (and outstanding) on approval; Upfront ones are paid separately.
    const retainedFees = r2((d.ext_fee_timing === 'Retained' ? extFee : 0) + (d.doc_fee_timing === 'Retained' ? docFee : 0));
    const upfrontFees = r2(extFee + docFee - retainedFees);
    const grossAfter = r2(gross + retainedFees);
    const rate = d.monthly_rate_pct != null && String(d.monthly_rate_pct) !== '' ? Number(d.monthly_rate_pct) : 0;
    const monthly = this.interestMode === 'PCT'
      ? r2((grossAfter * rate) / 100)
      : (d.monthly_interest != null && String(d.monthly_interest) !== '' ? Number(d.monthly_interest) : 0);
    const months = Math.max(1, Math.min(60, Number(d.extension_months) || 1));
    const retainedInterest = d.interest_treatment === 'Retained' ? monthly * months : 0;
    return {
      newMaturity: this.addMonths(x?.current_maturity || '', months),
      extFee,
      docFee,
      retainedFees,
      upfrontFees,
      grossAfter,
      monthly,
      months,
      totalInterest: monthly * months,
      retainedInterest: r2(retainedInterest),
      // Client 09-10-2026: net loan doesn't change on an extension; gross grows if interest is retained
      // and (28-10-2026) by any fee that is retained.
      newGross: r2(grossAfter + retainedInterest),
      grossDelta: r2(retainedFees + retainedInterest),
    };
  });
  /** The "Additional Terms" bullets exactly as the agreement will print them. */
  readonly termLines = computed(() => {
    const f = this.figures();
    const x = this.ext();
    const d = this.draft;
    if (!x) return [];
    const out: string[] = [];
    if (f.monthly > 0) {
      out.push(d.interest_treatment === 'Retained'
        ? `Interest from ${this.longDate(x.current_maturity)} to the ${this.longDate(f.newMaturity)} of ${this.money2(f.monthly)} a month (${this.money2(f.totalInterest)} in total) will be retained and is payable in full at the end of the extension, on or before ${this.longDate(f.newMaturity)}.`
        : `Interest from ${this.longDate(x.current_maturity)} to the ${this.longDate(f.newMaturity)} of ${this.money2(f.monthly)} a month has to be serviced monthly with the first payment being made on the ${this.longDate(d.first_payment_date || x.current_maturity)}.`);
    }
    const feeLine = (label: string, type: string, value: number | null, amt: number, timing: string, due: string | null, verb: string) => {
      if (!(amt > 0)) return;
      const what = type === 'PCT' ? `${label} of ${value}% of the initial gross loan, which equates to ${this.money(amt)}` : `${label} of ${this.money(amt)}`;
      out.push(timing === 'Retained'
        ? `${what} that will be retained and added to the gross loan, payable at the end of the extension, on or before ${this.longDate(f.newMaturity)}.`
        : `${what} ${verb} on or before ${this.longDate(due) || 'the start of the extension'}.`);
    };
    feeLine('Extension fee', d.ext_fee_type, d.ext_fee_value, f.extFee, d.ext_fee_timing, d.ext_fee_due_date, 'that will be paid');
    feeLine('Extension Documentation/ Administration fee', d.doc_fee_type, d.doc_fee_value, f.docFee, d.doc_fee_timing, d.doc_fee_due_date, 'to be paid');
    return out;
  });

  // ---- modals ----
  readonly sendOpen = signal(false);
  sendDraft = { to: '', cc: '', message: '', send_email: true, recipient: 'broker' as 'broker' | 'borrower' };
  /** Interest entry mode (client 09-10-2026): a % rate or a manual £ amount. */
  interestMode: 'PCT' | 'AMOUNT' = 'AMOUNT';
  setInterestMode(m: 'PCT' | 'AMOUNT'): void {
    this.interestMode = m;
    if (m === 'PCT') { this.draft.monthly_interest = null; } else { this.draft.monthly_rate_pct = null; }
    this.onChange();
  }
  // ---- payment schedule (client 28-10-2026) ----
  readonly schedule = computed(() => this.ext()?.payment_schedule ?? null);
  readonly awaitingFees = computed(() => !!this.ext()?.awaiting_fees);
  readonly payMethods = PAY_METHODS;
  readonly payFee = signal<ExtensionFeeRow | null>(null);
  payDraft = { paid_on: '', method: 'Bank Transfer', reference: '' };
  /** "Paid upfront" / "Retained – added to gross" label for a fee timing. */
  timingLabel(t: string | null | undefined): string { return t === 'Retained' ? 'Retained – added to gross' : 'Paid upfront'; }
  feeStatusTone(s: string): 'approved' | 'pending' | 'closed' | 'info' {
    return s === 'Paid' ? 'approved' : s === 'Due' ? 'pending' : s === 'Waived' ? 'closed' : 'info';
  }
  feeStatusLabel(s: string): string { return s === 'Capitalised' ? 'Added to gross' : s; }
  openPay(f: ExtensionFeeRow): void {
    this.payDraft = { paid_on: new Date().toISOString().slice(0, 10), method: 'Bank Transfer', reference: '' };
    this.payFee.set(f);
  }
  markPaid(): void {
    const x = this.ext();
    const f = this.payFee();
    if (!x || !f) return;
    if (!this.payDraft.paid_on) { this.toastr.error('Enter the date the fee was paid.', 'Validation Error'); return; }
    this.busy.set('pay');
    this.api.markFeePaid(x.extension_id, f.fee_id, this.payDraft).pipe(
      catchError((e) => { this.toastr.error(this.errText(e, 'Could not mark the fee paid.'), 'Validation Error'); return of(null); }),
    ).subscribe((r) => {
      this.busy.set(null);
      if (!r) return;
      this.payFee.set(null);
      this.apply(r);
      this.toastr.success(r.awaiting_fees ? `${f.fee_type} fee marked paid.` : 'All upfront fees paid – extension complete and back in the portfolio.', 'Paid');
    });
  }

  readonly submitOpen = signal(false);
  submitMessage = '';
  submitTo = '';
  submitCc = '';
  /** Send popup recipients (client 27-10-2026): Head of Extension checkboxes + typed addresses. */
  readonly heads = signal<HeadUser[]>([]);
  readonly headsLoading = signal(false);
  readonly pickedHeads = signal<number[]>([]);
  decisionNotes = '';
  readonly confirm = signal<{ title: string; text: string; action: string; danger?: boolean } | null>(null);
  cancelReason = '';

  ngOnInit(): void { this.load(); }

  onChange(): void { this.tick.update((n) => n + 1); }
  dirty(): boolean { this.tick(); return this.editable() && JSON.stringify(this.draft) !== this.snapshot; }

  private load(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    this.api.get(id).pipe(catchError((e) => { this.error.set(e?.error?.message || 'Could not load the extension.'); return of(null); }))
      .subscribe((x) => { if (x) this.apply(x); this.loading.set(false); });
  }

  /** jump = open the step for the (new) status - first load and after every workflow action. */
  private apply(x: Extension, jump = false): void {
    this.ext.set(x);
    if (jump || this.firstLoad) { this.view.set(OPEN_ON[x.status] ?? 0); this.firstLoad = false; }
    if (this.view() > this.reached()) this.view.set(this.reached());
    this.draft = {
      extension_months: x.extension_months,
      // Client 28-10-2026: each fee is Paid upfront or Retained (added to the gross) - back on the form.
      ext_fee_type: x.ext_fee_type, ext_fee_value: this.n(x.ext_fee_value) ?? 0, ext_fee_timing: x.ext_fee_timing === 'Retained' ? 'Retained' : 'Upfront', ext_fee_due_date: x.ext_fee_due_date,
      doc_fee_type: x.doc_fee_type, doc_fee_value: this.n(x.doc_fee_value) ?? 0, doc_fee_timing: x.doc_fee_timing === 'Retained' ? 'Retained' : 'Upfront', doc_fee_due_date: x.doc_fee_due_date,
      interest_treatment: x.interest_treatment, monthly_rate_pct: this.n(x.monthly_rate_pct) ?? 0, monthly_interest: this.n(x.monthly_interest) ?? 0, first_payment_date: x.first_payment_date,
      agreement_date: x.agreement_date, exit_plan: x.exit_plan || '',
      paper: { ...(x.paper || {}) },
    };
    this.interestMode = (x.monthly_rate_pct != null && Number(x.monthly_rate_pct) > 0) ? 'PCT' : 'AMOUNT';
    this.snapshot = JSON.stringify(this.draft);
    this.sendDraft = { to: x.agreement_sent_to && x.agreement_sent_to.includes('@') ? x.agreement_sent_to : (x.broker_email || x.customer_email || ''), cc: '', message: '', send_email: true, recipient: 'broker' };
    this.onChange();
  }

  /** Save pending form changes first (PDFs are built from saved data). */
  private saved$(): Observable<Extension | null> {
    const x = this.ext();
    if (!x || !this.dirty()) return of(x);
    return this.api.save(x.extension_id, this.draft).pipe(
      catchError((e) => { this.toastr.error(this.errText(e, 'Could not save the extension.'), 'Validation Error'); return of(null); }),
    );
  }

  save(): void {
    const x = this.ext();
    if (!x) return;
    this.busy.set('save');
    this.api.save(x.extension_id, this.draft).pipe(
      catchError((e) => { this.toastr.error(this.errText(e, 'Could not save the extension.'), 'Validation Error'); return of(null); }),
    ).subscribe((r) => { this.busy.set(null); if (r) { this.apply(r); this.toastr.success('Extension saved.', 'Saved'); } });
  }

  preview(kind: 'agreement' | 'request'): void {
    const x = this.ext();
    if (!x) return;
    this.busy.set('preview-' + kind);
    this.saved$().pipe(
      switchMap((s) => (s ? (kind === 'agreement' ? this.api.agreementPdf(x.extension_id) : this.api.requestPdf(x.extension_id)) : of(null))),
      catchError(() => { this.toastr.error('Could not build the PDF.', 'Failed'); return of(null); }),
    ).subscribe((blob) => {
      this.busy.set(null);
      if (blob) window.open(URL.createObjectURL(blob), '_blank');
      if (this.dirty()) this.reload(false);
    });
  }

  openSend(recipient: 'broker' | 'borrower' = 'broker'): void {
    const x = this.ext();
    this.sendDraft.recipient = recipient;
    const email = recipient === 'borrower' ? (x?.customer_email || '') : (x?.broker_email || '');
    this.sendDraft.to = email;
    this.sendOpen.set(true);
  }
  setSendRecipient(recipient: 'broker' | 'borrower'): void {
    const x = this.ext();
    this.sendDraft.recipient = recipient;
    this.sendDraft.to = recipient === 'borrower' ? (x?.customer_email || '') : (x?.broker_email || '');
  }
  sendAgreement(): void {
    const x = this.ext();
    if (!x) return;
    if (this.sendDraft.send_email && !this.sendDraft.to.includes('@')) { this.toastr.error('Enter the recipient e-mail address.', 'Validation Error'); return; }
    this.busy.set('send');
    this.saved$().pipe(
      switchMap((s) => (s ? this.api.sendAgreement(x.extension_id, this.sendDraft) : of(null))),
      catchError((e) => { this.toastr.error(this.errText(e, 'Could not send the agreement.'), 'Failed'); return of(null); }),
    ).subscribe((r) => {
      this.busy.set(null);
      if (!r) return;
      this.sendOpen.set(false);
      if (r.error) this.toastr.warning(`Agreement saved to documents, but the e-mail failed: ${r.error}`, 'Not sent');
      else this.toastr.success(r.emailed ? 'Extension Agreement e-mailed to the borrower.' : 'Extension Agreement generated and marked as sent.', 'Sent');
      this.reload();
    });
  }

  upload(kind: 'SIGNED_AGREEMENT' | 'EXIT_EVIDENCE', file: File | null): void {
    const x = this.ext();
    if (!x || !file) return;
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) { this.toastr.error(`File is larger than ${MAX_UPLOAD_MB}MB.`, 'Validation Error'); return; }
    this.busy.set('upload-' + kind);
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = String(reader.result || '');
      this.api.upload(x.extension_id, { kind, file_name: file.name, content_base64: b64 }).pipe(
        catchError((e) => { this.toastr.error(this.errText(e, 'Upload failed.'), 'Upload failed'); return of(null); }),
      ).subscribe((r) => {
        this.busy.set(null);
        if (!r) return;
        this.toastr.success(kind === 'SIGNED_AGREEMENT' ? 'Signed agreement uploaded - next: Extension Request.' : 'Document uploaded.', 'Uploaded');
        this.reload(kind === 'SIGNED_AGREEMENT');
      });
    };
    reader.onerror = () => { this.busy.set(null); this.toastr.error('Could not read the file.', 'Upload failed'); };
    reader.readAsDataURL(file);
  }

  viewDoc(d: ExtensionDoc, download = false): void {
    const x = this.ext();
    if (!x) return;
    this.api.download(x.extension_id, d.app_document_id).pipe(catchError(() => of(null))).subscribe((blob) => {
      if (!blob) { this.toastr.error('Could not open the file.', 'Failed'); return; }
      const url = URL.createObjectURL(blob);
      if (!download) { window.open(url, '_blank'); return; }
      const a = document.createElement('a');
      a.href = url; a.download = d.file_name; a.click();
      URL.revokeObjectURL(url);
    });
  }

  askDelete(d: ExtensionDoc): void {
    this.pendingDoc = d;
    this.confirm.set({ title: 'Delete document', text: `Delete "${d.file_name}"?${d.kind === 'SIGNED_AGREEMENT' ? ' The extension goes back to Agreement Sent.' : ''}`, action: 'delete', danger: true });
  }
  private pendingDoc: ExtensionDoc | null = null;

  openSubmit(): void {
    this.submitMessage = ''; this.submitTo = ''; this.submitCc = '';
    this.pickedHeads.set([]);
    this.submitOpen.set(true);
    this.headsLoading.set(true);
    this.api.headUsers().pipe(catchError(() => of([] as HeadUser[]))).subscribe((rows) => {
      this.heads.set(rows);
      this.pickedHeads.set(rows.map((h) => h.user_id)); // all ticked, as before (sent to every head)
      this.headsLoading.set(false);
    });
  }
  isHeadPicked(id: number): boolean { return this.pickedHeads().includes(id); }
  toggleHead(id: number): void {
    this.pickedHeads.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }
  toggleAllHeads(): void {
    const all = this.heads().map((h) => h.user_id);
    this.pickedHeads.set(this.pickedHeads().length === all.length ? [] : all);
  }
  /** Typed addresses (comma / semicolon / space separated) and the ones that are not valid. */
  submitEmails(): string[] { return this.submitTo.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean); }
  submitBadEmails(): string[] { return this.submitEmails().filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)); }
  /** Send only with at least one ticked head or typed address, and no invalid address. */
  canSubmit(): boolean {
    return (this.pickedHeads().length > 0 || this.submitEmails().length > 0) && !this.submitBadEmails().length;
  }

  /** Open the Extension Request paper, generated live (client 13-10-2026 - stored-copy open was failing). */
  openRequestPaper(): void {
    const x = this.ext();
    if (!x) return;
    this.busy.set('preview-request');
    this.api.requestPdf(x.extension_id).pipe(catchError(() => { this.toastr.error('Could not open the Extension Request paper.', 'Failed'); return of(null); }))
      .subscribe((blob) => { this.busy.set(null); if (blob) window.open(URL.createObjectURL(blob), '_blank'); });
  }
  submit(): void {
    const x = this.ext();
    if (!x || !this.canSubmit()) return;
    this.busy.set('submit');
    this.saved$().pipe(
      switchMap((s) => (s ? this.api.submit(x.extension_id, { message: this.submitMessage, heads: this.pickedHeads(), to: this.submitTo, cc: this.submitCc }) : of(null))),
      catchError((e) => { this.toastr.error(this.errText(e, 'Could not send to the Head of Extension.'), 'Failed'); return of(null); }),
    ).subscribe((r) => {
      this.busy.set(null);
      if (!r) return;
      this.submitOpen.set(false);
      if (r.error) this.toastr.warning(r.error, r.sentTo ? 'Partly sent' : 'Waiting in Extensions');
      else this.toastr.success(`Extension Request e-mailed to ${r.sentTo} recipient${r.sentTo === 1 ? '' : 's'}.`, 'Sent for approval');
      this.reload();
    });
  }

  askDecision(decision: 'approve' | 'reject'): void {
    if (decision === 'reject' && !this.decisionNotes.trim()) { this.toastr.error('Give a reason for rejecting.', 'Validation Error'); return; }
    const x = this.ext();
    this.confirm.set(decision === 'approve'
      ? { title: 'Approve extension', text: `Approve ${x?.extension_ref}? Facility ${x?.loan_number} moves to ${this.longDate(x?.new_maturity || '')}, the extension months are added to its schedule and the fees are raised on the facility.`, action: 'approve' }
      : { title: 'Reject extension', text: `Reject ${x?.extension_ref}? The facility stays on its current maturity.`, action: 'reject', danger: true });
  }

  askCancel(): void {
    this.cancelReason = '';
    this.confirm.set({ title: 'Cancel extension', text: 'Withdraw this extension request? It can not be reopened.', action: 'cancel', danger: true });
  }

  confirmYes(): void {
    const c = this.confirm();
    const x = this.ext();
    this.confirm.set(null);
    if (!c || !x) return;
    let req$: Observable<unknown>;
    let ok = '';
    if (c.action === 'delete' && this.pendingDoc) { req$ = this.api.deleteDoc(x.extension_id, this.pendingDoc.app_document_id); ok = 'Document deleted.'; }
    else if (c.action === 'approve' || c.action === 'reject') { req$ = this.api.decide(x.extension_id, c.action, this.decisionNotes); ok = c.action === 'approve' ? 'Extension approved - facility updated.' : 'Extension rejected.'; }
    else if (c.action === 'cancel') { req$ = this.api.cancel(x.extension_id, this.cancelReason); ok = 'Extension cancelled.'; }
    else return;
    this.busy.set(c.action);
    req$.pipe(catchError((e) => { this.toastr.error(this.errText(e, 'Action failed.'), 'Failed'); return of(null); }))
      .subscribe((r) => { this.busy.set(null); if (r === null) return; this.toastr.success(ok, 'Done'); this.pendingDoc = null; this.reload(c.action !== 'delete'); });
  }

  back(): void { void this.router.navigate(['/extensions']); }

  private reload(jump = true): void {
    const x = this.ext();
    if (!x) return;
    this.api.get(x.extension_id).pipe(catchError(() => of(null))).subscribe((r) => { if (r) this.apply(r, jump); });
  }

  // ---- helpers ----
  tone(s: string) { return extensionTone(s); }
  kindLabel(k: string): string {
    return ({ AGREEMENT: 'Extension Agreement', SIGNED_AGREEMENT: 'Signed Agreement', REQUEST_PAPER: 'Extension Request paper', EXIT_EVIDENCE: 'Exit evidence', OTHER: 'Document' } as Record<string, string>)[k] || k;
  }
  private n(v: unknown): number | null { return v === null || v === undefined || v === '' ? null : Number(v); }
  private blank(): ExtensionSavePayload {
    return {
      extension_months: 1, ext_fee_type: 'PCT', ext_fee_value: 0, ext_fee_timing: 'Upfront', ext_fee_due_date: null,
      doc_fee_type: 'AMOUNT', doc_fee_value: 0, doc_fee_timing: 'Upfront', doc_fee_due_date: null,
      interest_treatment: 'Serviced', monthly_rate_pct: 0, monthly_interest: 0, first_payment_date: null, agreement_date: null, exit_plan: '', paper: {},
    };
  }
  addMonths(iso: string, months: number): string {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    const y = Number(m[1]); const mo = Number(m[2]) - 1 + months; const d = Number(m[3]);
    const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, mo, Math.min(d, last))).toISOString().slice(0, 10);
  }
  longDate(iso: string | null | undefined): string {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    const day = Number(m[3]);
    const suf = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] || 'th';
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${day}${suf} ${months[Number(m[2]) - 1]} ${m[1]}`;
  }
  shortDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const s = String(iso);
    const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  dateTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(String(iso));
    return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  money(v: unknown): string {
    const n = Number(v || 0);
    const dp = Math.abs(n - Math.round(n)) < 0.005 ? 0 : 2;
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n);
  }
  money2(v: unknown): string {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v || 0));
  }
  private errText(e: unknown, fb: string): string {
    const list = toFieldErrorList(extractFieldErrors(e));
    if (list.length) return errorSummary(list, fb);
    const m = (e as { error?: { message?: string } })?.error?.message;
    return m && m !== 'Validation Error' ? m : fb;
  }
}
