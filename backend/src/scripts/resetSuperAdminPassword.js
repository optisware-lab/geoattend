// Reset the super admin (ADMIN001) password directly in the database.
// Usage: npm run reset-admin -- "NewPassword123!" [STAFF_ID]
// Needs DATABASE_URL (or DB_*) in backend/.env pointing at the target database.
const bcrypt = require('bcryptjs');
const pool = require('../config/database');

// Connection failures (e.g. ECONNREFUSED to localhost) can arrive as an AggregateError with an empty message
function describeError(e) {
  const inner = Array.isArray(e.errors) ? e.errors.map(describeError).join('; ') : '';
  return [e.code, e.message, inner].filter(Boolean).join(' — ') || String(e);
}

async function reset(client) {
  const [newPassword, staffIdArg] = process.argv.slice(2);
  const staffId = (staffIdArg || 'ADMIN001').toUpperCase();

  if (!newPassword || newPassword.length < 8) {
    console.error('Usage: npm run reset-admin -- "NewPassword123!" [STAFF_ID]   (min 8 characters)');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL is empty in backend/.env — falling back to DB_HOST/DB_* settings.');
  }

  // Neon's free tier sleeps when idle; the first connection can take longer than the pool's 5s timeout
  for (let attempt = 1; ; attempt++) {
    try {
      await client.query('SELECT 1');
      break;
    } catch (e) {
      if (attempt >= 4) throw e;
      console.log(`Database not reachable yet (${describeError(e)}) — retrying (${attempt}/3)...`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  // Ops script with no user context — runs with the RLS system bypass.
  const found = await client.query(
    `SELECT s.id, s.staff_id, s.role, s.is_active, i.name AS institution_name
     FROM staff s JOIN institutions i ON i.id = s.institution_id
     WHERE s.staff_id = $1 AND s.role IN ('admin', 'super_admin')`,
    [staffId]
  );
  if (found.rows.length === 0) {
    console.error(`No admin account with Staff ID ${staffId} found in this database.`);
    process.exit(1);
  }
  console.table(found.rows.map(({ id, ...row }) => row));

  const hash = await bcrypt.hash(newPassword, 12);
  const updated = await client.query(
    `UPDATE staff SET password_hash = $1, is_active = true, updated_at = NOW()
     WHERE staff_id = $2 AND role IN ('admin', 'super_admin')`,
    [hash, staffId]
  );
  console.log(`Password reset for ${updated.rowCount} account(s) with Staff ID ${staffId}.`);
  console.log('Log in with the institution code left empty.');
  process.exit(0);
}

pool.withSystemContext(reset).catch((e) => { console.error('Reset failed:', describeError(e)); process.exit(1); });
