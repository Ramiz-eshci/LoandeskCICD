'use strict';

/**
 * Enquiry "Loan Amount" (client 15-10-2026) - shared by the enquiry list, the reports
 * Enquiries module and anywhere else an enquiry amount is listed.
 *
 * LATEST_GROSS_APPLY is an OUTER APPLY (needs the enquiries table aliased `e`) exposing
 * `lg.gross`: the gross of the accepted / sent offer, else the legacy offer_amount, else
 * the latest indicative actually SENT. NULL until one of those exists.
 * Loan amount / basis follow the basis typed on the enquiry - see LOAN_AMOUNT_SQL.
 */
/** Same OUTER APPLY for any alias of the enquiries table (applications join it as `enq`).
 *  Exposes lg.gross AND lg.net (client 15-10-2026): the net of the same offer / sent
 *  indicative - total net incl. drawdowns when there are drawdowns, else day-1 net
 *  (the figure the Send Indicatives popup shows as "Net Amount"). */
const latestGrossApply = (e = 'e') => `OUTER APPLY (SELECT
    COALESCE(
      (SELECT TOP 1 TRY_CONVERT(DECIMAL(18,2), JSON_VALUE(eo.offer_json, '$.gross_loan_amount'))
         FROM enquiry_offers eo
        WHERE eo.enquiry_id = ${e}.enquiry_id AND eo.flag_deleted = 0 AND eo.status IN ('Accepted','Sent')
        ORDER BY CASE WHEN eo.status = 'Accepted' THEN 0 ELSE 1 END, eo.version_no DESC),
      ${e}.offer_amount,
      -- only an indicative actually SENT to the client counts (a draft is not a quote)
      (SELECT TOP 1 TRY_CONVERT(DECIMAL(18,2), JSON_VALUE(ei.calc_json, '$.total_gross_loan_incl_dds'))
         FROM enquiry_indicatives ei
        WHERE ei.enquiry_id = ${e}.enquiry_id AND ei.flag_deleted = 0 AND ei.sent_at IS NOT NULL
        ORDER BY ei.version_no DESC)
    ) AS gross,
    COALESCE(
      (SELECT TOP 1 COALESCE(TRY_CONVERT(DECIMAL(18,2), JSON_VALUE(eo.offer_json, '$.net_release_incl_drawdowns')),
                             TRY_CONVERT(DECIMAL(18,2), JSON_VALUE(eo.offer_json, '$.net_release_day1')))
         FROM enquiry_offers eo
        WHERE eo.enquiry_id = ${e}.enquiry_id AND eo.flag_deleted = 0 AND eo.status IN ('Accepted','Sent')
        ORDER BY CASE WHEN eo.status = 'Accepted' THEN 0 ELSE 1 END, eo.version_no DESC),
      (SELECT TOP 1 COALESCE(TRY_CONVERT(DECIMAL(18,2), JSON_VALUE(ei.calc_json, '$.total_net_incl_drawdowns')),
                             TRY_CONVERT(DECIMAL(18,2), JSON_VALUE(ei.calc_json, '$.day1_net')))
         FROM enquiry_indicatives ei
        WHERE ei.enquiry_id = ${e}.enquiry_id AND ei.flag_deleted = 0 AND ei.sent_at IS NOT NULL
        ORDER BY ei.version_no DESC)
    ) AS net) lg`;
const LATEST_GROSS_APPLY = latestGrossApply('e');

/**
 * Loan Amount column (client 15-10-2026, revised): it follows the basis chosen on the
 * enquiry for the WHOLE journey. Net enquiry -> "NET <actual net>" (the typed net until
 * an indicative is sent, then the indicative / offer net); Gross enquiry -> "GROSS
 * <actual gross>". Previously a Net enquiry flipped to GROSS once terms existed.
 */
const LOAN_AMOUNT_SQL = "CASE WHEN e.loan_basis = 'Net' THEN COALESCE(lg.net, e.amount_requested) ELSE COALESCE(lg.gross, e.amount_requested) END";
const LOAN_BASIS_SQL = "CASE WHEN e.loan_basis = 'Net' THEN 'Net' ELSE 'Gross' END";
/** Actual net of an enquiry: offer / sent-indicative net, else the typed Net amount. */
const ENQ_NET_SQL = "COALESCE(lg.net, CASE WHEN e.loan_basis = 'Net' THEN e.amount_requested END)";

/** Basis CHOSEN on the source enquiry ('Net' | 'Gross') - drives which figure an
 *  application / underwriting case headlines. Needs the enquiry joined as `enqAlias`. */
const appBasisSql = (enqAlias = 'enq') => `CASE WHEN ${enqAlias}.loan_basis = 'Net' THEN 'Net' ELSE 'Gross' END`;
/** Whether applications.amount_requested itself is still a NET figure (Net enquiry and no
 *  offer / sent-indicative gross yet) - labels that field correctly. */
const appAmountBasisSql = (enqAlias = 'enq') => `CASE WHEN ${enqAlias}.loan_basis = 'Net' AND lg.gross IS NULL THEN 'Net' ELSE 'Gross' END`;
/** Actual net of an application: net advance on the application (offer day-1 net, or the
 *  underwriter's edit), else the enquiry's offer / indicative net, else the amount when it
 *  is still a net figure. Needs `lg` applied for `enqAlias` and applications as `appAlias`. */
/* Client 20-10-2026: the headline Net Amount is the TOTAL net incl. drawdowns everywhere (same
 * as the enquiry header and the Send Indicatives "Net Amount" box). net_advance is the day-1 net,
 * so the agreed terms' drawdowns net is added on top. Rows written by the old "Edit loan" (which
 * stored the total in net_advance) already equal the total and are shown as they are. */
const appNetSql = (enqAlias = 'enq', appAlias = 'a') => {
  const jv = (k) => `CASE WHEN ISJSON(${appAlias}.agreed_terms) = 1 THEN TRY_CONVERT(DECIMAL(18,2), JSON_VALUE(${appAlias}.agreed_terms, '$.${k}')) END`;
  const incl = jv('net_release_incl_drawdowns');
  const day1 = jv('net_release_day1');
  const ddNet = `COALESCE(${jv('drawdowns_net_total')}, ${incl} - ${day1}, 0)`;
  return `COALESCE(
    CASE
      WHEN ${appAlias}.net_advance IS NULL THEN NULL
      WHEN ${incl} IS NOT NULL AND ABS(${appAlias}.net_advance - ${incl}) < 0.01 THEN ${appAlias}.net_advance
      ELSE ${appAlias}.net_advance + ${ddNet}
    END,
    lg.net,
    CASE WHEN ${enqAlias}.loan_basis = 'Net' AND lg.gross IS NULL THEN ${appAlias}.amount_requested END)`;
};

module.exports = {
  LATEST_GROSS_APPLY, LOAN_AMOUNT_SQL, LOAN_BASIS_SQL, ENQ_NET_SQL,
  latestGrossApply, appBasisSql, appAmountBasisSql, appNetSql,
};
