import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { NumInputDirective } from '../../../shared/ui/num-input.directive';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet, UpperCasePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import { PermissionsStore } from '../../../core/session/permissions.store';
import { UnderwritingApi, UwBorrowerSolicitor, UwCaseDetail, UwCaseDocument, UwField, UwMeta, UwSolicitorChecks, UwStep, UwStepDef } from '../underwriting.api';
import { auditAction, auditSummary } from '../../../core/util/audit.util';
import { ServerFieldError, errorSummary, extractFieldErrors, toFieldErrorList } from '../../../core/util/server-errors';
import { formatDateTime } from '../../../core/util/date.util';
import { IMAGE_UPLOAD_EXTS, MAX_UPLOAD_MB, UPLOAD_ACCEPT, filterUploads } from '../../../core/util/upload-policy.util';
import { ApplicationDetailComponent } from '../../applications/application-detail/application-detail.component';

/** A summary-card row; `lines` renders a multi-security list (client 16-10-2026). */
export interface SumRow { label: string; value: string; lines?: { main: string; sub: string }[]; }

/** A file attached to a step (Site Visit & Diligence accepts images, video or any document). */
export interface UwFileItem {
  id: number;
  file_name: string;
  content_type: string | null;
  url: string | null;
  /** Checklist tag, e.g. 'kyc:12' / 'sol:3' — groups a doc under a specific check. */
  tag?: string | null;
}

/** Underwriting case detail — 8-step stepper (Figma /underwriting). Backend-driven state. */
import { IndicativeEditorComponent } from '../indicative-editor/indicative-editor.component';

@Component({
  selector: 'app-underwriting-detail',
  standalone: true,
  imports: [FormsModule, UpperCasePipe, NgTemplateOutlet, ApplicationDetailComponent, IndicativeEditorComponent, NumInputDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './underwriting-detail.component.html',
  styleUrl: './underwriting-detail.component.scss',
})
export class UnderwritingDetailComponent implements OnInit {
  private readonly api = inject(UnderwritingApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toastr = inject(ToastrService);
  private readonly perms = inject(PermissionsStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);

  // ---- signed offer + application form (uploaded at convert) ----
  readonly signedOpen = signal(false);
  readonly signedUrl = signal<SafeResourceUrl | null>(null);
  readonly signedLoading = signal(false);
  readonly signedInline = signal(true);
  private signedRawUrl: string | null = null;
  private signedLoadedFor: number | null = null;
  private readonly signedCache = new Map<number, { raw: string; safe: SafeResourceUrl; inline: boolean }>();
  readonly signedDocs = signal<{ id: number; file_name: string }[]>([]);
  readonly signedSel = signal<number | null>(null);
  signedSelName(): string { return this.signedDocs().find((d) => d.id === this.signedSel())?.file_name || ''; }
  /** Files uploaded at convert; the first opens by default while the case is in New Review. */
  private initSignedOffer(cas: UwCaseDetail): void {
    const docs = (cas.signed_offer_docs && cas.signed_offer_docs.length)
      ? cas.signed_offer_docs
      : (cas.signed_offer_doc_id ? [{ id: cas.signed_offer_doc_id, file_name: cas.signed_offer_file_name || 'Signed offer' }] : []);
    if (!docs.length) return;
    if (this.signedLoadedFor === cas.underwriting_case_id) return;
    this.signedLoadedFor = cas.underwriting_case_id;
    this.signedDocs.set(docs);
    // Client 06-10-2026: viewer collapsed by default; opens on "View Document" click.
    this.destroyRef.onDestroy(() => { for (const v of this.signedCache.values()) URL.revokeObjectURL(v.raw); });
    this.showSigned(docs[0].id);
  }
  showSigned(docId: number): void {
    this.signedSel.set(docId);
    const hit = this.signedCache.get(docId);
    if (hit) { this.signedRawUrl = hit.raw; this.signedInline.set(hit.inline); this.signedUrl.set(hit.safe); return; }
    const cas = this.c(); if (!cas) return;
    const name = this.signedDocs().find((d) => d.id === docId)?.file_name || '';
    this.signedLoading.set(true); this.signedUrl.set(null);
    this.api.signedOffer(cas.underwriting_case_id, docId)
      .pipe(catchError(() => { this.signedLoading.set(false); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => {
        this.signedLoading.set(false);
        if (!blob || this.signedSel() !== docId) return;
        const raw = URL.createObjectURL(blob);
        const inline = /pdf|image\//i.test(blob.type || '') || /\.(pdf|png|jpe?g)$/i.test(name);
        // PDFs: hide the browser viewer's toolbar (it shows the blob id) and fit the width.
        const isPdf = /pdf/i.test(blob.type || '') || /\.pdf$/i.test(name);
        const safe = this.sanitizer.bypassSecurityTrustResourceUrl(raw + (isPdf ? '#toolbar=0&navpanes=0&view=FitH' : ''));
        this.signedCache.set(docId, { raw, safe, inline });
        this.signedRawUrl = raw; this.signedInline.set(inline); this.signedUrl.set(safe);
      });
  }
  openSignedInTab(): void { if (this.signedRawUrl) window.open(this.signedRawUrl, '_blank'); }
  downloadSigned(cas: UwCaseDetail): void {
    if (!this.signedRawUrl) return;
    const a = document.createElement('a');
    a.href = this.signedRawUrl; a.download = this.signedSelName() || cas.signed_offer_file_name || 'signed-offer.pdf';
    document.body.appendChild(a); a.click(); a.remove();
  }

  readonly c = signal<UwCaseDetail | null>(null);
  readonly meta = signal<UwMeta | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly acting = signal(false);
  readonly uploadingPhoto = signal(false);
  readonly photos = signal<UwFileItem[]>([]);
  readonly photoIdx = signal<number | null>(null);
  readonly photoCur = computed(() => { const i = this.photoIdx(); return i == null ? null : (this.photos()[i] || null); });
  openPhotoAt(i: number): void { const p = this.photos()[i]; if (p?.url && this.isImage(p)) this.photoIdx.set(i); }
  closePhoto(): void { this.photoIdx.set(null); }
  prevPhoto(): void { const n = this.photos().length; const i = this.photoIdx(); if (i == null || !n) return; this.photoIdx.set((i - 1 + n) % n); }
  nextPhoto(): void { const n = this.photos().length; const i = this.photoIdx(); if (i == null || !n) return; this.photoIdx.set((i + 1) % n); }

  /** Site-visit uploads accept any file: classify by mime, fall back to extension. */
  private kind(ph: UwFileItem): 'image' | 'video' | 'file' {
    const ct = (ph.content_type || '').toLowerCase();
    if (ct.startsWith('image/')) return 'image';
    if (ct.startsWith('video/')) return 'video';
    const ext = (ph.file_name.split('.').pop() || '').toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'svg'].includes(ext)) return 'image';
    if (['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v', '3gp'].includes(ext)) return 'video';
    return 'file';
  }
  isImage(ph: UwFileItem): boolean { return this.kind(ph) === 'image'; }
  isVideo(ph: UwFileItem): boolean { return this.kind(ph) === 'video'; }
  readonly editOverride = signal(false);
  readonly selected = signal(1);

  // draft for selected step
  draft: { checklist: Record<string, boolean>; fields: Record<string, unknown>; recommendation?: string } = { checklist: {}, fields: {} };
  readonly draftRec = signal('');
  readonly reqPackItems = ['Underwriting requirements list', 'Valuation quote / fee', 'Solicitor fee quote', 'Required documents checklist', 'Outstanding information request', 'Solicitor undertaking requirements'];

  rejectOpen = signal(false); rejectMode = signal<'reject' | 'cannot_proceed'>('reject'); rejectReason = '';
  queryOpen = signal(false); respDraft = '';
  reqSendTo = 'Broker';
  reqItems = { bank: false, address: false, income: false, accounts: false, assets: false, creditFile: false };
  reqComments = ''; reqDueDate = '';
  /** Today as yyyy-mm-dd (local) — used as the min for Request Info due dates. */
  get todayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
  }
  reviewRejectOpen = signal(false); reviewReason = '';
  returnOpen = signal(false); returnNote = '';

  private id = 0;

  // ---- deal notes (client 07-10-2026): OUTSIDE the step process; MULTIPLE notes ----
  readonly notesOpen = signal(false);
  readonly notesSaving = signal(false);
  readonly notesList = signal<{ id: string; text: string; ts: string }[]>([]);
  newNote = '';
  toggleNotes(): void { this.notesOpen.update((v) => !v); }
  /** Parse the stored notes blob — a JSON array of notes, or a legacy single string. */
  private loadNotes(cas: UwCaseDetail): void {
    const raw = String(cas.underwriter_notes ?? '').trim();
    if (!raw) { this.notesList.set([]); return; }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.notesList.set(parsed
          .map((n: { id?: unknown; text?: unknown; ts?: unknown }) => ({ id: String(n.id ?? (Date.now() + '' + Math.random())), text: String(n.text ?? ''), ts: String(n.ts ?? '') }))
          .filter((n) => n.text.trim()));
        return;
      }
    } catch { /* legacy plain-text single note */ }
    this.notesList.set([{ id: 'legacy', text: raw, ts: '' }]);
  }
  addNote(): void {
    const text = this.newNote.trim();
    if (!text) { this.toastr.warning('Type a note first.'); return; }
    const list = [...this.notesList(), { id: String(Date.now()), text, ts: new Date().toISOString() }];
    this.persistNotes(list, 'Note added', () => { this.newNote = ''; });
  }
  removeNote(id: string): void {
    this.persistNotes(this.notesList().filter((n) => n.id !== id), 'Note removed');
  }
  private persistNotes(list: { id: string; text: string; ts: string }[], msg: string, done?: () => void): void {
    this.notesSaving.set(true);
    this.api.saveNotes(this.id, { notes: JSON.stringify(list) })
      .pipe(catchError((e: { error?: { message?: string } }) => { this.toastr.error(e?.error?.message || 'Could not save note'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.notesSaving.set(false);
        if (r === null) return;
        this.notesList.set(list);
        const cas = this.c(); if (cas) this.c.set({ ...cas, underwriter_notes: JSON.stringify(list) });
        this.toastr.success(msg);
        if (done) done();
      });
  }
  noteWhen(ts: string): string { return ts ? this.dt(ts) : ''; }

  // ---- Send Requirement (client 08-10-2026): replaces the Requirements-to-Broker step.
  // A button at the top of the case e-mails the requirements pack + sanction letter to the
  // broker when one is set, otherwise to the applicant(s) — a company's directors each get
  // their own separate e-mail. Shown only once Valuation, Solicitor Quote and KYC / AML
  // (displayed steps 1, 2, 3) are complete.
  readonly sendingReq = signal(false);
  canSendRequirement(): boolean {
    const cas = this.c();
    if (!cas || !this.canSendPerm() || this.UW_FINAL.includes(cas.status)) return false;
    return this.isDone(2) && this.isDone(4) && this.isDone(3);
  }
  sendRequirement(): void {
    this.sendingReq.set(true);
    this.api.sendBroker(this.id)
      .pipe(catchError((e: { error?: { message?: string } }) => { this.toastr.error(e?.error?.message || 'Could not send the requirements'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.sendingReq.set(false);
        if (!r) return;
        const n = r.recipients || 0;
        this.toastr.success('Requirements e-mailed' + (r.to ? ' to ' + r.to : '') + (n > 1 ? ' (' + n + ' recipients)' : ''));
      });
  }


  // ---- KYC / AML checklist (client 07-10-2026): masters-driven, split by applicant type ----
  readonly kycDocs = signal<UwFileItem[]>([]);
  isCompanyCase(): boolean { return /compan|limited|ltd/i.test(String(this.c()?.applicant_type || '')); }
  private kycChecksAll(): { id: number; name: string; applicant_type?: string }[] {
    return (this.meta()?.options?.['kycChecks'] || []) as { id: number; name: string; applicant_type?: string }[];
  }
  kycChecksIndividual(): { id: number; name: string }[] {
    return this.kycChecksAll().filter((k) => String(k.applicant_type || '').toLowerCase() === 'individual');
  }
  kycChecksCompany(): { id: number; name: string }[] {
    return this.kycChecksAll().filter((k) => String(k.applicant_type || '').toLowerCase() === 'company');
  }
  private kycMap(): Record<string, { done?: boolean; notes?: string }> {
    const m = this.draft.fields['kyc_checks'];
    return (m && typeof m === 'object') ? m as Record<string, { done?: boolean; notes?: string }> : {};
  }
  kycDone(id: number): boolean { return this.kycMap()[String(id)]?.done === true; }
  kycNoteVal(id: number): string { return String(this.kycMap()[String(id)]?.notes ?? ''); }
  setKycNote(id: number, v: string): void {
    const m = { ...this.kycMap() }; m[String(id)] = { ...(m[String(id)] || {}), notes: v };
    this.draft.fields['kyc_checks'] = m;
  }
  toggleKycDone(id: number): void {
    const m = { ...this.kycMap() }; const cur = m[String(id)] || {};
    m[String(id)] = { ...cur, done: !(cur.done === true) };
    this.draft.fields['kyc_checks'] = m;
    this.saveKyc();
  }
  saveKyc(notify = false): void {
    this.acting.set(true);
    this.api.saveStep(this.id, 3, { data: { ...this.draft, recommendation: this.draftRec() } })
      .pipe(catchError((e) => { this.showStepErrors(e, 'Save failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.patchLocalStep(); if (notify) this.toastr.success('KYC details saved', 'Saved'); } });
  }
  markKycPassed(): void { this.draft.fields['kyc_result'] = 'passed'; this.saveKyc(); this.toastr.success('KYC marked passed'); }
  clearKyc(): void { this.draft.fields['kyc_result'] = ''; this.saveKyc(); }
  /**
   * Client 22-10-2026: files are listed by NAME only; the download API is called when a file
   * is clicked (previously every file was downloaded on page load, slowing big cases).
   * The tab is opened straight away (popup blockers allow it) and pointed at the file once
   * it arrives; the blob URL is cached on the item for the next click.
   */
  readonly fileLoading = signal<Set<number>>(new Set<number>());
  isFileLoading(id: number): boolean { return this.fileLoading().has(id); }
  openFile(ph: UwFileItem, mode: 'view' | 'download' = 'view'): void {
    const go = (url: string, win: Window | null) => {
      if (mode === 'download') { const a = document.createElement('a'); a.href = url; a.download = ph.file_name || 'file'; a.click(); win?.close(); return; }
      if (win) win.location.href = url; else window.open(url, '_blank');
    };
    if (ph.url) { go(ph.url, mode === 'view' ? window.open('', '_blank') : null); return; }
    const win = mode === 'view' ? window.open('', '_blank') : null;
    if (win) win.document.title = 'Loading ' + (ph.file_name || 'file') + '…';
    this.fileLoading.update((s) => new Set(s).add(ph.id));
    this.api.downloadPhoto(this.id, ph.id).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => {
        this.fileLoading.update((s) => { const n = new Set(s); n.delete(ph.id); return n; });
        if (!blob) { win?.close(); this.toastr.error(`Could not open ${ph.file_name}.`, 'Failed'); return; }
        const url = URL.createObjectURL(blob as Blob);
        ph.url = url; // cache for the next click
        go(url, win);
      });
  }
  private loadKycDocs(): void {
    this.kycDocs.set([]);
    this.api.listPhotos(this.id, 3).pipe(catchError(() => of([])), takeUntilDestroyed(this.destroyRef))
      .subscribe((rows) => {
        this.kycDocs.set((rows || []).map((r) => ({ id: r.id, file_name: r.file_name, content_type: r.content_type ?? null, url: null, tag: r.doc_tag ?? null })));
        // Client 22-10-2026: names only - a file is fetched when it is clicked (openFile).
      });
  }
  /** For [accept] on the raw file inputs (client 21-10-2026: Word, PDF, image and Excel only). */
  readonly uploadAccept = UPLOAD_ACCEPT;
  /** Picked files that pass the upload policy (type + 20MB); the rest are reported in a toast. */
  private allowedPicks(input: HTMLInputElement, exts?: string[]): File[] {
    const { ok, error } = filterUploads(input.files ? Array.from(input.files) : [], exts);
    if (error) { this.toastr.error(error, 'Validation Error'); input.value = ''; }
    return ok;
  }
  kycDocsFor(id: number): UwFileItem[] { return this.kycDocs().filter((d) => d.tag === 'kyc:' + id); }
  onKycDocPick(id: number, ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = this.allowedPicks(input);
    if (!files.length) return;
    let pending = files.length;
    // Client 22-10-2026: progress shows in the global upload panel; errors still toast.
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onerror = () => { this.toastr.error(`Could not read ${file.name}.`, 'Failed'); if (--pending <= 0) this.loadKycDocs(); };
      reader.onload = () => {
        const b64 = String(reader.result || '');
        this.api.uploadPhoto(this.id, { step_no: 3, file_name: file.name, content_base64: b64, content_type: file.type, doc_tag: 'kyc:' + id })
          .pipe(catchError((e: { status?: number; error?: { message?: string } }) => {
            const tooBig = e?.status === 413 || e?.status === 404;
            this.toastr.error(e?.error?.message || (tooBig ? `${file.name} is too large for the server (max ${MAX_UPLOAD_MB}MB).` : `Upload of ${file.name} failed.`), 'Failed');
            return of(null);
          }), takeUntilDestroyed(this.destroyRef))
          .subscribe(() => { if (--pending <= 0) this.loadKycDocs(); });
      };
      reader.readAsDataURL(file);
    });
    input.value = '';
  }
  removeKycDoc(docId: number): void {
    this.api.deletePhoto(this.id, docId).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadKycDocs());
  }

  // ---- Solicitor Quote (client 07-10-2026): our quote + borrower-solicitor checks ----
  readonly solDocs = signal<UwFileItem[]>([]);
  private solObj(key: string): Record<string, unknown> {
    const o = this.draft.fields[key];
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o as Record<string, unknown> : {};
  }
  ourSol(k: string): string { return String(this.solObj('our_solicitor')[k] ?? ''); }
  setOurSol(k: string, v: unknown): void { const o = { ...this.solObj('our_solicitor') }; o[k] = v; this.draft.fields['our_solicitor'] = o; }
  borrowerSol(k: string): string { return String(this.solObj('borrower_solicitor')[k] ?? ''); }
  setBorrowerSol(k: string, v: unknown): void { const o = { ...this.solObj('borrower_solicitor') }; o[k] = v; this.draft.fields['borrower_solicitor'] = o; }
  repType(): string { return String(this.draft.fields['rep_type'] || 'single'); }
  setRepType(v: string): void { this.draft.fields['rep_type'] = v; this.saveSol(); }
  isDualRep(): boolean { return this.repType() === 'dual'; }
  solFeePaid(): boolean { return this.draft.fields['sol_fee_paid'] === true; }
  toggleSolFeePaid(): void { this.draft.fields['sol_fee_paid'] = !(this.draft.fields['sol_fee_paid'] === true); this.saveSol(); }
  additionalCosts(): { name: string; amount: unknown; cost_type_id?: number | null }[] {
    const a = this.draft.fields['additional_costs'];
    return Array.isArray(a) ? a as { name: string; amount: unknown; cost_type_id?: number | null }[] : [];
  }
  addCost(): void { this.draft.fields['additional_costs'] = [...this.additionalCosts(), { cost_type_id: null, name: '', amount: '' }]; }
  removeCost(i: number): void { this.draft.fields['additional_costs'] = this.additionalCosts().filter((_, k) => k !== i); this.saveSol(); }
  setCostName(i: number, v: string): void { const list = this.additionalCosts().map((x) => ({ ...x })); if (list[i]) { list[i].name = v; this.draft.fields['additional_costs'] = list; } }
  // Client 15-10-2026: additional costs can't be negative (a "-780" cost reduced the quote total).
  setCostAmount(i: number, v: string): void {
    const list = this.additionalCosts().map((x) => ({ ...x }));
    if (!list[i]) return;
    const n = Number(v);
    list[i].amount = v === '' || v == null ? '' : (Number.isFinite(n) && n < 0 ? Math.abs(n) : v);
    this.draft.fields['additional_costs'] = list;
  }
  costVal(c: { amount: unknown }): number { const n = Number(c.amount); return Number.isFinite(n) && n > 0 ? n : 0; }
  quoteTotal(): number {
    const base = Math.max(0, Number(this.ourSol('quote_amount')) || 0);
    return base + this.additionalCosts().reduce((s, c) => s + this.costVal(c), 0);
  }
  saveSol(notify = false): void {
    this.acting.set(true);
    this.api.saveStep(this.id, 4, { data: { ...this.draft, recommendation: this.draftRec() } })
      .pipe(catchError((e) => { this.showStepErrors(e, 'Save failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.patchLocalStep(); if (notify) this.toastr.success('Solicitor details saved', 'Saved'); } });
  }
  solChecksAll(): { id: number; name: string }[] { return (this.meta()?.options?.['solicitorChecks'] || []) as { id: number; name: string }[]; }
  private solMap(): Record<string, { done?: boolean; notes?: string }> {
    const m = this.draft.fields['sol_checks'];
    return (m && typeof m === 'object') ? m as Record<string, { done?: boolean; notes?: string }> : {};
  }
  solDone(id: number): boolean { return this.solMap()[String(id)]?.done === true; }
  solNoteVal(id: number): string { return String(this.solMap()[String(id)]?.notes ?? ''); }
  setSolNote(id: number, v: string): void { const m = { ...this.solMap() }; m[String(id)] = { ...(m[String(id)] || {}), notes: v }; this.draft.fields['sol_checks'] = m; }
  toggleSolDone(id: number): void {
    const m = { ...this.solMap() }; const cur = m[String(id)] || {}; m[String(id)] = { ...cur, done: !(cur.done === true) };
    this.draft.fields['sol_checks'] = m; this.saveSol();
    this.saveBsCheck(id);
  }
  /** Note edited: save the case step and (when a master solicitor is picked) the solicitor's check. */
  saveSolCheckNote(id: number): void { this.saveSol(); this.saveBsCheck(id); }
  private loadSolDocs(): void {
    this.solDocs.set([]);
    this.api.listPhotos(this.id, 4).pipe(catchError(() => of([])), takeUntilDestroyed(this.destroyRef))
      .subscribe((rows) => {
        this.solDocs.set((rows || []).map((r) => ({ id: r.id, file_name: r.file_name, content_type: r.content_type ?? null, url: null, tag: r.doc_tag ?? null })));
        // Client 22-10-2026: names only - a file is fetched when it is clicked (openFile).
      });
  }
  solDocsFor(id: number): UwFileItem[] { return this.solDocs().filter((d) => d.tag === 'sol:' + id); }
  onSolDocPick(id: number, ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = this.allowedPicks(input);
    if (!files.length) return;
    // Client 16-10-2026: a master solicitor is picked -> the evidence is kept WITH the solicitor.
    if (this.bsId()) { this.uploadBsDocs(id, files); input.value = ''; return; }
    let pending = files.length;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = String(reader.result || '');
        this.api.uploadPhoto(this.id, { step_no: 4, file_name: file.name, content_base64: b64, content_type: file.type, doc_tag: 'sol:' + id })
          .pipe(catchError((e: { error?: { message?: string } }) => { this.toastr.error(e?.error?.message || 'Upload failed.', 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
          .subscribe(() => { if (--pending <= 0) this.loadSolDocs(); });
      };
      reader.readAsDataURL(file);
    });
    input.value = '';
  }
  removeSolDoc(docId: number): void { this.api.deletePhoto(this.id, docId).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadSolDocs()); }

  // ---- Step 5: updated Credit Deal Summary (client 07-10-2026) ----
  readonly uploadingSummary = signal(false);
  readonly sendingCreditPaper = signal(false);

  // ---- Final Credit Committee: "Send Credit Paper to Committee" popup (client 09-10-2026).
  //      Tick Head-of-Underwriting recipients and/or add one-off emails for this send. ----
  readonly committeeSendOpen = signal(false);
  readonly committeeSelected = signal<Set<string>>(new Set<string>());
  readonly committeeExtra = signal<string[]>([]);
  committeeExtraDraft = '';
  readonly committeeError = signal<string | null>(null);

  committeeHeads(): { id: number; name: string; email: string }[] {
    return (this.meta()?.options?.['committeeHeads'] || []) as { id: number; name: string; email: string }[];
  }
  openCommitteeSend(): void {
    // Pre-tick every Head of Underwriting by default.
    const emails = this.committeeHeads().map((h) => String(h.email || '').trim()).filter(Boolean);
    this.committeeSelected.set(new Set(emails));
    this.committeeExtra.set([]);
    this.committeeExtraDraft = '';
    this.committeeError.set(null);
    this.committeeDocSel.set(new Set<string>());
    this.committeeUploads.set([]);
    this.committeeNotes = '';
    this.loadCommitteeDocs();
    this.committeeSendOpen.set(true);
  }
  isCommitteeChecked(email: string): boolean { return this.committeeSelected().has(email); }
  toggleCommittee(email: string): void {
    const next = new Set(this.committeeSelected());
    if (next.has(email)) next.delete(email); else next.add(email);
    this.committeeSelected.set(next);
  }
  addCommitteeEmail(): void {
    const e = this.committeeExtraDraft.trim();
    if (!e) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { this.committeeError.set('Enter a valid email address.'); return; }
    const lower = e.toLowerCase();
    if (this.committeeExtra().some((x) => x.toLowerCase() === lower) || this.committeeHeads().some((h) => String(h.email).toLowerCase() === lower)) {
      this.committeeError.set('That email is already in the list.'); return;
    }
    this.committeeExtra.update((list) => [...list, e]);
    const sel = new Set(this.committeeSelected()); sel.add(e); this.committeeSelected.set(sel);
    this.committeeExtraDraft = '';
    this.committeeError.set(null);
  }
  removeCommitteeExtra(email: string): void {
    this.committeeExtra.update((list) => list.filter((x) => x !== email));
    const sel = new Set(this.committeeSelected()); sel.delete(email); this.committeeSelected.set(sel);
  }
  submitCommitteeSend(): void {
    const emails = Array.from(this.committeeSelected());
    if (!emails.length) { this.committeeError.set('Select at least one recipient.'); return; }
    const miss = this.solChecksMissing();
    if (miss.length) { this.committeeError.set('Complete all Solicitor Checks (Step 2 Solicitor Quote) first: ' + miss.join(', ')); return; }
    this.committeeError.set(null);
    this.sendingCreditPaper.set(true);
    const sel = this.committeeDocSel();
    const documents = this.committeeDocs().filter((d) => sel.has(this.docKey(d))).map((d) => ({ source: d.source, id: d.id }));
    this.api.sendFinalCreditPaper(this.id, emails, { documents, uploads: this.committeeUploads(), notes: this.committeeNotes.trim() })
      .pipe(catchError((e: { error?: { message?: string } }) => { this.sendingCreditPaper.set(false); this.committeeError.set(e?.error?.message || 'Could not send the credit paper'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.sendingCreditPaper.set(false);
        if (r === null) return;
        this.committeeSendOpen.set(false);
        this.toastr.success('Credit paper e-mailed' + (r && r.to ? ' to ' + r.to : '') + (r && r.attachments && r.attachments > 1 ? ' with ' + (r.attachments - 1) + ' other document' + (r.attachments > 2 ? 's' : '') : ''));
        if (this.committeeUploads().length) this.refreshCase();
      });
  }
  creditSummaryDoc(): { id: number; file_name: string } | null {
    return this.signedDocs().find((d) => /^Credit Deal Summary/i.test(d.file_name)) || null;
  }
  downloadCreditSummary(): void {
    const doc = this.creditSummaryDoc(); if (!doc) return;
    this.api.signedOffer(this.id, doc.id).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => {
        if (!blob) { this.toastr.error('Could not download the Credit Deal Summary'); return; }
        const url = URL.createObjectURL(blob as Blob);
        const a = document.createElement('a'); a.href = url; a.download = doc.file_name;
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      });
  }
  readonly genCreditPaper = signal(false);
  downloadGeneratedCreditPaper(): void {
    this.genCreditPaper.set(true);
    this.api.downloadCreditPaper(this.id).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => {
        this.genCreditPaper.set(false);
        if (!blob) { this.toastr.error('Could not generate the credit paper'); return; }
        const ref = this.c()?.application_ref || ('APP-' + this.id);
        const url = URL.createObjectURL(blob as Blob);
        const a = document.createElement('a'); a.href = url; a.download = `Credit Paper - ${ref}.docx`;
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      });
  }
  onCreditSummaryPick(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0]; if (!file) return;
    this.uploadingSummary.set(true);
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = String(reader.result || '');
      this.api.uploadCreditSummary(this.id, { file_name: file.name, content_base64: b64, content_type: file.type })
        .pipe(catchError((e: { error?: { message?: string } }) => { this.toastr.error(e?.error?.message || 'Upload failed.', 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
        .subscribe((r) => {
          this.uploadingSummary.set(false);
          if (r === null) return;
          this.toastr.success('Updated Credit Deal Summary uploaded');
          this.api.get(this.id).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
            .subscribe((cas) => { if (cas) { this.c.set(cas); this.signedLoadedFor = null; this.initSignedOffer(cas); } });
        });
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  // ---- valuation report documents (client 07-10-2026): stored with the case docs (step 2) ----
  readonly valDocs = signal<UwFileItem[]>([]);
  readonly uploadingValDoc = signal(false);
  private loadValDocs(): void {
    this.valDocs.set([]);
    this.api.listPhotos(this.id, 2).pipe(catchError(() => of([])), takeUntilDestroyed(this.destroyRef))
      .subscribe((rows) => {
        this.valDocs.set((rows || []).map((r) => ({ id: r.id, file_name: r.file_name, content_type: r.content_type ?? null, url: null })));
        // Client 22-10-2026: names only - a file is fetched when it is clicked (openFile).
      });
  }
  onValDocPick(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = this.allowedPicks(input);
    if (!files.length) return;
    this.uploadingValDoc.set(true); let pending = files.length;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = String(reader.result || '');
        this.api.uploadPhoto(this.id, { step_no: 2, file_name: file.name, content_base64: b64, content_type: file.type })
          .pipe(catchError((e: { error?: { message?: string } }) => { this.toastr.error(e?.error?.message || 'Upload failed.', 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
          .subscribe(() => { if (--pending <= 0) { this.uploadingValDoc.set(false); this.loadValDocs(); } });
      };
      reader.readAsDataURL(file);
    });
    input.value = '';
  }
  removeValDoc(docId: number): void {
    this.api.deletePhoto(this.id, docId).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadValDocs());
  }

  // ---- add-new Valuer Firm (client 07-10-2026): mirrors the enquiry add-broker flow ----
  readonly valuerAddOpen = signal(false);
  readonly valuerSaving = signal(false);
  readonly valuerError = signal<string | null>(null);
  valuerDraft: { name: string; firm: string; email: string; phone: string } = { name: '', firm: '', email: '', phone: '' };
  // Edit the valuer firm selected in the entry form (client 08-10-2026): mirrors the
  // enquiry broker add/edit — the SAME firm is updated, never duplicated.
  readonly valuerEditOpen = signal(false);
  readonly valuerEditSaving = signal(false);
  readonly valuerEditError = signal<string | null>(null);
  valuerEditDraft: { name: string; firm: string; email: string; phone: string } = { name: '', firm: '', email: '', phone: '' };
  private valuerEditId = 0;

  toggleValuerAdd(): void { this.valuerError.set(null); if (this.valuerEditOpen()) this.valuerEditOpen.set(false); this.valuerAddOpen.update((v) => !v); }
  saveValuerFirm(): void {
    const name = this.valuerDraft.name.trim();
    const email = this.valuerDraft.email.trim();
    const phone = this.valuerDraft.phone.trim();
    const firm = this.valuerDraft.firm.trim();
    if (!name) { this.valuerError.set('Valuer firm name is required.'); return; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { this.valuerError.set('Enter a valid email address.'); return; }
    if (phone && !/^\+?[0-9\s()-]{6,}$/.test(phone)) { this.valuerError.set('Enter a valid phone number.'); return; }
    this.valuerSaving.set(true); this.valuerError.set(null);
    this.api.createValuerFirm({ name, firm, email, phone })
      .pipe(catchError((e: { error?: { errors?: Record<string, string>; message?: string } }) => {
        const errs = e?.error?.errors;
        this.valuerError.set((errs && Object.values(errs)[0]) || e?.error?.message || 'Could not add valuer firm.');
        this.valuerSaving.set(false); return of(null);
      }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.valuerSaving.set(false);
        if (!r) return;
        const m = this.meta();
        if (m) { const valuers = [...(m.options?.['valuers'] || []), { id: r.id, name: r.name }]; this.meta.set({ ...m, options: { ...(m.options || {}), valuers } }); }
        this.setEv('valuer_firm', r.name);
        this.valuerAddOpen.set(false);
        this.valuerDraft = { name: '', firm: '', email: '', phone: '' };
      });
  }
  /** Is a valuer firm chosen in the entry form (so there is something to edit)? */
  valuerSelected(): boolean { return !!String(this.ev('valuer_firm') || '').trim(); }
  private valuerOpts(): { id: number; name: string; firm?: string; email?: string; phone?: string }[] {
    return (this.meta()?.options?.['valuers'] || []) as { id: number; name: string; firm?: string; email?: string; phone?: string }[];
  }
  /** Open the edit panel, prefilled from the selected valuer firm's option row. */
  openValuerEdit(): void {
    const nm = String(this.ev('valuer_firm') || '').trim();
    if (!nm) { this.valuerEditError.set('Select a valuer firm to edit first.'); return; }
    const v = this.valuerOpts().find((o) => o.name === nm);
    if (!v) { this.valuerEditError.set('Could not find the selected valuer firm.'); return; }
    if (this.valuerAddOpen()) this.valuerAddOpen.set(false);
    this.valuerEditId = v.id;
    this.valuerEditDraft = { name: v.name || '', firm: v.firm || '', email: v.email || '', phone: v.phone || '' };
    this.valuerEditError.set(null);
    this.valuerEditOpen.set(true);
  }
  cancelValuerEdit(): void { this.valuerEditOpen.set(false); this.valuerEditError.set(null); }
  saveValuerFirmEdit(): void {
    const id = this.valuerEditId;
    if (!id) return;
    const name = this.valuerEditDraft.name.trim();
    const email = this.valuerEditDraft.email.trim();
    const phone = this.valuerEditDraft.phone.trim();
    const firm = this.valuerEditDraft.firm.trim();
    if (!name) { this.valuerEditError.set('Valuer firm name is required.'); return; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { this.valuerEditError.set('Enter a valid email address.'); return; }
    if (phone && !/^\+?[0-9\s()-]{6,}$/.test(phone)) { this.valuerEditError.set('Enter a valid phone number.'); return; }
    const prevName = this.valuerOpts().find((o) => Number(o.id) === id)?.name;
    this.valuerEditSaving.set(true); this.valuerEditError.set(null);
    this.api.updateValuerFirm(id, { name, firm, email, phone })
      .pipe(catchError((e: { error?: { errors?: Record<string, string>; message?: string } }) => {
        const errs = e?.error?.errors;
        this.valuerEditError.set((errs && Object.values(errs)[0]) || e?.error?.message || 'Could not update valuer firm.');
        this.valuerEditSaving.set(false); return of(null);
      }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.valuerEditSaving.set(false);
        if (!r) return;
        const m = this.meta();
        if (m) {
          const valuers = (m.options?.['valuers'] || []).map((o) => Number(o.id) === id ? { ...o, name: r.name, firm: r.firm, email: r.email, phone: r.phone } : o);
          this.meta.set({ ...m, options: { ...(m.options || {}), valuers } });
        }
        // Keep the entry pointing at the firm even if its name changed.
        if (prevName && String(this.ev('valuer_firm') || '') === prevName) this.setEv('valuer_firm', r.name);
        this.valuerEditOpen.set(false);
        this.toastr.success('Valuer firm updated');
      });
  }

  // ---- Solicitor master add/edit (client 09-10-2026): mirrors the Valuer Firm add/edit,
  //      so a new "Our Solicitor" can be created / edited from the Solicitor Quote step. ----
  readonly solAddOpen = signal(false);
  readonly solSaving = signal(false);
  readonly solError = signal<string | null>(null);
  solDraft: { name: string; firm: string; email: string; phone: string } = { name: '', firm: '', email: '', phone: '' };
  readonly solEditOpen = signal(false);
  readonly solEditSaving = signal(false);
  readonly solEditError = signal<string | null>(null);
  solEditDraft: { name: string; firm: string; email: string; phone: string } = { name: '', firm: '', email: '', phone: '' };
  private solEditId = 0;

  private solicitorOpts(): { id: number; name: string; sol_name?: string; firm?: string; email?: string; phone?: string }[] {
    return (this.meta()?.options?.['solicitors'] || []) as { id: number; name: string; sol_name?: string; firm?: string; email?: string; phone?: string }[];
  }
  solicitorSelected(): boolean { return !!String(this.ourSol('firm_name') || '').trim(); }
  toggleSolAdd(): void { this.solError.set(null); if (this.solEditOpen()) this.solEditOpen.set(false); this.solAddOpen.update((v) => !v); }
  saveSolicitor(): void {
    const name = this.solDraft.name.trim();
    const email = this.solDraft.email.trim();
    const phone = this.solDraft.phone.trim();
    const firm = this.solDraft.firm.trim();
    if (!name) { this.solError.set('Solicitor name is required.'); return; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { this.solError.set('Enter a valid email address.'); return; }
    if (phone && !/^\+?[0-9\s()-]{6,}$/.test(phone)) { this.solError.set('Enter a valid phone number.'); return; }
    this.solSaving.set(true); this.solError.set(null);
    this.api.createSolicitor({ name, firm, email, phone })
      .pipe(catchError((e: { error?: { errors?: Record<string, string>; message?: string } }) => {
        const errs = e?.error?.errors;
        this.solError.set((errs && Object.values(errs)[0]) || e?.error?.message || 'Could not add solicitor.');
        this.solSaving.set(false); return of(null);
      }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.solSaving.set(false);
        if (!r) return;
        const m = this.meta();
        if (m) {
          const solicitors = [...(m.options?.['solicitors'] || []), { id: r.id, name: r.name, sol_name: r.sol_name, firm: r.firm, email: r.email, phone: r.phone }];
          this.meta.set({ ...m, options: { ...(m.options || {}), solicitors } });
        }
        this.setOurSol('firm_name', r.name); this.saveSol();
        this.solAddOpen.set(false);
        this.solDraft = { name: '', firm: '', email: '', phone: '' };
      });
  }
  openSolEdit(): void {
    const nm = String(this.ourSol('firm_name') || '').trim();
    if (!nm) { this.solEditError.set('Select a solicitor to edit first.'); return; }
    const v = this.solicitorOpts().find((o) => o.name === nm);
    if (!v) { this.solEditError.set('Could not find the selected solicitor.'); return; }
    if (this.solAddOpen()) this.solAddOpen.set(false);
    this.solEditId = v.id;
    this.solEditDraft = { name: v.sol_name || v.name || '', firm: v.firm || '', email: v.email || '', phone: v.phone || '' };
    this.solEditError.set(null);
    this.solEditOpen.set(true);
  }
  cancelSolEdit(): void { this.solEditOpen.set(false); this.solEditError.set(null); }
  saveSolicitorEdit(): void {
    const id = this.solEditId;
    if (!id) return;
    const name = this.solEditDraft.name.trim();
    const email = this.solEditDraft.email.trim();
    const phone = this.solEditDraft.phone.trim();
    const firm = this.solEditDraft.firm.trim();
    if (!name) { this.solEditError.set('Solicitor name is required.'); return; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { this.solEditError.set('Enter a valid email address.'); return; }
    if (phone && !/^\+?[0-9\s()-]{6,}$/.test(phone)) { this.solEditError.set('Enter a valid phone number.'); return; }
    const prevName = this.solicitorOpts().find((o) => Number(o.id) === id)?.name;
    this.solEditSaving.set(true); this.solEditError.set(null);
    this.api.updateSolicitor(id, { name, firm, email, phone })
      .pipe(catchError((e: { error?: { errors?: Record<string, string>; message?: string } }) => {
        const errs = e?.error?.errors;
        this.solEditError.set((errs && Object.values(errs)[0]) || e?.error?.message || 'Could not update solicitor.');
        this.solEditSaving.set(false); return of(null);
      }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.solEditSaving.set(false);
        if (!r) return;
        const m = this.meta();
        if (m) {
          const solicitors = (m.options?.['solicitors'] || []).map((o) => Number((o as { id: number }).id) === id ? { ...o, name: r.name, sol_name: r.sol_name, firm: r.firm, email: r.email, phone: r.phone } : o);
          this.meta.set({ ...m, options: { ...(m.options || {}), solicitors } });
        }
        if (prevName && String(this.ourSol('firm_name') || '') === prevName) { this.setOurSol('firm_name', r.name); this.saveSol(); }
        this.solEditOpen.set(false);
        this.toastr.success('Solicitor updated');
      });
  }

  // ---- securities (client 07-10-2026): main + other securities from the enquiry ----
  securityOptions(): { id: number; label: string }[] {
    const cas = this.c();
    return (cas?.securities || []).map((s) => ({
      id: s.security_id,
      // Client 15-10-2026: always "1st legal charge" / "2nd legal charge" (some rows store just '1st').
      label: [s.property_address || ('Security #' + s.security_id), this.chargeLabel(s.charge_type)].filter(Boolean).join(' · '),
    }));
  }
  /** Multi-line summary value (several securities) -> stacked layout, label above the list. */
  isMultiLine(v: unknown): boolean { return typeof v === 'string' && v.includes('\n'); }
  chargeLabel(ct: unknown): string {
    const v = String(ct || '').trim().toLowerCase();
    if (v.startsWith('2nd')) return '2nd legal charge';
    if (v.startsWith('1st')) return '1st legal charge';
    return String(ct || '').trim();
  }
  /** All security addresses — one numbered line each when more than one security is involved. */
  securitiesAddress(cas: UwCaseDetail): string {
    // Client 12-10-2026: comma-separated, each address carrying its postcode when present.
    const withPc = (a: string, p: string): string => {
      a = (a || '').trim(); p = (p || '').trim();
      if (!a) return '';
      if (!p) return a;
      return a.replace(/\s/g, '').toUpperCase().includes(p.replace(/\s/g, '').toUpperCase()) ? a : `${a}, ${p}`;
    };
    const list = (cas.securities || []).map((s) => withPc(s.property_address || '', s.postcode || '')).filter(Boolean);
    // Client 15-10-2026: several securities -> each on its own numbered line (rendered with
    // white-space: pre-line on the summary value).
    if (list.length > 1) return list.map((a, i) => `${i + 1}. ${a}`).join('\n');
    return list.length ? list[0] : (cas.property_address || '—');
  }
  /** Security summary row — lists ALL securities (main + other), pluralised (client 12-10-2026). */
  private securityRow(cas: UwCaseDetail, nameOnly = false): SumRow {
    const multi = !!(cas.securities && cas.securities.length > 1);
    return { label: multi ? 'Securities' : 'Security', value: this.securitiesAddress(cas), lines: multi ? this.securityLines(cas, nameOnly) : undefined };
  }
  /** Client 16-10-2026: one tidy block per security (address, then charge · value) instead of a
   *  long right-aligned run-on in the summary cards. */
  securityLines(cas: UwCaseDetail, nameOnly = false): { main: string; sub: string }[] {
    const withPc = (a: string, p: string): string => {
      a = (a || '').trim(); p = (p || '').trim();
      if (!a) return '';
      if (!p) return a;
      return a.replace(/\s/g, '').toUpperCase().includes(p.replace(/\s/g, '').toUpperCase()) ? a : `${a}, ${p}`;
    };
    return (cas.securities || []).map((s, i) => ({
      main: withPc(s.property_address || '', s.postcode || '') || ('Security ' + (i + 1)),
      // nameOnly (client 21-10-2026, Final Credit Committee): the security name, no charge type / amount.
      sub: nameOnly ? '' : [this.chargeLabel(s.charge_type), s.estimated_value != null && Number(s.estimated_value) > 0 ? this.money(Number(s.estimated_value)) : ''].filter(Boolean).join(' · '),
    }));
  }

  // ---- valuation paid toggle (client 07-10-2026): borrower pays the valuer direct ----
  entryPaid(e: Record<string, unknown>): boolean { return e['paid'] === true; }
  togglePaid(i: number): void {
    const list = this.entries().map((e) => ({ ...e }));
    if (!list[i]) return;
    const nowPaid = !(list[i]['paid'] === true);
    list[i]['paid'] = nowPaid;
    this.draft.fields['entries'] = list;
    this.acting.set(true);
    this.api.saveStep(this.id, this.selected(), this.payload())
      .pipe(catchError((e) => { this.showStepErrors(e, 'Save failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.toastr.success('Valuation ' + (i + 1) + (nowPaid ? ' marked paid' : ' marked not paid')); this.patchLocalStep(); } });
  }

  ngOnInit(): void {
    this.id = Number(this.route.snapshot.paramMap.get('id'));
    forkJoin({
      meta: this.api.meta().pipe(catchError(() => of(null))),
      cas: this.api.get(this.id).pipe(catchError((e) => { this.error.set(e?.error?.message || 'Could not load case.'); return of(null); })),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ meta, cas }) => {
      this.meta.set(meta); this.c.set(cas);
      if (cas) {
        // Keep the user on the step they were viewing across a refresh (e.g. after a KYC
        // upload), instead of always snapping back to the case's current step (client 09-10-2026).
        const saved = this.readSavedStep();
        const cur = cas.current_step || 1;
        this.selected.set(saved != null && saved >= 1 && saved <= cur ? saved : cur);
        this.loadDraft(); this.initSignedOffer(cas); this.loadNotes(cas);
      }
      this.loading.set(false);
    });
  }

  private reload(): void {
    this.api.get(this.id).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe((cas) => {
      if (cas) { this.c.set(cas); this.selected.set(cas.current_step || this.selected()); this.loadDraft(); }
    });
  }

  // ---- perms ----
  private can(a: string): boolean { return !this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.can('UNDERWRITING.CASE', a); }
  /** Send Requirements button (client 13-10-2026): its own role permission, falls back to Underwriting add. */
  private canSendPerm(): boolean { return !this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.can('UNDERWRITING.SEND_REQUIREMENTS', 'add') || this.perms.can('UNDERWRITING.CASE', 'add'); }
  /** Accept Case = Underwriting > APPROVE. */
  canAccept(): boolean { return this.can('approve'); }
  /** Return to BDM = Underwriting > ADD (unchanged). */
  canReturnBdm(): boolean { return this.can('add'); }
  /** Return to BDM is allowed at any step (28-09-2026) until the case is finished. */
  canReturnAnyStep(): boolean {
    const st = this.c()?.status || '';
    return this.canReturnBdm() && !['New Review', 'In Portfolio', 'Rejected', 'Closed'].includes(st);
  }
  /** A closed or rejected underwriting file can be reopened (back to In Progress). */
  canReopen(): boolean { const st = this.c()?.status || ''; return ['Closed', 'Rejected'].includes(st) && this.can('approve'); }
  reopenCase(cas: UwCaseDetail): void {
    this.acting.set(true);
    this.api.reopenCase(cas.underwriting_case_id)
      .pipe(catchError((e) => { this.showStepErrors(e, 'Reopen failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.toastr.success('Case reopened'); this.reload(); } });
  }
  // ---- On Hold / Resume (client 07-10-2026): keeps paused deals out of the pipeline numbers ----
  isOnHold(): boolean { return this.c()?.status === 'On Hold'; }
  canHold(): boolean {
    const st = this.c()?.status || '';
    return this.can('add') && !['New Review', 'On Hold', 'In Portfolio', 'Rejected', 'Closed', 'Returned to BDM', 'Sent to Credit'].includes(st);
  }
  holdCase(cas: UwCaseDetail): void {
    this.acting.set(true);
    this.api.holdCase(cas.underwriting_case_id)
      .pipe(catchError((e) => { this.showStepErrors(e, 'Could not hold'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.toastr.success('Case put on hold'); this.reload(); } });
  }
  resumeCase(cas: UwCaseDetail): void {
    this.acting.set(true);
    this.api.resumeCase(cas.underwriting_case_id)
      .pipe(catchError((e) => { this.showStepErrors(e, 'Could not resume'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.toastr.success('Case resumed'); this.reload(); } });
  }
  /** "View Application" needs Applications > Application List > VIEW. */
  canViewApp(): boolean { return !this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.can('APPLICATIONS.APPLICATION_LIST', 'view'); }

  // ---- edit Gross Loan / Net Advance (client 12-10-2026) ----
  readonly loanEditOpen = signal(false);
  readonly loanSaving = signal(false);
  loanDraft: { gross: number | null; net: number | null } = { gross: null, net: null };
  canEditLoan(cas: UwCaseDetail): boolean {
    return this.can('add') && !['Rejected', 'Closed', 'In Portfolio'].includes(String(cas.status || ''));
  }
  openLoanEdit(): void {
    const cas = this.c();
    this.loanDraft = { gross: cas?.amount_requested ?? null, net: cas?.net_advance ?? null };
    this.loanEditOpen.set(true);
  }
  cancelLoanEdit(): void { this.loanEditOpen.set(false); }
  /** Client 12-10-2026: underwriter saved an edited indicative — refresh the case figures. */
  onIndicativeSaved(): void {
    this.loanEditOpen.set(false);
    this.reload();
  }
  saveLoan(): void {
    const gross = Number(this.loanDraft.gross);
    if (!Number.isFinite(gross) || gross <= 0) { this.toastr.error('Enter a valid Gross Loan amount.'); return; }
    const net = this.loanDraft.net == null || (this.loanDraft.net as unknown) === '' ? null : Number(this.loanDraft.net);
    if (net != null && net > gross) { this.toastr.error('Net Advance cannot exceed the Gross Loan.'); return; }
    this.loanSaving.set(true);
    this.api.updateLoan(this.id, { gross, net })
      .pipe(catchError((e: { error?: { message?: string } }) => { this.loanSaving.set(false); this.toastr.error(e?.error?.message || 'Could not update the loan figures.'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.loanSaving.set(false);
        if (r === null) return;
        const cas = this.c();
        if (cas) this.c.set({ ...cas, amount_requested: r.amount_requested ?? gross, net_advance: r.net_advance ?? cas.net_advance, ltv_pct: r.ltv_pct ?? cas.ltv_pct });
        this.loanEditOpen.set(false);
        this.toastr.success('Loan figures updated');
      });
  }
  canQuery(): boolean { return this.can('add'); }
  /** Request Info button: stays until ALL underwriting steps are done, and the case has not moved on
      (Sent to Credit / In Portfolio) or been rejected / closed. */
  private readonly UW_FINAL = ['Sent to Credit', 'In Portfolio', 'Rejected', 'Closed'];
  canRequestInfoUw(): boolean {
    const c = this.c();
    if (!c || !this.canQuery() || this.UW_FINAL.includes(c.status)) return false;
    const steps = this.visibleSteps();
    return !steps.length || !steps.every((s) => this.isDone(s.no));
  }
  canReject(): boolean { return this.can('approve') || this.can('reject'); }
  /** Final Credit Committee (client 20-10-2026): Agree to Fund = stage APPROVE, Cannot Proceed = stage REJECT. */
  private canCommittee(a: 'approve' | 'reject'): boolean { return !this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.can('UNDERWRITING_STAGES.CREDIT_COMMITTEE', a); }
  /** Show the step CTA? Committee step needs APPROVE; other steps unchanged. */
  canStepCta(no: number): boolean { return no !== 10 || this.canCommittee('approve'); }
  /** Client 21-10-2026: the final step (Completion & Move to Portfolio) can't be completed
   *  until every earlier step is done - lists the open ones as "Step 3 KYC / AML". */
  pendingBeforeFinal(no: number): string[] {
    const steps = this.visibleSteps();
    const last = steps.length ? Math.max(...steps.map((s) => s.no)) : 0;
    if (no !== last || this.inPortfolio()) return [];
    return steps.filter((s) => s.no !== last && !this.isDone(s.no)).map((s) => `Step ${this.displayNo(s.no)} ${this.stepName(s)}`);
  }
  /** Show Reject / Cannot Proceed? Committee step needs its own REJECT; others keep Underwriting approve/reject. */
  canStepReject(no: number): boolean { return no === 10 ? this.canCommittee('reject') : this.canReject(); }
  canRespond(): boolean { return this.can('add'); }

  // ---- step helpers ----
  def = computed<UwStepDef | null>(() => (this.meta()?.steps || []).find((s) => s.no === this.selected()) || null);
  stepOf(no: number): UwStep | undefined { return (this.c()?.steps || []).find((s) => s.step_no === no); }
  /** Post-accept stepper hides Step 1 (Initial Review = the acceptance); rest renumber (Valuation = Step 1). */
  /** Merged UI: hide Initial Review (1) and the merged sub-steps 7,8,9 (shown inside step 6). */
  visibleSteps(): UwStepDef[] {
    return (this.meta()?.steps || []).filter((s) => ![1, 7, 8, 9].includes(s.no))
      .slice().sort((a, b) => this.displayNo(a.no) - this.displayNo(b.no));
  }
  /** Merged UI Step 5 = config step 6 (Underwrite & Findings + Credit Paper + Site Visit). */
  isMerged(): boolean { return this.selected() === 6; }
  stepName(s: UwStepDef): string { return s.no === 6 ? 'Underwriting Review' : s.name; }
  stepHint(s: UwStepDef): string { return s.no === 6 ? 'Findings & recommendation, credit paper and site visit diligence' : s.hint; }
  displayNo(no: number): number {
    // Client 08-10-2026: Requirements to Broker (config 5) removed. Display order:
    // Valuation (2)=1, Solicitor Quote (4)=2, KYC/AML (3)=3, Underwrite & Findings (6)=4,
    // Final Credit Committee (10)=5, Funds (11)=6, Completion (12)=7.
    if (no === 2) return 1;
    if (no === 4) return 2;
    if (no === 3) return 3;
    if (no === 6) return 4;
    if (no >= 10) return no - 5;
    return 4; // merged sub-steps (7,8,9) sit under Underwriting Review (step 4)
  }
  reachable(no: number): boolean { const cur = this.c()?.current_step || 1; return no <= cur; }
  /** Any rendered step is freely navigable (view). Acting stays gated by reachable()/isCurrent(). */
  navigable(no: number): boolean { return (this.visibleSteps() || []).some((s) => s.no === no); }
  isDone(no: number): boolean {
    // Client 13-10-2026: once the case is In Portfolio every step is complete.
    if (this.inPortfolio()) return true;
    // A verdict step is done only when the verdict itself says so.
    if (this.isVerdictStep(no)) {
      const r = this.stepMeta(no).result;
      return r === 'accepted' || r === 'passed';
    }
    // Client 16-10-2026: Solicitor Quote is never "Done" while a solicitor check is open
    // (also covers cases completed before the rule existed).
    if (no === 4 && this.canViewStep(4) && this.solChecksMissing().length) return false;
    const st = this.stepOf(no)?.status;
    return st === 'Completed' || st === 'Approved';
  }
  /** Live per-step outcome (selected step reads the draft, others read persisted data). */
  /**
   * Steps whose completion is a VERDICT, not a form save.
   * Valuation Instruction is done only once the valuation is accepted; KYC/AML
   * only once it is marked passed. Without this they read "Done" as soon as the
   * step row was completed, even though nobody had answered yet.
   */
  private readonly VERDICT_STEP_KEYS = ['valuation_instruction', 'kyc_aml'];
  /* ---- server validation feedback ---------------------------------- */

  readonly fieldErrors = signal<Record<string, string>>({});
  readonly fieldErrorList = signal<ServerFieldError[]>([]);

  /**
   * Report WHICH field the server rejected. Underwriting step data is free-form
   * JSON, so most rejections here are whole-step rules ("Choose a recommendation
   * before proceeding") rather than per-field - those still surface as the toast
   * message, while any field map is listed above the step form.
   */
  private showStepErrors(e: unknown, fallback: string): void {
    const errors = extractFieldErrors(e);
    this.fieldErrors.set(errors);
    const list = toFieldErrorList(errors);
    this.fieldErrorList.set(list);
    const msg = (e as { error?: { message?: string } })?.error?.message;
    this.toastr.error(list.length ? errorSummary(list) : (msg || fallback), fallback);
  }

  fErr(name: string): string { return this.fieldErrors()[name] || ''; }
  private clearStepErrors(): void { this.fieldErrors.set({}); this.fieldErrorList.set([]); }

  auditAction = auditAction;
  auditSummary = auditSummary;
  auditWhen(v: string): string { return formatDateTime(v); }

  /** Case finished underwriting and now lives in Portfolio. */
  readonly showStagesAnyway = signal(false);
  /** Case history opens in a dialog — inline it buried the step form. */
  readonly auditOpen = signal(false);
  inPortfolio(): boolean { return this.c()?.status === 'In Portfolio'; }

  isVerdictStep(no: number): boolean {
    const def = (this.meta()?.steps || []).find((x) => x.no === no);
    return !!def && this.VERDICT_STEP_KEYS.includes(def.key);
  }

  stepMeta(no: number): { result: string; sent: boolean } {
    let f: Record<string, unknown> = {};
    if (no === this.selected()) { f = this.draft.fields; }
    else { const st = this.stepOf(no); if (st?.data) { try { f = (JSON.parse(st.data).fields) || {}; } catch { f = {}; } } }
    const result = String(f['valuation_result'] || f['kyc_result'] || f['broker_result'] || '');
    const sent = !!(f['valuation_sent'] || f['kyc_sent'] || f['broker_sent']);
    return { result, sent };
  }
  stageClass(no: number): string {
    if (this.inPortfolio()) return 'done';
    const r = this.stepMeta(no).result;
    const bad = r === 'rejected' || r === 'failed';
    if (this.selected() === no) return bad ? 'sel rej' : 'sel';
    if (bad) return 'rej';
    if (r === 'accepted' || r === 'passed' || this.isDone(no)) return 'done';
    if (no === (this.c()?.current_step || 1)) return 'cur';
    return '';
  }
  stageBadge(no: number): string {
    const m = this.stepMeta(no);
    if (m.result === 'rejected' || m.result === 'failed') return 'Rejected';
    // Done ONLY when the step is genuinely complete (verdict met / status completed).
    if (this.isDone(no)) return '✓ Done';
    // Client 05-10-2026 (#12/#13): no "Pending" on a fresh / current / future step.
    // Once the underwriter has MOVED PAST a step without completing it, it shows
    // Pending (they proceeded freely but the step is not done).
    const cur = this.c()?.current_step || 1;
    if (no > 1 && this.displayNo(no) < this.displayNo(cur)) return 'Pending';
    return '';
  }
  stageBadgeClass(no: number): string {
    const m = this.stepMeta(no);
    if (m.result === 'rejected' || m.result === 'failed') return 'rej';
    if (this.isDone(no)) return 'done';
    const cur = this.c()?.current_step || 1;
    if (no > 1 && this.displayNo(no) < this.displayNo(cur)) return 'query';
    return '';
  }
  editable(): boolean {
    const cas = this.c(); if (!cas) return false;
    // 'In Portfolio' added: once the case has been handed to Portfolio the
    // underwriting file is closed history. Every action button in this screen
    // hangs off editable(), so this one entry closes Save, Raise Query, Reject,
    // Cannot Proceed, the step CTA, Send to Broker, Mark Passed/Failed and the
    // valuation and KYC actions together.
    if (['Rejected', 'Closed', 'Sent to Credit'].includes(cas.status)) return false;
    // Stage-level RBAC: the API marks stages this role cannot view / work (Underwriting Stages matrix).
    if (this.stepOf(this.selected())?.can_act === false || !this.canViewStep(this.selected())) return false;
    // In Portfolio = closed history, EXCEPT a step that was never finished (cases moved before the
    // all-steps gate existed): that one step stays open so it can be completed for the record.
    if (cas.status === 'In Portfolio') return this.can('add') && !this.isDone(this.selected()) && this.stepOf(this.selected())?.status !== 'Skipped' && !this.isLastStep(this.selected());
    return this.navigable(this.selected()) && this.can('add');
  }
  /** Stage VIEW permission (server-computed can_view; admin / older API = visible). */
  canViewStep(no: number): boolean { return this.stepOf(no)?.can_view !== false; }
  isCurrent(): boolean { return this.selected() === (this.c()?.current_step || 1); }
  /** Last configured step — its CTA (Complete & Move to Portfolio) stays reachable. */
  isLastStep(n: number): boolean {
    const steps = this.meta()?.steps || [];
    return !!steps.length && n === steps[steps.length - 1].no;
  }
  /** Step 6: a recommendation must be picked before "Happy to Proceed". */
  recChosen(): boolean { return !!String(this.draftRec() || '').trim(); }
  select(no: number): void {
    this.clearStepErrors(); if (!this.navigable(no)) return; this.selected.set(no); this.saveStepSel(no); this.loadDraft(); }
  private stepKey(): string { return 'uw_step_' + this.id; }
  private saveStepSel(no: number): void { try { sessionStorage.setItem(this.stepKey(), String(no)); } catch { /* storage unavailable */ } }
  private readSavedStep(): number | null {
    try { const v = sessionStorage.getItem(this.stepKey()); const n = v ? Number(v) : NaN; return Number.isFinite(n) && n >= 1 ? n : null; } catch { return null; }
  }

  private loadDraft(): void {
    const st = this.stepOf(this.selected());
    let data: { checklist?: Record<string, boolean>; fields?: Record<string, unknown>; recommendation?: string } = {};
    if (st?.data) { try { data = JSON.parse(st.data); } catch { data = {}; } }
    this.draft = { checklist: data.checklist || {}, fields: data.fields || {}, recommendation: data.recommendation };
    this.draftRec.set(data.recommendation || '');
    // #6 Valuation (step 2): default Market Value + GDV from the enquiry figures.
    if (this.selected() === 2) {
      const cas = this.c();
      if ((this.draft.fields['market_value'] == null || this.draft.fields['market_value'] === '') && cas?.estimated_value != null) this.draft.fields['market_value'] = cas.estimated_value;
      if ((this.draft.fields['gdv_value'] == null || this.draft.fields['gdv_value'] === '') && cas?.gdv != null) this.draft.fields['gdv_value'] = cas.gdv;
    }
    // Funds to Solicitor (step 11). Client 16-10-2026: the amount sent to the solicitor is the
    // NET loan (what actually goes out), Funds to Broker = broker fee + the broker's share of
    // the arrangement fee, Funds Drawn Down (deals with drawdowns) = the gross. Dates = today.
    if (this.selected() === 11) {
      const cas = this.c();
      const empty = (k: string) => this.draft.fields[k] == null || this.draft.fields[k] === '';
      const today = new Date().toISOString().slice(0, 10);
      const net = cas ? this.netLoan(cas) : null;
      if (empty('funds_amount') && net != null) this.draft.fields['funds_amount'] = net;
      if (empty('funds_date')) this.draft.fields['funds_date'] = today;
      if (empty('broker_funds_amount') && this.brokerTotal() > 0) this.draft.fields['broker_funds_amount'] = this.brokerTotal();
      if (empty('broker_funds_date') && this.brokerTotal() > 0) this.draft.fields['broker_funds_date'] = today;
      if (this.hasDrawdowns()) {
        if (empty('drawdown_funds_amount') && cas?.amount_requested != null) this.draft.fields['drawdown_funds_amount'] = cas.amount_requested;
        if (empty('drawdown_funds_date')) this.draft.fields['drawdown_funds_date'] = today;
      }
    }
    this.initEntries();
    this.editOverride.set(false);
    this.photos.set([]);
    if (this.def()?.photos) this.loadPhotos();
    if (this.selected() === 6) this.loadMerged();
    if (this.selected() === 2) this.loadValDocs();
    if (this.selected() === 3) this.loadKycDocs();
    if (this.selected() === 4) { this.loadSolDocs(); this.loadBsChecks(true); }
  }

  // ---- photos (Site Visit & Diligence) ----
  private loadPhotos(): void {
    const step = this.selected();
    this.api.listPhotos(this.id, step)
      .pipe(catchError(() => of([])), takeUntilDestroyed(this.destroyRef))
      .subscribe((rows) => {
        this.photos.set((rows || []).map((r) => ({ id: r.id, file_name: r.file_name, content_type: r.content_type ?? null, url: null })));
        // Client 22-10-2026: names only - a file is fetched when it is clicked (openFile).
      });
  }
  onPhotoPick(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = this.allowedPicks(input);
    if (!files.length) return;
    const step = this.selected();
    this.uploadingPhoto.set(true);
    let pending = files.length;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = String(reader.result || '');
        this.api.uploadPhoto(this.id, { step_no: step, file_name: file.name, content_base64: b64, content_type: file.type })
          .pipe(catchError((e: any) => { this.toastr.error(e?.error?.message || 'Upload failed.', 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
          .subscribe(() => { if (--pending <= 0) { this.uploadingPhoto.set(false); this.loadPhotos(); } });
      };
      reader.readAsDataURL(file);
    });
    input.value = '';
  }
  removePhoto(docId: number): void {
    this.api.deletePhoto(this.id, docId)
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadPhotos());
  }

  // ---- edit-lock / update model ----
  canEditForm(): boolean {
    if (!this.editable()) return false;
    if (this.editOverride()) return true;
    // Valuation / KYC no longer lock after a "Send" (client 29-09-2026: the Send buttons are gone).
    // step 5 stays editable after send so edits can re-enable the Send button
    return true;
  }
  /** Keep the local case in sync after a step save so revisiting reads the saved data (not stale). */
  private patchLocalStep(): void {
    const cas = this.c(); if (!cas) return;
    const no = this.selected();
    const data = JSON.stringify({ checklist: this.draft.checklist, fields: this.draft.fields, recommendation: this.draftRec() });
    const steps = (cas.steps || []).map((st) => (st.step_no === no ? { ...st, data } : st));
    this.c.set({ ...cas, steps });
    // The local patch keeps the form snappy, but it cannot know what the server
    // recorded - step status, case status, and above all the audit history. Pull
    // the case back so the trail reflects the action that just happened instead
    // of waiting for a manual page refresh.
    this.refreshCase();
  }

  /** Refetch the case (audit history included) without disturbing the open form. */
  private refreshCase(): void {
    this.api.get(this.id)
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((cas) => { if (cas) this.c.set(cas); });
  }
  enableUpdate(): void { this.editOverride.set(true); }
  cancelUpdate(): void { this.loadDraft(); }
  saveUpdate(): void { this.editOverride.set(false); this.save(); }
  canEditReport(): boolean { return this.editable() && (this.isCurrent() || this.editOverride() || !this.valResult()); }

  checked(item: string): boolean { return this.draft.checklist[item] === true; }
  toggle(item: string): void { this.draft.checklist[item] = !this.draft.checklist[item]; }
  fieldVal(f: string): unknown { return this.draft.fields[f] ?? ''; }
  options(src: string): { id: number; name: string }[] { return this.meta()?.options?.[src] || []; }
  selectOpts(f: UwField): string[] { return f.source ? this.options(f.source).map((o) => o.name) : (f.options || []); }
  setField(f: string, v: unknown): void {
    this.draft.fields[f] = v;
  }
  setRec(v: string): void { this.draftRec.set(v); this.draft.recommendation = v; }

  private payload(): Record<string, unknown> {
    if (this.hasEntries(this.selected())) this.syncStepVerdict();
    return { data: { ...this.draft, recommendation: this.draftRec() } };
  }

  // ---- actions ----
  // Review stage is first-come, first-served. When the server refuses because
  // another reviewer got there first, the page in front of this user is stale —
  // reload it so the banner and its buttons go away instead of sitting there
  // inviting another failing click.
  accept(cas: UwCaseDetail): void {
    this.acting.set(true);
    this.api.accept(cas.underwriting_case_id)
      .pipe(catchError((e) => { this.showStepErrors(e, 'Accept failed'); this.reload(); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.toastr.success('Case accepted'); this.reload(); } });
  }
  openReviewReject(): void { this.reviewReason = ''; this.reviewRejectOpen.set(true); }
  confirmReviewReject(): void {
    if (!this.reviewReason.trim()) { this.toastr.error('Reason required'); return; }
    this.acting.set(true);
    this.api.rejectCase(this.id, { reason: this.reviewReason.trim() })
      .pipe(catchError((e) => { this.showStepErrors(e, 'Reject failed'); this.reviewRejectOpen.set(false); this.reload(); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.reviewRejectOpen.set(false); this.toastr.success('Case rejected'); this.reload(); } });
  }
  openReturn(): void { this.returnNote = ''; this.returnOpen.set(true); }
  confirmReturn(): void {
    this.acting.set(true);
    this.api.returnToBdm(this.id, { note: this.returnNote.trim() })
      .pipe(catchError((e) => { this.showStepErrors(e, 'Return failed'); this.returnOpen.set(false); this.reload(); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.returnOpen.set(false); this.toastr.success('Returned to the BDM — the enquiry has been reopened at the offer stage.'); void this.router.navigate(['/underwriting']); } });
  }
  save(): void {
    this.acting.set(true);
    this.api.saveStep(this.id, this.selected(), this.payload()).pipe(catchError((e) => { this.showStepErrors(e, 'Save failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.toastr.success('Saved'); this.patchLocalStep(); } });
  }

  // ---- multiple entries: Valuation (2), KYC / AML (3), Solicitor Quote (4) — client 28-09-2026 ----
  // Entries live in draft.fields.entries; the FIRST entry is also mirrored onto the flat
  // fields so everything that reads the old single-entry shape (valuations list,
  // portfolio, application form, broker email fallback) keeps working.
  readonly ENTRY_KEYS: Record<number, string[]> = {
    2: ['security', 'valuation_type', 'valuer_firm', 'instruction_date', 'report_due_date', 'fee', 'notes', 'paid'],
  };
  private readonly ENTRY_REQUIRED: Record<number, [string, string][]> = {
    2: [['valuation_type', 'Valuation Type'], ['valuer_firm', 'Valuer Firm']],
  };
  entryDraft: Record<string, unknown> = {};
  readonly editingEntry = signal<number | null>(null);
  hasEntries(no: number): boolean { return !!this.ENTRY_KEYS[no]; }
  entries(): Record<string, unknown>[] {
    const e = this.draft.fields['entries'];
    return Array.isArray(e) ? (e as Record<string, unknown>[]) : [];
  }
  ev(k: string): unknown { return this.entryDraft[k] ?? ''; }
  setEv(k: string, v: unknown): void { this.entryDraft[k] = v; }
  /** Old single-entry steps: lift the flat fields into entries[0] once. */
  private initEntries(): void {
    this.entryDraft = {}; this.editingEntry.set(null); this.decideIdx.set(null);
    const keys = this.ENTRY_KEYS[this.selected()];
    if (!keys || Array.isArray(this.draft.fields['entries'])) return;
    const one: Record<string, unknown> = {};
    for (const k of keys) { const v = this.draft.fields[k]; if (v !== undefined && v !== null && v !== '') one[k] = v; }
    this.draft.fields['entries'] = Object.keys(one).length ? [one] : [];
  }
  private mirrorFirstEntry(): void {
    const keys = this.ENTRY_KEYS[this.selected()] || [];
    // The ACCEPTED entry (first one, if several) is the one the rest of the system reads;
    // before anything is accepted it is the first entry.
    const first = this.entries().find((e) => e['status'] === 'accepted') || this.entries()[0] || {};
    for (const k of keys) this.draft.fields[k] = first[k] ?? '';
  }
  addEntry(): void {
    const no = this.selected();
    const miss = (this.ENTRY_REQUIRED[no] || []).filter(([k]) => !String(this.entryDraft[k] ?? '').trim()).map(([, l]) => l);
    if (miss.length) { this.toastr.error(miss.join(', ') + (miss.length > 1 ? ' are' : ' is') + ' required'); return; }
    // Tester 20-10-2026: Report Due Date cannot be in the past (an unchanged old date on edit is fine).
    const due = String(this.entryDraft['report_due_date'] ?? '').slice(0, 10);
    const ei = this.editingEntry();
    const prevDue = ei !== null ? String((this.entries()[ei] || {})['report_due_date'] ?? '').slice(0, 10) : '';
    if (due && due < this.todayStr && due !== prevDue) { this.toastr.error('Report Due Date cannot be in the past.'); return; }
    const instr = String(this.entryDraft['instruction_date'] ?? '').slice(0, 10);
    if (due && instr && due < instr) { this.toastr.error('Report Due Date cannot be before the Instruction Date.'); return; }
    const row: Record<string, unknown> = {};
    for (const k of this.ENTRY_KEYS[no] || []) row[k] = this.entryDraft[k] ?? '';
    const list = [...this.entries()];
    const i = this.editingEntry();
    // Editing keeps the entry's Accepted / Rejected mark.
    if (i !== null && list[i] && list[i]['status']) row['status'] = list[i]['status'];
    const wasEdit = i !== null && i >= 0 && i < list.length;
    if (wasEdit) list[i as number] = row; else list.push(row);
    this.draft.fields['entries'] = list;
    this.mirrorFirstEntry();
    this.entryDraft = {}; this.editingEntry.set(null);
    // Persist immediately so an added / updated entry survives a page refresh
    // (previously only Approve / Reject saved a step - a plain add was lost on reload).
    this.persistEntries(this.entryNoun(no) + (wasEdit ? ' updated' : ' added'));
  }
  editEntry(i: number): void { this.entryDraft = { ...(this.entries()[i] || {}) }; this.editingEntry.set(i); }
  cancelEntry(): void { this.entryDraft = {}; this.editingEntry.set(null); }
  removeEntry(i: number): void {
    const list = this.entries().filter((_, k) => k !== i);
    this.draft.fields['entries'] = list;
    this.mirrorFirstEntry();
    if (this.editingEntry() === i) this.cancelEntry();
    this.decideIdx.set(null);
    this.persistEntries(this.entryNoun(this.selected()) + ' removed');
  }
  /** One-line title + detail for the list card. */
  entryTitle(no: number, e: Record<string, unknown>): string {
    const v = (k: string) => String(e[k] ?? '').trim();
    if (no === 2) return [v('valuation_type'), v('valuer_firm')].filter(Boolean).join(' — ') || '—';
    if (no === 3) return [v('kyc_type'), v('assign_to')].filter(Boolean).join(' — ') || '—';
    return v('firm_name') || '—';
  }
  entryDetail(no: number, e: Record<string, unknown>): string[] {
    const v = (k: string) => String(e[k] ?? '').trim();
    const d = (k: string) => (v(k) ? new Date(v(k)).toLocaleDateString('en-GB') : '');
    const m = (k: string) => (v(k) ? '£' + Number(v(k)).toLocaleString('en-GB', { maximumFractionDigits: 2 }) : '');
    const parts: [string, string][] = no === 2
      ? [['Security', v('security')], ['Instructed', d('instruction_date')], ['Report due', d('report_due_date')], ['Fee', m('fee')], ['Notes', v('notes')]]
      : no === 3
        ? [['Due', d('due_date')], ['Quote', m('quote_amount')], ['Notes', v('notes')]]
        : [['Contact', v('contact_name')], ['SRA', v('sra_no')], ['Quote', m('quote_amount')], ['Quote date', d('quote_date')]];
    return parts.filter(([, x]) => x).map(([l, x]) => l + ': ' + x);
  }
  /** KYC Type options come from the step config (field kyc_type). */
  kycTypes(): string[] { return (this.def()?.fields || []).find((f) => f.key === 'kyc_type')?.options || []; }
  entryNoun(no: number): string { return no === 2 ? 'Valuation' : no === 3 ? 'KYC' : 'Solicitor Quote'; }

  // ---- steps 2-4: pick the entry to go with (client 29-09-2026) ----
  // No "Send to Valuation Team" / "Send KYC Assignment" any more: add as many entries as
  // needed, mark the chosen one(s) Accepted (others Rejected) in the list, then Proceed.
  // Only accepted entries go to the broker in step 4 (all of them while none is accepted).
  valuationSent(): boolean { return this.draft.fields['valuation_sent'] === true; }
  valResult(): string { return String(this.draft.fields['valuation_result'] || ''); }
  kycResult(): string { return String(this.draft.fields['kyc_result'] || ''); }
  strVal(k: string): string { return String(this.draft.fields[k] ?? ''); }
  entryStatus(e: Record<string, unknown>): string { return String(e['status'] || ''); }
  hasAccepted(): boolean { return this.entries().some((e) => e['status'] === 'accepted'); }
  acceptedCount(): number { return this.entries().filter((e) => e['status'] === 'accepted').length; }
  /** Client 12-10-2026: every valuation has a decision (so the Approve/Reject buttons hide). */
  valuationDecided(): boolean {
    const list = this.entries();
    return list.length > 0 && list.every((e) => e['status'] === 'accepted' || e['status'] === 'rejected');
  }
  valuationAllRejected(): boolean {
    const list = this.entries();
    return list.length > 0 && list.every((e) => e['status'] === 'rejected');
  }
  /** Step-level flags the rest of the system still reads, derived from the entry marks. */
  private syncStepVerdict(): void {
    const no = this.selected();
    const list = this.entries();
    const acc = list.some((e) => e['status'] === 'accepted');
    const allRej = list.length > 0 && list.every((e) => e['status'] === 'rejected');
    const f = this.draft.fields;
    if (no === 2) {
      // Valuations module lists cases once instructed: having an entry now means instructed.
      f['valuation_sent'] = list.length > 0;
      if (list.length && !f['valuation_sent_at']) f['valuation_sent_at'] = new Date().toISOString();
      f['valuation_result'] = acc ? 'accepted' : allRej ? 'rejected' : '';
    } else if (no === 3) {
      f['kyc_sent'] = list.length > 0;
      if (list.length && !f['kyc_sent_at']) f['kyc_sent_at'] = new Date().toISOString();
      f['kyc_result'] = acc ? 'passed' : allRej ? 'failed' : '';
    } else if (no === 4) {
      f['solicitor_result'] = acc ? 'accepted' : allRej ? 'rejected' : '';
    }
    this.mirrorFirstEntry();
  }
  /** Entry picked in the right-hand dropdown (index into entries()). */
  readonly decideIdx = signal<number | null>(null);
  /** Approve / Reject the entry picked in the dropdown. */
  decideEntry(status: 'accepted' | 'rejected'): void {
    const i = this.decideIdx();
    if (i === null || !this.entries()[i]) { this.toastr.warning('Select an entry from the list first.'); return; }
    if (this.entryStatus(this.entries()[i]) === status) {
      this.toastr.info(this.entryNoun(this.selected()) + ' ' + (i + 1) + ' is already ' + (status === 'accepted' ? 'approved' : 'rejected') + '.');
      return;
    }
    this.markEntry(i, status);
  }
  /** Save the current step (entries included) to the server right away so it
   *  survives a page refresh. Used by add / update / remove of an entry. */
  private persistEntries(msg: string): void {
    this.acting.set(true);
    this.api.saveStep(this.id, this.selected(), this.payload())
      .pipe(catchError((e) => { this.showStepErrors(e, 'Save failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.toastr.success(msg); this.patchLocalStep(); } });
  }

  /** Approve / Reject one entry and save straight away. */
  /**
   * Client 12-10-2026: one overall decision for the whole valuation step — mark EVERY
   * added valuation accepted (or rejected) in a single save, instead of per-valuation
   * buttons / a dropdown pick.
   */
  markAllEntries(status: 'accepted' | 'rejected'): void {
    const no = this.selected();
    if (!this.entries().length) { this.toastr.warning('Add a valuation first.'); return; }
    if (no === 2 && status === 'accepted' && !this.fieldVal('market_value')) {
      this.toastr.error('Enter Market Value (Report Details) before approving the valuation');
      return;
    }
    const list = this.entries().map((e) => ({ ...e, status }));
    this.draft.fields['entries'] = list;
    this.acting.set(true);
    this.api.saveStep(this.id, no, this.payload()).pipe(catchError((e) => { this.showStepErrors(e, 'Save failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.acting.set(false);
        if (r === null) return;
        this.toastr.success(status === 'accepted'
          ? (list.length === 1 ? this.entryNoun(no) + ' approved' : 'All ' + list.length + ' valuations approved')
          : (list.length === 1 ? this.entryNoun(no) + ' rejected' : 'All ' + list.length + ' valuations rejected'));
        this.patchLocalStep();
      });
  }

  markEntry(i: number, status: 'accepted' | 'rejected'): void {
    const no = this.selected();
    if (no === 2 && status === 'accepted' && !this.fieldVal('market_value')) {
      this.toastr.error('Enter Market Value (Report Details) before approving a valuation');
      return;
    }
    const list = this.entries().map((e) => ({ ...e }));
    if (!list[i]) return;
    list[i]['status'] = status;
    this.draft.fields['entries'] = list;
    this.acting.set(true);
    this.api.saveStep(this.id, no, this.payload()).pipe(catchError((e) => { this.showStepErrors(e, 'Save failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.acting.set(false);
        if (r === null) return;
        const st = String(list[i]['status'] || '');
        this.toastr.success(this.entryNoun(no) + ' ' + (i + 1) + (st === 'accepted' ? ' approved' : st ? ' ' + st : ' mark cleared'));
        this.patchLocalStep();
      });
  }
  private readonly SELECT_MSG: Record<number, string> = {
    2: 'Approve at least one valuation before proceeding to KYC.',
  };

  // ---- step 5: broker ----
  brokerSent(): boolean { return this.draft.fields['broker_sent'] === true; }
  brokerResult(): string { return String(this.draft.fields['broker_result'] || ''); }
  sendToBroker(): void {
    if (!this.fieldVal('broker') || !this.fieldVal('date_sent')) { this.toastr.error('Broker and Date Sent are required'); return; }
    this.acting.set(true);
    // persist the step fields first, then email the application-form PDF to the broker
    this.draft.fields['broker_sent'] = true;
    this.draft.fields['broker_sent_at'] = new Date().toISOString();
    this.api.saveStep(this.id, this.selected(), this.payload()).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.api.sendBroker(this.id).pipe(catchError((e: { error?: { message?: string } }) => { this.toastr.error(e?.error?.message || 'Could not email the broker'); return of(null); }), takeUntilDestroyed(this.destroyRef))
          .subscribe((r) => {
            this.acting.set(false);
            if (r === null) { this.draft.fields['broker_sent'] = false; return; }
            this.toastr.success('Application form and sanction letter emailed to broker (' + r.to + ')');
            this.patchLocalStep();
          });
      });
  }
  brokerMark(result: 'accepted' | 'rejected'): void {
    if (!this.brokerSent()) { this.toastr.error('Send to broker first'); return; }
    this.draft.fields['broker_result'] = result;
    this.acting.set(true);
    this.api.saveStep(this.id, this.selected(), this.payload()).pipe(catchError((e) => { this.showStepErrors(e, 'Save failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.toastr.success('Broker ' + result); this.patchLocalStep(); } });
  }

  // ---- step 4/7 helpers + generic branch decision ----
  solChecksLeft(): string[] { return (this.def()?.checklist || []).slice(0, 4); }
  solChecksRight(): string[] { return (this.def()?.checklist || []).slice(4); }
  topicOpts(): string[] { const fld = (this.def()?.fields || []).find((x) => x.key === 'topic'); return fld?.options || []; }
  bespoke(n: number): boolean { return n >= 1 && n <= 7; }
  decideStep(code: string): void {
    this.acting.set(true);
    this.api.decide(this.id, this.selected(), { decision: code }).pipe(catchError((e) => { this.showStepErrors(e, 'Action failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.toastr.success('Recorded'); this.reload(); } });
  }
  complete(): void {
    // Client 05-10-2026 (#13): free-flow — no per-step "approve first" block when
    // proceeding. Completeness of all steps is checked only at the final step
    // (Move to Portfolio), enforced server-side.
    this.acting.set(true);
    this.api.completeStep(this.id, this.selected(), { ...this.payload(), decision: this.draftRec() || undefined })
      .pipe(catchError((e) => { this.toastr.error(e?.error?.message || 'Cannot complete'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.reload(); } });
  }
  /** Complete the current step with an explicit branch decision (step 6: proceed=skip to 8, refer_credit=step 7). */
  completeWith(decision: string): void {
    if (this.selected() === 6 && decision === 'proceed' && !this.recChosen()) {
      this.toastr.warning('Choose a recommendation before proceeding.', 'Not yet completed');
      return;
    }
    this.acting.set(true);
    this.api.completeStep(this.id, this.selected(), { ...this.payload(), decision })
      .pipe(catchError((e) => { this.toastr.error(e?.error?.message || 'Cannot complete'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.reload(); } });
  }
  openReject(mode: 'reject' | 'cannot_proceed' = 'reject'): void { this.rejectMode.set(mode); this.rejectReason = ''; this.rejectOpen.set(true); }
  confirmReject(): void {
    if (!this.rejectReason.trim()) { this.toastr.error('Reason required'); return; }
    this.acting.set(true);
    this.api.decide(this.id, this.selected(), { decision: this.rejectMode(), reason: this.rejectReason.trim() })
      .pipe(catchError((e) => { this.showStepErrors(e, 'Action failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.rejectOpen.set(false); this.toastr.success('Recorded'); this.reload(); } });
  }
  openQuery(): void {
    this.reqSendTo = 'Broker';
    this.reqItems = { bank: false, address: false, income: false, accounts: false, assets: false, creditFile: false };
    this.reqComments = ''; this.reqDueDate = '';
    this.queryOpen.set(true);
  }
  confirmQuery(): void {
    if (this.reqDueDate && this.reqDueDate < this.todayStr) { this.toastr.error('Due date cannot be in the past.'); return; }
    const items: string[] = [];
    if (this.reqItems.bank) items.push('Bank Statements');
    if (this.reqItems.address) items.push('Proof Of Address');
    if (this.reqItems.income) items.push('Evidence Of Income');
    if (this.reqItems.accounts) items.push('Company Accounts');
    if (this.reqItems.assets) items.push('Asset & Liability Statement');
    if (this.reqItems.creditFile) items.push('Credit File');
    const parts = [`Information requested from ${this.reqSendTo}`];
    if (items.length) parts.push('Items: ' + items.join(', '));
    if (this.reqDueDate) parts.push('Due ' + this.reqDueDate);
    if (this.reqComments.trim()) parts.push(this.reqComments.trim());
    const desc = parts.join('. ');
    if (!items.length && !this.reqComments.trim()) { this.toastr.error('Select an item or add comments'); return; }
    this.acting.set(true);
    this.api.raiseQuery(this.id, {
      step_no: this.selected(), target_role: this.reqSendTo, description: desc,
      items, comments: this.reqComments.trim(), due_date: this.reqDueDate || null,
    })
      .pipe(catchError((e) => { this.showStepErrors(e, 'Action failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.acting.set(false);
        if (r === null) return;
        this.queryOpen.set(false);
        const rr = r as { email_sent?: boolean; email_to?: string | null; email_error?: string | null };
        if (rr && rr.email_sent) this.toastr.success('Request e-mailed' + (rr.email_to ? ' to ' + rr.email_to : '') + (this.reqSendTo === 'Broker' ? ' (BDM cc\'d)' : ''));
        else if (rr && rr.email_error) this.toastr.warning('Query raised, but the e-mail failed: ' + rr.email_error);
        else this.toastr.success('Query raised');
        this.reload();
      });
  }
  respond(qid: number): void {
    if (!this.respDraft.trim()) { this.toastr.error('Enter a response'); return; }
    this.acting.set(true);
    this.api.respondQuery(this.id, qid, { response: this.respDraft.trim() })
      .pipe(catchError((e) => { this.showStepErrors(e, 'Action failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.respDraft = ''; this.toastr.success('Responded'); this.reload(); } });
  }

  // ---- merged UW step (UI Step 5): findings (6) + credit paper (8) + site visit (9); credit discussion (7) in a popup ----
  readonly mergedFindings = signal('');
  mergedSite: { visit_type: string; visit_date: string; diligence_notes: string; docs_signed_date: string } =
    { visit_type: '', visit_date: '', diligence_notes: '', docs_signed_date: '' };
  readonly creditPhotos = signal<UwFileItem[]>([]);
  readonly sitePhotos = signal<UwFileItem[]>([]);
  readonly uploadingCredit = signal(false);
  readonly uploadingSite = signal(false);
  readonly creditDiscOpen = signal(false);
  creditDisc = { topic: '', notes: '', credit_contact: '', discussion_date: '' };

  private stepData(no: number): Record<string, unknown> {
    const st = this.stepOf(no);
    try { return st?.data ? (JSON.parse(st.data).fields || {}) : {}; } catch { return {}; }
  }
  private loadMerged(): void {
    const f6 = this.stepData(6);
    this.mergedFindings.set(String(f6['risk_finding'] ?? ''));
    const f9 = this.stepData(9);
    this.mergedSite = {
      visit_type: String(f9['visit_type'] ?? ''), visit_date: String(f9['visit_date'] ?? ''),
      diligence_notes: String(f9['diligence_notes'] ?? ''), docs_signed_date: String(f9['docs_signed_date'] ?? ''),
    };
    this.loadStepPhotos(8, this.creditPhotos);
    this.loadStepPhotos(9, this.sitePhotos);
  }
  private loadStepPhotos(step: number, target: ReturnType<typeof signal<UwFileItem[]>>): void {
    target.set([]);
    this.api.listPhotos(this.id, step).pipe(catchError(() => of([])), takeUntilDestroyed(this.destroyRef))
      .subscribe((rows) => {
        target.set((rows || []).map((r) => ({ id: r.id, file_name: r.file_name, content_type: r.content_type ?? null, url: null })));
        // Client 22-10-2026: names only - a file is fetched when it is clicked (openFile).
      });
  }
  setMergedFindings(v: string): void { this.mergedFindings.set(v); }
  setSite(k: 'visit_type' | 'visit_date' | 'diligence_notes' | 'docs_signed_date', v: string): void { this.mergedSite[k] = v; }
  siteVal(k: 'visit_type' | 'visit_date' | 'diligence_notes' | 'docs_signed_date'): string { return this.mergedSite[k]; }
  creditTopicOpts(): string[] {
    const d = (this.meta()?.steps || []).find((x) => x.no === 7);
    return (d?.fields || []).find((f) => f.key === 'topic')?.options || [];
  }
  onCreditPick(ev: Event): void { this.uploadMergedFiles(ev, 8, this.uploadingCredit, this.creditPhotos); }
  onSitePick(ev: Event): void { this.uploadMergedFiles(ev, 9, this.uploadingSite, this.sitePhotos); }
  private uploadMergedFiles(ev: Event, step: number, flag: ReturnType<typeof signal<boolean>>, target: ReturnType<typeof signal<UwFileItem[]>>): void {
    const input = ev.target as HTMLInputElement;
    const files = this.allowedPicks(input);
    if (!files.length) return;
    flag.set(true); let pending = files.length;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = String(reader.result || '');
        this.api.uploadPhoto(this.id, { step_no: step, file_name: file.name, content_base64: b64, content_type: file.type })
          .pipe(catchError((e: { error?: { message?: string } }) => { this.toastr.error(e?.error?.message || 'Upload failed.', 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
          .subscribe(() => { if (--pending <= 0) { flag.set(false); this.loadStepPhotos(step, target); } });
      };
      reader.readAsDataURL(file);
    });
    input.value = '';
  }
  removeCreditPhoto(docId: number): void { this.api.deletePhoto(this.id, docId).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadStepPhotos(8, this.creditPhotos)); }
  removeSitePhoto(docId: number): void { this.api.deletePhoto(this.id, docId).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadStepPhotos(9, this.sitePhotos)); }
  mergedValid(): boolean {
    // Client 09-10-2026: only Findings & Recommendation is required to proceed.
    return !!this.mergedFindings().trim();
  }
  private syncMergedLocal(no: number, fields: Record<string, unknown>): void {
    const cas = this.c(); if (!cas) return;
    const data = JSON.stringify({ fields });
    const steps = (cas.steps || []).map((st) => (st.step_no === no ? { ...st, data } : st));
    this.c.set({ ...cas, steps });
  }
  saveFindings(): void {
    this.acting.set(true);
    this.api.saveStep(this.id, 6, { data: { fields: { risk_finding: this.mergedFindings() } } })
      .pipe(catchError((e) => { this.showStepErrors(e, 'Save failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.toastr.success('Findings saved'); this.syncMergedLocal(6, { risk_finding: this.mergedFindings() }); } });
  }
  saveSite(): void {
    this.acting.set(true);
    this.api.saveStep(this.id, 9, { data: { fields: { ...this.mergedSite } } })
      .pipe(catchError((e) => { this.showStepErrors(e, 'Save failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.toastr.success('Site visit saved'); this.syncMergedLocal(9, { ...this.mergedSite }); } });
  }
  saveCreditPaper(): void {
    // Credit paper files persist the moment they are uploaded; this just confirms.
    if (!this.creditPhotos().length) { this.toastr.warning('Upload the Credit Paper Document first.'); return; }
    this.toastr.success('Credit paper saved');
  }
  proceedMerged(): void {
    if (!this.mergedValid()) { this.toastr.warning('Enter the Findings & Recommendation before proceeding.', 'Not yet complete'); return; }
    this.acting.set(true);
    this.api.completeMergedStep(this.id, { data: { findings: this.mergedFindings(), site_visit: this.mergedSite } })
      .pipe(catchError((e) => { this.showStepErrors(e, 'Cannot complete'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.reload(); } });
  }
  openCreditDisc(): void {
    const f = this.stepData(7);
    this.creditDisc = { topic: String(f['topic'] ?? ''), notes: String(f['notes'] ?? ''), credit_contact: String(f['credit_contact'] ?? ''), discussion_date: String(f['discussion_date'] ?? '') };
    this.creditDiscOpen.set(true);
  }
  submitReferToCredit(): void {
    this.acting.set(true);
    this.api.referToCredit(this.id, { data: { fields: this.creditDisc } })
      .pipe(catchError((e) => { this.showStepErrors(e, 'Action failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.creditDiscOpen.set(false); this.toastr.success('Referred to Credit'); this.reload(); } });
  }

  // =====================================================================================
  // Client 16-10-2026 underwriting changes
  // =====================================================================================

  // ---- #2 Reopen Valuation: undo the overall approve / reject so the valuation can change ----
  reopenValuation(): void {
    const list = this.entries().map((e) => { const x = { ...e }; delete x['status']; return x; });
    this.draft.fields['entries'] = list;
    this.acting.set(true);
    this.api.saveStep(this.id, 2, this.payload())
      .pipe(catchError((e) => { this.showStepErrors(e, 'Save failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.toastr.success('Valuation reopened — you can change it and approve again.'); this.patchLocalStep(); } });
  }

  // ---- #3 Edit loan -> revised offer e-mailed; upload the signed copy here ----
  revisedPending(): boolean { const v = this.c()?.revised_offer_pending; return v === true || v === 1; }
  /** BDM - CC'd on the revised offer e-mail (client 16-10-2026). */
  loanCcDefaults(): { label: string; email: string }[] {
    const cas = this.c(); if (!cas) return [];
    const out: { label: string; email: string }[] = [];
    if (cas.bdm_email) out.push({ label: 'BDM' + (cas.bdm_name ? ' — ' + cas.bdm_name : ''), email: String(cas.bdm_email) });
    return out;
  }
  readonly uploadingRevised = signal(false);
  onRevisedSignedPick(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = this.allowedPicks(input, ['pdf', ...IMAGE_UPLOAD_EXTS]);
    input.value = '';
    if (!files.length) return;
    this.uploadingRevised.set(true);
    this.readFiles(files).then((list) => {
      this.api.uploadRevisedSignedOffer(this.id, list.map((f) => ({ file_name: f.file_name, content_base64: f.content_base64 })))
        .pipe(catchError((e: { error?: { message?: string } }) => { this.toastr.error(e?.error?.message || 'Upload failed.', 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
        .subscribe((r) => {
          this.uploadingRevised.set(false);
          if (!r) return;
          this.toastr.success('Signed offer uploaded (' + r.version + ') — saved to the application documents.', 'Uploaded');
          this.api.get(this.id).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
            .subscribe((cas) => { if (cas) { this.c.set(cas); this.signedLoadedFor = null; this.initSignedOffer(cas); } });
        });
    });
  }
  /** Read picked files as data-URLs. */
  private readFiles(files: File[]): Promise<{ file_name: string; content_base64: string; content_type: string }[]> {
    return Promise.all(files.map((file) => new Promise<{ file_name: string; content_base64: string; content_type: string }>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ file_name: file.name, content_base64: String(reader.result || ''), content_type: file.type });
      reader.onerror = () => resolve({ file_name: file.name, content_base64: '', content_type: file.type });
      reader.readAsDataURL(file);
    }))).then((list) => list.filter((f) => !!f.content_base64));
  }

  // ---- #4 Borrower's Solicitor dropdown + checks saved PER SOLICITOR ----
  /** Checks older than this show as "may need redoing". */
  private readonly STALE_DAYS = 90;
  readonly bsChecks = signal<UwSolicitorChecks['checks']>({});
  readonly bsDocs = signal<(UwSolicitorChecks['docs'][number])[]>([]);
  borrowerSolOpts(): UwBorrowerSolicitor[] {
    return ((this.meta()?.options?.['borrowerSolicitors'] || []) as unknown) as UwBorrowerSolicitor[];
  }
  bsId(): number { return Number(this.solObj('borrower_solicitor')['id']) || 0; }
  bsSelected(): UwBorrowerSolicitor | null { const id = this.bsId(); return id ? (this.borrowerSolOpts().find((o) => Number(o.id) === id) || null) : null; }
  /** Old cases typed the firm by hand - keep showing it until a master row is picked. */
  bsLegacyName(): string { return !this.bsId() ? this.borrowerSol('firm_name') : ''; }
  bsLegacyText(): string {
    return [this.bsLegacyName(), this.borrowerSol('contact_name'), this.borrowerSol('telephone'), this.borrowerSol('email'), this.borrowerSol('address')]
      .filter((x) => !!String(x || '').trim()).join(' · ');
  }
  selectBorrowerSol(v: string): void {
    const id = Number(v) || 0;
    const prevId = this.bsId();
    const o = { ...this.solObj('borrower_solicitor') };
    if (!id) {
      for (const k of ['id', 'firm_name', 'contact_name', 'sra_no', 'telephone', 'email', 'address']) delete o[k];
      this.draft.fields['borrower_solicitor'] = o;
      // Client 21-10-2026: clearing the solicitor clears its check ticks / notes too.
      this.draft.fields['sol_checks'] = {};
      this.bsChecks.set({}); this.bsDocs.set([]);
      this.saveSol();
      return;
    }
    const m = this.borrowerSolOpts().find((x) => Number(x.id) === id);
    if (!m) return;
    Object.assign(o, {
      id, firm_name: m.firm || m.firm_name || m.name || '', contact_name: m.contact_name || '', sra_no: m.sra_no || '',
      telephone: m.telephone || '', email: m.email || '', address: m.address || '',
    });
    this.draft.fields['borrower_solicitor'] = o;
    // Client 21-10-2026: a different solicitor never shows the previous firm's ticks - clear
    // now, then loadBsChecks fills in the new solicitor's own saved checks.
    if (id !== prevId) { this.draft.fields['sol_checks'] = {}; this.bsChecks.set({}); this.bsDocs.set([]); }
    this.loadBsChecks(false, true);
  }
  /**
   * Pull the picked solicitor's saved checks. Their ticks / notes are the solicitor's record, so
   * they replace the case's copy (fromPick: always saved; on load: saved only when different).
   */
  private loadBsChecks(onLoad: boolean, fromPick = false): void {
    const id = this.bsId();
    if (!id) { this.bsChecks.set({}); this.bsDocs.set([]); if (fromPick) this.saveSol(); return; }
    this.api.borrowerSolicitorChecks(id).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        if (this.bsId() !== id) return;
        this.bsChecks.set(r?.checks || {}); this.bsDocs.set(r?.docs || []);
        const cur = this.solMap();
        const next: Record<string, { done?: boolean; notes?: string }> = { ...cur };
        let changed = false;
        for (const [k, v] of Object.entries(r?.checks || {})) {
          const before = cur[k] || {};
          if (before.done !== v.done || String(before.notes ?? '') !== String(v.notes ?? '')) changed = true;
          next[k] = { done: v.done, notes: v.notes || '' };
        }
        if (fromPick) {
          // Picked a solicitor with no history: start from a clean sheet, not the previous firm's ticks.
          for (const k of Object.keys(next)) if (!(r?.checks || {})[k]) { next[k] = { done: false, notes: '' }; changed = true; }
        }
        if (changed || fromPick) {
          this.draft.fields['sol_checks'] = next;
          if (fromPick || (onLoad && this.canEditForm())) this.saveSol();
        }
        if (fromPick) {
          const n = Object.values(r?.checks || {}).filter((c) => c.done).length;
          if (n) this.toastr.info(n + ' solicitor check' + (n === 1 ? '' : 's') + ' filled in from earlier cases — check the dates.', 'Checks loaded');
        }
      });
  }
  private saveBsCheck(checkId: number): void {
    const sid = this.bsId(); if (!sid) return;
    const cur = this.solMap()[String(checkId)] || {};
    this.api.saveBorrowerSolicitorCheck(sid, checkId, { done: cur.done === true, notes: cur.notes ?? null, case_id: this.id })
      .pipe(catchError((e: { error?: { message?: string } }) => { this.toastr.error(e?.error?.message || 'Could not save the check against the solicitor.'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        if (r === null) return;
        const now = new Date().toISOString();
        this.bsChecks.update((m) => ({ ...m, [String(checkId)]: { done: cur.done === true, notes: String(cur.notes ?? ''), updated_at: now, updated_by_name: null } }));
      });
  }
  /** "Updated 12 Mar 2026" for a check on the picked solicitor. */
  checkUpdatedText(checkId: number): string {
    const v = this.bsChecks()[String(checkId)]?.updated_at;
    if (!v) return '';
    const d = new Date(v);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  checkStale(checkId: number): boolean {
    const v = this.bsChecks()[String(checkId)]?.updated_at;
    if (!v) return false;
    const t = new Date(v).getTime();
    return Number.isFinite(t) && (Date.now() - t) > this.STALE_DAYS * 86400000;
  }
  bsDocsFor(checkId: number): UwSolicitorChecks['docs'] { return this.bsDocs().filter((d) => Number(d.check_id) === Number(checkId)); }
  bsDocDate(d: { created_at: string }): string { const x = new Date(d.created_at); return isNaN(x.getTime()) ? '' : x.toLocaleDateString('en-GB'); }
  private uploadBsDocs(checkId: number, files: File[]): void {
    const sid = this.bsId(); if (!sid) return;
    this.readFiles(files).then((list) => {
      let pending = list.length;
      for (const f of list) {
        this.api.uploadBorrowerSolicitorDoc(sid, checkId, { ...f, case_id: this.id })
          .pipe(catchError((e: { error?: { message?: string } }) => { this.toastr.error(e?.error?.message || 'Upload failed.', 'Failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
          .subscribe(() => { if (--pending <= 0) this.loadBsChecks(false); });
      }
    });
  }
  openBsDoc(docId: number, name: string): void {
    const sid = this.bsId(); if (!sid) return;
    this.api.downloadBorrowerSolicitorDoc(sid, docId).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => {
        if (!blob) { this.toastr.error('Could not open ' + name); return; }
        const url = URL.createObjectURL(blob as Blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      });
  }
  removeBsDoc(docId: number): void {
    const sid = this.bsId(); if (!sid) return;
    this.api.deleteBorrowerSolicitorDoc(sid, docId).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadBsChecks(false));
  }
  // add / edit the Borrower's Solicitor master from the step (same as the enquiry popup)
  readonly bsAddOpen = signal(false);
  readonly bsEditOpen = signal(false);
  readonly bsSaving = signal(false);
  readonly bsError = signal<string | null>(null);
  bsDraft = { firm: '', contact_name: '', sra_no: '', telephone: '', email: '', address: '' };
  toggleBsAdd(): void {
    this.bsError.set(null); this.bsEditOpen.set(false);
    if (!this.bsAddOpen()) this.bsDraft = { firm: '', contact_name: '', sra_no: '', telephone: '', email: '', address: '' };
    this.bsAddOpen.update((v) => !v);
  }
  toggleBsEdit(): void {
    this.bsError.set(null);
    if (this.bsEditOpen()) { this.bsEditOpen.set(false); return; }
    const s = this.bsSelected();
    if (!s) { this.bsError.set('Select a solicitor to edit first.'); return; }
    this.bsAddOpen.set(false);
    this.bsDraft = { firm: s.firm || s.firm_name || s.name || '', contact_name: s.contact_name || '', sra_no: s.sra_no || '', telephone: s.telephone || '', email: s.email || '', address: s.address || '' };
    this.bsEditOpen.set(true);
  }
  cancelBs(): void { this.bsAddOpen.set(false); this.bsEditOpen.set(false); this.bsError.set(null); }
  saveBs(): void {
    const d = {
      firm: this.bsDraft.firm.trim(), contact_name: this.bsDraft.contact_name.trim(), sra_no: this.bsDraft.sra_no.trim(),
      telephone: this.bsDraft.telephone.trim(), email: this.bsDraft.email.trim(), address: this.bsDraft.address.trim(),
    };
    if (!d.firm) { this.bsError.set("Borrower's solicitor / firm name is required."); return; }
    if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) { this.bsError.set('Enter a valid email address.'); return; }
    if (d.telephone && !/^\+?[0-9\s()-]{6,}$/.test(d.telephone)) { this.bsError.set('Enter a valid telephone number.'); return; }
    const editing = this.bsEditOpen();
    const call = editing ? this.api.updateBorrowerSolicitor(this.bsId(), d) : this.api.createBorrowerSolicitor(d);
    this.bsSaving.set(true); this.bsError.set(null);
    call.pipe(
      catchError((e: { error?: { message?: string; errors?: Record<string, string> } }) => {
        const errs = e?.error?.errors;
        this.bsError.set((errs && Object.values(errs)[0]) || e?.error?.message || 'Could not save the solicitor.');
        this.bsSaving.set(false); return of(null);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => {
      this.bsSaving.set(false);
      if (!r) return;
      const row = { ...r, name: r.firm || r.name, firm_name: r.firm || r.firm_name } as UwBorrowerSolicitor;
      const m = this.meta();
      if (m) {
        const list = this.borrowerSolOpts();
        const next = editing ? list.map((x) => (Number(x.id) === Number(row.id) ? row : x)) : [...list, row];
        next.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        this.meta.set({ ...m, options: { ...(m.options || {}), borrowerSolicitors: next as unknown as NonNullable<UwMeta['options']>[string] } });
      }
      this.cancelBs();
      if (editing) {
        // Same solicitor: refresh the case's copy of its details, keep the checks.
        const o = { ...this.solObj('borrower_solicitor') };
        Object.assign(o, { firm_name: row.firm || '', contact_name: row.contact_name || '', sra_no: row.sra_no || '', telephone: row.telephone || '', email: row.email || '', address: row.address || '' });
        this.draft.fields['borrower_solicitor'] = o; this.saveSol();
        this.toastr.success('Solicitor updated.', 'Saved');
      } else {
        this.selectBorrowerSol(String(row.id));
        this.toastr.success('Solicitor added.', 'Saved');
      }
    });
  }

  // ---- #6 every Solicitor Check must be ticked (single rep) ----
  /** Names of the checks still open on the Solicitor Quote step (live draft when it is open). */
  solChecksMissing(): string[] {
    const f = this.selected() === 4 ? this.draft.fields : this.stepData(4);
    if (String(f['rep_type'] || '').toLowerCase() === 'dual') return [];
    const m = (f['sol_checks'] && typeof f['sol_checks'] === 'object') ? f['sol_checks'] as Record<string, { done?: boolean }> : {};
    return this.solChecksAll().filter((it) => m[String(it.id)]?.done !== true).map((it) => it.name);
  }

  // ---- #5 Additional costs: names from Masters > Solicitor Cost Types (dropdown with add / edit) ----
  costTypes(): { id: number; name: string }[] { return (this.meta()?.options?.['solicitorCostTypes'] || []) as { id: number; name: string }[]; }
  /** A row typed before the dropdown existed keeps its text as a (legacy) option. */
  costLegacy(c: { name: string; cost_type_id?: number | null }): string {
    const n = String(c.name || '').trim();
    if (!n || c.cost_type_id) return '';
    return this.costTypes().some((t) => t.name.toLowerCase() === n.toLowerCase()) ? '' : n;
  }
  costTypeVal(c: { name: string; cost_type_id?: number | null }): string {
    if (c.cost_type_id) return String(c.cost_type_id);
    const n = String(c.name || '').trim().toLowerCase();
    const hit = n ? this.costTypes().find((t) => t.name.toLowerCase() === n) : undefined;
    return hit ? String(hit.id) : (n ? 'legacy' : '');
  }
  setCostType(i: number, v: string): void {
    if (v === 'legacy') return;
    const list = this.additionalCosts().map((x) => ({ ...x }));
    if (!list[i]) return;
    const t = this.costTypes().find((x) => String(x.id) === String(v));
    list[i].cost_type_id = t ? t.id : null;
    list[i].name = t ? t.name : '';
    this.draft.fields['additional_costs'] = list;
    this.saveSol();
  }
  readonly ctOpen = signal<'add' | 'edit' | null>(null);
  readonly ctSaving = signal(false);
  readonly ctError = signal<string | null>(null);
  ctDraft = '';
  private ctRow: number | null = null;
  private ctId = 0;
  openCtAdd(row: number): void { this.ctRow = row; this.ctId = 0; this.ctDraft = ''; this.ctError.set(null); this.ctOpen.set('add'); }
  openCtEdit(row: number): void {
    const c = this.additionalCosts()[row];
    const id = Number(c?.cost_type_id) || Number(this.costTypeVal(c || { name: '' })) || 0;
    const t = this.costTypes().find((x) => Number(x.id) === id);
    if (!t) { this.toastr.warning('Pick a cost type to edit first.'); return; }
    this.ctRow = row; this.ctId = t.id; this.ctDraft = t.name; this.ctError.set(null); this.ctOpen.set('edit');
  }
  isCtRow(i: number): boolean { return this.ctOpen() !== null && this.ctRow === i; }
  cancelCt(): void { this.ctOpen.set(null); this.ctError.set(null); }
  saveCt(): void {
    const name = this.ctDraft.trim();
    if (!name) { this.ctError.set('Cost name is required.'); return; }
    const editing = this.ctOpen() === 'edit';
    const call = editing ? this.api.updateSolicitorCostType(this.ctId, name) : this.api.createSolicitorCostType(name);
    this.ctSaving.set(true); this.ctError.set(null);
    call.pipe(
      catchError((e: { error?: { message?: string; errors?: Record<string, string> } }) => {
        const errs = e?.error?.errors;
        this.ctError.set((errs && Object.values(errs)[0]) || e?.error?.message || 'Could not save the cost type.');
        this.ctSaving.set(false); return of(null);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => {
      this.ctSaving.set(false);
      if (!r) return;
      const m = this.meta();
      if (m) {
        const list = this.costTypes();
        const next = editing ? list.map((t) => (Number(t.id) === Number(r.id) ? { ...t, name: r.name } : t)) : [...list, { id: r.id, name: r.name }];
        this.meta.set({ ...m, options: { ...(m.options || {}), solicitorCostTypes: next } });
      }
      // Rows using the type follow a rename; a new type goes onto the row it was added from.
      let rows = this.additionalCosts().map((x) => ({ ...x }));
      if (editing) rows = rows.map((x) => (Number(x.cost_type_id) === Number(r.id) ? { ...x, name: r.name } : x));
      else if (this.ctRow != null && rows[this.ctRow]) rows[this.ctRow] = { ...rows[this.ctRow], cost_type_id: r.id, name: r.name };
      this.draft.fields['additional_costs'] = rows;
      this.cancelCt();
      this.saveSol();
      this.toastr.success(editing ? 'Cost type updated.' : 'Cost type added.', 'Saved');
    });
  }

  // ---- #8 committee e-mail: pick case documents, upload more, notes ----
  readonly committeeDocs = signal<UwCaseDocument[]>([]);
  readonly committeeDocsLoading = signal(false);
  readonly committeeDocSel = signal<Set<string>>(new Set<string>());
  readonly committeeUploads = signal<{ file_name: string; content_base64: string; content_type: string }[]>([]);
  committeeNotes = '';
  docKey(d: UwCaseDocument): string { return d.source + ':' + d.id; }
  private loadCommitteeDocs(): void {
    this.committeeDocsLoading.set(true);
    this.api.caseDocuments(this.id).pipe(catchError(() => of([] as UwCaseDocument[])), takeUntilDestroyed(this.destroyRef))
      .subscribe((rows) => {
        this.committeeDocsLoading.set(false);
        // The latest credit paper always goes (attached by the server) - hide only that one.
        // Client 22-10-2026: every other document is listed (application, underwriting incl.
        // earlier credit-paper uploads, enquiry) and ticked by default; untick to leave out.
        // Client 22-10-2026 (2): the latest credit paper is SHOWN too (ticked, locked - it always
        // goes); Step 4 Underwriting Review uploads (config steps 6-9) are listed first.
        const all = rows || [];
        const paper = all.filter((d) => d.source === 'underwriting' && Number(d.step_no) === 8)
          .sort((a, b) => Number(b.id) - Number(a.id))[0];
        this.committeePaperKey.set(paper ? this.docKey(paper) : '');
        const rank = (d: UwCaseDocument) => (d === paper ? 0 : d.source === 'underwriting' && [6, 7, 8, 9].includes(Number(d.step_no)) ? 1 : d.source === 'underwriting' ? 2 : d.source === 'application' ? 3 : 4);
        const docs = [...all].sort((a, b) => rank(a) - rank(b));
        this.committeeDocs.set(docs);
        this.committeeDocSel.set(new Set(docs.map((d) => this.docKey(d))));
      });
  }
  /** Key of the latest credit paper (always attached by the server; locked in the picker). */
  readonly committeePaperKey = signal('');
  toggleCommitteeDoc(d: UwCaseDocument): void {
    const k = this.docKey(d);
    if (k === this.committeePaperKey()) return;
    const next = new Set(this.committeeDocSel());
    if (next.has(k)) next.delete(k); else next.add(k);
    this.committeeDocSel.set(next);
  }
  onCommitteeFilesPick(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = this.allowedPicks(input);
    input.value = '';
    if (!files.length) return;
    this.readFiles(files).then((list) => this.committeeUploads.update((cur) => [...cur, ...list]));
  }
  removeCommitteeUpload(i: number): void { this.committeeUploads.update((list) => list.filter((_, k) => k !== i)); }

  // ---- #10-13 Funds step: net to solicitor, broker payout, drawdowns ----
  netLoan(cas: UwCaseDetail): number | null {
    const v = cas.net_advance ?? cas.net_loan ?? null;
    return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  }
  brokerFee(): number { return Number(this.c()?.broker_fee) || 0; }
  brokerShare(): number { return Number(this.c()?.broker_arrangement_share) || 0; }
  brokerTotal(): number { return Math.round((this.brokerFee() + this.brokerShare()) * 100) / 100; }
  brokerPayee(): string { return String(this.c()?.broker_payee_name || '') || 'Broker'; }
  hasDrawdowns(): boolean { return (this.c()?.drawdowns || []).length > 0; }
  /** Client 21-10-2026: each drawdown's NET amount with its month (falls back to gross when no net was set). */
  drawdownRows(): { no: number; month: string; net: number }[] {
    return (this.c()?.drawdowns || []).map((d, i) => ({
      no: i + 1,
      month: d.month != null && Number(d.month) > 0 ? 'Month ' + d.month : '—',
      net: Number(d.net) > 0 ? Number(d.net) : (Number(d.gross ?? d.amount) || 0),
    }));
  }
  /** Total net of all drawdowns (Drawdown Net Loan). */
  drawdownNetTotal(): number { return Math.round(this.drawdownRows().reduce((s, r) => s + r.net, 0) * 100) / 100; }

  // ---- display ----
  back(): void { void this.router.navigate(['/underwriting']); }
  viewApp(cas: UwCaseDetail): void { void this.router.navigate(['/applications', cas.application_id]); }
  /** The facility exists only once the case has been handed to Portfolio. */
  canGoPortfolio(cas: UwCaseDetail): boolean { return cas.status === 'In Portfolio' && cas.portfolio_loan_id != null; }
  goPortfolio(cas: UwCaseDetail): void {
    if (cas.portfolio_loan_id == null) return;
    void this.router.navigate(['/portfolio/facilities', cas.portfolio_loan_id]);
  }
  applicant(cas: UwCaseDetail): string { return cas.company_name || [cas.first_name, cas.last_name].filter(Boolean).join(' ') || '—'; }
  /** New workflow steps (9-13) use a green confirm button; earlier steps keep gold. */
  ctaClass(no: number): string { return no >= 8 ? 'ok' : 'gold'; }

  infoTitle(no: number): string | null {
    if (no === 1) return 'CASE SUMMARY';
    if (no === 2) return 'PROPERTY / SECURITY';
    if (no === 3) return 'KYC STATUS';
    if (no === 8) return 'LEGAL & CREDIT CONTEXT';
    if (no === 9) return 'PROPERTY / SOLICITOR';
    if (no === 10) return 'CREDIT SUMMARY';
    if (no === 11) return 'COMPLETION';
    if (no === 12) return 'PORTFOLIO HANDOVER';
    return null;
  }
  /** Summary rows. Client 15-10-2026 (revised): ONE LTV only - our loan's LTV; the
   *  separate "Total LTV (incl. other charges)" row was removed. */
  infoRows(no: number, cas: UwCaseDetail): SumRow[] {
    const rows = this.infoRowsBase(no, cas);
    // Client 21-10-2026: once in Portfolio the security details are hidden in Underwriting.
    return this.inPortfolio() ? rows.filter((r) => !/^(Securit(y|ies)( Address(es)?)?|Estimated Value)$/.test(r.label)) : rows;
  }
  private infoRowsBase(no: number, cas: UwCaseDetail): SumRow[] {
    const ltv = cas.ltv_pct != null ? cas.ltv_pct + '%' : '—';
    const totalLtv = cas.summary_total_ltv_pct != null ? cas.summary_total_ltv_pct + '%' : '—';
    if (no === 1) return [
      { label: 'Applicant', value: this.applicant(cas) }, { label: 'Product', value: cas.product_name || '—' },
      { label: 'Gross Loan', value: this.money(cas.amount_requested) }, { label: 'Net Advance', value: this.money(cas.net_advance ?? cas.net_loan ?? null) },
      { label: 'LTV', value: ltv },
      // Client 17-10-2026: Total LTV = (gross + other charges) ÷ all security values. Case Summary only.
      { label: 'Total LTV', value: totalLtv },
      this.securityRow(cas), { label: 'BDM', value: cas.bdm_name || '—' },
      // Client 15-10-2026: broker name AND company, so the reviewer sees who introduced it.
      { label: 'Broker', value: String(cas['broker_contact_name'] || '') || '—' },
      { label: 'Broker Company', value: String(cas['broker_company'] || '') || '—' },
    ];
    if (no === 2) return [
      { label: (cas.securities && cas.securities.length > 1) ? 'Security Addresses' : 'Security Address', value: this.securitiesAddress(cas),
        lines: (cas.securities && cas.securities.length > 1) ? this.securityLines(cas) : undefined },
      { label: 'Estimated Value', value: this.money(cas.estimated_value) },
      { label: 'Loan Amount', value: this.money(cas.amount_requested) },
      // Client 19-10-2026: Step 1 (Valuation) shows Total LTV.
      { label: 'Total LTV', value: totalLtv },
    ];
    if (no === 3) return [
      { label: 'Applicant', value: this.applicant(cas) }, { label: 'Type', value: cas.applicant_type || 'Individual' },
    ];
    if (no === 8) return [
      { label: 'Applicant', value: this.applicant(cas) }, { label: 'Product', value: cas.product_name || '—' },
      { label: 'Gross Loan', value: this.money(cas.amount_requested) }, { label: 'Net Advance', value: this.money(cas.net_advance ?? cas.net_loan ?? null) },
      { label: 'LTV', value: ltv },
      this.securityRow(cas),
    ];
    if (no === 9) return [
      this.securityRow(cas),
      { label: 'Estimated Value', value: this.money(cas.estimated_value) },
      { label: 'Applicant', value: this.applicant(cas) },
    ];
    if (no === 10) return [
      { label: 'Applicant', value: this.applicant(cas) }, { label: 'Product', value: cas.product_name || '—' },
      // Client 22-10-2026: Net Loan = total net incl. drawdowns (same as the header), not the day-1 net.
      { label: 'Gross Loan', value: this.money(cas.amount_requested) }, { label: 'Net Loan', value: this.money(cas.net_loan ?? this.netLoan(cas)) },
      // Client 19-10-2026: Step 5 (Final Credit Committee) shows Total LTV.
      { label: 'Total LTV', value: totalLtv },
      // Client 21-10-2026: security name only - no charge type or amount.
      this.securityRow(cas, true),
    ];
    // Client 16-10-2026: Gross AND Net, the broker payout broken down, tidy securities.
    if (no === 11) return [
      { label: 'Applicant', value: this.applicant(cas) },
      { label: 'Gross Loan', value: this.money(cas.amount_requested) },
      { label: 'Net Loan', value: this.money(this.netLoan(cas)) },
      // Client 21-10-2026: deals with drawdowns show the drawdowns' net total right after Net Loan.
      ...(this.hasDrawdowns() ? [{ label: 'Drawdown Net Loan', value: this.money(this.drawdownNetTotal()) }] : []),
      // Client 21-10-2026: Securities removed from the Completion card.
    ];
    if (no === 12) return [
      { label: 'Applicant', value: this.applicant(cas) }, { label: 'Product', value: cas.product_name || '—' },
      { label: 'Gross Loan', value: this.money(cas.amount_requested) }, { label: 'BDM', value: cas.bdm_name || '—' },
      this.securityRow(cas),
    ];
    return [];
  }
  /** Header: Gross Loan + actual Net, the basis chosen on the enquiry first (client 15-10-2026). */
  loanAmounts(cas: UwCaseDetail): { label: string; value: number }[] {
    const gross = cas.amount_basis === 'Net' ? null : (cas.amount_requested ?? null);
    // Net Amount = total net incl. drawdowns (server net_loan), same as Enquiry / Application (client 20-10-2026).
    const net = cas.net_loan ?? cas.net_advance ?? (cas.amount_basis === 'Net' ? cas.amount_requested : null) ?? null;
    const g = gross != null ? { label: 'GROSS LOAN', value: Number(gross) } : null;
    const n = net != null ? { label: 'NET LOAN', value: Number(net) } : null;
    return (cas.loan_basis === 'Net' ? [n, g] : [g, n]).filter((x): x is { label: string; value: number } => !!x);
  }
  money(v: number | null): string { return v == null ? '—' : '£' + Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 }); }
  slaText(cas: UwCaseDetail): string { if (!cas.sla_due_date) return '—'; const days = Math.ceil((new Date(cas.sla_due_date).getTime() - Date.now()) / 86400000); return days < 0 ? 'Breach' : days + 'd'; }
  dt(v: string): string { const d = new Date(v); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  fieldLabel(f: string): string { return f.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()); }
  toneClass(s: string): string { if (['Sent to Credit', 'Ready to Proceed'].includes(s)) return 't-ok'; if (s === 'Pending Information') return 't-warn'; if (['Rejected', 'Closed'].includes(s)) return 't-bad'; if (s === 'New Review') return 't-info'; return ''; }
  stepBadge(status?: string): string {
    if (!status) return '';
    if (status === 'Completed' || status === 'Approved') return '✓ Done';
    if (status === 'In Progress') return '● Active';
    if (status === 'Query Raised' || status === 'Pending Information') return 'Query';
    if (status === 'Rejected') return 'Rejected';
    if (status === 'Available') return 'Available';
    return '';
  }
  stepStatusClass(status?: string): string {
    if (status === 'Completed' || status === 'Approved') return 'done';
    if (status === 'In Progress') return 'active';
    if (status === 'Query Raised' || status === 'Pending Information') return 'query';
    if (status === 'Rejected') return 'rej';
    return '';
  }
}
