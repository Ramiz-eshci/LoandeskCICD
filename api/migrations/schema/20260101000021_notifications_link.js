'use strict';

/**
 * Add deep-link + entity ref to notifications so a bell item can navigate
 * (e.g. to the enquiry it is about). Additive & idempotent.
 */
module.exports = {
  async up(db) {
    await db.raw(`IF COL_LENGTH('dbo.notifications','link') IS NULL ALTER TABLE dbo.notifications ADD link NVARCHAR(300) NULL;`);
    await db.raw(`IF COL_LENGTH('dbo.notifications','entity_id') IS NULL ALTER TABLE dbo.notifications ADD entity_id INT NULL;`);
  },
  async down(db) {
    await db.raw(`IF COL_LENGTH('dbo.notifications','link') IS NOT NULL ALTER TABLE dbo.notifications DROP COLUMN link;`);
    await db.raw(`IF COL_LENGTH('dbo.notifications','entity_id') IS NOT NULL ALTER TABLE dbo.notifications DROP COLUMN entity_id;`);
  },
};
