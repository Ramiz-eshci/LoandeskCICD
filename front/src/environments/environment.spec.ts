import { environment } from './environment';

describe('production environment (pen-test 24-10-2026)', () => {
  it('is marked as production and never enables design mode', () => {
    expect(environment.production).toBe(true);
    expect(environment.designMode).toBe(false);
    expect(environment.apiBaseUrl).toBe('/api');
  });
});
