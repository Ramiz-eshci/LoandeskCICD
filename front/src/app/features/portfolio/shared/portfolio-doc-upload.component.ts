import { Component, ChangeDetectionStrategy, EventEmitter, Input, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { UiModalComponent } from '../../../shared/ui/ui-modal/ui-modal.component';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiFileUploadComponent } from '../../../shared/ui/ui-file-upload/ui-file-upload.component';
import { MAX_UPLOAD_MB, UPLOAD_ACCEPT, uploadExtOk } from '../../../core/util/upload-policy.util';

export interface DocUploadResult {
  file_name: string;
  content_base64: string;
  document_type_id: number;
  application_id?: number;
}

/**
 * Shared portfolio document-upload modal (used by facility detail and Customer 360).
 * Standardised UI: labelled selects, drag-and-drop drop zone, selected-file chip
 * with size + remove, client-side type/size validation, and consistent footer.
 */
@Component({
  selector: 'app-portfolio-doc-upload',
  standalone: true,
  imports: [FormsModule, UiModalComponent, UiButtonDirective, UiFileUploadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-modal [title]="title" (closed)="closed.emit()">
      @if (error || localError()) {
        <div class="alert alert-warning du-alert">{{ error || localError() }}</div>
      }

      <div class="du-form">
        @if (showAppPicker) {
          <label class="du-field">
            <span class="du-label">Application</span>
            <select class="form-select" [(ngModel)]="appId">
              <option [ngValue]="null">Select application…</option>
              @for (a of applications; track a.application_id) {
                <option [ngValue]="a.application_id">{{ a.application_ref }}</option>
              }
            </select>
          </label>
        }

        <label class="du-field">
          <span class="du-label">Document Type</span>
          <select class="form-select" [(ngModel)]="typeId">
            <option [ngValue]="null">Select type…</option>
            @for (t of docTypes; track t.id) {
              <option [ngValue]="t.id">{{ t.category ? t.category + ' — ' + t.name : t.name }}</option>
            }
          </select>
        </label>

        <div class="du-field">
          <span class="du-label">File</span>

          <!-- Standard LoanDesk upload (Underwriting Step 8 design). -->
          <ui-file-upload label="Upload File" [accept]="accept" emptyText="No file selected yet."
            [hint]="'PDF, Word, Excel or images · up to ' + maxSizeMb + 'MB'"
            (fileChange)="$event ? handleFile($event) : remove()" />
        </div>
      </div>

      <div modalFooter class="du-footer">
        <button uiButton variant="ghost" type="button" (click)="closed.emit()">Cancel</button>
        <button uiButton variant="primary" type="button" [disabled]="saving || !fileName()" (click)="submit()">
          {{ saving ? 'Uploading…' : 'Upload' }}
        </button>
      </div>
    </ui-modal>
  `,
  styles: [`
    :host { display: contents; }
    .du-alert { margin-bottom: 14px; }
    .du-form { display: grid; gap: 16px; }
    .du-field { display: grid; gap: 6px; }
    .du-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--muted-foreground);
    }
    .du-drop {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 24px 16px;
      border: 1.5px dashed var(--border);
      border-radius: var(--radius);
      background: var(--muted);
      cursor: pointer;
      text-align: center;
      transition: border-color 0.15s, background 0.15s;
    }
    .du-drop:hover { border-color: var(--muted-foreground); }
    .du-drop--over { border-color: var(--accent); background: rgba(234, 171, 0, 0.08); }
    .du-drop-icon { font-size: 26px; color: var(--muted-foreground); margin-bottom: 2px; }
    .du-drop-main { font-size: 13px; color: var(--foreground); }
    .du-drop-link { color: var(--accent-foreground); font-weight: 600; text-decoration: underline; }
    .du-drop-sub { font-size: 11px; color: var(--muted-foreground); }
    .du-input {
      position: absolute; inset: 0; width: 100%; height: 100%;
      opacity: 0; cursor: pointer;
    }
    .du-file {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--card);
    }
    .du-file-icon { font-size: 22px; color: var(--accent-foreground); }
    .du-file-meta { display: grid; gap: 2px; min-width: 0; flex: 1; }
    .du-file-name {
      font-size: 13px; font-weight: 600; color: var(--foreground);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .du-file-size { font-size: 11px; color: var(--muted-foreground); }
    .du-file-remove {
      flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px;
      border: none; border-radius: 6px;
      background: transparent; color: var(--muted-foreground); cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .du-file-remove:hover { background: var(--muted); color: var(--foreground); }
    .du-footer { display: flex; justify-content: flex-end; gap: 8px; }
  `],
})
export class PortfolioDocUploadComponent {
  @Input() title = 'Upload Document';
  @Input() docTypes: { id: number; name: string; category?: string | null }[] = [];
  @Input() saving = false;
  @Input() error: string | null = null;
  @Input() showAppPicker = false;
  @Input() applications: { application_id: number; application_ref: string }[] = [];
  @Input() maxSizeMb = MAX_UPLOAD_MB; // client 22-10-2026: 20MB across all modules
  @Output() submitDoc = new EventEmitter<DocUploadResult>();
  @Output() closed = new EventEmitter<void>();

  readonly accept = UPLOAD_ACCEPT;
  readonly fileName = signal('');
  readonly fileSizeLabel = signal('');
  readonly localError = signal<string | null>(null);
  readonly dragging = signal(false);
  private base64 = '';
  typeId: number | null = null;
  appId: number | null = null;

  onPicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    this.handleFile(input.files?.[0] || null);
  }

  onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    this.dragging.set(true);
  }

  onDragLeave(ev: DragEvent): void {
    ev.preventDefault();
    this.dragging.set(false);
  }

  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragging.set(false);
    this.handleFile(ev.dataTransfer?.files?.[0] || null);
  }

  handleFile(file: File | null): void {
    this.localError.set(null);
    this.base64 = '';
    this.fileName.set('');
    this.fileSizeLabel.set('');
    if (!file) return;
    if (!uploadExtOk(file.name)) {
      this.localError.set('File type not allowed. Use Word, PDF, image or Excel files.');
      return;
    }
    if (file.size > this.maxSizeMb * 1024 * 1024) {
      this.localError.set(`File is too large. Maximum size is ${this.maxSizeMb}MB.`);
      return;
    }
    this.fileName.set(file.name);
    this.fileSizeLabel.set(this.humanSize(file.size));
    const reader = new FileReader();
    reader.onload = () => { this.base64 = String(reader.result || ''); };
    reader.onerror = () => { this.localError.set('Could not read the selected file.'); };
    reader.readAsDataURL(file);
  }

  remove(): void {
    this.base64 = '';
    this.fileName.set('');
    this.fileSizeLabel.set('');
    this.localError.set(null);
  }

  private humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  submit(): void {
    this.localError.set(null);
    if (this.showAppPicker && !this.appId) { this.localError.set('Choose an application.'); return; }
    if (!this.typeId) { this.localError.set('Choose a document type.'); return; }
    if (!this.fileName() || !this.base64) { this.localError.set('Choose a file to upload.'); return; }
    const result: DocUploadResult = {
      file_name: this.fileName(),
      content_base64: this.base64,
      document_type_id: this.typeId,
    };
    if (this.showAppPicker && this.appId) result.application_id = this.appId;
    this.submitDoc.emit(result);
  }
}
