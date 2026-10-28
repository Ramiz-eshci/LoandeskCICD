'use strict';

/**
 * Microsoft SQL Server connection pool (mssql / tedious).
 *
 * A03 Injection: ALWAYS use parameterized queries. This module exposes
 * helpers that bind values as SQL parameters (@p0, @p1, ...) instead of
 * string-concatenating user input into SQL.
 */

const sql = require('mssql');
const { config } = require('./env');

const poolConfig = {
  server: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  options: {
    encrypt: config.db.encrypt,
    trustServerCertificate: config.db.trustServerCertificate,
    enableArithAbort: true,
  },
  pool: {
    max: config.db.poolMax,
    min: config.db.poolMin,
    idleTimeoutMillis: config.db.poolIdleMs,
  },
};

let poolPromise = null;

/** Lazily create (once) and return the shared connection pool. */
function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(poolConfig)
      .connect()
      .then((pool) => {
        // eslint-disable-next-line no-console
        console.log('[db] Connected to SQL Server:', config.db.host + ':' + config.db.port + '/' + config.db.database);
        return pool;
      })
      .catch((err) => {
        poolPromise = null; // allow retry on next call
        // eslint-disable-next-line no-console
        console.error('[db] Connection failed:', err.message);
        throw err;
      });
  }
  return poolPromise;
}

/**
 * Run a parameterized query.
 * @param {string} text  SQL with @p0, @p1, ... placeholders
 * @param {Array}  params values bound in order to @p0, @p1, ...
 * @returns {Promise<Array>} recordset rows
 *
 * Example:
 *   query('SELECT * FROM users WHERE email=@p0 AND flag_deleted=@p1', [email, 0])
 */
async function query(text, params = []) {
  const pool = await getPool();
  const request = pool.request();
  params.forEach((value, i) => request.input('p' + i, value));
  const result = await request.query(text);
  return result.recordset || [];
}

/**
 * Named-parameter variant for clarity in longer queries.
 * @param {string} text SQL with @name placeholders
 * @param {Object} params { name: value, ... }
 */
async function queryNamed(text, params = {}) {
  const pool = await getPool();
  const request = pool.request();
  Object.entries(params).forEach(([k, v]) => request.input(k, v));
  const result = await request.query(text);
  return result.recordset || [];
}

/** Alias of query() - used by migrations/seeders. Params still parameterized. */
async function raw(text, params = []) {
  return query(text, params);
}

async function close() {
  if (poolPromise) {
    const pool = await poolPromise;
    await pool.close();
    poolPromise = null;
  }
}

module.exports = { sql, getPool, query, queryNamed, raw, close };
