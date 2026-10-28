'use strict';

/**
 * Seeder: rename + re-order the MASTERS permission modules.
 *
 * The permission matrix rows (Roles > Add/Edit) come from the `modules` table
 * (module_name = label, sort_order = row order). The base seeder
 * 20260101000004_modules_matrix.js inserts these with "IF NOT EXISTS", so it
 * never updates an already-seeded database. This seeder UPDATEs the existing
 * MASTERS child rows to:
 *   - drop the trailing "Master" wording (Branch Master -> Branch, ...),
 *     applying the same renames used on the master screens (Application Source
 *     -> Source Type, etc.); "Solicitor / Valuer" stays combined.
 *   - sort every MASTERS child alphabetically (A-Z) via sort_order.
 *
 * MASTERS.COMMON_MASTERS is intentionally left alone (already retired by
 * 20260101000041_retire_common_masters.js, so it no longer appears).
 *
 * Safe + idempotent: re-running sets the same values. Module codes and the
 * permission grants are untouched, so no role loses any access.
 */

module.exports = {
  async run(db) {
    const N_ = (s) => s; // labels passed as NVARCHAR params
    // [module_code, module_name, sort_order] — sort_order is A-Z by name
    const rows = [
      ['MASTERS.APPLICANT_TYPE_MASTER', N_('Applicant Type'), 101],
      ['MASTERS.APPLICATION_STATUS_MASTER', N_('Application Status'), 102],
      ['MASTERS.APPROVAL_CONDITION_MASTER', N_('Approval Condition'), 103],
      ['MASTERS.BRANCH_MASTER', N_('Branch'), 104],
      ['MASTERS.BROKER_MASTER', N_('Broker'), 105],
      ['MASTERS.CONTACT_METHOD_MASTER', N_('Contact Method'), 106],
      ['MASTERS.CONTACT_OUTCOME_MASTER', N_('Contact Outcome'), 107],
      ['MASTERS.DOCUMENT_TYPE_MASTER', N_('Document Type'), 108],
      ['MASTERS.ENQUIRY_STATUS_MASTER', N_('Enquiry Status'), 109],
      ['MASTERS.FOLLOWUP_STATUS_MASTER', N_('Followup Status'), 110],
      ['MASTERS.LEAD_SOURCE_MASTER', N_('Lead Source'), 111],
      ['MASTERS.LOAN_PURPOSE_MASTER', N_('Loan Purpose'), 112],
      ['MASTERS.PRODUCT_MASTER', N_('Product'), 114],
      ['MASTERS.PRODUCT_TYPE_MASTER', N_('Product Type'), 115],
      ['MASTERS.REJECTION_REASON_MASTER', N_('Rejection Reason'), 116],
      ['MASTERS.REPAYMENT_FREQUENCY_MASTER', N_('Repayment Frequency'), 117],
      ['MASTERS.ROI_MASTER', N_('ROI Configuration'), 118],
      ['MASTERS.ROLES_MASTER', N_('Roles'), 100],
      ['MASTERS.SOLICITOR_VALUER_MASTER', N_('Solicitor / Valuer'), 120],
      ['MASTERS.APPLICATION_SOURCE_MASTER', N_('Source Type'), 121],
      ['MASTERS.USER_MASTER', N_('Users'), 99],
      ['MASTERS.VALUATION_TYPE_MASTER', N_('Valuation Type'), 123]
    ];
    for (const [code, name, sort] of rows) {
      await db.query(
        `UPDATE modules SET module_name = @p1, sort_order = @p2 WHERE module_code = @p0`,
        [code, name, sort],
      );
    }
  },
};
