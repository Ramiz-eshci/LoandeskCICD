/**
 * Smoke test for EVERY standalone component in src/app (auto-discovered, so new
 * components are covered automatically).
 *
 * Each component is created with its real template, its first change detection
 * runs, every HTTP call it makes on start-up is answered with an empty API
 * response, and change detection runs again. The test fails if rendering or
 * initialisation throws - the kind of break an Angular / library upgrade causes.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideToastr } from 'ngx-toastr';
import { of } from 'rxjs';

const APP_DIR = path.join(__dirname, '..');

function componentFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return componentFiles(p);
    return d.name.endsWith('.component.ts') ? [p] : [];
  });
}

function componentsIn(file: string): [string, Type<unknown>][] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(file) as Record<string, unknown>;
  return Object.entries(mod)
    .filter(([, v]) => typeof v === 'function' && 'ɵcmp' in (v as object))
    .map(([name, v]) => [name, v as Type<unknown>]);
}

const CASES: [string, string, Type<unknown>][] = componentFiles(APP_DIR)
  .sort()
  .flatMap((f) => componentsIn(f).map(([name, cmp]) => [path.relative(APP_DIR, f), name, cmp] as [string, string, Type<unknown>]));

/** Sample values for `input.required<T>()` inputs, read from the component source. */
function requiredInputs(file: string): Record<string, unknown> {
  const src = fs.readFileSync(path.join(APP_DIR, file), 'utf8');
  const out: Record<string, unknown> = {};
  for (const m of src.matchAll(/(\w+)\s*=\s*input\.required<(.+?)>\(/g)) {
    const type = m[2];
    out[m[1]] = /\[\]/.test(type) ? [] : /number/.test(type) ? 1 : 'Sample';
  }
  return out;
}

/** Plural field names (steps, documents, assignees ...) - not status / address / basis. */
const LIST_KEY = /^[a-z_]+[^su]s$|_list$|^(items|rows|data)$/i;

/** An empty record whose unknown list-like fields read as [] (e.g. options.assignees, case.steps). */
function emptyRecord(seed: Record<string, unknown> = {}): Record<string, unknown> {
  return new Proxy(seed, {
    get: (t, k) => (k in t || typeof k !== 'string' || !LIST_KEY.test(k) ? t[k as string] : []),
  });
}

/** Endpoints whose empty payload needs list fields the heuristic can't guess. */
const FIXTURES: [RegExp, () => unknown][] = [
  [/\/email-settings\/options$/, () => ({ users: [], roles: [], dynamic: [], modules: [], events: [] })],
  [/\/underwriting\/meta$/, () => ({ steps: [], options: {} })],
  [/\/underwriting\/\d+$/, () => emptyRecord({ steps: [], queries: [], audit: [], securities: [], drawdowns: [], signed_offer_docs: [] })],
];

/** Empty API payload in the shape the caller expects: object for single records / counts, else a list. */
function emptyData(url: string): unknown {
  if (/\/meta\/counts$/.test(url)) return { total: 0, byCode: {}, byStage: {} };
  const u = url.split('?')[0];
  const fixture = FIXTURES.find(([re]) => re.test(u));
  if (fixture) return fixture[1]();
  return /\/(\d+|counts|summary|stats|showcase|me|options|form-options|meta(\/[\w-]+)?)(\/[\w-]+)?$/.test(u) ? emptyRecord() : [];
}

const params = convertToParamMap({ id: '1', key: 'ENQUIRY_OFFER', section: 'enquiries', module: 'enquiries', token: 'a'.repeat(64) });
const routeStub = {
  snapshot: { paramMap: params, queryParamMap: convertToParamMap({}), params: { id: '1' }, queryParams: {}, data: {}, url: [] },
  paramMap: of(params),
  queryParamMap: of(convertToParamMap({})),
  params: of({ id: '1' }),
  queryParams: of({}),
  data: of({}),
  url: of([]),
  parent: null,
};

/** Answer every pending request (and the ones they trigger) with an empty success. */
function drain(http: HttpTestingController, fixture: ComponentFixture<unknown>): void {
  for (let round = 0; round < 5; round++) {
    const pending = http.match(() => true);
    if (!pending.length) return;
    for (const req of pending) {
      if (req.cancelled) continue;
      if (req.request.responseType === 'blob') req.flush(new Blob([]));
      else req.flush({ status: true, message: 'ok', data: emptyData(req.request.url), errors: null, meta: null });
    }
    fixture.detectChanges();
  }
}

describe('component smoke tests', () => {
  it('discovers the components', () => {
    expect(CASES.length).toBeGreaterThan(60);
  });

  describe.each(CASES)('%s', (file, name, cmp) => {
    let errors: unknown[];
    let consoleError: jest.SpyInstance;

    beforeEach(() => {
      errors = [];
      consoleError = jest.spyOn(console, 'error').mockImplementation((...a: unknown[]) => errors.push(a));
      TestBed.configureTestingModule({
        imports: [cmp],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideRouter([]),
          provideNoopAnimations(),
          provideToastr(),
          { provide: ActivatedRoute, useValue: routeStub },
        ],
      });
    });

    afterEach(() => consoleError.mockRestore());

    it(`${name} renders and initialises without errors`, () => {
      const fixture = TestBed.createComponent(cmp);
      expect(fixture.componentInstance).toBeTruthy();
      for (const [k, v] of Object.entries(requiredInputs(file))) fixture.componentRef.setInput(k, v);
      fixture.detectChanges();
      drain(TestBed.inject(HttpTestingController), fixture);
      fixture.destroy();
      expect(errors).toEqual([]);
    });
  });
});
