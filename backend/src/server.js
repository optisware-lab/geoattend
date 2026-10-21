const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const attendanceRoutes = require('./routes/attendance');
const staffRoutes = require('./routes/staff');
const institutionRoutes = require('./routes/institution');
const reportRoutes = require('./routes/reports');
const leaveRoutes = require('./routes/leave');
const analyticsRoutes = require('./routes/analytics');
const geofenceRoutes = require('./routes/geofence');
const payrollRoutes = require('./routes/payroll');

const app = express();

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: false,
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, please try again later' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/google', authLimiter);
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Health check with build info for deploy verification
app.get('/api/health', (req, res) => {
  let gitSha = 'unknown';
  try {
    // Try multiple env vars (Render, Heroku, etc.) then fall back to reading .git
    gitSha = process.env.RENDER_GIT_COMMIT
      || process.env.SOURCE_VERSION
      || process.env.GIT_SHA
      || require('child_process').execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) { /* ignore */ }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    gitSha,
    nodeEnv: process.env.NODE_ENV || 'development',
  });
});


// Routes
app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/institutions', institutionRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/geofence', geofenceRoutes);
app.use('/api/payroll', payrollRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Auto-migrate: ensure column sizes are correct on startup
const pool = require('./config/database');
async function runAutoMigration(client) {
  const alters = [
    'ALTER TABLE staff ADD COLUMN IF NOT EXISTS push_token TEXT',
    'ALTER TABLE staff ALTER COLUMN profile_photo_url TYPE TEXT',
    'ALTER TABLE staff ALTER COLUMN staff_id TYPE VARCHAR(50)',
    'ALTER TABLE staff ALTER COLUMN first_name TYPE VARCHAR(100)',
    'ALTER TABLE staff ALTER COLUMN last_name TYPE VARCHAR(100)',
    'ALTER TABLE staff ALTER COLUMN email TYPE VARCHAR(255)',
    'ALTER TABLE staff ALTER COLUMN password_hash DROP NOT NULL',
    'ALTER TABLE staff ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE',
  ];
  for (const sql of alters) {
    try {
      await client.query(sql);
    } catch (err) {
      console.error('Auto-migration skip:', sql.slice(0, 60), '-', err.message);
    }
  }
  // New tables for automation features
  const newTables = [
    `CREATE TABLE IF NOT EXISTS leave_requests (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      staff_uuid UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      leave_type VARCHAR(30) NOT NULL DEFAULT 'personal',
      start_date DATE NOT NULL, end_date DATE NOT NULL,
      reason TEXT, status VARCHAR(20) DEFAULT 'pending',
      reviewed_by UUID REFERENCES staff(id), reviewed_at TIMESTAMP, review_note TEXT,
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS overtime_records (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      staff_uuid UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      date DATE NOT NULL, overtime_minutes INTEGER NOT NULL DEFAULT 0,
      reason VARCHAR(50) DEFAULT 'auto_checkout', created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE,
      action VARCHAR(100) NOT NULL, entity_type VARCHAR(50) NOT NULL,
      entity_id VARCHAR(255), details JSONB, performed_by VARCHAR(255) NOT NULL,
      ip_address VARCHAR(45), created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS fraud_events (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      staff_uuid UUID REFERENCES staff(id) ON DELETE SET NULL,
      event_type VARCHAR(50) NOT NULL,
      details JSONB,
      ip_address VARCHAR(45),
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS geofence_events (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      staff_uuid UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      event VARCHAR(10) NOT NULL CHECK (event IN ('enter','exit')),
      latitude DECIMAL(10, 8),
      longitude DECIMAL(11, 8),
      distance_m INTEGER,
      radius_m INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      resolved_at TIMESTAMP,
      notes TEXT
    )`,
    `ALTER TABLE institutions ADD COLUMN IF NOT EXISTS institution_code VARCHAR(30)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_institutions_code ON institutions(institution_code)`,
    `UPDATE institutions
     SET institution_code = UPPER('INST-' || SUBSTRING(REPLACE(id::text, '-', '') FROM 1 FOR 6))
     WHERE institution_code IS NULL`,
    `ALTER TABLE attendance_rules ADD COLUMN IF NOT EXISTS member_type VARCHAR(20) DEFAULT 'staff'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_attendance_rules_inst_member ON attendance_rules(institution_id, member_type)`,
    `CREATE TABLE IF NOT EXISTS subscriptions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      plan_name VARCHAR(100) NOT NULL DEFAULT 'trial',
      status VARCHAR(20) NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled')),
      trial_start TIMESTAMP,
      trial_end TIMESTAMP,
      current_period_end TIMESTAMP,
      payment_reference VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_subscriptions_institution ON subscriptions(institution_id)`,
    `CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status)`,
    `INSERT INTO subscriptions (institution_id, plan_name, status, trial_start, trial_end)
     SELECT i.id, 'trial', 'trialing', NOW(), NOW() + INTERVAL '28 days'
     FROM institutions i
     WHERE NOT EXISTS (
       SELECT 1 FROM subscriptions s WHERE s.institution_id = i.id
     )`,
    `ALTER TABLE institutions ADD COLUMN IF NOT EXISTS qr_rotation_token VARCHAR(255)`,
    `ALTER TABLE institutions ADD COLUMN IF NOT EXISTS qr_rotated_at TIMESTAMP`,
    `CREATE TABLE IF NOT EXISTS institution_admin_credentials (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      admin_staff_id VARCHAR(50) NOT NULL,
      admin_password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_institution_admin_credentials_institution
      ON institution_admin_credentials(institution_id)`,

    // â”€â”€ Hourly-rate payroll support â”€â”€
    `ALTER TABLE institutions ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) NOT NULL DEFAULT 'monthly'`,
    `ALTER TABLE institutions ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'GHS'`,
    `ALTER TABLE staff ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10, 2)`,
    `ALTER TABLE attendance_rules ADD COLUMN IF NOT EXISTS overtime_multiplier NUMERIC(5, 2) NOT NULL DEFAULT 1.5`,

    // â”€â”€ Premises tracking (checked in at gate, left without working) â”€â”€
    `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS premises_left_at TIMESTAMP`,
    `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS premises_returned_at TIMESTAMP`,
  ];
  for (const sql of newTables) {
    try { await client.query(sql); } catch (err) {
      if (!err.message.includes('already exists')) console.error('Auto-migration skip:', err.message);
    }
  }

  // â”€â”€ Restricted app role: makes RLS actually binding â”€â”€
  // Hosted providers (Neon) hand the project owner rolbypassrls=true, which
  // silently disables every policy for connections made with DATABASE_URL.
  // The app therefore masquerades as this NOLOGIN role (SET ROLE on connect,
  // see config/database.js) which only holds plain DML grants, so the policies
  // below are enforced for real. DDL ownership stays with the connecting role.
  const appRoleSql = [
    `DO $app_role$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geoattend_app') THEN
           CREATE ROLE geoattend_app NOLOGIN;
         END IF;
       END
     $app_role$`,
    // The connecting owner must be a member so it is allowed to SET ROLE.
    `DO $app_role$
       DECLARE
         connecting_role TEXT := current_user;
       BEGIN
         IF connecting_role <> 'geoattend_app' THEN
           EXECUTE format('GRANT geoattend_app TO %I', connecting_role);
         END IF;
       END
     $app_role$`,
    'GRANT USAGE ON SCHEMA public TO geoattend_app',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO geoattend_app',
    'GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO geoattend_app',
    // Future tables created by the owner are auto-granted to the app role.
    `DO $app_priv$
       DECLARE
         connecting_role TEXT := current_user;
       BEGIN
         EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO geoattend_app', connecting_role);
         EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE ON SEQUENCES TO geoattend_app', connecting_role);
       END
     $app_priv$`,
  ];
  for (const sql of appRoleSql) {
    try { await client.query(sql); } catch (err) {
      console.error('App role setup skip:', err.message.replace(/\n/g, ' ').slice(0, 160));
    }
  }

  // â”€â”€ Row-Level Security: engine-enforced tenant isolation â”€â”€
  // Every tenant table is locked to current_setting('app.institution_id') rows
  // unless app.bypass_rls = 'on' (super admin / system jobs). FORCE makes the
  // table owner obey the policies too, so an unfiltered query can never leak
  // another institution's data â€” Postgres blocks it before it reaches the app.
  // NULLIF guards the uuid cast: the system channel clears institution_id to ''.
  const rlsTables = {
    // tables that carry the institution_id column directly
    standard: [
      'staff', 'attendance_records', 'attendance_rules',
      'overtime_records', 'geofence_events', 'fraud_events', 'subscriptions',
      'audit_logs', 'leave_requests', 'institution_admin_credentials',
    ],
    special: {
      // institutions IS the tenant row: its id is the institution id
      institutions: `
        USING ((NULLIF(current_setting('app.institution_id', true), '') IS NOT NULL AND id = NULLIF(current_setting('app.institution_id', true), '')::uuid) OR current_setting('app.bypass_rls', true) = 'on')
        WITH CHECK ((NULLIF(current_setting('app.institution_id', true), '') IS NOT NULL AND id = NULLIF(current_setting('app.institution_id', true), '')::uuid) OR current_setting('app.bypass_rls', true) = 'on')`,
      // device_logs has no institution_id column â€” route through staff
      device_logs: `
        USING ((NULLIF(current_setting('app.institution_id', true), '') IS NOT NULL AND EXISTS (SELECT 1 FROM staff s WHERE s.id = staff_uuid)) OR current_setting('app.bypass_rls', true) = 'on')
        WITH CHECK ((NULLIF(current_setting('app.institution_id', true), '') IS NOT NULL AND EXISTS (SELECT 1 FROM staff s WHERE s.id = staff_uuid)) OR current_setting('app.bypass_rls', true) = 'on')`,
    },
  };

  const standardPolicy = `
    USING ((NULLIF(current_setting('app.institution_id', true), '') IS NOT NULL AND institution_id = NULLIF(current_setting('app.institution_id', true), '')::uuid) OR current_setting('app.bypass_rls', true) = 'on')
    WITH CHECK ((NULLIF(current_setting('app.institution_id', true), '') IS NOT NULL AND institution_id = NULLIF(current_setting('app.institution_id', true), '')::uuid) OR current_setting('app.bypass_rls', true) = 'on')`;

  for (const table of rlsTables.standard) {
    try {
      await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS tenant_isolation_policy ON ${table}`);
      await client.query(`CREATE POLICY tenant_isolation_policy ON ${table} ${standardPolicy}`);
    } catch (err) {
      console.error('RLS policy skip:', table, '-', err.message);
    }
  }
  for (const [table, policy] of Object.entries(rlsTables.special)) {
    try {
      await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS tenant_isolation_policy ON ${table}`);
      await client.query(`CREATE POLICY tenant_isolation_policy ON ${table} ${policy}`);
    } catch (err) {
      console.error('RLS policy skip:', table, '-', err.message);
    }
  }
  console.log('Auto-migration: RLS tenant isolation policies applied.');

  // â”€â”€ Encrypt legacy plaintext admin credentials at rest â”€â”€
  try {
    const { encrypt, isEncrypted, decryptSafe } = require('./utils/credentialsCrypto');
    await pool.withSystemContext(async (client) => {
      const rows = await client.query(
        'SELECT id, admin_password FROM institution_admin_credentials WHERE admin_password IS NOT NULL'
      );
      let migrated = 0;
      let unreadable = 0;
      for (const row of rows.rows) {
        // Key rotation: re-encrypt anything that is plaintext or encrypted
        // under an older configuration, so every row ends up encrypted with
        // the CURRENT key (ADMIN_CREDENTIALS_KEY || JWT_SECRET).
        if (isEncrypted(row.admin_password)) {
          if (decryptSafe(row.admin_password) === null) {
            unreadable++;
            continue;
          }
        }
        const plain = decryptSafe(row.admin_password);
        if (plain) {
          await client.query(
            'UPDATE institution_admin_credentials SET admin_password = $1 WHERE id = $2',
            [encrypt(plain), row.id]
          );
          migrated++;
        }
      }
      if (migrated > 0) console.log(`Auto-migration: re-encrypted ${migrated} stored admin password(s) under the current key`);
      if (unreadable > 0) console.warn(`Auto-migration: ${unreadable} stored admin password(s) cannot be decrypted with any known key — regenerate them from the Institutions page`);
    });
  } catch (err) {
    console.error('Credential encryption backfill skip:', err.message);
  }

  console.log('Auto-migration: column sizes verified.');
}

async function ensureAdminExists() {
  try {
    const existing = await pool.query("SELECT id FROM staff WHERE staff_id = 'ADMIN001'");
    if (existing.rows.length > 0) return;

    const bcrypt = require('bcryptjs');
    const instResult = await pool.query('SELECT id FROM institutions ORDER BY created_at LIMIT 1');
    let institutionId;

    if (instResult.rows.length === 0) {
      const ins = await pool.query(
        `INSERT INTO institutions (name, address, city, region, latitude, longitude, geofence_radius)
         VALUES ('Sample Institution Ghana', '123 Independence Avenue', 'Accra', 'Greater Accra', 5.6037, -0.1870, 200)
         RETURNING id`
      );
      institutionId = ins.rows[0].id;
      await pool.query(
        `INSERT INTO attendance_rules (institution_id, member_type)
         VALUES ($1, 'staff')
         ON CONFLICT DO NOTHING`,
        [institutionId]
      );
    } else {
      institutionId = instResult.rows[0].id;
    }

    const passwordHash = await bcrypt.hash(process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@123', 12);
    await pool.query(
      `INSERT INTO staff (institution_id, staff_id, first_name, last_name, email, password_hash, role, department, position, qr_code_data)
       VALUES ($1, 'ADMIN001', 'System', 'Administrator', $2, $3, 'super_admin', 'Administration', 'System Administrator', $4)
       ON CONFLICT DO NOTHING`,
      [institutionId, process.env.DEFAULT_ADMIN_EMAIL || 'admin@institution.edu.gh', passwordHash, `STAFF-${institutionId}-ADMIN001`]
    );
    console.log('Admin account created: ADMIN001');
  } catch (err) {
    console.error('Ensure admin error:', err.message);
  }
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Startup DDL runs on the owner channel (the restricted RLS app role must
  // not own tables); it happens before any tenant identity exists.
  await pool.withOwnerContext((client) => runAutoMigration(client));
  await pool.withSystemContext(() => ensureAdminExists());

  // Start scheduled jobs
  const { startScheduler } = require('./services/scheduler');
  startScheduler();
});

module.exports = app;
