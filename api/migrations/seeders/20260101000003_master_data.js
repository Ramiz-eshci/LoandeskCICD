'use strict';

/**
 * Seeder: permissions + role_permissions + master data + sample role users
 *          + user_roles (incl. a multi-role user for the "Select Your Workspace" screen).
 * Idempotent (guarded inserts). DEV passwords only (Doc-02 Section 36).
 */

const DEV_HASH = '$2b$10$253jqiDS9XE8SUu.SoMFL.p2rMmd1KYlJALTBrk9dyCARJt4BSBJO'; // Password@123

// NOTE: 'UNDERWRITING' removed — underwriting is gated on UNDERWRITING.CASE only
// (seeder 20260101000045 drops the old coarse UNDERWRITING permission rows).
const MODULES = [
  'DASHBOARD','ENQUIRY','APPLICATION','DOCUMENT','KYC','AML','CREDIT',
  'LEGAL','LOAN','PORTFOLIO','COLLECTION','REPORT','AUDIT','MASTER','USER','ROLE',
  'BRANCH','PRODUCT','NOTIFICATION',
];
const ACTIONS = ['view','add','edit','delete','assign','approve','reject','submit','upload','download','export'];

// role_name -> [ [module, [actions]] ]  (System Administrator bypasses via is_super_admin)
const ROLE_GRANTS = {
  'Sales / BDM': [['DASHBOARD',['view']],['ENQUIRY',['view','add','edit','assign','submit']],['APPLICATION',['view','add','edit','submit','upload']],['DOCUMENT',['view','add','upload','download']]],
  'Underwriter': [['DASHBOARD',['view']],['APPLICATION',['view']],['DOCUMENT',['view','download']]],
  'Credit Manager': [['DASHBOARD',['view']],['APPLICATION',['view']],['CREDIT',['view','approve','reject']]],
  'Legal': [['DASHBOARD',['view']],['APPLICATION',['view']],['LEGAL',['view','edit']]],
  'Solicitor': [['DASHBOARD',['view']],['LEGAL',['view','edit']],['DOCUMENT',['view','upload','download']]],
  'Portfolio': [['DASHBOARD',['view']],['PORTFOLIO',['view','edit','export']],['LOAN',['view','edit']]],
  'Branch Manager': [['DASHBOARD',['view']],['ENQUIRY',['view','assign']],['APPLICATION',['view','approve']],['REPORT',['view','export']]],
  'Collection Officer': [['DASHBOARD',['view']],['COLLECTION',['view','edit']],['LOAN',['view']]],
  'Auditor / Compliance': [['DASHBOARD',['view']],['AUDIT',['view','export']],['REPORT',['view','export']],['APPLICATION',['view']],['LOAN',['view']]],
};

// sample users: email -> [full_name, primary_role]
const SAMPLE_USERS = [
  ['bdm@loandesk.local','Sample BDM','Sales / BDM'],
  ['underwriter@loandesk.local','Sample Underwriter','Underwriter'],
  ['credit@loandesk.local','Sample Credit Manager','Credit Manager'],
  ['solicitor@loandesk.local','Sample Solicitor','Solicitor'],
  ['portfolio@loandesk.local','Sample Portfolio','Portfolio'],
  ['collections@loandesk.local','Sample Collection Officer','Collection Officer'],
  ['auditor@loandesk.local','Sample Auditor','Auditor / Compliance'],
];

// a user with MULTIPLE roles -> exercises the "Select Your Workspace" screen
const MULTI_ROLE_USER = ['manager@loandesk.local','Sample Branch Manager', ['Branch Manager','Credit Manager','Underwriter']];

async function insertMaster(db, table, codeCol, rows) {
  for (const row of rows) {
    const cols = Object.keys(row);
    const params = Object.values(row);
    const ph = cols.map((_, i) => '@p' + i).join(', ');
    const codeIdx = cols.length; // guard param placed after the value params
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM ${table} WHERE ${codeCol}=@p${codeIdx})
         INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph});`,
      [...params, row[codeCol]]
    );
  }
}

module.exports = {
  async run(db) {
    /* ---------- permissions ---------- */
    for (const m of MODULES) {
      for (const a of ACTIONS) {
        await db.query(
          `IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_key=@p0 AND permission_key=@p1)
             INSERT INTO permissions (module_key, permission_key, description) VALUES (@p0,@p1,@p2);`,
          [m, a, `${a} ${m}`]
        );
      }
    }

    /* ---------- role_permissions: System Administrator = ALL ---------- */
    await db.raw(`
      DECLARE @admin INT = (SELECT role_id FROM roles WHERE role_name='System Administrator');
      IF @admin IS NOT NULL
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT @admin, p.permission_id FROM permissions p
      WHERE NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id=@admin AND rp.permission_id=p.permission_id);`);

    /* ---------- role_permissions: scoped roles ---------- */
    for (const [roleName, grants] of Object.entries(ROLE_GRANTS)) {
      for (const [mod, acts] of grants) {
        for (const act of acts) {
          await db.query(
            `DECLARE @r INT = (SELECT role_id FROM roles WHERE role_name=@p0);
             DECLARE @p INT = (SELECT permission_id FROM permissions WHERE module_key=@p1 AND permission_key=@p2);
             IF @r IS NOT NULL AND @p IS NOT NULL AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id=@r AND permission_id=@p)
               INSERT INTO role_permissions (role_id, permission_id) VALUES (@r,@p);`,
            [roleName, mod, act]
          );
        }
      }
    }

    /* ---------- master data ---------- */
    await insertMaster(db, 'branches', 'branch_code', [
      { branch_code: 'HO',  branch_name: 'Head Office' },
      { branch_code: 'BR1', branch_name: 'London Branch' },
      { branch_code: 'BR2', branch_name: 'Manchester Branch' },
    ]);
    await insertMaster(db, 'product_types', 'code', [
      { code: 'MTG', name: 'Mortgage' },
      { code: 'BRDG', name: 'Bridging' },
      { code: 'DEV', name: 'Development Finance' },
      { code: 'BTL', name: 'Buy to Let' },
    ]);
    await insertMaster(db, 'products', 'code', [
      // 29-09-2026: bridging product set (old RES-MTG / BRDG-STD / DEV-FIN /
      // BTL-STD retired by 20260101000059_product_bridge_values.js)
      { code: 'BRIDGE-1ST', name: '1st Charge Bridge' },
      { code: 'BRIDGE-2ND', name: '2nd Charge Bridge' },
      { code: 'BRIDGE-1ST-2ND', name: '1st and 2nd Charge Bridge' },
      { code: 'BRIDGE-MULTI', name: 'Multi Bridge' },
    ]);
    await insertMaster(db, 'loan_purposes', 'code', [
      { code: 'PURCHASE', name: 'Purchase' },
      { code: 'REFINANCE', name: 'Refinance' },
      { code: 'RENOVATION', name: 'Renovation' },
      { code: 'BUSINESS', name: 'Business' },
      { code: 'REBRIDGE', name: 'Rebridge' },
      { code: 'DEV_EXIT', name: 'Development Exit' },
    ]);
    await insertMaster(db, 'applicant_types', 'code', [
      { code: 'INDIVIDUAL', name: 'Individual' },
      { code: 'COMPANY', name: 'Company' },
      { code: 'TRUST', name: 'Trust' },
      { code: 'PARTNERSHIP', name: 'Partnership' },
    ]);
    await insertMaster(db, 'enquiry_statuses', 'code', [
      { code: 'NEW', name: 'New', sort_order: 1 },
      { code: 'ASSIGNED', name: 'Assigned', sort_order: 2 },
      { code: 'IN_PROGRESS', name: 'In Progress', sort_order: 3 },
      { code: 'CONVERTED', name: 'Converted', sort_order: 4, is_terminal: 1 },
      { code: 'CLOSED', name: 'Closed', sort_order: 5, is_terminal: 1 },
    ]);
    await insertMaster(db, 'application_statuses', 'code', [
      { code: 'DRAFT', name: 'Awaiting Initial Review', sort_order: 1 }, // client 15-10-2026: was "Draft"
      { code: 'SUBMITTED', name: 'Submitted', sort_order: 2 },
      { code: 'UNDERWRITING', name: 'Underwriting', sort_order: 3 },
      { code: 'CREDIT_REVIEW', name: 'Credit Review', sort_order: 4 },
      { code: 'LEGAL', name: 'Legal', sort_order: 5 },
      { code: 'APPROVED', name: 'Approved', sort_order: 6 },
      { code: 'COMPLETED', name: 'Completed', sort_order: 7, is_terminal: 1 },
      { code: 'REJECTED', name: 'Rejected', sort_order: 8, is_terminal: 1 },
      { code: 'WITHDRAWN', name: 'Withdrawn', sort_order: 9, is_terminal: 1 },
    ]);
    await insertMaster(db, 'document_types', 'code', [
      { code: 'ID', name: 'Proof of Identity', category: 'KYC' },
      { code: 'ADDRESS', name: 'Proof of Address', category: 'KYC' },
      { code: 'INCOME', name: 'Proof of Income', category: 'Financial' },
      { code: 'BANK', name: 'Bank Statement', category: 'Financial' },
      { code: 'VALUATION', name: 'Valuation Report', category: 'Security' },
    ]);
    await insertMaster(db, 'valuation_types', 'code', [
      { code: 'FULL', name: 'Full Valuation' },
      { code: 'DESKTOP', name: 'Desktop Valuation' },
      { code: 'DRIVEBY', name: 'Drive-by Valuation' },
    ]);
    await insertMaster(db, 'repayment_frequencies', 'code', [
      { code: 'MONTHLY', name: 'Monthly', payments_per_year: 12 },
      { code: 'QUARTERLY', name: 'Quarterly', payments_per_year: 4 },
      { code: 'WEEKLY', name: 'Weekly', payments_per_year: 52 },
    ]);
    // loan_terms seed removed 28-09-2026: Loan Term master retired (not used anywhere).
    await insertMaster(db, 'application_sources', 'code', [
      { code: 'WEBSITE', name: 'Website' },
      { code: 'BROKER', name: 'Broker' },
      { code: 'MANUAL', name: 'Manual' },
      { code: 'REFERRAL', name: 'Referral' },
    ]);
    await insertMaster(db, 'rejection_reasons', 'code', [
      { code: 'AFFORDABILITY', name: 'Affordability not met' },
      { code: 'CREDIT', name: 'Adverse credit history' },
      { code: 'LTV', name: 'LTV too high' },
      { code: 'DOCS', name: 'Insufficient documentation' },
    ]);
    await insertMaster(db, 'approval_conditions', 'code', [
      { code: 'VALUATION_OK', name: 'Satisfactory valuation received' },
      { code: 'PROOF_INCOME', name: 'Verified proof of income' },
      { code: 'LEGAL_CLEAR', name: 'Legal checks cleared' },
    ]);
    await insertMaster(db, 'brokers', 'code', [
      { code: 'BRK1', name: 'Alpha Brokers', company: 'Alpha Ltd', commission_pct: 1.50 },
      { code: 'BRK2', name: 'Beta Finance', company: 'Beta LLP', commission_pct: 1.25 },
    ]);
    await insertMaster(db, 'solicitors', 'code', [
      { code: 'SOL1', name: 'Smith & Co', firm: 'Smith & Co Solicitors' },
      { code: 'SOL2', name: 'Jones Legal', firm: 'Jones Legal LLP' },
    ]);
    await insertMaster(db, 'interest_rates', 'name', [
      { name: 'Standard Fixed 5%', rate_pct: 5.000, rate_type: 'Fixed' },
      { name: 'Bridging 9%', rate_pct: 9.000, rate_type: 'Fixed' },
      { name: 'BTL Variable 6.5%', rate_pct: 6.500, rate_type: 'Variable' },
    ]);

    /* ---------- sample role users + user_roles ---------- */
    for (const [email, name, role] of SAMPLE_USERS) {
      await db.query(
        `DECLARE @r INT = (SELECT role_id FROM roles WHERE role_name=@p3);
         IF NOT EXISTS (SELECT 1 FROM users WHERE email=@p0)
           INSERT INTO users (email, password_hash, full_name, role_id) VALUES (@p0,@p1,@p2,@r);`,
        [email, DEV_HASH, name, role]
      );
      await db.query(
        `DECLARE @u INT = (SELECT user_id FROM users WHERE email=@p0);
         DECLARE @r INT = (SELECT role_id FROM roles WHERE role_name=@p1);
         IF @u IS NOT NULL AND @r IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id=@u AND role_id=@r)
           INSERT INTO user_roles (user_id, role_id, is_primary) VALUES (@u,@r,1);`,
        [email, role]
      );
    }

    // multi-role user
    const [mEmail, mName, mRoles] = MULTI_ROLE_USER;
    await db.query(
      `DECLARE @r INT = (SELECT role_id FROM roles WHERE role_name=@p3);
       IF NOT EXISTS (SELECT 1 FROM users WHERE email=@p0)
         INSERT INTO users (email, password_hash, full_name, role_id) VALUES (@p0,@p1,@p2,@r);`,
      [mEmail, DEV_HASH, mName, mRoles[0]]
    );
    for (let i = 0; i < mRoles.length; i++) {
      await db.query(
        `DECLARE @u INT = (SELECT user_id FROM users WHERE email=@p0);
         DECLARE @r INT = (SELECT role_id FROM roles WHERE role_name=@p1);
         IF @u IS NOT NULL AND @r IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id=@u AND role_id=@r)
           INSERT INTO user_roles (user_id, role_id, is_primary) VALUES (@u,@r,@p2);`,
        [mEmail, mRoles[i], i === 0 ? 1 : 0]
      );
    }
  },
};
