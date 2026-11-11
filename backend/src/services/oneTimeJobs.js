const pool = require('../config/database');
const { renumberStaff } = require('../utils/staffIds');

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
