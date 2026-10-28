'use strict';
/**
 * Backup / restore for the Roles-matrix action merge (seeder 20260101000049).
 *
 *   node scripts/perm-merge-backup.js backup    full .bak (COPY_ONLY) + in-DB copy tables + JSON dump
 *   node scripts/perm-merge-backup.js status    counts per permission_key (before/after check)
 *   node scripts/perm-merge-backup.js restore   put permissions + role_permissions back from the in-DB copy
 *
 * The in-DB copy tables are bak_pm_permissions / bak_pm_role_permissions.
 * `backup` refuses to overwrite them (so a second run never destroys the good
 * pre-merge copy) unless you pass --force.
 * Restore only rewinds the DATABASE; restore the code from
 * _backups/perm-merge-20260925/code as well.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { config } = require('../config/env');

const OUT = path.join(__dirname, '..', '..', '_backups', 'perm-merge-20260925', 'db');
const log = (...a) => console.log(...a); // eslint-disable-line no-console

async function exists(name) {
  const r = await db.query(`SELECT OBJECT_ID(@p0, 'U') AS id`, ['dbo.' + name]);
  return r[0] && r[0].id != null;
}

async function cols(table) {
  const r = await db.query(
    `SELECT c.name, c.is_identity FROM sys.columns c WHERE c.object_id = OBJECT_ID(@p0) ORDER BY c.column_id`,
    ['dbo.' + table],
  );
  return r;
}

async function backup(force) {
  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const dbName = config.db.database;

  // 1) full database backup file on the SQL Server machine
  try {
    const p = await db.query(`SELECT CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS NVARCHAR(400)) AS dir`);
    const dir = (p[0] && p[0].dir) || '';
    const file = `${dir.replace(/[\\/]+$/, '')}\\${dbName}_pre_perm_merge_${stamp}.bak`;
    await db.query(`BACKUP DATABASE [${dbName.replace(/]/g, ']]')}] TO DISK = @p0 WITH COPY_ONLY, INIT, CHECKSUM`, [file]);
    log('  [ok]   full backup  ->', file);
  } catch (e) {
    log('  [skip] full .bak backup failed (needs BACKUP DATABASE right):', e.message);
    log('         the table copies + JSON below still cover everything this change touches.');
  }

  // 2) in-DB copies of the two tables the merge changes
  for (const [src, dst] of [['permissions', 'bak_pm_permissions'], ['role_permissions', 'bak_pm_role_permissions']]) {
    if (await exists(dst)) {
      if (!force) { log(`  [keep] ${dst} already exists — not overwritten (use --force to replace)`); continue; }
      await db.raw(`DROP TABLE dbo.${dst}`);
    }
    await db.raw(`SELECT * INTO dbo.${dst} FROM dbo.${src}`);
    const n = await db.query(`SELECT COUNT(*) AS n FROM dbo.${dst}`);
    log(`  [ok]   ${src} -> ${dst} (${n[0].n} rows)`);
  }

  // 3) JSON dump next to the code backup
  for (const t of ['permissions', 'role_permissions', 'modules', 'roles']) {
    const rows = await db.query(`SELECT * FROM dbo.${t}`);
    const f = path.join(OUT, `${t}_${stamp}.json`);
    fs.writeFileSync(f, JSON.stringify(rows, null, 2));
    log(`  [ok]   ${t} -> ${path.relative(process.cwd(), f)} (${rows.length} rows)`);
  }
}

async function restore() {
  if (!(await exists('bak_pm_permissions')) || !(await exists('bak_pm_role_permissions'))) {
    throw new Error('backup tables bak_pm_permissions / bak_pm_role_permissions not found');
  }
  const pc = (await cols('permissions')).map((c) => `[${c.name}]`).join(', ');
  const rc = (await cols('role_permissions')).map((c) => `[${c.name}]`).join(', ');
  await db.raw(`
    SET XACT_ABORT ON;
    BEGIN TRAN;
      DELETE FROM dbo.role_permissions;
      DELETE FROM dbo.permissions;
      SET IDENTITY_INSERT dbo.permissions ON;
      INSERT INTO dbo.permissions (${pc}) SELECT ${pc} FROM dbo.bak_pm_permissions;
      SET IDENTITY_INSERT dbo.permissions OFF;
      INSERT INTO dbo.role_permissions (${rc}) SELECT ${rc} FROM dbo.bak_pm_role_permissions;
    COMMIT;`);
  const s = await db.query(`DECLARE @m INT = (SELECT MAX(permission_id) FROM dbo.permissions);
                            DBCC CHECKIDENT ('dbo.permissions', RESEED, @m) WITH NO_INFOMSGS;
                            SELECT (SELECT COUNT(*) FROM dbo.permissions) AS p, (SELECT COUNT(*) FROM dbo.role_permissions) AS rp`);
  log(`  [ok]   restored: ${s[0].p} permissions, ${s[0].rp} role grants`);
}

async function status() {
  const r = await db.query(`
    SELECT LOWER(p.permission_key) AS action_key, COUNT(DISTINCT p.permission_id) AS permission_rows, COUNT(rp.role_id) AS role_grants
      FROM permissions p LEFT JOIN role_permissions rp ON rp.permission_id = p.permission_id
     GROUP BY LOWER(p.permission_key) ORDER BY action_key`);
  console.table(r); // eslint-disable-line no-console
}

(async () => {
  const [cmd, flag] = process.argv.slice(2);
  try {
    if (cmd === 'backup') await backup(flag === '--force');
    else if (cmd === 'restore') await restore();
    else if (cmd === 'status') await status();
    else { log('Usage: node scripts/perm-merge-backup.js backup|status|restore'); process.exitCode = 1; }
  } catch (e) {
    log('  [fail]', e.message); process.exitCode = 1;
  } finally {
    await db.close();
  }
})();
