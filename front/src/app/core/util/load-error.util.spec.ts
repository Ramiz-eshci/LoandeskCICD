import { loadErrorMessage } from './load-error.util';

describe('load-error.util / loadErrorMessage', () => {
  it('403 -> permission message naming what failed', () => {
    expect(loadErrorMessage({ status: 403 }, 'enquiries'))
      .toBe('You do not have permission to view enquiries. Please contact your administrator.');
  });

  it('401 -> session expired', () => {
    expect(loadErrorMessage({ status: 401 }, 'x')).toBe('Your session has expired. Please sign in again.');
  });

  it('0 -> cannot reach server', () => {
    expect(loadErrorMessage({ status: 0 }, 'x')).toBe('Cannot reach the server. Check your connection and try again.');
  });

  it('anything else -> generic retry naming what failed', () => {
    expect(loadErrorMessage({ status: 500 }, 'the list')).toBe('Could not load the list. Please try again.');
    expect(loadErrorMessage(null, 'the list')).toBe('Could not load the list. Please try again.');
  });
});
