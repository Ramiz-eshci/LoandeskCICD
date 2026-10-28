import {
  AfterViewChecked, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, ViewChild, WritableSignal, computed, inject, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { catchError, forkJoin, of } from 'rxjs';

import { PermissionsStore } from '../../../core/session/permissions.store';
import { loadErrorMessage } from '../../../core/util/load-error.util';
import { extractFieldErrors } from '../../../core/util/server-errors';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiFileItem, UiFileUploadComponent } from '../../../shared/ui/ui-file-upload/ui-file-upload.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal/ui-modal.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiTagComponent } from '../../../shared/ui/ui-tag/ui-tag.component';
import { EmailEventDetail, EmailOptions, EmailService } from '../email.service';
import { MAX_UPLOAD_MB } from '../../../core/util/upload-policy.util';
import { cleanEmailHtml } from '../../../core/util/safe-html';

/** What each placeholder means (shown as a tooltip on the chip). */
const PLACEHOLDER_HELP: Record<string, string> = {
  Ref: 'Enquiry / application / extension reference or loan number',
  EnquiryRef: 'Enquiry reference',
  LoanNumber: 'Facility / loan number',
  Borrower: 'Borrower / company name',
  ForBorrower: '" for <borrower>" - empty when there is no borrower name',
  SecurityAddress: 'Security address(es)',
  SecurityInBrackets: '" (<security address>)" - empty when there is none',
  SecurityLabel: '"Security" or "Securities"',
  RecipientName: 'Name of the person the e-mail is sent to',
  RecipientFirstName: 'First name of the person the e-mail is sent to',
  RequestedItems: 'Items requested in the popup (comma separated)',
  DueDate: 'Respond-by date from the popup',
  Notes: 'Notes typed by the sender',
  Link: 'Link to open the record in LoanDesk',
  NewMaturity: 'New maturity date',
  ExtensionMonths: 'Extension length in months',
  GrossLoan: 'Gross loan amount',
  FileOwner: 'File owner (BDM) name',
  RedemptionAmount: 'Amount to redeem',
  RedemptionDate: 'Redemption date',
  BDMName: 'BDM on the case',
  UnderwriterName: 'Underwriter on the case',
  SenderName: 'User who sends the e-mail',
  Today: "Today's date",
  FiguresTable: 'Block: the indicative figures table (same rows as the PDF)',
  SecurityBlock: 'Block: "Security address(es):" line or list',
  SecurityLines: 'Block: every security on its own line',
  RequestedItemsList: 'Block: bulleted list of requested items',
  DueDateBlock: 'Block: "Please respond by" line - empty when no date',
  NotesBlock: 'Block: the notes paragraph - empty when no notes',
  RequirementsDetails: 'Block: valuation / KYC / solicitor requirement entries',
  AlsoAttachedList: 'Block: list of the other attached files',
};

/** Masters > Email Settings > one e-mail (client 17-10-2026). */
@Component({
  selector: 'app-email-settings-edit',
  standalone: true,
  imports: [FormsModule, UiButtonDirective, UiCardComponent, UiFileUploadComponent, UiModalComponent, UiPageHeaderComponent, UiTagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './email-settings-edit.component.html',
  styleUrl: './email-settings-edit.component.scss',
})
export class EmailSettingsEditComponent implements OnInit, AfterViewChecked {
  private readonly api = inject(EmailService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toastr = inject(ToastrService);
  private readonly perms = inject(PermissionsStore);
  private readonly sanitizer = inject(DomSanitizer);

  @ViewChild('editor') editorRef?: ElementRef<HTMLDivElement>;
  @ViewChild('subjectInput') subjectRef?: ElementRef<HTMLInputElement>;

  readonly key = signal('');
  readonly detail = signal<EmailEventDetail | null>(null);
  readonly opts = signal<EmailOptions | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly uploading = signal(false);
  readonly errors = signal<Record<string, string>>({});

  // form state
  readonly keepDefault = signal(true);
  subject = '';
  readonly bodyHtml = signal('');
  readonly userIds = signal<Set<number>>(new Set());
  readonly roleIds = signal<Set<number>>(new Set());
  readonly dynKeys = signal<Set<string>>(new Set());
  readonly userSearch = signal('');
  readonly dirty = signal(false);

  readonly preview = signal<{ subject: string; html: string; unknown: string[] } | null>(null);
  readonly previewHtml = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(this.preview()?.html || ''));

  readonly canEdit = computed(() => this.perms.isSuperAdmin() || this.perms.can('MASTERS.EMAIL_SETTINGS', 'edit') || !this.perms.loaded());
  readonly placeholders = computed(() => {
    const blocks = new Set(this.detail()?.html_placeholders || []);
    return (this.detail()?.placeholders || []).map((p) => ({ name: p, help: PLACEHOLDER_HELP[p] || p, block: blocks.has(p) }));
  });

  readonly filteredUsers = computed(() => {
    const q = this.userSearch().trim().toLowerCase();
    const all = this.opts()?.users || [];
    const sel = this.userIds();
    const list = q ? all.filter((u) => (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)) : all;
    // selected people first so they are never hidden below the fold
    return [...list].sort((a, b) => Number(sel.has(b.user_id)) - Number(sel.has(a.user_id)));
  });

  readonly ccSummary = computed(() => {
    const o = this.opts();
    const d = this.detail();
    if (!o || !d) return [] as string[];
    const out: string[] = [];
    if ((this.keepDefault() || d.cc_from_user) && d.default_cc !== 'None') out.push(d.default_cc);
    o.dynamic.filter((x) => this.dynKeys().has(x.key)).forEach((x) => out.push(x.label));
    o.roles.filter((r) => this.roleIds().has(r.role_id)).forEach((r) => out.push('Everyone in role: ' + r.role_name));
    o.users.filter((u) => this.userIds().has(u.user_id)).forEach((u) => out.push(u.full_name || u.email));
    return out;
  });

  readonly fileItems = computed<UiFileItem[]>(() => (this.detail()?.attachments || []).map((a) => ({ id: a.attachment_id, name: a.file_name, type: a.content_type })));

  private editorLoaded = false;
  private savedRange: Range | null = null;
  private lastField: 'subject' | 'body' = 'body';

  ngOnInit(): void {
    const key = this.route.snapshot.paramMap.get('eventKey') || '';
    this.key.set(key);
    forkJoin({ d: this.api.get(key), o: this.api.options() })
      .pipe(catchError((e) => { this.error.set(loadErrorMessage(e, 'email settings')); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        this.loading.set(false);
        if (!res) return;
        this.opts.set(res.o);
        this.applyDetail(res.d);
      });
  }

  /** Put the stored body into the editor once it is on screen. */
  ngAfterViewChecked(): void {
    if (!this.editorLoaded && this.editorRef && this.detail()) {
      // Pen-test 24-10-2026: never write unsanitised HTML into the live page.
      this.editorRef.nativeElement.innerHTML = cleanEmailHtml(this.bodyHtml());
      this.editorLoaded = true;
    }
  }

  private applyDetail(d: EmailEventDetail): void {
    this.detail.set(d);
    this.keepDefault.set(d.keep_default_cc);
    // Opens with the custom text, or the system text when not customised (client 17-10-2026).
    this.subject = d.subject_template || d.default_subject || '';
    this.bodyHtml.set(d.body_template || d.default_body || '');
    this.userIds.set(new Set(d.user_ids));
    this.roleIds.set(new Set(d.role_ids));
    this.dynKeys.set(new Set(d.dynamic_keys));
    this.editorLoaded = false;
    this.dirty.set(false);
  }

  /* ---------------- recipients */

  private toggle<T>(sig: WritableSignal<Set<T>>, v: T): void {
    const s = new Set(sig());
    if (s.has(v)) s.delete(v); else s.add(v);
    sig.set(s);
    this.dirty.set(true);
  }
  toggleUser(id: number): void { this.toggle(this.userIds, id); }
  toggleRole(id: number): void { this.toggle(this.roleIds, id); }
  toggleDyn(k: string): void { this.toggle(this.dynKeys, k); }
  setKeep(v: boolean): void { this.keepDefault.set(v); this.dirty.set(true); }

  /* ---------------- editor */

  onEditorInput(): void {
    this.bodyHtml.set(this.editorRef?.nativeElement.innerHTML || '');
    this.dirty.set(true);
    this.rememberSelection();
  }

  rememberSelection(): void {
    this.lastField = 'body';
    const sel = window.getSelection();
    const el = this.editorRef?.nativeElement;
    if (sel && sel.rangeCount && el && el.contains(sel.anchorNode)) this.savedRange = sel.getRangeAt(0).cloneRange();
  }

  onSubjectFocus(): void { this.lastField = 'subject'; }

  format(cmd: string): void {
    if (!this.canEdit()) return;
    this.editorRef?.nativeElement.focus();
    this.restoreSelection();
    document.execCommand(cmd, false);
    this.onEditorInput();
  }

  private restoreSelection(): void {
    if (!this.savedRange) return;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(this.savedRange);
  }

  insertPlaceholder(name: string): void {
    if (!this.canEdit()) return;
    const token = `{{${name}}}`;
    if (this.lastField === 'subject' && this.subjectRef) {
      const el = this.subjectRef.nativeElement;
      const at = el.selectionStart ?? this.subject.length;
      const end = el.selectionEnd ?? at;
      this.subject = this.subject.slice(0, at) + token + this.subject.slice(end);
      this.dirty.set(true);
      setTimeout(() => { el.focus(); el.setSelectionRange(at + token.length, at + token.length); });
      return;
    }
    const ed = this.editorRef?.nativeElement;
    if (!ed) return;
    ed.focus();
    if (this.savedRange) this.restoreSelection();
    else { const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); }
    document.execCommand('insertText', false, token);
    this.onEditorInput();
  }

  /** Back to the system text (what is sent today). Saved as "not customised". */
  resetToDefault(): void {
    const d = this.detail();
    if (!d) return;
    this.subject = d.default_subject || '';
    this.setBody(d.default_body || '');
  }

  private setBody(html: string): void {
    this.bodyHtml.set(html);
    if (this.editorRef) this.editorRef.nativeElement.innerHTML = cleanEmailHtml(html);
    this.savedRange = null;
    this.dirty.set(true);
  }

  /** True when the subject or text differs from the system text. */
  hasCustomText(): boolean {
    const d = this.detail();
    if (!d) return false;
    const norm = (h: string) => String(h || '').replace(/<br\s*\/?>/gi, '<br>').replace(/&nbsp;/g, ' ')
      .replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
    return norm(this.subject) !== norm(d.default_subject) || norm(this.bodyHtml()) !== norm(d.default_body);
  }

  /* ---------------- files */

  onFilePicked(file: File | null): void {
    if (!file) return;
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) { this.toastr.error(`File must be ${MAX_UPLOAD_MB} MB or smaller`); return; }
    const reader = new FileReader();
    this.uploading.set(true);
    reader.onload = () => {
      this.api.addAttachment(this.key(), { file_name: file.name, content_base64: String(reader.result || '') })
        .pipe(catchError((e) => {
          const fe = extractFieldErrors(e);
          this.toastr.error(fe['file'] || loadErrorMessage(e, 'file'));
          this.uploading.set(false);
          return of(null);
        }), takeUntilDestroyed(this.destroyRef))
        .subscribe((r) => { if (r) { this.toastr.success(`${file.name} added`); this.reloadFiles(); } });
    };
    reader.onerror = () => { this.uploading.set(false); this.toastr.error('Could not read the file'); };
    reader.readAsDataURL(file);
  }

  private reloadFiles(): void {
    this.api.get(this.key()).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe((d) => {
      this.uploading.set(false);
      const cur = this.detail();
      if (d && cur) this.detail.set({ ...cur, attachments: d.attachments });
    });
  }

  viewFile(item: UiFileItem): void {
    this.api.downloadAttachment(this.key(), Number(item.id))
      .pipe(catchError(() => { this.toastr.error('Download failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => { if (blob) window.open(URL.createObjectURL(blob), '_blank'); });
  }

  removeFile(item: UiFileItem): void {
    if (!this.canEdit()) return;
    this.api.removeAttachment(this.key(), Number(item.id))
      .pipe(catchError(() => { this.toastr.error('Could not remove the file'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r !== null) { this.toastr.success(`${item.name} removed`); this.reloadFiles(); } });
  }

  /* ---------------- preview / save */

  showPreview(): void {
    this.api.preview(this.key(), { subject_template: this.subject, body_template: this.bodyHtml() })
      .pipe(catchError((e) => { this.toastr.error(loadErrorMessage(e, 'preview')); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((p) => { if (p) this.preview.set(p); });
  }

  save(): void {
    if (!this.canEdit() || this.saving()) return;
    this.saving.set(true);
    this.errors.set({});
    this.api.save(this.key(), {
      keep_default_cc: this.keepDefault(),
      subject_template: this.subject,
      body_template: this.bodyHtml(),
      user_ids: [...this.userIds()],
      role_ids: [...this.roleIds()],
      dynamic_keys: [...this.dynKeys()],
    }).pipe(catchError((e) => {
      this.saving.set(false);
      const fe = extractFieldErrors(e);
      this.errors.set(fe);
      this.toastr.error(Object.values(fe)[0] || loadErrorMessage(e, 'email settings'));
      return of(null);
    }), takeUntilDestroyed(this.destroyRef)).subscribe((d) => {
      this.saving.set(false);
      if (!d) return;
      this.toastr.success(`${d.name} settings saved`, 'Saved');
      this.applyDetail(d);
    });
  }

  /** Placeholder token text, e.g. {{Ref}} (built here so the template has no literal braces). */
  tok(name: string): string { return '{' + '{' + name + '}' + '}'; }

  back(): void { this.router.navigate(['/masters/email-settings']); }
}
