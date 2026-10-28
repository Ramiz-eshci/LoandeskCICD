import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnDestroy, Output, signal } from '@angular/core';
import { ALLOWED_UPLOAD_EXTS, IMAGE_UPLOAD_EXTS, MAX_UPLOAD_MB } from '../../../core/util/upload-policy.util';

/** An already-uploaded file shown as a tile (e.g. list from the server). */
export interface UiFileItem {
  id: number | string;
  name: string;
  /** Preview / view URL (object URL or link). Images with a url show a thumbnail. */
  url?: string | null;
  /** Mime type or file name hint for the thumbnail choice. */
  type?: string | null;
}

/** Default allowed types when no [accept] is given (tester 20-10-2026: .exe was accepted).
 *  Client 21-10-2026: Word, PDF, image and Excel only - an [accept] can narrow this, never widen it. */
const DEFAULT_EXTS = ALLOWED_UPLOAD_EXTS;
const IMAGE_EXTS = IMAGE_UPLOAD_EXTS;
/** Never allowed anywhere in the name (catches "x.exe.pdf" too). */
const BLOCKED_EXTS = ['exe', 'dll', 'bat', 'cmd', 'com', 'msi', 'scr', 'pif', 'vbs', 'js', 'ps1', 'sh', 'jar', 'hta', 'lnk', 'reg', 'apk', 'html', 'htm', 'svg', 'php'];

interface LocalPick { file: File; name: string; size: string; url: string | null; image: boolean; }

/**
 * LoanDesk standard file upload — the Underwriting Step 8 "Site Visit Files" design,
 * used everywhere a file is uploaded (client 28-09-2026: same design across project):
 *   [ ⤒ Upload Files ]  then a grid of square tiles (thumbnail or file icon + name, × remove),
 *   or "No files uploaded yet."
 *
 * Two ways to use it:
 *  - Picker (default): the user picks, the tiles show the picked file(s), the parent gets
 *    (fileChange) File|null for single, (filesChange) File[] for multiple, and uploads later.
 *  - List: pass [items] (already uploaded files). Picking still emits fileChange/filesChange
 *    (parent uploads straight away and refreshes items); tiles emit (itemView) / (itemRemove).
 */
@Component({
  selector: 'ui-file-upload',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fu">
      @if (!readonly) {
        <label class="fu-upload" [class.fu-upload--disabled]="disabled || busy">
          <input type="file" hidden [attr.accept]="accept || defaultAccept" [multiple]="multiple"
                 [disabled]="disabled || busy" (change)="onPick($event)" />
          <span class="fu-btn"><i class="bi bi-upload"></i> {{ busy ? busyText : (label || (multiple ? 'Upload Files' : 'Upload File')) }}</span>
        </label>
        @if (required && !hasFiles()) { <span class="fu-req">Required</span> }
      }
      @if (hint) { <div class="fu-hint">{{ hint }}</div> }
      @if (tooBig()) { <div class="fu-err">{{ tooBig() }}</div> }

      @if (items) {
        @if (items.length) {
          <div class="fu-grid">
            @for (it of items; track it.id) {
              <div class="fu-tile">
                @if (it.url && isImage(it.type || it.name)) {
                  <img [src]="it.url" [alt]="it.name" (click)="itemView.emit(it)" />
                } @else {
                  <button type="button" class="fu-file" (click)="itemView.emit(it)" [title]="'View ' + it.name">
                    <i class="bi bi-file-earmark-text"></i><span class="fu-name">{{ it.name }}</span>
                    <span class="fu-view">View</span>
                  </button>
                }
                @if (removable && !readonly) {
                  <button class="fu-x" type="button" (click)="itemRemove.emit(it)" title="Remove"><i class="bi bi-x"></i></button>
                }
              </div>
            }
          </div>
        } @else {
          <div class="fu-empty">{{ emptyText }}</div>
        }
      } @else {
        @if (picks().length) {
          <div class="fu-grid">
            @for (p of picks(); track $index) {
              <div class="fu-tile">
                @if (p.image && p.url) {
                  <img [src]="p.url" [alt]="p.name" />
                } @else {
                  <div class="fu-file" [title]="p.name">
                    <i class="bi bi-file-earmark-text"></i><span class="fu-name">{{ p.name }}</span>
                    <span class="fu-size">{{ p.size }}</span>
                  </div>
                }
                @if (!readonly) {
                  <button class="fu-x" type="button" (click)="removeAt($index)" title="Remove"><i class="bi bi-x"></i></button>
                }
              </div>
            }
          </div>
        } @else {
          <div class="fu-empty">{{ emptyText }}</div>
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .fu-upload { display: inline-block; cursor: pointer; margin-bottom: 10px; }
    .fu-upload--disabled { cursor: not-allowed; opacity: .6; }
    .fu-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px;
      border: 1px solid var(--border); background: transparent; font: inherit; font-size: 13px; color: inherit; }
    .fu-upload:not(.fu-upload--disabled):hover .fu-btn { background: #f8fafc; }
    .fu-req { margin-left: 8px; font-size: 11px; font-weight: 600; color: #b42318; }
    .fu-hint { font-size: 12px; color: var(--muted-foreground); margin: -4px 0 8px; }
    .fu-err { font-size: 12px; color: #b42318; margin: -2px 0 8px; }
    .fu-empty { color: var(--muted-foreground); font-size: 13px; }
    .fu-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; margin-top: 8px; }
    .fu-tile { position: relative; aspect-ratio: 1; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background: #f3f4f6; }
    .fu-tile img { width: 100%; height: 100%; object-fit: cover; display: block; cursor: zoom-in; }
    .fu-file { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
      width: 100%; height: 100%; padding: 8px; text-align: center; color: #4b5563; background: transparent; border: 0; font: inherit; }
    button.fu-file { cursor: pointer; }
    button.fu-file:hover { background: #eef2f7; color: #111827; }
    .fu-file i { font-size: 26px; line-height: 1; }
    .fu-name { font-size: 11px; line-height: 1.25; word-break: break-word;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .fu-view { font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #1d4ed8; }
    .fu-size { font-size: 10px; color: var(--muted-foreground); }
    .fu-x { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; border: none; border-radius: 50%;
      background: rgba(0,0,0,.6); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px; }
    .fu-x:hover { background: #b00020; }
  `],
})
export class UiFileUploadComponent implements OnDestroy {
  @Input() label = '';
  @Input() emptyText = 'No files uploaded yet.';
  @Input() hint = '';
  @Input() accept = '';
  @Input() multiple = false;
  @Input() disabled = false;
  @Input() readonly = false;
  @Input() required = false;
  @Input() busy = false;
  @Input() busyText = 'Uploading…';
  /** Max size per file in MB; files over this are blocked before upload (client 02-10-2026; 20MB client 22-10-2026). */
  @Input() maxSizeMb = MAX_UPLOAD_MB;
  /** List mode: already-uploaded files. Leave null for picker mode. */
  @Input() items: UiFileItem[] | null = null;
  @Input() removable = true;

  @Output() fileChange = new EventEmitter<File | null>();
  @Output() filesChange = new EventEmitter<File[]>();
  @Output() itemView = new EventEmitter<UiFileItem>();
  @Output() itemRemove = new EventEmitter<UiFileItem>();

  readonly defaultAccept = DEFAULT_EXTS.map((e) => '.' + e).join(',');
  readonly picks = signal<LocalPick[]>([]);
  /** Message shown when a picked file is over the size limit. */
  readonly tooBig = signal<string>('');

  hasFiles(): boolean { return this.items ? this.items.length > 0 : this.picks().length > 0; }

  isImage(hint: string | null | undefined): boolean {
    return /^image\//i.test(hint || '') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(hint || '');
  }

  onPick(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const picked = Array.from(input.files || []);
    input.value = ''; // allow picking the same file again after removing it
    if (!picked.length) return;
    // Size limit (client 02-10-2026): block oversize files before any upload and tell the
    // user, rather than letting the server reject them with "File too large".
    this.tooBig.set('');
    const limit = Math.min(this.maxSizeMb, MAX_UPLOAD_MB) * 1024 * 1024;
    // File type (tester 20-10-2026): only the allowed extensions; executables never.
    const badType = picked.filter((f) => !this.typeOk(f.name)).map((f) => f.name);
    const okType = picked.filter((f) => this.typeOk(f.name));
    const files = okType.filter((f) => f.size <= limit);
    const big = okType.filter((f) => f.size > limit).map((f) => f.name);
    const msgs: string[] = [];
    if (badType.length) {
      const one = badType.length === 1;
      msgs.push(`${one ? 'File' : 'Files'} ${badType.join(', ')} ${one ? 'is' : 'are'} not an allowed file type (${this.allowedExts().map((e) => '.' + e).join(', ')}).`);
    }
    if (big.length) {
      const one = big.length === 1;
      msgs.push(`${one ? 'File' : 'Files'} ${big.join(', ')} ${one ? 'is' : 'are'} over the ${Math.min(this.maxSizeMb, MAX_UPLOAD_MB)}MB limit and ${one ? 'was' : 'were'} not added.`);
    }
    if (msgs.length) this.tooBig.set(msgs.join(' '));
    if (!files.length) return;
    if (this.items) { // list mode: parent uploads now
      if (this.multiple) this.filesChange.emit(files); else this.fileChange.emit(files[0]);
      return;
    }
    const next = files.map((f) => this.toPick(f));
    if (this.multiple) {
      this.picks.set([...this.picks(), ...next]);
      this.filesChange.emit(this.picks().map((p) => p.file));
    } else {
      this.revoke(this.picks());
      this.picks.set(next.slice(0, 1));
      this.fileChange.emit(next[0].file);
    }
  }

  /** Extensions allowed by [accept] (".pdf,image/*") or the default list. */
  allowedExts(): string[] {
    const src = (this.accept || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!src.length) return DEFAULT_EXTS;
    const out: string[] = [];
    for (const a of src) {
      if (a.startsWith('.')) out.push(a.slice(1));
      else if (a === 'image/*') out.push(...IMAGE_EXTS);
      else if (a === 'application/pdf') out.push('pdf');
    }
    const narrowed = Array.from(new Set(out)).filter((e) => DEFAULT_EXTS.includes(e));
    return narrowed.length ? narrowed : DEFAULT_EXTS;
  }

  private typeOk(name: string): boolean {
    const parts = String(name || '').toLowerCase().split('.');
    if (parts.length < 2) return false;
    if (parts.slice(1).some((p) => BLOCKED_EXTS.includes(p))) return false;
    return this.allowedExts().includes(parts[parts.length - 1]);
  }

  removeAt(i: number): void {
    const cur = this.picks();
    this.revoke([cur[i]]);
    const left = cur.filter((_, k) => k !== i);
    this.picks.set(left);
    if (this.multiple) this.filesChange.emit(left.map((p) => p.file)); else this.fileChange.emit(null);
  }

  /** Parent can clear the picker (e.g. after a successful upload). */
  clear(): void { this.revoke(this.picks()); this.picks.set([]); }

  ngOnDestroy(): void { this.revoke(this.picks()); }

  private toPick(f: File): LocalPick {
    const image = this.isImage(f.type || f.name);
    return { file: f, name: f.name, size: this.human(f.size), image, url: image ? URL.createObjectURL(f) : null };
  }
  private revoke(list: LocalPick[]): void { for (const p of list) if (p && p.url) URL.revokeObjectURL(p.url); }
  private human(n: number): string {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
}
