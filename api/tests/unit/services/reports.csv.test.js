'use strict';

/** Reports CSV export: escaping + formula-injection guard (pen-test 24-10-2026). */

jest.mock('../../../config/database', () => ({ query: jest.fn().mockResolvedValue([]), queryNamed: jest.fn() }));
const db = require('../../../config/database');
const reports = require('../../../services/reports.service');

describe('reports.csvCell', () => {
  it.each([
    ['=HYPERLINK("http://evil","x")', `"'=HYPERLINK(""http://evil"",""x"")"`],
    ['+cmd|/C calc!A0', "'+cmd|/C calc!A0"],
    ['@SUM(1+1)', "'@SUM(1+1)"],
    ['-2+3', "'-2+3"],
    ['-cmd', "'-cmd"],
    ['\tSUM(A1)', "'\tSUM(A1)"],
  ])('neutralises %p', (input, out) => expect(reports.csvCell(input)).toBe(out));

  it.each(['-12.5', '-£1,234.00', '-5%', '1,234', '£250,000.00', 'Jane Smith', 'ENQ-2026-00042', ''])('leaves %p as it is', (v) => {
    expect(reports.csvCell(v)).toBe(v.includes(',') ? `"${v}"` : v);
  });

  it('quotes commas, quotes and new lines', () => {
    expect(reports.csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(reports.csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(reports.csvCell(null)).toBe('');
  });
});

describe('reports.exportCsv', () => {
  it('a malicious applicant name is exported as text', async () => {
    db.queryNamed.mockResolvedValueOnce([
      { ref: 'ENQ-1', customer: '=1+1', status: 'New', basis: 'Gross', amount: 100000, assigned: 'Bob', created_at: '2026-10-01' },
    ]);
    const req = { userData: { userId: 1, isSuperAdmin: true } };
    const { filename, buffer } = await reports.exportCsv(req, 'enquiry', {});
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    expect(filename).toBe('enquiry-report.csv');
    expect(text.split('\n')[0]).toBe('Reference,Applicant,Status,Basis,Loan Amount,Assigned To,Created');
    expect(text.split('\n')[1]).toMatch(/^ENQ-1,'=1\+1,New,Gross,/);
  });
});
