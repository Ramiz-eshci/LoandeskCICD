'use strict';

/**
 * Seeder: Portfolio facility detail — one Roles-matrix module per tab.
 *
 *   Facility - Overview / Loan Structure / Schedule / Transactions / Interest /
 *   Security / Valuation / Statements / Amendments / Collections / Audit     view
 *   Facility - Fees         view | add (Record Fee) | edit (Edit) | delete (Delete)
 *   Facility - Payments     view | add (Record Payment)
 *   Facility - Drawdowns    view | add (release drawdown API)
 *   Facility - Covenants    view | add (Add Covenant) | edit (update covenant API)
 *   Facility - Documents    view (+download) | add (Upload) | delete (Delete)
 *   Facility - Contacts     view (contact schedule, history, notes) | add (Add Note)
 *   Facility - Redemption   view | add (Generate Statement) | edit (Redeem Facility)
 *
 * Replaces Client Monitoring, Exit Fee and Portfolio Maturity (removed), and the
 * top "Portfolio" row becomes VIEW only (menu + facility list; add/edit/delete removed).
 * Extension / Further Advance (raise request = add) and Customer Logs stay.
 *
 * First run only: grants are copied from the old rules so nobody loses access —
 *   every tab VIEW   <- roles that could open a facility before
 *                       (view on Portfolio / Client Monitoring / Customer Logs /
 *                        Extension / Further Advance / Maturity / Exit Fee)
 *   each action      <- the exact old permissions its API accepted (see @map).
 * Old rows are then deleted. Idempotent.
 */

const TABS = [
  ['OVERVIEW', 'Facility - Overview'], ['LOAN_STRUCTURE', 'Facility - Loan Structure'],
  ['SCHEDULE', 'Facility - Schedule'], ['TRANSACTIONS', 'Facility - Transactions'],
  ['INTEREST', 'Facility - Interest'], ['FEES', 'Facility - Fees'], ['PAYMENTS', 'Facility - Payments'],
  ['DRAWDOWNS', 'Facility - Drawdowns'], ['SECURITY', 'Facility - Security'],
  ['VALUATION', 'Facility - Valuation'], ['COVENANTS', 'Facility - Covenants'],
  ['DOCUMENTS', 'Facility - Documents'], ['CONTACTS', 'Facility - Contacts'],
  ['STATEMENTS', 'Facility - Statements'], ['AMENDMENTS', 'Facility - Amendments'],
  ['COLLECTIONS', 'Facility - Collections'], ['REDEMPTION', 'Facility - Redemption'],
  ['AUDIT', 'Facility - Audit'],
];
const ACTIONS = {
  FEES: ['add', 'edit', 'delete'], PAYMENTS: ['add'], DRAWDOWNS: ['add'], COVENANTS: ['add', 'edit'],
  DOCUMENTS: ['add', 'delete'], CONTACTS: ['add'], REDEMPTION: ['add', 'edit'],
};
const P = 'PORTFOLIO', MON = 'PORTFOLIO.CLIENT_MONITORING', EXIT = 'PORTFOLIO.EXIT_FEE',
  MAT = 'PORTFOLIO.PORTFOLIO_MATURITY', CL = 'PORTFOLIO.CONTACT_LOG';
// new action <- old (module, action) pairs the API accepted before
const MAP = {
  'FEES.add': [[P, 'add'], [P, 'edit'], [MON, 'add'], [MON, 'edit'], [EXIT, 'add'], [EXIT, 'edit']],
  'FEES.edit': [[P, 'edit'], [MON, 'edit'], [EXIT, 'edit']],
  'FEES.delete': [[P, 'edit'], [MON, 'edit'], [EXIT, 'edit']],
  'PAYMENTS.add': [[P, 'add'], [P, 'edit'], [MON, 'add'], [MON, 'edit']],
  'DRAWDOWNS.add': [[P, 'add'], [P, 'edit'], [MON, 'add'], [MON, 'edit']],
  'COVENANTS.add': [[P, 'add'], [P, 'edit'], [MON, 'add'], [MON, 'edit']],
  'COVENANTS.edit': [[P, 'edit'], [MON, 'edit']],
  'DOCUMENTS.add': [[P, 'add'], [P, 'edit'], [MON, 'add'], [MON, 'edit']],
  'DOCUMENTS.delete': [[P, 'delete'], [MON, 'delete'], [MON, 'edit']],
  'CONTACTS.add': [[P, 'add'], [P, 'edit'], [MON, 'add'], [MON, 'edit'], [CL, 'add']],
  'REDEMPTION.add': [[P, 'add'], [P, 'edit'], [MAT, 'add'], [MAT, 'edit']],
  'REDEMPTION.edit': [[P, 'edit'], [MAT, 'edit']],
};
const OPENERS = [P, MON, CL, 'PORTFOLIO.EXTENSION', 'PORTFOLIO.FURTHER_ADVANCE', MAT, EXIT];

const q = (v) => `N'${String(v).replace(/'/g, "''")}'`;

module.exports = {
  async run(db) {
    const modRows = TABS.map(([k, n], i) => `(${q('PORTFOLIO.FACILITY_' + k)}, ${q(n)}, ${200 + i})`).join(',\n  ');
    const permRows = [];
    for (const [k] of TABS) {
      permRows.push(`(${q('PORTFOLIO.FACILITY_' + k)}, 'view')`);
      for (const a of ACTIONS[k] || []) permRows.push(`(${q('PORTFOLIO.FACILITY_' + k)}, ${q(a)})`);
    }
    const mapRows = [];
    for (const [k] of TABS) for (const o of OPENERS) mapRows.push(`(${q('PORTFOLIO.FACILITY_' + k)}, 'view', ${q(o)}, 'view')`);
    for (const [key, olds] of Object.entries(MAP)) {
      const [tab, act] = key.split('.');
      for (const [om, oa] of olds) mapRows.push(`(${q('PORTFOLIO.FACILITY_' + tab)}, ${q(act)}, ${q(om)}, ${q(oa)})`);
    }
    // Extension / Further Advance request used to be allowed by Portfolio > ADD too
    mapRows.push(`('PORTFOLIO.EXTENSION', 'add', 'PORTFOLIO', 'add')`, `('PORTFOLIO.FURTHER_ADVANCE', 'add', 'PORTFOLIO', 'add')`);

    const rows = await db.raw(`
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @first BIT = CASE WHEN EXISTS (SELECT 1 FROM modules WHERE module_code = 'PORTFOLIO.FACILITY_OVERVIEW') THEN 0 ELSE 1 END;

-- 1) modules (after the existing Portfolio screens)
DECLARE @mods TABLE (code NVARCHAR(100), name NVARCHAR(150), sort INT);
INSERT INTO @mods VALUES
  ${modRows};
INSERT INTO modules (module_code, module_name, parent_code, sort_order)
SELECT m.code, m.name, 'PORTFOLIO', m.sort FROM @mods m
 WHERE NOT EXISTS (SELECT 1 FROM modules x WHERE x.module_code = m.code);

-- 2) permission rows
DECLARE @perms TABLE (module_key NVARCHAR(100), permission_key NVARCHAR(50));
INSERT INTO @perms VALUES
  ${permRows.join(',\n  ')};
INSERT INTO permissions (module_key, permission_key, description)
SELECT p.module_key, p.permission_key, p.permission_key + ' ' + p.module_key FROM @perms p
 WHERE NOT EXISTS (SELECT 1 FROM permissions x WHERE x.module_key = p.module_key AND LOWER(x.permission_key) = p.permission_key);

-- 3) first run: copy grants from the old rules
DECLARE @granted INT = 0;
IF @first = 1
BEGIN
  DECLARE @map TABLE (new_mod NVARCHAR(100), new_act NVARCHAR(50), old_mod NVARCHAR(100), old_act NVARCHAR(50));
  INSERT INTO @map VALUES
    ${mapRows.join(',\n    ')};
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT DISTINCT rp.role_id, np.permission_id
    FROM @map m
    JOIN permissions op ON op.module_key = m.old_mod AND LOWER(op.permission_key) = m.old_act
    JOIN role_permissions rp ON rp.permission_id = op.permission_id
    JOIN permissions np ON np.module_key = m.new_mod AND LOWER(np.permission_key) = m.new_act
   WHERE NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = np.permission_id);
  SET @granted = @@ROWCOUNT;
END

-- 4) remove the replaced modules + the Portfolio umbrella actions
DECLARE @ids TABLE (permission_id INT PRIMARY KEY);
INSERT INTO @ids SELECT permission_id FROM permissions
 WHERE module_key IN ('PORTFOLIO.CLIENT_MONITORING', 'PORTFOLIO.EXIT_FEE', 'PORTFOLIO.PORTFOLIO_MATURITY')
    OR (module_key = 'PORTFOLIO' AND LOWER(permission_key) IN ('add', 'edit', 'delete', 'approve', 'reject', 'export'));
DELETE rp FROM role_permissions rp JOIN @ids i ON i.permission_id = rp.permission_id;
DECLARE @revoked INT = @@ROWCOUNT;
DELETE p FROM permissions p JOIN @ids i ON i.permission_id = p.permission_id;
DECLARE @removed INT = @@ROWCOUNT;
DELETE FROM modules WHERE module_code IN ('PORTFOLIO.CLIENT_MONITORING', 'PORTFOLIO.EXIT_FEE', 'PORTFOLIO.PORTFOLIO_MATURITY');

COMMIT;
SELECT @granted AS granted, @revoked AS revoked, @removed AS removed;`);
    const r = rows[0] || {};
    // eslint-disable-next-line no-console
    console.log(`    portfolio facility tabs: +${r.granted || 0} grants copied, -${r.revoked || 0} old grants, -${r.removed || 0} old permission rows`);
  },
};
