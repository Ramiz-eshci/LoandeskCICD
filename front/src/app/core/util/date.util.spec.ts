import { formatDate, formatDateTime, toDateInput } from './date.util';

describe('date.util / formatDate', () => {
  it('returns the placeholder for empty values', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
  });

  it('honours a custom placeholder', () => {
    expect(formatDate(null, 'N/A')).toBe('N/A');
  });

  it('splits a plain yyyy-mm-dd string without a timezone shift', () => {
    expect(formatDate('2026-09-15')).toBe('15-09-2026');
  });

  it('takes the date part of an ISO datetime string', () => {
    expect(formatDate('2026-01-05T23:30:00Z')).toBe('05-01-2026');
  });

  it('formats a Date object as dd-mm-yyyy', () => {
    expect(formatDate(new Date(2026, 8, 15))).toBe('15-09-2026');
  });

  it('returns the placeholder for an unparseable string', () => {
    expect(formatDate('not-a-date')).toBe('—');
  });
});

describe('date.util / formatDateTime', () => {
  it('appends zero-padded HH:mm', () => {
    expect(formatDateTime(new Date(2026, 8, 15, 9, 5))).toBe('15-09-2026 09:05');
  });

  it('returns the placeholder for empty or invalid values', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('nope')).toBe('—');
  });
});

describe('date.util / toDateInput', () => {
  it('returns an empty string for falsy values', () => {
    expect(toDateInput(null)).toBe('');
    expect(toDateInput('')).toBe('');
  });

  it('passes a yyyy-mm-dd prefix through untouched', () => {
    expect(toDateInput('2026-09-15T10:00:00')).toBe('2026-09-15');
  });

  it('formats a Date object as yyyy-mm-dd', () => {
    expect(toDateInput(new Date(2026, 0, 3))).toBe('2026-01-03');
  });

  it('returns an empty string for an invalid date', () => {
    expect(toDateInput('rubbish')).toBe('');
  });
});
