import { HttpEvent, HttpEventType, HttpHandlerFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, finalize, tap } from 'rxjs';

import { UploadProgressService } from './upload-progress.service';

/** File names in a request body: FormData files, or the app's JSON { file_name, content_base64 } shape. */
function fileNames(body: unknown): string[] {
  const out: string[] = [];
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    body.forEach((v) => { if (typeof File !== 'undefined' && v instanceof File) out.push(v.name); });
    return out;
  }
  const walk = (v: unknown, depth: number): void => {
    if (!v || typeof v !== 'object' || depth > 4) return;
    if (Array.isArray(v)) { v.slice(0, 100).forEach((x) => walk(x, depth + 1)); return; }
    const o = v as Record<string, unknown>;
    if (typeof o['content_base64'] === 'string' && (o['content_base64'] as string).length > 0) {
      out.push(String(o['file_name'] || o['name'] || 'file'));
    }
    Object.values(o).forEach((x) => { if (x && typeof x === 'object') walk(x, depth + 1); });
  };
  walk(body, 0);
  return out;
}

/**
 * Client 22-10-2026: any request that carries a file gets upload progress reporting and
 * an entry in the global upload panel - so every upload screen shows "Uploading x%"
 * without each screen wiring it up. Must run BEFORE the crypto interceptor (plain body).
 */
export function uploadProgressInterceptor(req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> {
  if (req.method === 'GET' || req.method === 'DELETE') return next(req);
  const names = fileNames(req.body);
  if (!names.length) return next(req);
  const uploads = inject(UploadProgressService);
  const label = names.length === 1 ? names[0] : `${names.length} files (${names.slice(0, 2).join(', ')}${names.length > 2 ? '…' : ''})`;
  const id = uploads.start(label);
  let ok = false;
  return next(req.clone({ reportProgress: true })).pipe(
    tap({
      next: (ev) => {
        if (ev.type === HttpEventType.UploadProgress) uploads.progress(id, ev.loaded, ev.total);
        if (ev instanceof HttpResponse) ok = ev.ok;
      },
    }),
    finalize(() => uploads.finish(id, ok)),
  );
}
