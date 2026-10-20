/**
 * One-off repair script: fixes institutions that were created without
 * an institution_code and/or without an admin account.
 *
 * Usage: node src/scripts/repairOrphanedInstitutions.js [institutionName]
 *   - If institutionName is provided, only repairs that institution.
 *   - Otherwise, repairs ALL institutions with missing codes or missing admins.
 */

const pool = require('../config/database');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { encrypt } = require('../utils/credentialsCrypto');

async function generateInstitutionCode(client) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = `INST-${Math.floor(100000 + Math.random() * 900000)}`;
    const exists = await client.query('SELECT id FROM institutions WHERE institution_code = $1', [code]);
    if (exists.rows.length === 0) return code;
  }
  return `INST-${Date.now().toString().slice(-6)}`;
}

async function repairInstitution(inst, client) {
  try {
    await client.query('BEGIN');
    let repaired = false;

    // Fix missing institution_code
    if (!inst.institution_code) {
      const newCode = await generateInstitutionCode(client);
      await client.query(
        'UPDATE institutions SET institution_code = $1, updated_at = NOW() WHERE id = $2',
        [newCode, inst.id]
      );
      console.log(`  ✅ Assigned code: ${newCode}`);
      inst.institution_code = newCode;
      repaired = true;
    } else {
      console.log(`  ✓ Already has code: ${inst.institution_code}`);
    }

    // Check for existing admin
    const adminCheck = await client.query(
      "SELECT id, staff_id FROM staff WHERE institution_id = $1 AND role IN ('admin','super_admin') LIMIT 1",
      [inst.id]
    );

    if (adminCheck.rows.length === 0) {
      // Create admin account
      const staffId = 'ADMIN' + crypto.randomBytes(3).toString('hex').toUpperCase();
      const rawPassword = crypto.randomBytes(4).toString('hex');
      const passwordHash = await bcrypt.hash(rawPassword, 12);
      const qrData = `STAFF-${inst.id}-${staffId}`;

      await client.query(
        `INSERT INTO staff (institution_id, staff_id, first_name, last_name, password_hash, qr_code_data, role, member_type)
         VALUES ($1, $2, 'Admin', 'User', $3, $4, 'admin', 'staff')`,
        [inst.id, staffId, passwordHash, qrData]
      );

      // Store encrypted credentials for super admin retrieval
      await client.query(
        `INSERT INTO institution_admin_credentials (institution_id, admin_staff_id, admin_password)
         VALUES ($1, $2, $3)
         ON CONFLICT (institution_id) DO UPDATE SET
           admin_staff_id = EXCLUDED.admin_staff_id,
           admin_password = EXCLUDED.admin_password,
           updated_at = NOW()`,
        [inst.id, staffId, encrypt(rawPassword)]
      );

      console.log(`  ✅ Admin created: ${staffId} / ${rawPassword}`);
      repaired = true;
    } else {
      console.log(`  ✓ Admin already exists: ${adminCheck.rows[0].staff_id}`);
    }

    // Ensure attendance rules exist (handle missing member_type column gracefully)
    try {
      await client.query(
        `INSERT INTO attendance_rules (institution_id, member_type)
         VALUES ($1, 'staff')
         ON CONFLICT (institution_id, member_type) DO NOTHING`,
        [inst.id]
      );
    } catch (rulesErr) {
      // Fallback for older schemas without member_type
      if (rulesErr.message.includes('member_type')) {
        await client.query(
          `INSERT INTO attendance_rules (institution_id)
           VALUES ($1)
           ON CONFLICT (institution_id) DO NOTHING`,
          [inst.id]
        ).catch(() => {}); // Ignore if still fails
      }
    }

    // Ensure trial subscription exists
    const subCheck = await client.query(
      'SELECT id FROM subscriptions WHERE institution_id = $1 LIMIT 1',
      [inst.id]
    );
    if (subCheck.rows.length === 0) {
      await client.query(
        `INSERT INTO subscriptions (institution_id, plan_name, status, trial_start, trial_end)
         VALUES ($1, 'trial', 'trialing', NOW(), NOW() + INTERVAL '28 days')`,
        [inst.id]
      );
      console.log(`  ✅ Trial subscription created`);
      repaired = true;
    } else {
      console.log(`  ✓ Subscription exists`);
    }

    await client.query('COMMIT');
    return repaired;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`  ✗ Repair failed: ${err.message}`);
    return false;
  }
}

async function main(client) {
  const targetName = process.argv[2];

  let query = 'SELECT id, name, institution_code, created_at FROM institutions';
  let params = [];

  if (targetName) {
    query += ' WHERE name ILIKE $1';
    params = [`%${targetName}%`];
  }

  query += ' ORDER BY created_at DESC';

  const result = await client.query(query, params);

  if (result.rows.length === 0) {
    console.log(targetName ? `No institution found matching "${targetName}"` : 'No institutions found');
    process.exit(0);
  }

  console.log(`Found ${result.rows.length} institution(s) to check:\n`);

  let repairedCount = 0;
  for (const inst of result.rows) {
    console.log(`✔ ${inst.name} (${inst.id})`);
    const wasRepaired = await repairInstitution(inst, client);
    if (wasRepaired) repairedCount++;
    console.log('');
  }

  console.log(`\n✓ Repair complete. ${repairedCount} institution(s) were repaired.`);
  process.exit(0);
}

// Ops scripts run without a tenant identity — run with the RLS system bypass.
pool.withSystemContext(main).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
