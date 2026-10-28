'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

function todayFile() {
  const p = (n) => String(n).padStart(2, '0');
  const d = new Date();
  return path.join(logger.LOG_DIR, `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.log`);
}

describe('utils/logger', () => {
  it('writes a plaintext ERROR line to the date-wise file', () => {
    const marker = 'jest-logger-marker-' + process.pid;
    logger.error(marker);
    const f = todayFile();
    expect(fs.existsSync(f)).toBe(true);
    const txt = fs.readFileSync(f, 'utf8');
    expect(txt).toContain(marker);
    expect(txt).toMatch(/\[ERROR\]/);
  });

  it('logRequestError includes method + url context', () => {
    const marker = 'jest-ctx-marker-' + process.pid;
    logger.logRequestError(new Error(marker), {
      method: 'GET',
      originalUrl: '/api/example/ping',
      clientIp: '127.0.0.1',
      headers: {},
    });
    const txt = fs.readFileSync(todayFile(), 'utf8');
    expect(txt).toContain('GET /api/example/ping');
    expect(txt).toContain(marker);
  });
});
