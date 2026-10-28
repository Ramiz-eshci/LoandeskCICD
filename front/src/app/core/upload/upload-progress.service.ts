import { Injectable, computed, signal } from '@angular/core';

export interface UploadJob {
  id: number;
  /** File name(s) being sent. */
  label: string;
  /** 0-100 once the browser reports bytes sent; null while unknown. */
  percent: number | null;
  /** 'sending' -> bytes going up; 'processing' -> all sent, waiting for the server. */
  phase: 'sending' | 'processing' | 'done' | 'failed';
}

/**
 * Client 22-10-2026: every file upload in the app shows its own progress (instead of
 * "Uploading" toasts). Fed by uploadProgressInterceptor; rendered by <ui-upload-progress>.
 */
@Injectable({ providedIn: 'root' })
export class UploadProgressService {
  private seq = 0;
  readonly jobs = signal<UploadJob[]>([]);
  readonly active = computed(() => this.jobs().some((j) => j.phase === 'sending' || j.phase === 'processing'));

  start(label: string): number {
    const id = ++this.seq;
    this.jobs.update((l) => [...l, { id, label, percent: null, phase: 'sending' }]);
    return id;
  }
  progress(id: number, loaded: number, total: number | undefined): void {
    const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : null;
    this.patch(id, { percent: pct, phase: pct !== null && pct >= 100 ? 'processing' : 'sending' });
  }
  finish(id: number, ok: boolean): void {
    this.patch(id, { phase: ok ? 'done' : 'failed', percent: ok ? 100 : this.jobs().find((j) => j.id === id)?.percent ?? null });
    setTimeout(() => this.jobs.update((l) => l.filter((j) => j.id !== id)), ok ? 1500 : 4000);
  }
  dismiss(id: number): void { this.jobs.update((l) => l.filter((j) => j.id !== id)); }
  private patch(id: number, p: Partial<UploadJob>): void {
    this.jobs.update((l) => l.map((j) => (j.id === id ? { ...j, ...p } : j)));
  }
}
