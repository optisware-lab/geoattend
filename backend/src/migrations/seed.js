const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Row-Level Security: seed scripts run before any tenant identity exists, so
// they execute on a connection with the system bypass.
pool.withSystemContext(async (client) => {
  try {
    console.log('Seeding database...');

    // Check if institution already exists
    const existing = await client.query('SELECT id FROM institutions LIMIT 1');
    if (existing.rows.length > 0) {
      console.log('Seed skipped: data already exists.');
      console.log(`Institution ID: ${existing.rows[0].id}`);
      return;
    }

    // Create default institution with institution code
    const institutionId = uuidv4();
    const institutionCode = `INST-${Math.floor(100000 + Math.random() * 900000)}`;
    await client.query(`
      INSERT INTO institutions (id, name, institution_code, address, city, region, latitude, longitude, geofence_radius)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      institutionId,
      'Sample Institution Ghana',
      institutionCode,
      '123 Independence Avenue',
      'Accra',
      'Greater Accra',
      5.6037,
      -0.1870,
      200
    ]);

    // Create default attendance rules
    await client.query(`
      INSERT INTO attendance_rules (institution_id, member_type)
      VALUES ($1, 'staff')
      ON CONFLICT DO NOTHING
    `, [institutionId]);

    // Create default admin user
    const passwordHash = await bcrypt.hash(
      process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@123',
      12
    );

    await client.query(`
      INSERT INTO staff (institution_id, staff_id, first_name, last_name, email, password_hash, role, department, position, qr_code_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (institution_id, staff_id) DO NOTHING
    `, [
      institutionId,
      'ADMIN001',
      'System',
      'Administrator',
      process.env.DEFAULT_ADMIN_EMAIL || 'admin@institution.edu.gh',
      passwordHash,
      'super_admin',
      'Administration',
      'System Administrator',
      `STAFF-${institutionId}-ADMIN001`
    ]);

    console.log('Seed completed successfully.');
    console.log('='.repeat(60));
    console.log('SUPER ADMIN CREDENTIALS:');
    console.log(`  Staff ID: ADMIN001`);
    console.log(`  Password: ${process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@123'}`);
    console.log(`  Institution Code: (leave empty when logging in)`);
    console.log('='.repeat(60));
    console.log(`Institution: Sample Institution Ghana`);
    console.log(`Institution ID: ${institutionId}`);
    console.log(`Institution Code: ${institutionCode}`);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
});
