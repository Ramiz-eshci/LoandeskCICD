import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { API } from '../../core/constants/api-endpoints';
import { ApiMeta, ApiResponse } from '../../core/models/api-response.model';

/** One automatic e-mail on Masters > Email Settings. */
export interface EmailEventRow {
  [k: string]: unknown;
  event_key: string;
  module: string;
  module_name: string;
  name: string;
  description: string;
  to: string;
  default_cc: string;
  cc_from_user: boolean;
  keep_default_cc: boolean;
  extra_cc: string[];
  custom_subject: boolean;
  custom_body: boolean;
  extra_files: number;
  updated_at: string | null;
}

export interface EmailAttachment {
  attachment_id: number;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

export interface EmailEventDetail {
  event_key: string;
  module: string;
  module_name: string;
  name: string;
  description: string;
  to: string;
  default_cc: string;
  cc_from_user: boolean;
  placeholders: string[];
  /** Placeholders that are ready-made HTML blocks (tables, lists, optional paragraphs). */
  html_placeholders: string[];
  keep_default_cc: boolean;
  subject_template: string;
  body_template: string;
  /** The system text (same as what is sent today) - shown when there is no custom text. */
  default_subject: string;
  default_body: string;
  user_ids: number[];
  role_ids: number[];
  dynamic_keys: string[];
  attachments: EmailAttachment[];
  updated_at: string | null;
}

export interface EmailOptions {
  users: { user_id: number; full_name: string; email: string }[];
  roles: { role_id: number; role_name: string }[];
  dynamic: { key: string; label: string }[];
  modules: { key: string; label: string }[];
  events: { key: string; name: string; module: string }[];
}

export interface EmailSettingsSave {
  keep_default_cc: boolean;
  subject_template: string;
  body_template: string;
  user_ids: number[];
  role_ids: number[];
  dynamic_keys: string[];
}

export interface EmailLogRow {
  [k: string]: unknown;
  email_log_id: number;
  event_key: string | null;
  event_name: string;
  module: string | null;
  module_name: string;
  record_id: number | null;
  record_ref: string | null;
  to_list: string;
  cc_list: string | null;
  subject: string | null;
  attachments: string | null;
  status: 'Sent' | 'Failed';
  error: string | null;
  sent_at: string;
  sent_by_name: string | null;
  body?: string | null;
  transport?: string | null;
}

export interface EmailHistorySummary {
  total: number;
  sent: number;
  failed: number;
  records: number;
  by_module: { module: string; module_name: string; count: number }[];
}

export interface EmailHistoryQuery {
  from?: string;
  to?: string;
  module?: string;
  event?: string;
  status?: string;
  search?: string;
  page?: number;
  per_page?: number;
}

/** Masters > Email Settings + Email History (client 17-10-2026). */
@Injectable({ providedIn: 'root' })
export class EmailService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl + API.emailSettings;
  private readonly histBase = environment.apiBaseUrl + API.emailHistory;

  list(): Observable<EmailEventRow[]> {
    return this.http.get<ApiResponse<EmailEventRow[]>>(this.base).pipe(map((r) => r.data ?? []));
  }

  options(): Observable<EmailOptions> {
    return this.http.get<ApiResponse<EmailOptions>>(`${this.base}/options`).pipe(map((r) => r.data));
  }

  get(key: string): Observable<EmailEventDetail> {
    return this.http.get<ApiResponse<EmailEventDetail>>(`${this.base}/${key}`).pipe(map((r) => r.data));
  }

  save(key: string, body: EmailSettingsSave): Observable<EmailEventDetail> {
    return this.http.put<ApiResponse<EmailEventDetail>>(`${this.base}/${key}`, body).pipe(map((r) => r.data));
  }

  preview(key: string, body: { subject_template: string; body_template: string }): Observable<{ subject: string; html: string; unknown: string[] }> {
    return this.http.post<ApiResponse<{ subject: string; html: string; unknown: string[] }>>(`${this.base}/${key}/preview`, body).pipe(map((r) => r.data));
  }

  addAttachment(key: string, file: { file_name: string; content_base64: string }): Observable<{ id: number }> {
    return this.http.post<ApiResponse<{ id: number }>>(`${this.base}/${key}/attachments`, file).pipe(map((r) => r.data));
  }

  removeAttachment(key: string, id: number): Observable<unknown> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/${key}/attachments/${id}`).pipe(map((r) => r.data));
  }

  downloadAttachment(key: string, id: number): Observable<Blob> {
    return this.http.get(`${this.base}/${key}/attachments/${id}/download`, { responseType: 'blob' });
  }

  history(q: EmailHistoryQuery): Observable<{ rows: EmailLogRow[]; summary: EmailHistorySummary; meta: ApiMeta | null }> {
    let params = new HttpParams();
    Object.entries(q).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') params = params.set(k, String(v)); });
    return this.http
      .get<ApiResponse<{ rows: EmailLogRow[]; summary: EmailHistorySummary }>>(this.histBase, { params })
      .pipe(map((r) => ({ rows: r.data?.rows ?? [], summary: r.data?.summary, meta: r.meta })));
  }

  historyItem(id: number): Observable<EmailLogRow> {
    return this.http.get<ApiResponse<EmailLogRow>>(`${this.histBase}/${id}`).pipe(map((r) => r.data));
  }
}
