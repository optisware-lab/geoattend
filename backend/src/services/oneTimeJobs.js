const pool = require('../config/database');
const { renumberStaff } = require('../utils/staffIds');
const { formatName } = require('../utils/names');
const {
  freeInstitutionCode, freeAdminId, OLD_INSTITUTION_CODE, OLD_ADMIN_ID,
} = require('../utils/institutionCodes');

// Data changes that must run exactly once, right after the deploy that adds
// them. Each runs in a transaction together with recording its key, so it
// either completes and is never repeated, or fails and is retried on the
// next start. Add new jobs at the end with a new key; never reuse a key.
const JOBS = [
  {
    key: '2026-11-staff-ids-school-initials',
    // Existing staff IDs (e.g. GAFBACA) -> school initials + number (RSS012).
    // Old IDs are kept so logins and printed QR cards keep working.
    async run(client) {
      const schools = await client.query('SELECT id, name FROM institutions ORDER BY created_at');
      let renamed = 0;
      for (const school of schools.rows) {
        const changes = await renumberStaff(client, school.id, { mode: 'missing' });
        renamed += changes.length;
        if (changes.length) console.log(`[One-time] ${school.name}: ${changes.length} staff ID(s) renamed`);
      }
      return { renamed };
    },
  },
  {
    key: '2026-11-staff-names-same-format',
    // Stored names like "BRIGHT anyawe" -> "Bright Anyawe", the same rule
    // used when names are saved (utils/names.js).
    async run(client) {
      const staff = await client.query('SELECT id, first_name, last_name FROM staff');
      let fixed = 0;
      for (const s of staff.rows) {
        const first = formatName(s.first_name);
        const last = formatName(s.last_name);
        if (first === s.first_name && last === s.last_name) continue;
        await client.query('UPDATE staff SET first_name = $2, last_name = $3 WHERE id = $1', [s.id, first, last]);
        fixed += 1;
      }
      return { fixed };
    },
  },
  {
    key: '2026-11-school-codes-initials',
    // School codes INST-123456 -> school initials (RSS), admin IDs
    // ADMIN3FA9C2 -> RSSADMIN. The old ones keep working, and phones and
    // browsers swap in the new ones the next time they sign in.
    async run(client) {
      const schools = await client.query(
        'SELECT id, name, institution_code, staff_id_prefix FROM institutions ORDER BY created_at'
      );
      const changes = [];
      for (const school of schools.rows) {
        let code = school.institution_code;
        if (!code || OLD_INSTITUTION_CODE.test(code)) {
          code = await freeInstitutionCode(client, school.name, {
            staffIdPrefix: school.staff_id_prefix, exceptInstitutionId: school.id,
          });
          await client.query(
            `UPDATE institutions SET institution_code = $2,
               legacy_institution_codes = CASE WHEN $3::text IS NULL OR $3 = ANY(legacy_institution_codes)
                 THEN legacy_institution_codes ELSE array_append(legacy_institution_codes, $3) END,
               updated_at = NOW()
             WHERE id = $1`,
            [school.id, code, school.institution_code]
          );
          changes.push(`${school.name}: code ${school.institution_code} -> ${code}`);
        }

        const admins = await client.query(
          `SELECT id, staff_id FROM staff WHERE institution_id = $1 AND role = 'admin'
           ORDER BY created_at`,
          [school.id]
        );
        for (const admin of admins.rows) {
          if (!OLD_ADMIN_ID.test(admin.staff_id)) continue;
          const newId = await freeAdminId(client, code);
          await client.query(
            `UPDATE staff SET staff_id = $2,
               legacy_staff_ids = CASE WHEN $3 = ANY(legacy_staff_ids) THEN legacy_staff_ids
                                       ELSE array_append(legacy_staff_ids, $3) END,
               updated_at = NOW()
             WHERE id = $1`,
            [admin.id, newId, admin.staff_id]
          );
          await client.query(
            `UPDATE institution_admin_credentials SET admin_staff_id = $3, updated_at = NOW()
             WHERE institution_id = $1 AND admin_staff_id = $2`,
            [school.id, admin.staff_id, newId]
          );
          changes.push(`${school.name}: admin ${admin.staff_id} -> ${newId}`);
        }
      }
      changes.forEach((c) => console.log(`[One-time] ${c}`));
      return { changes };
    },
  },
];

async function runOneTimeJobs() {
  await pool.withOwnerContext(async (client) => {
    await client.query(`CREATE TABLE IF NOT EXISTS one_time_jobs (
      key VARCHAR(80) PRIMARY KEY,
      done_at TIMESTAMP DEFAULT NOW(),
      details JSONB
    )`);
    for (const job of JOBS) {
      try {
        await client.query('BEGIN');
        const claimed = await client.query(
          'INSERT INTO one_time_jobs (key) VALUES ($1) ON CONFLICT (key) DO NOTHING RETURNING key',
          [job.key]
        );
        if (claimed.rowCount === 0) { await client.query('ROLLBACK'); continue; }
        const details = await job.run(client);
        await client.query('UPDATE one_time_jobs SET details = $2 WHERE key = $1', [job.key, JSON.stringify(details || {})]);
        await client.query('COMMIT');
        console.log(`[One-time] ${job.key} done`, details || '');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`[One-time] ${job.key} failed, will retry on next start:`, err.message);
      }
    }
  });
}

module.exports = { runOneTimeJobs };
