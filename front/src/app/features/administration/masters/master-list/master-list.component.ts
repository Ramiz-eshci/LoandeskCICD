import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, of } from 'rxjs';

import { HasPermissionDirective } from '../../../../core/auth/has-permission.directive';
import { UiButtonDirective } from '../../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../../shared/ui/ui-card/ui-card.component';
import { UiModalComponent } from '../../../../shared/ui/ui-modal/ui-modal.component';
import { UiPageHeaderComponent } from '../../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiPaginationComponent } from '../../../../shared/ui/ui-pagination/ui-pagination.component';
import { UiSearchInputComponent } from '../../../../shared/ui/ui-search-input/ui-search-input.component';
import { UiTagComponent } from '../../../../shared/ui/ui-tag/ui-tag.component';
import { UiCellDirective } from '../../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../../shared/ui/table/ui-data-table.component';
import { TableColumn } from '../../../../shared/ui/table/table-column.model';
import { MastersService } from '../masters.service';
import { MASTERS, MasterConfig, masterModule } from '../masters.config';
import { ToastrService } from 'ngx-toastr';
import { loadErrorMessage } from '../../../../core/util/load-error.util';

type Row = Record<string, unknown>;

/** Generic Master list — paginated, searchable, add/edit/deactivate/delete (real /api/masters/:key). */
@Component({
  selector: 'app-master-list',
  standalone: true,
  imports: [
    HasPermissionDirective, UiButtonDirective, UiCardComponent, UiCellDirective, UiDataTableComponent, UiModalComponent,
    UiPageHeaderComponent, UiPaginationComponent, UiSearchInputComponent, UiTagComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './master-list.component.html',
  styleUrl: './master-list.component.scss',
})
export class MasterListComponent implements OnInit {
  private readonly api = inject(MastersService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toastr = inject(ToastrService);

  readonly key = signal('');
  readonly cfg = signal<MasterConfig | null>(null);
  readonly rawRows = signal<Row[]>([]);
  /** id -> label maps for select/reference columns, so the list shows names not ids. */
  readonly refMaps = signal<Record<string, Record<string, string>>>({});
  readonly rows = computed<Row[]>(() => {
    const maps = this.refMaps();
    const fields = (this.cfg()?.fields || []).filter((f) => f.type === 'select' && f.ref);
    if (!fields.length) return this.rawRows();
    return this.rawRows().map((r) => {
      const out: Row = { ...r };
      for (const f of fields) {
        const m = maps[f.name];
        const v = r[f.name];
        if (m && v != null && m[String(v)] != null) out[f.name] = m[String(v)];
      }
      return out;
    });
  });
  readonly total = signal(0);
  readonly page = signal(1);
  readonly perPage = 10;
  readonly search = signal('');
  readonly error = signal<string | null>(null);
  readonly pending = signal<Row | null>(null);
  readonly pendingDelete = signal<Row | null>(null);

  /** RBAC module key for the active master (mirrors backend masters.controller moduleKey). */
  readonly moduleKey = computed(() => masterModule(this.key()));
  private label(): string { return this.cfg()?.title || 'Record'; }

  readonly hasNext = computed(() => this.page() * this.perPage < this.total());
  readonly subtitle = computed(() => `${this.total()} record(s)`);
  readonly pageSummary = computed(() => {
    const from = this.total() ? (this.page() - 1) * this.perPage + 1 : 0;
    const to = Math.min(this.page() * this.perPage, this.total());
    return `Showing ${from}–${to} of ${this.total()}`;
  });

  readonly columns = computed<TableColumn<Row>[]>(() => {
    const c = this.cfg();
    if (!c) return [];
    const cols: TableColumn<Row>[] = [{ key: c.pk, header: 'ID', width: '70px', mono: true }];
    const shown = c.fields.filter((f) => f.type !== 'code');
    for (const f of shown.slice(0, 4)) cols.push({ key: f.name, header: f.label, width: '180px', bold: f.name === shown[0]?.name });
    cols.push({ key: 'is_active', header: 'Status', width: '110px' });
    cols.push({ key: 'actions', header: 'Actions', width: '330px' });
    return cols;
  });

  ngOnInit(): void {
    // The :key lives on the parent route. When switching masters the component
    // instance is REUSED (only the param changes), so react to param changes
    // instead of reading a one-time snapshot — otherwise the list stays stale.
    const source = this.route.parent?.paramMap ?? this.route.paramMap;
    source.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((pm) => {
      const key = pm.get('key') || this.route.snapshot.paramMap.get('key') || '';
      this.key.set(key);
      this.cfg.set(MASTERS[key] ?? null);
      this.page.set(1);
      this.search.set('');
      this.error.set(null);
      this.rawRows.set([]);
      this.refMaps.set({});
      this.total.set(0);
      if (!this.cfg()) {
        this.error.set('Unknown master: ' + key);
        return;
      }
      this.loadRefOptions();
      this.load();
    });
  }

  private load(): void {
    this.api.list(this.key(), { page: this.page(), search: this.search(), perPage: this.perPage })
      .pipe(
        catchError((e) => {
          this.error.set(loadErrorMessage(e, 'these records'));
          return of({ rows: [], meta: null });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.rawRows.set(res.rows);
        this.total.set(res.meta && typeof res.meta.total === 'number' ? res.meta.total : res.rows.length);
      });
  }

  /** Load id->label options for every select/reference column so names show in the list. */
  private loadRefOptions(): void {
    const fields = (this.cfg()?.fields || []).filter((f) => f.type === 'select' && f.ref);
    if (!fields.length) { this.refMaps.set({}); return; }
    const maps: Record<string, Record<string, string>> = {};
    for (const f of fields) {
      const ref = f.ref!;
      this.api.list(ref.master, { page: 1, search: '', perPage: 200 })
        .pipe(catchError(() => of({ rows: [] as Row[], meta: null })), takeUntilDestroyed(this.destroyRef))
        .subscribe((res) => {
          const m: Record<string, string> = {};
          for (const row of res.rows as Row[]) { m[String(row[ref.valueCol])] = String(row[ref.labelCol] ?? ''); }
          maps[f.name] = m;
          this.refMaps.set({ ...maps });
        });
    }
  }

  applySearch(): void { this.page.set(1); this.load(); }
  prev(): void { if (this.page() > 1) { this.page.update((p) => p - 1); this.load(); } }
  next(): void { if (this.hasNext()) { this.page.update((p) => p + 1); this.load(); } }

  create(): void { void this.router.navigate(['/masters', this.key(), 'new']); }
  edit(row: Row): void { void this.router.navigate(['/masters', this.key(), row[this.cfg()!.pk], 'edit']); }

  ask(row: Row): void { this.pending.set(row); }

  confirmDeactivate(row: Row): void {
    this.api.deactivate(this.key(), row[this.cfg()!.pk] as number, false)
      .pipe(
        catchError((e: unknown) => {
          this.pending.set(null);
          this.toastr.error(this.apiMsg(e, 'Could not deactivate the record.'), 'Deactivate failed');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => {
        if (r === null) return;
        this.pending.set(null);
        this.toastr.success(`${this.label()} deactivated successfully.`, 'Deactivated');
        this.load();
      });
  }

  confirmDelete(row: Row): void {
    this.api.remove(this.key(), row[this.cfg()!.pk] as number)
      .pipe(
        catchError((e: unknown) => {
          this.pendingDelete.set(null);
          this.toastr.error(this.apiMsg(e, 'Could not delete the record.'), 'Delete failed');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => {
        if (r === null) return;
        this.pendingDelete.set(null);
        this.toastr.success(`${this.label()} deleted successfully.`, 'Deleted');
        this.load();
      });
  }

  reactivate(row: Row): void {
    this.api.deactivate(this.key(), row[this.cfg()!.pk] as number, true)
      .pipe(
        catchError((e: unknown) => {
          this.toastr.error(this.apiMsg(e, 'Could not activate the record.'), 'Activate failed');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => {
        if (r === null) return;
        this.toastr.success(`${this.label()} activated successfully.`, 'Activated');
        this.load();
      });
  }

  /** Pull a human message off an HttpErrorResponse-ish object. */
  private apiMsg(e: unknown, fallback: string): string {
    const err = e as { error?: { message?: string } };
    return err?.error?.message || fallback;
  }
}
