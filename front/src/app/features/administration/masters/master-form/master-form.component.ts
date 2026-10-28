import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, of } from 'rxjs';

import { UiButtonDirective } from '../../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../../shared/ui/ui-card/ui-card.component';
import { UiFormFieldComponent } from '../../../../shared/ui/ui-form-field/ui-form-field.component';
import { UiPageHeaderComponent } from '../../../../shared/ui/ui-page-header/ui-page-header.component';
import { MastersService } from '../masters.service';
import { MASTERS, MasterConfig, MasterField, VALIDATION } from '../masters.config';
import { ToastrService } from 'ngx-toastr';

type Option = { value: unknown; label: string };

/** Generic Master add/edit form — dynamic fields, per-type validation, FK select boxes. */
@Component({
  selector: 'app-master-form',
  standalone: true,
  imports: [ReactiveFormsModule, UiButtonDirective, UiCardComponent, UiFormFieldComponent, UiPageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './master-form.component.html',
  styleUrl: './master-form.component.scss',
})
export class MasterFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(MastersService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toastr = inject(ToastrService);

  readonly key = signal('');
  readonly cfg = signal<MasterConfig | null>(null);
  readonly recordId = signal<number | null>(null);
  readonly editMode = computed(() => this.recordId() !== null);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly serverErrors = signal<Record<string, string>>({});
  readonly options = signal<Record<string, Option[]>>({});
  private label(): string { return this.cfg()?.title || 'Record'; }

  form: FormGroup = this.fb.group({});

  readonly subtitle = computed(() => (this.editMode() ? 'Update this record' : 'Create a new record'));

  private validatorsFor(f: MasterField): ValidatorFn[] {
    const vs: ValidatorFn[] = [];
    if (f.auto) return vs; // server generates the code; nothing to validate client-side
    if (f.required) vs.push(Validators.required);
    if (f.type === 'code') vs.push(Validators.pattern(VALIDATION.code));
    else if (f.type === 'text') vs.push(Validators.pattern(VALIDATION.text));
    else if (f.type === 'phone') vs.push(Validators.pattern(VALIDATION.phone));
    else if (f.type === 'email') vs.push(Validators.email);
    else if (f.type === 'int') vs.push(Validators.pattern(VALIDATION.int));
    else if (f.type === 'decimal') vs.push(Validators.pattern(VALIDATION.decimal));
    return vs;
  }

  ngOnInit(): void {
    const key = this.route.snapshot.paramMap.get('key') || this.route.parent?.snapshot.paramMap.get('key') || '';
    const cfg = MASTERS[key] ?? null;
    this.key.set(key);
    this.cfg.set(cfg);
    if (!cfg) { this.error.set('Unknown master: ' + key); return; }

    const controls: Record<string, unknown[]> = {};
    for (const f of cfg.fields) {
      const init: unknown = f.type === 'bool' ? false : '';
      controls[f.name] = f.auto
        ? [{ value: init, disabled: true }, this.validatorsFor(f)] // auto code: read-only, server-generated
        : [init, this.validatorsFor(f)];
    }
    this.form = this.fb.group(controls);

    // load FK select options
    for (const f of cfg.fields) {
      if (f.type === 'select' && f.ref) {
        const ref = f.ref;
        this.api.list(ref.master, { perPage: 200, activeOnly: true })
          .pipe(catchError(() => of({ rows: [], meta: null })), takeUntilDestroyed(this.destroyRef))
          .subscribe((res) => {
            const opts = res.rows.map((r) => ({ value: r[ref.valueCol], label: String(r[ref.labelCol] ?? r[ref.valueCol]) }));
            this.options.update((m) => ({ ...m, [f.name]: [...opts, ...(m[f.name] ?? []).filter((o) => !opts.some((x) => String(x.value) === String(o.value)))] }));
          });
      }
    }

    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      this.recordId.set(Number(idParam));
      this.api.get(key, idParam)
        .pipe(catchError(() => { this.error.set('Could not load record.'); return of({} as Record<string, unknown>); }), takeUntilDestroyed(this.destroyRef))
        .subscribe((rec) => {
          const patch: Record<string, unknown> = {};
          for (const f of cfg.fields) {
            const v = rec[f.name];
            if (f.type === 'bool') patch[f.name] = !!v;
            else if (f.type === 'select') patch[f.name] = v != null ? String(v) : '';
            else patch[f.name] = v ?? '';
          }
          this.form.patchValue(patch);
          this.keepInactiveSelections(cfg, rec);
        });
    }
  }

  /** Edit mode: if the saved FK points to a now-inactive row, keep it visible (marked inactive) so the value is not lost. */
  private keepInactiveSelections(cfg: MasterConfig, rec: Record<string, unknown>): void {
    for (const f of cfg.fields) {
      const v = rec[f.name];
      if (f.type !== 'select' || !f.ref || v == null || v === '') continue;
      const ref = f.ref;
      this.api.get(ref.master, String(v))
        .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
        .subscribe((row) => {
          if (!row || row['is_active'] === true || Number(row['is_active']) === 1) return;
          const opt = { value: row[ref.valueCol] ?? v, label: String(row[ref.labelCol] ?? v) + ' (inactive)' };
          this.options.update((m) => {
            const cur = m[f.name] ?? [];
            return cur.some((o) => String(o.value) === String(opt.value)) ? m : { ...m, [f.name]: [...cur, opt] };
          });
        });
    }
  }

  inputType(f: MasterField): string {
    if (f.type === 'int' || f.type === 'decimal') return 'number';
    if (f.type === 'email') return 'email';
    if (f.type === 'date') return 'date';
    return 'text';
  }

  fieldError(f: MasterField): string {
    const server = this.serverErrors()[f.name];
    if (server) return server;
    const c = this.form.get(f.name);
    if (!c || !c.touched || c.valid) return '';
    if (c.errors?.['required']) return `${f.label} is required.`;
    if (c.errors?.['email']) return 'Enter a valid email address.';
    if (c.errors?.['pattern']) {
      switch (f.type) {
        case 'code': return 'Only letters, digits, _ and - are allowed.';
        case 'phone': return 'Enter a valid phone number.';
        case 'int': return 'Enter a whole number.';
        case 'decimal': return 'Enter a valid number.';
        default: return 'Special characters are not allowed.';
      }
    }
    return 'Invalid value.';
  }

  /** Back to where the form was opened from: the Brokers menu (client 20-10-2026) or the master list. */
  private backTo(): unknown[] {
    return this.key() === 'broker' || this.route.snapshot.queryParamMap.get('from') === 'brokers' ? ['/brokers'] : ['/masters', this.key()];
  }
  cancel(): void { void this.router.navigate(this.backTo()); }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toastr.warning('Please fix the highlighted fields before saving.', 'Validation');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.serverErrors.set({});
    const body = this.form.getRawValue();
    const id = this.recordId();

    const onErr = (e: unknown) => {
      this.saving.set(false);
      const err = e as { error?: { errors?: Record<string, string>; message?: string } };
      if (err?.error?.errors) this.serverErrors.set(err.error.errors);
      const msg = err?.error?.message || 'Save failed. Please check the form and try again.';
      this.error.set(msg);
      this.toastr.error(msg, this.editMode() ? 'Update failed' : 'Create failed');
      return of(null);
    };

    if (id === null) {
      this.api.create(this.key(), body).pipe(catchError(onErr), takeUntilDestroyed(this.destroyRef)).subscribe((r) => {
        if (!r) return;
        this.toastr.success(`${this.label()} created successfully.`, 'Created');
        this.done();
      });
    } else {
      this.api.update(this.key(), id, body).pipe(catchError(onErr), takeUntilDestroyed(this.destroyRef)).subscribe((r) => {
        if (r === null) return;
        this.toastr.success(`${this.label()} updated successfully.`, 'Updated');
        this.done();
      });
    }
  }

  private done(): void { this.saving.set(false); void this.router.navigate(this.backTo()); }
}
