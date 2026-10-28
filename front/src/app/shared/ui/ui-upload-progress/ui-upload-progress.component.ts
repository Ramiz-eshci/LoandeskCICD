import { Component, ChangeDetectionStrategy, inject } from '@angular/core';

import { UploadProgressService } from '../../../core/upload/upload-progress.service';

/** Global upload panel (bottom-right): one row per file upload with a progress bar. */
@Component({
  selector: 'ui-upload-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (svc.jobs().length) {
      <div class="up-panel" role="status" aria-live="polite">
        @for (j of svc.jobs(); track j.id) {
          <div class="up-row" [class.up-row--done]="j.phase === 'done'" [class.up-row--failed]="j.phase === 'failed'">
            <div class="up-head">
              <i class="bi" [class.bi-cloud-arrow-up]="j.phase === 'sending' || j.phase === 'processing'"
                 [class.bi-check-circle-fill]="j.phase === 'done'" [class.bi-x-circle-fill]="j.phase === 'failed'"></i>
              <span class="up-name" [title]="j.label">{{ j.label }}</span>
              <span class="up-pct">
                @switch (j.phase) {
                  @case ('sending') { {{ j.percent !== null ? j.percent + '%' : 'Uploading…' }} }
                  @case ('processing') { Saving… }
                  @case ('done') { Uploaded }
                  @case ('failed') { Failed }
                }
              </span>
              @if (j.phase === 'done' || j.phase === 'failed') {
                <button type="button" class="up-x" aria-label="Dismiss" (click)="svc.dismiss(j.id)"><i class="bi bi-x"></i></button>
              }
            </div>
            <div class="up-track">
              <div class="up-bar" [class.up-bar--indet]="j.percent === null || j.phase === 'processing'"
                   [style.width.%]="j.phase === 'processing' || j.percent === null ? 100 : j.percent"></div>
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .up-panel {
      position: fixed; right: 20px; bottom: 20px; z-index: 2000; width: 340px; max-width: calc(100vw - 32px);
      display: grid; gap: 8px; padding: 10px; border-radius: 12px; background: #fff;
      border: 1px solid #e2e8f0; box-shadow: 0 10px 30px rgba(15, 34, 68, 0.18);
    }
    .up-row { display: grid; gap: 6px; }
    .up-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #0f2244; }
    .up-head .bi { font-size: 15px; color: #0f2244; }
    .up-row--done .up-head .bi { color: #2e8b57; }
    .up-row--failed .up-head .bi { color: #c0392b; }
    .up-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
    .up-pct { flex: none; font-family: 'DM Mono', ui-monospace, monospace; color: #475569; }
    .up-x { border: 0; background: none; padding: 0 2px; cursor: pointer; color: #64748b; font-size: 16px; line-height: 1; }
    .up-track { height: 6px; border-radius: 999px; background: #e7edf5; overflow: hidden; }
    .up-bar { height: 100%; border-radius: 999px; background: #eaab00; transition: width 0.2s ease; }
    .up-row--done .up-bar { background: #2e8b57; }
    .up-row--failed .up-bar { background: #c0392b; }
    .up-bar--indet { background: linear-gradient(90deg, #f5d36b 0%, #eaab00 50%, #f5d36b 100%); background-size: 200% 100%; animation: up-move 1.1s linear infinite; }
    @keyframes up-move { from { background-position: 200% 0; } to { background-position: 0 0; } }
  `],
})
export class UiUploadProgressComponent {
  protected readonly svc = inject(UploadProgressService);
}
