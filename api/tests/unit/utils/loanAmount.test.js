'use strict';

/** loanAmount SQL fragments - shape checks so a refactor can't silently change the basis rules. */

const L = require('../../../utils/loanAmount');

describe('loanAmount SQL helpers', () => {
  it('LATEST_GROSS_APPLY targets the enquiries alias `e` and exposes lg.gross + lg.net', () => {
    expect(L.LATEST_GROSS_APPLY).toBe(L.latestGrossApply('e'));
    expect(L.LATEST_GROSS_APPLY).toMatch(/^OUTER APPLY/);
    expect(L.LATEST_GROSS_APPLY).toMatch(/AS gross,/);
    expect(L.LATEST_GROSS_APPLY).toMatch(/AS net\) lg$/);
    expect(L.LATEST_GROSS_APPLY).toContain('eo.enquiry_id = e.enquiry_id');
  });

  it('latestGrossApply re-targets another alias everywhere', () => {
    const sql = L.latestGrossApply('enq');
    expect(sql).toContain('eo.enquiry_id = enq.enquiry_id');
    expect(sql).toContain('enq.offer_amount');
    expect(sql).not.toMatch(/\be\.enquiry_id/);
  });

  it('only SENT indicatives and Accepted/Sent offers count', () => {
    expect(L.LATEST_GROSS_APPLY).toContain("eo.status IN ('Accepted','Sent')");
    expect(L.LATEST_GROSS_APPLY).toContain('ei.sent_at IS NOT NULL');
    expect(L.LATEST_GROSS_APPLY).toContain("CASE WHEN eo.status = 'Accepted' THEN 0 ELSE 1 END");
  });

  it('loan amount follows the enquiry basis (Net -> net, else gross)', () => {
    expect(L.LOAN_AMOUNT_SQL).toBe("CASE WHEN e.loan_basis = 'Net' THEN COALESCE(lg.net, e.amount_requested) ELSE COALESCE(lg.gross, e.amount_requested) END");
    expect(L.LOAN_BASIS_SQL).toBe("CASE WHEN e.loan_basis = 'Net' THEN 'Net' ELSE 'Gross' END");
    expect(L.appBasisSql('x')).toBe("CASE WHEN x.loan_basis = 'Net' THEN 'Net' ELSE 'Gross' END");
    expect(L.appAmountBasisSql()).toContain("enq.loan_basis = 'Net' AND lg.gross IS NULL");
  });

  it('application net adds the drawdowns net unless net_advance already is the total', () => {
    const sql = L.appNetSql('q', 'ap');
    expect(sql).toContain('ap.net_advance IS NULL THEN NULL');
    expect(sql).toContain('ABS(ap.net_advance -');
    expect(sql).toContain("'$.drawdowns_net_total'");
    expect(sql).toContain('ap.net_advance +');
    expect(sql).toContain("q.loan_basis = 'Net'");
  });
});
