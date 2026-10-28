'use strict';

/**
 * Common data-access helpers for SQL Server.
 *
 * A03 Injection: every VALUE is bound as a parameter (@p0, @p1, ...).
 * Table and column names are NEVER taken from user input — they come from
 * controllers/common/table.controller.js constants only.
 */

const db = require('../config/database');

function assertIdentifier(name) {
  // whitelist identifiers to letters, digits, underscore, dot (schema.table)
  if (!/^[A-Za-z0-9_.]+$/.test(String(name))) {
    throw new Error('Unsafe SQL identifier: ' + name);
  }
  return name;
}

const common = {
  /** SELECT ... WHERE <field> = <value> [AND <extraWhere with @pN>] */
  async findBy(table, field, value, columns = '*', extraWhere = '', extraParams = []) {
    assertIdentifier(table);
    assertIdentifier(field);
    let sql = `SELECT ${columns} FROM ${table} WHERE ${field} = @p0`;
    if (extraWhere) sql += ` AND (${extraWhere})`;
    return db.query(sql, [value, ...extraParams]);
  },

  /** SELECT columns FROM table WHERE <parameterized clause> */
  async select(table, whereClause = '1=1', params = [], columns = '*') {
    assertIdentifier(table);
    return db.query(`SELECT ${columns} FROM ${table} WHERE ${whereClause}`, params);
  },

  /** INSERT a row from a plain object. Returns the new identity id. */
  async insert(table, data) {
    assertIdentifier(table);
    const cols = Object.keys(data);
    cols.forEach(assertIdentifier);
    const params = Object.values(data);
    const placeholders = cols.map((_, i) => '@p' + i).join(', ');
    const sql =
      `INSERT INTO ${table} (${cols.join(', ')}) ` +
      `OUTPUT INSERTED.* VALUES (${placeholders})`;
    const rows = await db.query(sql, params);
    return rows[0] || null;
  },

  /** UPDATE table SET <data> WHERE <whereClause with @wN params>. */
  async update(table, data, whereClause, whereParams = []) {
    assertIdentifier(table);
    const cols = Object.keys(data);
    cols.forEach(assertIdentifier);
    const setParams = Object.values(data);
    const setSql = cols.map((c, i) => `${c} = @p${i}`).join(', ');
    // shift where params to @p<after set>
    const offset = cols.length;
    const shiftedWhere = whereClause.replace(/@w(\d+)/g, (_, n) => '@p' + (offset + Number(n)));
    const sql = `UPDATE ${table} SET ${setSql} WHERE ${shiftedWhere}`;
    return db.query(sql, [...setParams, ...whereParams]);
  },

  /** Soft delete: sets flag_deleted=1, deleted_on=now. */
  async softDelete(table, field, value) {
    assertIdentifier(table);
    assertIdentifier(field);
    return db.query(
      `UPDATE ${table} SET flag_deleted = 1, deleted_on = SYSUTCDATETIME() WHERE ${field} = @p0`,
      [value]
    );
  },

  /** Existence check with an optional exclude id. */
  async exists(table, field, value, excludeField = null, excludeValue = null, extraWhere = '') {
    assertIdentifier(table);
    assertIdentifier(field);
    let sql = `SELECT TOP 1 1 AS x FROM ${table} WHERE ${field} = @p0`;
    const params = [value];
    if (excludeField) {
      assertIdentifier(excludeField);
      sql += ` AND ${excludeField} <> @p1`;
      params.push(excludeValue);
    }
    if (extraWhere) sql += ` AND (${extraWhere})`;
    const rows = await db.query(sql, params);
    return rows.length > 0;
  },

  /** Escape hatch for a fully hand-written parameterized query. */
  async raw(sql, params = []) {
    return db.query(sql, params);
  },
};

module.exports = common;
