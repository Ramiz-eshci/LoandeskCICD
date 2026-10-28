'use strict';

/**
 * Seeder: sync the Roles matrix to the current functionality (client 13-10-2026).
 *
 *  1) Underwriting Stages — renumber to the 7 steps the screen shows, 1..7
 *     (the live matrix had 1,2,3,5,6,7,8 with a gap at 4).
 *  2) Send Requirements — new permission for the "Send Requirements" button
 *     (was gated on Underwriting add). Existing Underwriting-add roles keep it.
 *  3) Portfolio — the facility detail page now has 8 tabs. The retired tabs'
 *     permission rows (Overview, Loan Structure, Schedule, Interest, Fees,
 *     Payments, Security, Valuation, Covenants, Statements, Amendments,
 *     Collections) are folded into "Facility - Transactions" (grants copied so
 *     nobody loses access) and removed from the matrix.
 *  4) Reports — the Executive / Sales / Underwriting / Portfolio / Finance /
 *     Collections / Notifications / Reject Reason / Payment Collection sub-rows
 *     are not enforced anywhere (every report screen checks only REPORTS). Their
 *     view grants are copied up to REPORTS and the dead rows removed.
 *
 * Idempotent: safe to re-run.
 */

async function ensurePerm(db, mod, act) {
  await db.query(
    `IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key=@p0 AND permission_key=@p1)
       INSERT INTO permissions (module_key, permission_key, description) VALUES (@p0, @p1, @p2);`,
    [mod, act, `${act} ${mod}`]);
}

/** Give (toMod,toAct) to every role holding (fromMod,fromAct). */
async function copyGrant(db, fromMod, fromAct, toMod, toAct) {
  await db.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT DISTINCT rp.role_id, t.permission_id
       FROM role_permissions rp
       JOIN permissions f ON f.permission_id = rp.permission_id AND f.module_key = @p0 AND f.permission_key = @p1
       JOIN permissions t ON t.module_key = @p2 AND t.permission_key = @p3
      WHERE NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = t.permission_id);`,
    [fromMod, fromAct, toMod, toAct]);
}

async function dropModule(db, code) {
  await db.query('DELETE rp FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id WHERE p.module_key = @p0;', [code]);
  await db.query('DELETE FROM permissions WHERE module_key = @p0;', [code]);
  await db.query('DELETE FROM modules WHERE module_code = @p0;', [code]);
}

const STG = 'UNDERWRITING_STAGES';
// code suffix -> [display name, sort] : the 7 steps, numbered 1..7 (no gap).
const STAGES = [
  ['VALUATION_INSTRUCTION', '1. Valuation Instruction', 1],
  ['SOLICITOR_QUOTE', '2. Solicitor Quote', 2],
  ['KYC_AML', '3. KYC / AML', 3],
  ['UNDERWRITE_FINDINGS', '4. Underwriting Review', 4],
  ['CREDIT_COMMITTEE', '5. Final Credit Committee', 5],
  ['FUNDS_COMPLETION', '6. Funds to Solicitor (Completion)', 6],
  ['COMPLETION_PORTFOLIO', '7. Completion & Move to Portfolio', 7],
];

// Portfolio facility tabs kept (visible on the detail page), with clean names + order.
const KEEP_TABS = [
  ['FACILITY_TRANSACTIONS', 'Facility - Transactions', 61],
  ['FACILITY_DOCUMENTS', 'Facility - Documents', 62],
  ['FACILITY_CONTACTS', 'Facility - Contacts', 63],
  ['FACILITY_DRAWDOWNS', 'Facility - Drawdowns', 64],
  ['FACILITY_BAD_DEBT', 'Facility - Bad Debt', 65],
  ['FACILITY_REDEMPTION', 'Facility - Redemption', 66],
  ['FACILITY_AUDIT', 'Facility - Audit', 67],
];
// Retired facility tabs -> folded into Facility - Transactions.
const DROP_TABS = [
  'FACILITY_OVERVIEW', 'FACILITY_LOAN_STRUCTURE', 'FACILITY_SCHEDULE', 'FACILITY_INTEREST',
  'FACILITY_FEES', 'FACILITY_PAYMENTS', 'FACILITY_SECURITY', 'FACILITY_VALUATION',
  'FACILITY_COVENANTS', 'FACILITY_STATEMENTS', 'FACILITY_AMENDMENTS', 'FACILITY_COLLECTIONS',
];
const TXN = 'PORTFOLIO.FACILITY_TRANSACTIONS';
// Unenforced leftover portfolio rows (in the base matrix, no screen uses them).
const DEAD_PORTFOLIO = ['PORTFOLIO.CUSTOMER_CONVERSION', 'PORTFOLIO.INTRODUCE_MAIL_CHECBOX_FOR_COMPLETED_MEETING'];

// Reports sub-rows that no screen enforces.
const DEAD_REPORTS = [
  'REPORTS.EXECUTIVE_REPORTS', 'REPORTS.SALES_REPORTS', 'REPORTS.UNDERWRITING_REPORTS',
  'REPORTS.PORTFOLIO_REPORTS', 'REPORTS.FINANCE_REPORTS', 'REPORTS.COLLECTIONS_REPORTS',
  'REPORTS.NOTIFICATIONS', 'REPORTS.REJECT_REASON', 'REPORTS.PAYMENT_COLLECTION_REPORT',
];

module.exports = {
  async run(db) {
    // ---- 1) Underwriting stages: renumber 1..7 ----
    for (const [code, name, sort] of STAGES) {
      await db.query('UPDATE modules SET module_name=@p1, sort_order=@p2 WHERE module_code=@p0;',
        [`${STG}.${code}`, name, sort]);
    }

    // ---- 2) Send Requirements permission ----
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM modules WHERE module_code='UNDERWRITING.SEND_REQUIREMENTS')
         INSERT INTO modules (module_code, module_name, parent_code, sort_order)
         SELECT 'UNDERWRITING.SEND_REQUIREMENTS', N'Send Requirements', parent_code, ISNULL(sort_order,30) + 1
           FROM modules WHERE module_code='UNDERWRITING.CASE';
       ELSE UPDATE modules SET module_name=N'Send Requirements' WHERE module_code='UNDERWRITING.SEND_REQUIREMENTS';`);
    for (const act of ['view', 'add']) await ensurePerm(db, 'UNDERWRITING.SEND_REQUIREMENTS', act);
    await copyGrant(db, 'UNDERWRITING.CASE', 'add', 'UNDERWRITING.SEND_REQUIREMENTS', 'add');
    await copyGrant(db, 'UNDERWRITING.CASE', 'view', 'UNDERWRITING.SEND_REQUIREMENTS', 'view');
    await copyGrant(db, 'UNDERWRITING.SEND_REQUIREMENTS', 'add', 'UNDERWRITING.SEND_REQUIREMENTS', 'view');

    // ---- 3) Portfolio: fold retired tabs into Transactions, then drop them ----
    for (const [code, name, sort] of KEEP_TABS) {
      await db.query('UPDATE modules SET module_name=@p1, sort_order=@p2 WHERE module_code=@p0;',
        [`PORTFOLIO.${code}`, name, sort]);
    }
    for (const act of ['view', 'add', 'edit', 'delete']) await ensurePerm(db, TXN, act);
    for (const t of DROP_TABS) {
      const from = `PORTFOLIO.${t}`;
      for (const act of ['view', 'add', 'edit', 'delete']) await copyGrant(db, from, act, TXN, act);
    }
    for (const t of DROP_TABS) await dropModule(db, `PORTFOLIO.${t}`);
    for (const d of DEAD_PORTFOLIO) await dropModule(db, d);

    // ---- 4) Reports: fold dead sub-rows up to REPORTS, then drop them ----
    await ensurePerm(db, 'REPORTS', 'view');
    for (const r of DEAD_REPORTS) await copyGrant(db, r, 'view', 'REPORTS', 'view');
    for (const r of DEAD_REPORTS) await dropModule(db, r);
  },
};
