'use strict';

/** Seeder: dummy data for local dev/testing.
 *  Dummy users password: Password@123. Idempotent by email / name. */
module.exports = {
  async run(db) {
    const DUMMY_HASH = '$2b$10$253jqiDS9XE8SUu.SoMFL.p2rMmd1KYlJALTBrk9dyCARJt4BSBJO'; // Password@123

    // dummy users under the 'User' role
    const users = [
      ['john.doe@example.com', 'John Doe'],
      ['jane.smith@example.com', 'Jane Smith'],
      ['bob.jones@example.com', 'Bob Jones'],
    ];
    for (const [email, name] of users) {
      await db.query(
        `DECLARE @r INT = (SELECT role_id FROM roles WHERE role_name='User');
         IF NOT EXISTS (SELECT 1 FROM users WHERE email=@p0)
           INSERT INTO users (email, password_hash, full_name, role_id)
           VALUES (@p0, @p1, @p2, @r);`,
        [email, DUMMY_HASH, name]
      );
    }

    // Multi-role demo user for the "Select Your Workspace" screen.
    // john.doe holds several roles under London Branch with varied
    // last-accessed times so each card shows Branch + Role + Last accessed.
    // Roles: [role_name, is_primary, days-ago | null, 'HH:MM' | null]
    const demoRoles = [
      ['Sales / BDM',     1, 0, '08:42'],
      ['Underwriter',     0, 1, null],
      ['Credit Manager',  0, 0, '07:30'],
      ['Branch Manager',  0, 5, '16:15'],
    ];
    for (const [roleName, isPrimary, daysAgo, hhmm] of demoRoles) {
      await db.query(
        `DECLARE @u INT = (SELECT user_id FROM users WHERE email=@p0);
         DECLARE @rl INT = (SELECT role_id FROM roles WHERE role_name=@p1 AND flag_deleted=0);
         DECLARE @b INT = (SELECT branch_id FROM branches WHERE branch_name='London Branch');
         IF @u IS NOT NULL AND @rl IS NOT NULL
         BEGIN
           UPDATE users SET branch_id=@b WHERE user_id=@u AND (branch_id IS NULL OR branch_id<>@b);
           DECLARE @la DATETIME2 = CASE WHEN @p3 < 0 THEN NULL
             ELSE DATEADD(MINUTE,
                    (CAST(LEFT(@p4,2) AS INT)*60 + CAST(RIGHT(@p4,2) AS INT)),
                    CAST(DATEADD(DAY, -@p3, CAST(SYSUTCDATETIME() AS DATE)) AS DATETIME2)) END;
           IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id=@u AND role_id=@rl)
             INSERT INTO user_roles (user_id, role_id, is_primary, last_accessed_at)
             VALUES (@u, @rl, @p2, @la);
           ELSE
             UPDATE user_roles SET is_primary=@p2, last_accessed_at=@la
              WHERE user_id=@u AND role_id=@rl;
         END`,
        ['john.doe@example.com', roleName, isPrimary,
         (daysAgo == null ? -1 : daysAgo), (hhmm == null ? '00:00' : hhmm)]
      );
    }
  },
};
