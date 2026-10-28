#!/usr/bin/env node
'use strict';

/**
 * Command-line entry for migrations + seeders.
 *
 *   node cli.js migrate                 run pending migrations
 *   node cli.js migrate:rollback        roll back the last batch
 *   node cli.js migrate:status          show applied / pending
 *   node cli.js migrate:fresh           roll back all, then migrate up
 *   node cli.js make:migration <name>   create a new migration file
 *   node cli.js seed                    run all seeders
 *   node cli.js seed:one <name>         run one seeder
 *   node cli.js make:seeder <name>      create a new seeder file
 *
 * (npm scripts wrap these - see package.json.)
 */

const migrator = require('./migrations/runner');
const dbmod = require('./config/database');

const [, , cmd, ...args] = process.argv;

async function main() {
  switch (cmd) {
    case 'migrate':
      await migrator.migrate();
      break;
    case 'migrate:rollback':
      await migrator.rollback();
      break;
    case 'migrate:status':
      await migrator.status();
      break;
    case 'migrate:fresh':
      await migrator.fresh();
      break;
    case 'make:migration':
      migrator.makeMigration(args.join(' '));
      break;
    case 'seed':
      await migrator.seedAll();
      break;
    case 'seed:one':
      await migrator.seedOne(args.join(' '));
      break;
    case 'make:seeder':
      migrator.makeSeeder(args.join(' '));
      break;
    default:
      // eslint-disable-next-line no-console
      console.log(
        'Usage: node cli.js <command>\n' +
          '  migrate | migrate:rollback | migrate:status | migrate:fresh\n' +
          '  make:migration <name>\n' +
          '  seed | seed:one <name> | make:seeder <name>'
      );
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[cli] error:', err && err.message ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // "make:*" commands never open a pool; closing a never-created pool is a no-op
    try {
      await dbmod.close();
    } catch (_) {
      /* ignore */
    }
  });
