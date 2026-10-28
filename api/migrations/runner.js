'use strict';

/**
 * Lightweight migration + seeder runner for SQL Server (Laravel/Alembic style).
 *
 * - Migrations live in migrations/schema as `YYYYMMDDHHMMSS_name.js`, each exporting
 *   `async up(db)` and `async down(db)`.
 * - Applied migrations are tracked in the `schema_migrations` table, grouped in
 *   BATCHES so `rollback` reverses the whole last batch (like Laravel).
 * - Seeders live in migrations/seeders as `*.js` exporting `async run(db)`.
 *
 * `db` passed to up/down/run is config/database.js (query, queryNamed, raw, sql).
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');

const MIGRATIONS_DIR = path.join(__dirname, 'schema');
const SEEDERS_DIR = path.join(__dirname, 'seeders');

function log(...a) {
  // eslint-disable-next-line no-console
  console.log(...a);
}

async function ensureTable() {
  await db.raw(`
    IF OBJECT_ID('dbo.schema_migrations','U') IS NULL
    CREATE TABLE dbo.schema_migrations (
      id         INT IDENTITY(1,1) PRIMARY KEY,
      name       NVARCHAR(255) NOT NULL UNIQUE,
      batch      INT NOT NULL,
      applied_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );`);
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .sort();
}

async function appliedNames() {
  const rows = await db.raw('SELECT name FROM schema_migrations ORDER BY name');
  return rows.map((r) => r.name);
}

async function currentBatch() {
  const rows = await db.raw('SELECT ISNULL(MAX(batch),0) AS b FROM schema_migrations');
  return rows[0].b;
}

// ---- commands ----

async function migrate() {
  await ensureTable();
  const applied = new Set(await appliedNames());
  const pending = listFiles(MIGRATIONS_DIR).filter((f) => !applied.has(f));
  if (!pending.length) {
    log('Nothing to migrate. Database up to date.');
    return;
  }
  const batch = (await currentBatch()) + 1;
  for (const file of pending) {
    const mig = require(path.join(MIGRATIONS_DIR, file));
    log(`  migrating: ${file}`);
    await mig.up(db);
    await db.query('INSERT INTO schema_migrations (name, batch) VALUES (@p0, @p1)', [file, batch]);
    log(`  migrated:  ${file}`);
  }
  log(`Done. Batch ${batch}, ${pending.length} migration(s).`);
}

async function rollback() {
  await ensureTable();
  const batch = await currentBatch();
  if (!batch) {
    log('Nothing to rollback.');
    return;
  }
  const rows = await db.raw(
    'SELECT name FROM schema_migrations WHERE batch = @p0 ORDER BY name DESC',
    [batch]
  );
  for (const { name } of rows) {
    const mig = require(path.join(MIGRATIONS_DIR, name));
    log(`  rolling back: ${name}`);
    if (typeof mig.down === 'function') await mig.down(db);
    await db.query('DELETE FROM schema_migrations WHERE name = @p0', [name]);
    log(`  rolled back:  ${name}`);
  }
  log(`Done. Rolled back batch ${batch}, ${rows.length} migration(s).`);
}

async function status() {
  await ensureTable();
  const applied = new Set(await appliedNames());
  const files = listFiles(MIGRATIONS_DIR);
  log('Migration status:');
  if (!files.length) log('  (no migration files)');
  for (const f of files) log(`  [${applied.has(f) ? 'X' : ' '}] ${f}`);
  const pending = files.filter((f) => !applied.has(f)).length;
  log(`  ${applied.size} applied, ${pending} pending.`);
}

async function fresh() {
  await ensureTable();
  // roll back everything (newest batch first), then migrate up
  let b = await currentBatch();
  while (b > 0) {
    await rollback();
    b = await currentBatch();
  }
  await migrate();
}

async function seedAll() {
  const files = listFiles(SEEDERS_DIR);
  if (!files.length) {
    log('No seeders found.');
    return;
  }
  for (const file of files) {
    const seeder = require(path.join(SEEDERS_DIR, file));
    log(`  seeding: ${file}`);
    await seeder.run(db);
    log(`  seeded:  ${file}`);
  }
  log(`Done. ${files.length} seeder(s).`);
}

async function seedOne(name) {
  const files = listFiles(SEEDERS_DIR);
  const match = files.find((f) => f === name || f === name + '.js' || f.includes(name));
  if (!match) {
    log(`Seeder not found: ${name}`);
    log('Available: ' + files.join(', '));
    process.exitCode = 1;
    return;
  }
  const seeder = require(path.join(SEEDERS_DIR, match));
  log(`  seeding: ${match}`);
  await seeder.run(db);
  log(`  seeded:  ${match}`);
}

// ---- file generators ----

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  );
}

function slug(s) {
  return String(s || 'migration').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function makeMigration(name) {
  const file = `${stamp()}_${slug(name)}.js`;
  const full = path.join(MIGRATIONS_DIR, file);
  fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
  fs.writeFileSync(
    full,
    `'use strict';

/** Migration: ${name} */
module.exports = {
  async up(db) {
    // Example - create a table:
    // await db.raw(\`
    //   IF OBJECT_ID('dbo.my_table','U') IS NULL
    //   CREATE TABLE dbo.my_table (
    //     id INT IDENTITY(1,1) PRIMARY KEY,
    //     name NVARCHAR(200) NOT NULL,
    //     created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    //   );\`);

    // Example - add a column:
    // await db.raw("IF COL_LENGTH('dbo.my_table','phone') IS NULL ALTER TABLE dbo.my_table ADD phone NVARCHAR(20) NULL;");
  },

  async down(db) {
    // Reverse of up (drop table / drop column):
    // await db.raw("IF OBJECT_ID('dbo.my_table','U') IS NOT NULL DROP TABLE dbo.my_table;");
  },
};
`
  );
  log('Created migration: schema/' + file);
}

function makeSeeder(name) {
  const file = `${stamp()}_${slug(name)}.js`;
  const full = path.join(SEEDERS_DIR, file);
  fs.mkdirSync(SEEDERS_DIR, { recursive: true });
  fs.writeFileSync(
    full,
    `'use strict';

/** Seeder: ${name} */
module.exports = {
  async run(db) {
    // Insert dummy data (idempotent recommended):
    // await db.query('INSERT INTO example_items (name) VALUES (@p0)', ['demo']);
  },
};
`
  );
  log('Created seeder: seeders/' + file);
}

module.exports = {
  migrate,
  rollback,
  status,
  fresh,
  seedAll,
  seedOne,
  makeMigration,
  makeSeeder,
};
