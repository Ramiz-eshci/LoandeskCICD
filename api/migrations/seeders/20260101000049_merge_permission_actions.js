'use strict';

/**
 * Seeder: compress the Roles matrix to 7 actions
 *   View, Add, Edit, Delete, Approve, Reject, Export.
 *
 * Merge map (per module — a grant only moves inside its own module):
 *   assign, submit, convert, query, upload, accept, act, respond  -> add
 *   decide                                                        -> approve
 *   convert on ENQUIRIES.ENQUIRY_LIST (Convert to Application)
 *     -> ENQUIRIES.SUBMIT_TO_APPLICATION add  (Enquiries List Add = New Enquiry only)
 *   (SUBMIT_TO_APPLICATION edit is folded into its add by seeder 050)
 *
 * Steps (one transaction, XACT_ABORT):
 *   1) create the target permission row (module, add|approve) where missing
 *   2) every role that held ANY old key on a module gets the target key on
 *      that module  -> nobody loses access (union)
 *   3) delete the old role grants + old permission rows
 *
 * `upload` was a HIDDEN, unenforced action everywhere except
 * CUSTOMERS.DOCUMENT, so only that module's upload grants are carried to add;
 * hidden upload rows on other modules are just removed (no new access).
 *
 * Code (routes / controllers / Angular) now checks add / approve instead of the
 * old keys — see _backups/perm-merge-20260925 for the pre-change copies.
 *
 * Idempotent; runs last in `npm run seed`, so re-seeding re-applies the merge.
 * Take a backup first:  node scripts/perm-merge-backup.js backup
 */

const MERGE_SQL = `
SET XACT_ABORT ON;
BEGIN TRAN;

DECLARE @map TABLE (old_key NVARCHAR(50) PRIMARY KEY, new_key NVARCHAR(50) NOT NULL);
INSERT INTO @map (old_key, new_key) VALUES
  ('assign','add'), ('submit','add'), ('convert','add'), ('query','add'), ('upload','add'),
  ('accept','add'), ('act','add'), ('respond','add'), ('decide','approve');

-- old rows that carry access over (hidden upload rows outside CUSTOMERS.DOCUMENT do not)
DECLARE @src TABLE (permission_id INT PRIMARY KEY, module_key NVARCHAR(100), new_key NVARCHAR(50));
INSERT INTO @src (permission_id, module_key, new_key)
SELECT p.permission_id,
       CASE WHEN m.old_key = 'convert' AND p.module_key = 'ENQUIRIES.ENQUIRY_LIST' THEN 'ENQUIRIES.SUBMIT_TO_APPLICATION' ELSE p.module_key END,
       m.new_key
  FROM permissions p
  JOIN @map m ON LOWER(p.permission_key) = m.old_key
 WHERE m.old_key <> 'upload' OR p.module_key = 'CUSTOMERS.DOCUMENT';

-- 1) target permission rows
INSERT INTO permissions (module_key, permission_key, description)
SELECT DISTINCT s.module_key, s.new_key, s.new_key + ' ' + s.module_key
  FROM @src s
 WHERE NOT EXISTS (SELECT 1 FROM permissions t
                    WHERE t.module_key = s.module_key AND LOWER(t.permission_key) = s.new_key);

-- 2) carry grants over (union, no duplicates)
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, t.permission_id
  FROM role_permissions rp
  JOIN @src s ON s.permission_id = rp.permission_id
  JOIN permissions t ON t.module_key = s.module_key AND LOWER(t.permission_key) = s.new_key
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions x
                    WHERE x.role_id = rp.role_id AND x.permission_id = t.permission_id);
DECLARE @granted INT = @@ROWCOUNT;

-- 3) remove old grants + old permission rows
DELETE rp FROM role_permissions rp
  JOIN permissions p ON p.permission_id = rp.permission_id
  JOIN @map m ON LOWER(p.permission_key) = m.old_key;
DECLARE @revoked INT = @@ROWCOUNT;

DELETE p FROM permissions p
  JOIN @map m ON LOWER(p.permission_key) = m.old_key;
DECLARE @removed INT = @@ROWCOUNT;

COMMIT;

SELECT @granted AS grants_added, @revoked AS old_grants_removed, @removed AS old_permissions_removed;
`;

module.exports = {
  MERGE_SQL,
  async run(db) {
    const rows = await db.raw(MERGE_SQL);
    const r = rows[0] || {};
    // eslint-disable-next-line no-console
    console.log(`    merge: +${r.grants_added || 0} add/approve grants, -${r.old_grants_removed || 0} old grants, -${r.old_permissions_removed || 0} old permission rows`);
  },
};
