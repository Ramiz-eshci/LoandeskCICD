'use strict';

jest.mock('../config/database', () => ({ query: jest.fn() }));
const db = require('../config/database');
const service = require('../services/demoRequest.service');
const migration = require('../migrations/schema/20261014000001_create_demo_requests');

const body = {
  name: " Jane O'Neil ",
  email: ' jane@firm.co.uk ',
  company: ' Élan & Partners ',
  interest: 'Underwriting workflow',
  message: 'Can we review KYC?\nWe have 12 users.',
};

describe('demo request validation and persistence', () => {
  it('accepts real company names, punctuation and multiline requirements', () => {
    expect(service.validate(body)).toMatchObject({ ok: true, values: { name: "Jane O'Neil", company: 'Élan & Partners' } });
  });

  it.each([null, [], 'text', 123])('rejects a non-object payload: %p', (value) => {
    expect(service.validate(value).ok).toBe(false);
  });

  it('rejects missing details, wrong types, unsupported interests and oversized text', () => {
    expect(service.validate({}).errors).toHaveProperty('email');
    expect(service.validate({ ...body, name: {} }).errors).toHaveProperty('name');
    expect(service.validate({ ...body, email: 'invalid' }).errors).toHaveProperty('email');
    expect(service.validate({ ...body, interest: 'Personal loan' }).errors).toHaveProperty('interest');
    for (const [field, max] of Object.entries({ name: 120, email: 254, company: 160, message: 2000 })) {
      expect(service.validate({ ...body, [field]: 'x'.repeat(max + 1) }).errors).toHaveProperty(field);
    }
    expect(service.validate({ ...body, name: 'Jane\u0000Smith' }).errors).toHaveProperty('name');
  });

  it('inserts only demo fields using bound parameters and returns only a reference', async () => {
    db.query.mockResolvedValue([{ request_ref: 'b4f4f87a-6f4e-4f7d-a6ee-0b5d0fa3bcca', demo_request_id: 17, email: body.email }]);
    const result = await service.create({ ...body, source: 'WEBSITE', assigned_to: 1, demo_request_id: 999, request_ref: 'fake', created_at: 'fake' });
    expect(result).toEqual({ ok: true, request_ref: 'b4f4f87a-6f4e-4f7d-a6ee-0b5d0fa3bcca' });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO demo_requests');
    expect(sql).not.toContain(body.name.trim());
    expect(sql).not.toContain('enquiries');
    expect(params).toEqual(["Jane O'Neil", 'jane@firm.co.uk', 'Élan & Partners', body.interest, body.message]);
  });

  it('does not write invalid submissions', async () => {
    expect((await service.create({ ...body, company: '' })).ok).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('stores an omitted optional message as null', async () => {
    db.query.mockResolvedValue([{ request_ref: 'reference' }]);
    await service.create({ ...body, message: undefined });
    expect(db.query.mock.calls[0][1][4]).toBeNull();
  });

  it('does not report success if persistence returns no record', async () => {
    db.query.mockResolvedValue([]);
    await expect(service.create(body)).rejects.toThrow('did not return a reference');
  });
});

describe('demo request migration', () => {
  it('provides additive, idempotent creation and a rollback for its own table', async () => {
    const database = { raw: jest.fn() };
    await migration.up(database);
    expect(database.raw.mock.calls[0][0]).toContain("IF OBJECT_ID('dbo.demo_requests', 'U') IS NULL");
    expect(database.raw.mock.calls[0][0]).toContain('NVARCHAR(2000)');
    expect(database.raw.mock.calls[0][0]).not.toContain('DROP TABLE');
    await migration.down(database);
    expect(database.raw.mock.calls[1][0]).toContain('DROP TABLE dbo.demo_requests');
  });
});
