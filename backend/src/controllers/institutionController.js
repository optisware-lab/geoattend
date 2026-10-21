const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { generateInstitutionQR } = require('../utils/qrcode');
const { logAudit } = require('../middleware/audit');
const { encrypt, decrypt, decryptSafe, isEncrypted } = require('../utils/credentialsCrypto');
const {
  DEFAULT_TRIAL_DAYS,
  ensureTrialSubscription,
  getCurrentSubscription,
  buildSubscriptionSnapshot,
} = require('../services/subscriptionService');

async function generateInstitutionCode(db) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = `INST-${Math.floor(100000 + Math.random() * 900000)}`;
    const exists = await db.query('SELECT id FROM institutions WHERE institution_code = $1', [code]);
    if (exists.rows.length === 0) return code;
  }
  return `INST-${Date.now().toString().slice(-6)}`;
}

/** Upsert the AES-encrypted admin credentials so the super admin can decrypt them later. */
async function storeAdminCredentials(institutionId, staffId, rawPassword, client = pool) {
  await client.query(
    `INSERT INTO institution_admin_credentials (institution_id, admin_staff_id, admin_password)
     VALUES ($1, $2, $3)
     ON CONFLICT (institution_id) DO UPDATE SET
       admin_staff_id = EXCLUDED.admin_staff_id,
       admin_password = EXCLUDED.admin_password,
       updated_at = NOW()`,
    [institutionId, staffId, encrypt(rawPassword)]
  );
}

/** Create the initial admin account for an institution and store its credentials. */
async function createInitialAdminCredentials(institutionId, providedPassword, client = pool) {
  const staffId = 'ADMIN' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const rawPassword = providedPassword || crypto.randomBytes(4).toString('hex');
  const passwordHash = await bcrypt.hash(rawPassword, 12);
  const qrData = `STAFF-${institutionId}-${staffId}`;

  await client.query(
    `INSERT INTO staff (institution_id, staff_id, first_name, last_name, password_hash, qr_code_data, role, member_type)
     VALUES ($1, $2, 'Admin', 'User', $3, $4, 'admin', 'staff')`,
    [institutionId, staffId, passwordHash, qrData]
  );

  await storeAdminCredentials(institutionId, staffId, rawPassword, client);
  return { staffId, password: rawPassword };
}

exports.getInstitution = async (req, res) => {
  try {
    const result = await req.tenantDb.query(
      'SELECT * FROM institutions WHERE id = $1',
      [req.user.institution_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Institution not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get institution error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateInstitution = async (req, res) => {
  try {
    const { name, address, city, region, latitude, longitude, geofenceRadius, paymentMode, currency } = req.body;
    const institutionId = req.user.institution_id;

    // Only 'hourly' or 'monthly' are accepted payment modes
    const paymentModeValue = ['hourly', 'monthly'].includes(paymentMode) ? paymentMode : null;
    const currencyValue = typeof currency === 'string' && currency.trim().length >= 1 && currency.trim().length <= 10
      ? currency.trim().toUpperCase()
      : null;

    const result = await req.tenantDb.query(
      `UPDATE institutions SET
        name = COALESCE($1, name),
        address = COALESCE($2, address),
        city = COALESCE($3, city),
        region = COALESCE($4, region),
        latitude = COALESCE($5, latitude),
        longitude = COALESCE($6, longitude),
        geofence_radius = COALESCE($7, geofence_radius),
        payment_mode = COALESCE($8, payment_mode),
        currency = COALESCE($9, currency),
        updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [name, address, city, region, latitude, longitude, geofenceRadius, paymentModeValue, currencyValue, institutionId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update institution error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getAllInstitutions = async (req, res) => {
  try {
    const result = await req.tenantDb.query(`
      SELECT
        i.*,
        COALESCE(sc.staff_count, 0) AS staff_count,
        COALESCE(sc.active_staff_count, 0) AS active_staff_count,
        COALESCE(sc.admin_count, 0) AS admin_count,
        COALESCE(sc.super_admin_count, 0) AS super_admin_count,
        sub.plan_name AS subscription_plan,
        sub.status AS subscription_status,
        sub.trial_end AS subscription_trial_end,
        sub.current_period_end AS subscription_period_end
      FROM institutions i
      LEFT JOIN (
        SELECT
          institution_id,
          COUNT(*) AS staff_count,
          COUNT(*) FILTER (WHERE is_active) AS active_staff_count,
          COUNT(*) FILTER (WHERE role IN ('admin', 'super_admin')) AS admin_count,
          COUNT(*) FILTER (WHERE role = 'super_admin') AS super_admin_count
        FROM staff
        GROUP BY institution_id
      ) sc ON sc.institution_id = i.id
      LEFT JOIN LATERAL (
        SELECT plan_name, status, trial_end, current_period_end
        FROM subscriptions s
        WHERE s.institution_id = i.id
        ORDER BY s.created_at DESC
        LIMIT 1
      ) sub ON true
      ORDER BY i.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Get all institutions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Institution + its stored admin credentials, as returned by createInstitution
async function getCreatedInstitution(id, db) {
  const inst = await db.query('SELECT * FROM institutions WHERE id = $1', [id]);
  if (inst.rows.length === 0) return null;
  const creds = await db.query(
    'SELECT admin_staff_id, admin_password FROM institution_admin_credentials WHERE institution_id = $1',
    [id]
  );
  const adminCredentials = creds.rows[0]
    ? { staffId: creds.rows[0].admin_staff_id, password: decryptSafe(creds.rows[0].admin_password) }
    : undefined;
  return { ...inst.rows[0], adminCredentials, alreadyCreated: true };
}

exports.createInstitution = async (req, res) => {
  const client = await pool.connect();
  // Super-admin route: this transaction client needs the RLS bypass flag
  await pool.applyTenantContext(client, { bypass: true }).catch(() => {});
  try {
    const { name, address, city, region, latitude, longitude, geofenceRadius, requestId } = req.body;

    if (!name || !latitude || !longitude) {
      return res.status(400).json({ error: 'Name, latitude, and longitude are required' });
    }

    // The dashboard sends one requestId per form submission and reuses it on
    // retries (e.g. after a timeout while Render wakes up). Using it as the id
    // makes a repeated request return the first institution instead of a duplicate.
    const id = UUID_PATTERN.test(String(requestId || '')) ? String(requestId).toLowerCase() : uuidv4();
    const existing = await getCreatedInstitution(id, req.tenantDb);
    if (existing) return res.json(existing);

    await client.query('BEGIN');

    // Insert with a freshly generated code; retry on unique violation (up to 5 attempts)
    let created = null;
    let institutionCode = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      institutionCode = await generateInstitutionCode(req.tenantDb);
      try {
        const result = await client.query(
          `INSERT INTO institutions (id, name, institution_code, address, city, region, latitude, longitude, geofence_radius)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [id, name, institutionCode, address || null, city || null, region || null, latitude, longitude, geofenceRadius || 200]
        );
        created = result.rows[0];
      } catch (insertErr) {
        // Unique violation on institution_code → retry with a new code
        if (insertErr.code === '23505' && insertErr.constraint === 'ux_institutions_code') {
          console.warn(`Institution code collision on attempt ${attempt + 1}, retrying...`);
          continue;
        }
        throw insertErr;
      }
    }

    if (!created) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Failed to generate a unique institution code after multiple attempts' });
    }

    // Ensure code is present (defensive against triggers/DB quirks)
    if (!created.institution_code) {
      const repairCode = await generateInstitutionCode(req.tenantDb);
      const upd = await client.query(
        `UPDATE institutions SET institution_code = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [repairCode, id]
      );
      if (upd.rows.length > 0) {
        created = upd.rows[0];
        console.log(`Institution ${id}: code repaired to ${repairCode}`);
      }
    }

    // Create default attendance rules (handle missing member_type column gracefully)
    try {
      await client.query(
        `INSERT INTO attendance_rules (institution_id, member_type)
         VALUES ($1, 'staff')
         ON CONFLICT (institution_id, member_type) DO NOTHING`,
        [id]
      );
    } catch (rulesErr) {
      // Fallback for older schemas without member_type
      if (rulesErr.message.includes('member_type')) {
        await client.query(
          `INSERT INTO attendance_rules (institution_id)
           VALUES ($1)
           ON CONFLICT (institution_id) DO NOTHING`,
          [id]
        ).catch(() => {}); // Ignore if still fails
      }
    }

    // Ensure trial subscription exists
    await ensureTrialSubscription(id, client);

    // Always create initial admin account + store credentials
    const adminCredentials = await createInitialAdminCredentials(id, null, client);

    await client.query('COMMIT');

    // Return the fully persisted record
    res.status(201).json({ ...created, adminCredentials });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // A concurrent retry of the same request committed first — return that one
    if (err.code === '23505' && err.constraint === 'institutions_pkey') {
      const existing = await getCreatedInstitution(req.body.requestId, req.tenantDb).catch(() => null);
      if (existing) return res.json(existing);
    }
    console.error('Create institution error:', err);
    const debug = process.env.NODE_ENV !== 'production' ? err.message : undefined;
    res.status(500).json({ error: 'Server error', ...(debug && { debug }) });
  } finally {
    client.release();
  }
};

exports.repairInstitutionCode = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Institution id is required' });

    const existing = await req.tenantDb.query('SELECT id, institution_code FROM institutions WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Institution not found' });
    }
    if (existing.rows[0].institution_code) {
      return res.json({ message: 'Institution already has a code', institution: existing.rows[0] });
    }

    const code = await generateInstitutionCode(req.tenantDb);
    const updated = await req.tenantDb.query(
      'UPDATE institutions SET institution_code = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [code, id]
    );

    res.json({ message: 'Institution code repaired', institution: updated.rows[0] });
  } catch (err) {
    console.error('Repair institution code error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Super admin: permanently delete an institution and everything that belongs to it
// (staff, attendance, leave, subscriptions, ... all cascade from institutions).
exports.deleteInstitution = async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  // Super-admin route: this transaction client needs the RLS bypass flag
  await pool.applyTenantContext(client, { bypass: true }).catch(() => {});
  try {
    const existing = await client.query(
      `SELECT i.id, i.name, i.institution_code,
              (SELECT COUNT(*) FROM staff s WHERE s.institution_id = i.id) AS staff_count,
              (SELECT COUNT(*) FROM staff s WHERE s.institution_id = i.id AND s.role = 'super_admin') AS super_admin_count
       FROM institutions i WHERE i.id = $1`,
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Institution not found' });
    }
    const institution = existing.rows[0];

    // Deleting this would cascade-delete the super admin account(s) themselves
    if (id === req.user.institution_id || parseInt(institution.super_admin_count, 10) > 0) {
      return res.status(400).json({ error: 'This institution holds a super admin account and cannot be deleted' });
    }

    await client.query('BEGIN');
    // leave_requests.reviewed_by has no ON DELETE action; detach reviews this
    // institution's staff made in other institutions so the cascade can't fail.
    await client.query(
      `UPDATE leave_requests SET reviewed_by = NULL
       WHERE institution_id <> $1 AND reviewed_by IN (SELECT id FROM staff WHERE institution_id = $1)`,
      [id]
    );
    await client.query('DELETE FROM institutions WHERE id = $1', [id]);
    await client.query('COMMIT');

    // Log against the super admin's own institution so the entry survives the cascade
    logAudit({
      institutionId: req.user.institution_id,
      action: 'delete_institution',
      entityType: 'institution',
      entityId: id,
      details: { name: institution.name, code: institution.institution_code, staffCount: parseInt(institution.staff_count, 10) },
      performedBy: req.user.id,
      ipAddress: req.ip,
    });

    res.json({ message: `${institution.name} deleted`, id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Delete institution error:', err);
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Institution still has linked records that block deletion' });
    }
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
};

exports.getSubscriptionStatus = async (req, res) => {
  try {
    await ensureTrialSubscription(req.user.institution_id);
    const subscription = await getCurrentSubscription(req.user.institution_id);
    res.json({ subscription: buildSubscriptionSnapshot(subscription) });
  } catch (err) {
    console.error('Get subscription status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const axios = require('axios');

exports.activateSubscription = async (req, res) => {
  try {
    const { planName, durationDays, paymentReference } = req.body;
    const days = parseInt(durationDays || '30', 10);

    if (!Number.isFinite(days) || days < 1 || days > 366) {
      return res.status(400).json({ error: 'durationDays must be between 1 and 366' });
    }

    // If a paymentReference is provided, verify it with Paystack using secret key
    if (paymentReference) {
      const secret = process.env.PAYSTACK_SECRET_KEY;
      if (!secret) {
        return res.status(500).json({ error: 'Payment verification not configured on server' });
      }

      try {
        const verifyRes = await axios.get(`https://api.paystack.co/transaction/verify/${encodeURIComponent(paymentReference)}`, {
          headers: { Authorization: `Bearer ${secret}` },
          timeout: 15000,
        });
        const verified = verifyRes.data && verifyRes.data.data && verifyRes.data.data.status === 'success';
        if (!verified) {
          return res.status(400).json({ error: 'Payment not verified or failed' });
        }
      } catch (verErr) {
        console.error('Paystack verify error:', verErr?.response?.data || verErr.message || verErr);
        return res.status(400).json({ error: 'Failed to verify payment reference' });
      }
    }

    const result = await req.tenantDb.query(
      `INSERT INTO subscriptions (institution_id, plan_name, status, trial_start, trial_end, current_period_end, payment_reference)
       VALUES ($1, $2, 'active', NULL, NULL, NOW() + ($3 || ' days')::INTERVAL, $4)
       RETURNING id, plan_name, status, trial_start, trial_end, current_period_end, payment_reference`,
      [req.user.institution_id, planName || 'paid_plan', String(days), paymentReference || null]
    );

    res.json({
      message: 'Subscription activated',
      subscription: buildSubscriptionSnapshot(result.rows[0]),
    });
  } catch (err) {
    console.error('Activate subscription error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.extendTrial = async (req, res) => {
  try {
    const extraDays = parseInt(req.body.extraDays || String(DEFAULT_TRIAL_DAYS), 10);
    if (!Number.isFinite(extraDays) || extraDays < 1 || extraDays > 90) {
      return res.status(400).json({ error: 'extraDays must be between 1 and 90' });
    }

    await ensureTrialSubscription(req.user.institution_id);
    const updated = await req.tenantDb.query(
      `WITH latest AS (
         SELECT id
         FROM subscriptions
         WHERE institution_id = $2
         ORDER BY created_at DESC
         LIMIT 1
       )
       UPDATE subscriptions s
       SET status = 'trialing',
           trial_end = GREATEST(COALESCE(s.trial_end, NOW()), NOW()) + ($1 || ' days')::INTERVAL,
           updated_at = NOW()
       FROM latest
       WHERE s.id = latest.id
       RETURNING s.id, s.plan_name, s.status, s.trial_start, s.trial_end, s.current_period_end, s.payment_reference`,
      [String(extraDays), req.user.institution_id]
    );
    if (updated.rows.length === 0) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    res.json({
      message: 'Trial extended',
      subscription: buildSubscriptionSnapshot(updated.rows[0]),
    });
  } catch (err) {
    console.error('Extend trial error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getAttendanceRules = async (req, res) => {
  try {
    const result = await req.tenantDb.query(
      "SELECT * FROM attendance_rules WHERE institution_id = $1 AND member_type = 'staff'",
      [req.user.institution_id]
    );
    res.json(result.rows[0] || {});
  } catch (err) {
    console.error('Get attendance rules error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateAttendanceRules = async (req, res) => {
  try {
    const { workStartTime, workEndTime, lateThresholdMinutes, earlyDepartureMinutes, workingDays, overtimeMultiplier } = req.body;
    const institutionId = req.user.institution_id;

    const multiplierValue = overtimeMultiplier === undefined || overtimeMultiplier === null
      ? null
      : Math.max(1, Math.min(3, parseFloat(overtimeMultiplier)));

    const result = await req.tenantDb.query(
      `UPDATE attendance_rules SET
        work_start_time = COALESCE($1, work_start_time),
        work_end_time = COALESCE($2, work_end_time),
        late_threshold_minutes = COALESCE($3, late_threshold_minutes),
        early_departure_minutes = COALESCE($4, early_departure_minutes),
        working_days = COALESCE($5, working_days),
        overtime_multiplier = COALESCE($6, overtime_multiplier),
        updated_at = NOW()
       WHERE institution_id = $7 AND member_type = 'staff'
       RETURNING *`,
      [workStartTime, workEndTime, lateThresholdMinutes, earlyDepartureMinutes, workingDays, multiplierValue, institutionId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update attendance rules error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getInstitutionQR = async (req, res) => {
  try {
    const result = await req.tenantDb.query(
      'SELECT * FROM institutions WHERE id = $1',
      [req.user.institution_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Institution not found' });
    }

    const institution = result.rows[0];
    const qrCode = await generateInstitutionQR(institution);

    res.json({
      qrCode,
      institutionName: institution.name,
      institutionId: institution.id,
      hasRotationToken: Boolean(institution.qr_rotation_token),
      rotatedAt: institution.qr_rotated_at || null,
    });
  } catch (err) {
    console.error('Get institution QR error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Admin: rotate the entrance QR. A new rotation token is issued, so any
// previously printed/sign-posted QR (or a photo of it) stops being accepted.
// The endpoint returns the fresh QR plus the print-ready message.
exports.rotateInstitutionQR = async (req, res) => {
  try {
    const token = crypto.randomBytes(24).toString('hex');
    const result = await req.tenantDb.query(
      `UPDATE institutions
       SET qr_rotation_token = $1, qr_rotated_at = NOW(), updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, qr_rotated_at`,
      [token, req.user.institution_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Institution not found' });
    }

    const institution = { ...result.rows[0], qr_rotation_token: token };
    const qrCode = await generateInstitutionQR(institution);

    await logAudit({
      institutionId: req.user.institution_id,
      action: 'rotate_institution_qr',
      entityType: 'institution',
      entityId: institution.id,
      details: { rotatedAt: institution.qr_rotated_at },
      performedBy: req.user.id,
      ipAddress: req.ip,
    });

    res.json({
      qrCode,
      institutionName: institution.name,
      institutionId: institution.id,
      rotatedAt: institution.qr_rotated_at,
      message: 'Entrance QR rotated — old prints are no longer valid. Reprint and replace the sign.',
    });
  } catch (err) {
    console.error('Rotate institution QR error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Super admin: decrypt and return the stored admin credentials for an
// institution (password, admin staff ID and institution code). Every
// retrieval is audit-logged.
exports.getAdminCredentials = async (req, res) => {
  try {
    const { id } = req.params;
    const inst = await req.tenantDb.query(
      'SELECT id, name, institution_code FROM institutions WHERE id = $1',
      [id]
    );
    if (inst.rows.length === 0) {
      return res.status(404).json({ error: 'Institution not found' });
    }

    const creds = await req.tenantDb.query(
      'SELECT admin_staff_id, admin_password, updated_at FROM institution_admin_credentials WHERE institution_id = $1',
      [id]
    );
    if (creds.rows.length === 0) {
      return res.status(404).json({ error: 'No stored admin credentials for this institution' });
    }

    await logAudit({
      institutionId: req.user.institution_id,
      action: 'view_admin_credentials',
      entityType: 'institution',
      entityId: id,
      details: { adminStaffId: creds.rows[0].admin_staff_id },
      performedBy: req.user.id,
      ipAddress: req.ip,
    });

    const storedPassword = decryptSafe(creds.rows[0].admin_password);

    res.json({
      institution: inst.rows[0],
      credentials: {
        staffId: creds.rows[0].admin_staff_id,
        password: storedPassword,
        passwordUnavailable: storedPassword === null,
        passwordUnavailableHint: storedPassword === null
          ? 'This password was stored under a previous server key. Generate new credentials to replace it.'
          : null,
      },
      updatedAt: creds.rows[0].updated_at,
    });
  } catch (err) {
    console.error('Get admin credentials error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Super admin: decrypted admin credentials (password, admin ID, institution
// code) for EVERY institution in one call. Each row retrieval is audit-logged.
exports.getAllAdminCredentials = async (req, res) => {
  try {
    const rows = await req.tenantDb.query(
      `SELECT i.id AS institution_id, i.name AS institution_name, i.institution_code,
              c.admin_staff_id, c.admin_password, c.updated_at
       FROM institutions i
       LEFT JOIN institution_admin_credentials c ON c.institution_id = i.id
       ORDER BY i.created_at DESC`
    );

    await logAudit({
      institutionId: req.user.institution_id,
      action: 'view_all_admin_credentials',
      entityType: 'institution',
      entityId: null,
      details: { count: rows.rows.length },
      performedBy: req.user.id,
      ipAddress: req.ip,
    });

    res.json(rows.rows.map((row) => {
      const password = row.admin_password ? decryptSafe(row.admin_password) : null;
      return {
        institutionId: row.institution_id,
        name: row.institution_name,
        code: row.institution_code,
        adminStaffId: row.admin_staff_id || null,
        adminPassword: password,
        passwordUnavailable: Boolean(row.admin_password) && password === null,
        updatedAt: row.updated_at || null,
      };
    }));
  } catch (err) {
    console.error('Get all admin credentials error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Super admin: create (if missing) or reset the admin credentials for an institution
exports.createOrResetAdminCredentials = async (req, res) => {
  try {
    const { id } = req.params;
    const inst = await req.tenantDb.query(
      'SELECT id, name, institution_code FROM institutions WHERE id = $1',
      [id]
    );
    if (inst.rows.length === 0) {
      return res.status(404).json({ error: 'Institution not found' });
    }

    const existing = await req.tenantDb.query(
      "SELECT id, staff_id FROM staff WHERE institution_id = $1 AND role IN ('admin','super_admin') ORDER BY created_at LIMIT 1",
      [id]
    );

    const rawPassword = crypto.randomBytes(4).toString('hex');
    const passwordHash = await bcrypt.hash(rawPassword, 12);
    let staffId;

    if (existing.rows.length > 0) {
      staffId = existing.rows[0].staff_id;
      await req.tenantDb.query('UPDATE staff SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, existing.rows[0].id]);
      await storeAdminCredentials(id, staffId, rawPassword, req.tenantDb);
    } else {
      const created = await createInitialAdminCredentials(id, rawPassword, req.tenantDb);
      staffId = created.staffId;
    }

    res.json({
      message: existing.rows.length > 0 ? 'Admin password reset' : 'Admin account created',
      credentials: { staffId, password: rawPassword },
    });
  } catch (err) {
    console.error('Create/reset admin credentials error:', err);
    if (err.code === '23505') return res.status(409).json({ error: 'Staff ID already exists — try again' });
    res.status(500).json({ error: 'Server error' });
  }
};
