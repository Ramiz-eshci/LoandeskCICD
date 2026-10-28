import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { catchError, map, of } from 'rxjs';

import { environment } from '../../../environments/environment';
import { API } from '../constants/api-endpoints';
import { ApiResponse } from '../models/api-response.model';
import { isGoogleMapsLink, isShortMapsLink, mapEmbedUrl } from './map-link.util';

/**
 * Map preview for any security (client 29-09-2026).
 *
 * Shows the map as soon as the user gives EITHER a Google Maps link OR an
 * address / postcode. Short share links (maps.app.goo.gl/…) are resolved once
 * through the API (the browser cannot follow Google's redirect) and cached, so
 * the pin comes from the link instead of falling back to the address.
 */
@Injectable({ providedIn: 'root' })
export class MapPreviewService {
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly base = environment.apiBaseUrl + API.enquiries;

  /** short link -> long link ('' while pending / failed) */
  private readonly resolved = signal<Record<string, string>>({});
  private readonly pending = new Set<string>();
  private readonly safeCache = new Map<string, SafeResourceUrl>();

  /** Embed URL for the iframe, or null when there is nothing to show / the link is invalid. */
  embed(link: string | null | undefined, address?: string | null, postcode?: string | null): SafeResourceUrl | null {
    const l = String(link ?? '').trim();
    if (l && !isGoogleMapsLink(l)) return null;
    let use = l;
    if (l && isShortMapsLink(l)) {
      const r = this.resolved()[l];
      if (r === undefined) this.resolve(l);
      if (r) use = r;
    }
    const url = mapEmbedUrl(use, address, postcode);
    if (!url) return null;
    let safe = this.safeCache.get(url);
    if (!safe) {
      // url is always https://www.google.com/maps?...&output=embed, built by mapEmbedUrl
      safe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      if (this.safeCache.size > 200) this.safeCache.clear();
      this.safeCache.set(url, safe);
    }
    return safe;
  }

  /** "Open in Google Maps" target: the link itself, else a search for the address. */
  openUrl(link: string | null | undefined, address?: string | null, postcode?: string | null): string | null {
    const l = String(link ?? '').trim();
    if (l && isGoogleMapsLink(l)) return l;
    const where = [address, postcode].map((x) => String(x ?? '').trim()).filter(Boolean).join(', ');
    return where ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}` : null;
  }

  private resolve(link: string): void {
    if (this.pending.has(link)) return;
    this.pending.add(link);
    this.http
      .get<ApiResponse<{ url: string }>>(`${this.base}/meta/resolve-map-link`, { params: { url: link } })
      .pipe(map((r) => r.data?.url || ''), catchError(() => of('')))
      .subscribe((url) => {
        this.pending.delete(link);
        this.resolved.update((m) => ({ ...m, [link]: url }));
      });
  }
}
