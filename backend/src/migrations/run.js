require('dotenv').config();

const migration = `
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Institutions table
CREATE TABLE IF NOT EXISTS institutions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  institution_code VARCHAR(30) UNIQUE,
  address TEXT,
  city VARCHAR(100),
  region VARCHAR(100),
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  geofence_radius INTEGER NOT NULL DEFAULT 200,
  timezone VARCHAR(50) DEFAULT 'Africa/Accra',
  logo_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Backfill institution codes for existing rows
UPDATE institutions
SET institution_code = UPPER('INST-' || SUBSTRING(REPLACE(id::text, '-', '') FROM 1 FOR 6))
WHERE institution_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_institutions_code ON institutions(institution_code);

-- Staff table
CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  staff_id VARCHAR(50) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  department VARCHAR(100),
  position VARCHAR(100),
  password_hash VARCHAR(255) NOT NULL,
  qr_code_data VARCHAR(255) UNIQUE,
  profile_photo_url TEXT,
  role VARCHAR(20) DEFAULT 'staff' CHECK (role IN ('staff', 'admin', 'super_admin')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(institution_id, staff_id)
);

-- Attendance records table
CREATE TABLE IF NOT EXISTS attendance_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_uuid UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  check_in_time TIMESTAMP NOT NULL,
  check_out_time TIMESTAMP,
  check_in_latitude DECIMAL(10, 8),
  check_in_longitude DECIMAL(11, 8),
  check_out_latitude DECIMAL(10, 8),
  check_out_longitude DECIMAL(11, 8),
  check_in_method VARCHAR(20) NOT NULL CHECK (check_in_method IN ('gps', 'qr_code', 'nfc', 'manual')),
  check_out_method VARCHAR(20) CHECK (check_out_method IN ('gps', 'qr_code', 'nfc', 'manual')),
  device_id VARCHAR(255),
  is_late BOOLEAN DEFAULT false,
  is_within_geofence BOOLEAN DEFAULT true,
  notes TEXT,
  date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Subscriptions table (trial and paid access control)
CREATE TABLE IF NOT EXISTS subscriptions (
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
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_institution ON subscriptions(institution_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- Ensure every institution has at least one subscription row (default trial)
INSERT INTO subscriptions (institution_id, plan_name, status, trial_start, trial_end)
SELECT i.id, 'trial', 'trialing', NOW(), NOW() + INTERVAL '28 days'
FROM institutions i
WHERE NOT EXISTS (
  SELECT 1 FROM subscriptions s WHERE s.institution_id = i.id
);

-- Attendance rules table
CREATE TABLE IF NOT EXISTS attendance_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  member_type VARCHAR(20) NOT NULL DEFAULT 'staff',
  work_start_time TIME NOT NULL DEFAULT '08:00:00',
  work_end_time TIME NOT NULL DEFAULT '17:00:00',
  late_threshold_minutes INTEGER DEFAULT 15,
  early_departure_minutes INTEGER DEFAULT 30,
  working_days INTEGER[] DEFAULT '{1,2,3,4,5}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Ensure one rules row per institution + member_type
CREATE UNIQUE INDEX IF NOT EXISTS ux_attendance_rules_institution_member_type
  ON attendance_rules(institution_id, member_type);

-- Device log table
CREATE TABLE IF NOT EXISTS device_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_uuid UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  device_id VARCHAR(255) NOT NULL,
  device_model VARCHAR(255),
  os_version VARCHAR(255),
  app_version VARCHAR(20),
  action VARCHAR(50) NOT NULL,
  ip_address VARCHAR(45),
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Google sign-in: accounts created with Google have no password
ALTER TABLE staff ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;
ALTER TABLE staff ALTER COLUMN password_hash DROP NOT NULL;

-- Ensure column sizes are correct (in case table was created with smaller sizes)
ALTER TABLE staff ALTER COLUMN profile_photo_url TYPE TEXT;
ALTER TABLE staff ALTER COLUMN staff_id TYPE VARCHAR(50);
ALTER TABLE staff ALTER COLUMN first_name TYPE VARCHAR(100);
ALTER TABLE staff ALTER COLUMN last_name TYPE VARCHAR(100);
ALTER TABLE staff ALTER COLUMN email TYPE VARCHAR(255);

-- Stored admin credentials per institution so super admin can retrieve/reset them
CREATE TABLE IF NOT EXISTS institution_admin_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  admin_staff_id VARCHAR(50) NOT NULL,
  admin_password TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_institution_admin_credentials_institution
  ON institution_admin_credentials(institution_id);

-- Widen device_logs columns for long values
ALTER TABLE device_logs ALTER COLUMN device_id TYPE VARCHAR(255);
ALTER TABLE device_logs ALTER COLUMN device_model TYPE VARCHAR(255);
ALTER TABLE device_logs ALTER COLUMN os_version TYPE VARCHAR(255);

-- Staff-only system: every account is 'staff'. The column is kept so legacy
-- rows from older builds can be told apart and excluded.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS member_type VARCHAR(20) DEFAULT 'staff';

-- Backfill missing staff rules rows for existing institutions (safe if already present)
INSERT INTO attendance_rules (institution_id, member_type)
SELECT i.id, 'staff'
FROM institutions i
WHERE NOT EXISTS (
  SELECT 1 FROM attendance_rules ar WHERE ar.institution_id = i.id AND ar.member_type = 'staff'
);

-- Leave requests table
CREATE TABLE IF NOT EXISTS leave_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_uuid UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  leave_type VARCHAR(30) NOT NULL DEFAULT 'personal' CHECK (leave_type IN ('sick', 'personal', 'vacation', 'maternity', 'paternity', 'bereavement', 'other')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by UUID REFERENCES staff(id),
  reviewed_at TIMESTAMP,
  review_note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Overtime records table
CREATE TABLE IF NOT EXISTS overtime_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_uuid UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  overtime_minutes INTEGER NOT NULL DEFAULT 0,
  reason VARCHAR(50) DEFAULT 'auto_checkout',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(255),
  details JSONB,
  performed_by VARCHAR(255) NOT NULL,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Fraud / suspicious activity events
CREATE TABLE IF NOT EXISTS fraud_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  staff_uuid UUID REFERENCES staff(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL,
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT NOW()
);

-- QR code rotation support
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS qr_rotation_token VARCHAR(255);
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS qr_rotated_at TIMESTAMP;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_attendance_staff ON attendance_records(staff_uuid);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(date);
CREATE INDEX IF NOT EXISTS idx_attendance_institution ON attendance_records(institution_id);
CREATE INDEX IF NOT EXISTS idx_attendance_staff_date ON attendance_records(staff_uuid, date);
CREATE INDEX IF NOT EXISTS idx_staff_institution ON staff(institution_id);
CREATE INDEX IF NOT EXISTS idx_staff_qr ON staff(qr_code_data);
CREATE INDEX IF NOT EXISTS idx_device_logs_staff ON device_logs(staff_uuid);
CREATE INDEX IF NOT EXISTS idx_leave_staff ON leave_requests(staff_uuid);
CREATE INDEX IF NOT EXISTS idx_leave_institution ON leave_requests(institution_id);
CREATE INDEX IF NOT EXISTS idx_leave_dates ON leave_requests(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_overtime_staff ON overtime_records(staff_uuid);
CREATE INDEX IF NOT EXISTS idx_overtime_date ON overtime_records(date);
CREATE INDEX IF NOT EXISTS idx_audit_institution ON audit_logs(institution_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_fraud_institution ON fraud_events(institution_id);
CREATE INDEX IF NOT EXISTS idx_fraud_type ON fraud_events(event_type);
CREATE INDEX IF NOT EXISTS idx_fraud_created ON fraud_events(created_at);

-- ========== GEOFENCE EVENTS ==========

CREATE TABLE IF NOT EXISTS geofence_events (
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
);

CREATE INDEX IF NOT EXISTS idx_geofence_staff_date ON geofence_events(staff_uuid, created_at);
CREATE INDEX IF NOT EXISTS idx_geofence_institution_date ON geofence_events(institution_id, created_at);
`;

async function runMigration() {
  // Allow extra time for Neon cold-start wake-up
  const migrationPool = new (require('pg').Pool)({
    ...(() => {
      require('dotenv').config();
      const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;
      return process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL, ssl }
        : {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT, 10) || 5432,
            database: process.env.DB_NAME || 'geofence_attendance',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || '',
            ssl,
          };
    })(),
    max: 1,
    connectionTimeoutMillis: 30000,
  });

  const client = await migrationPool.connect();
  try {
    console.log('Running migrations...');
    await client.query(migration);
    console.log('Migrations completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await migrationPool.end();
  }
}

runMigration();
