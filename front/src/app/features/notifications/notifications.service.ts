import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { API } from '../../core/constants/api-endpoints';
import { ApiResponse } from '../../core/models/api-response.model';

export interface AppNotification {
  notification_id: number;
  title: string;
  body: string | null;
  type: string | null;
  link: string | null;
  entity_id: number | null;
  is_read: boolean | number;
  created_at: string;
}

/** Bell feed for the current user — wired to /api/notifications (JWT-scoped). */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl + API.notifications;

  list(limit = 30): Observable<AppNotification[]> {
    return this.http
      .get<ApiResponse<AppNotification[]>>(`${this.base}?limit=${limit}`)
      .pipe(map((r) => r.data ?? []));
  }

  unreadCount(): Observable<number> {
    return this.http
      .get<ApiResponse<{ count: number }>>(`${this.base}/unread-count`)
      .pipe(map((r) => r.data?.count ?? 0));
  }

  markRead(id: number): Observable<unknown> {
    return this.http.patch(`${this.base}/${id}/read`, {});
  }

  markAllRead(): Observable<unknown> {
    return this.http.post(`${this.base}/read-all`, {});
  }
}
