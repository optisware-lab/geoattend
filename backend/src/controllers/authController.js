const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { logAudit } = require('../middleware/audit');
const {
  normalizeInstitutionCode,
  getInstitutionByCode,
  ensureTrialSubscription,
  getCurrentSubscription,
  buildSubscriptionSnapshot,
} = require('../services/subscriptionService');

async function getSubscriptionPayload(institutionId) {
  await ensureTrialSubscription(institutionId);
  const subscription = await getCurrentSubscription(institutionId);
  return buildSubscriptionSnapshot(subscription);
}

/** Never fail login if subscriptions table or trial row is missing. */
async function getSubscriptionPayloadSafe(institutionId) {
  try {
    return await getSubscriptionPayload(institutionId);
  } catch (e) {
    console.error('Login: subscription payload skipped:', e.message);
    return null;
  }
}

const loginHandler = async (req, res) => {
  try {
    const { staffId, password, institutionCode, deviceId, deviceModel, osVersion } = req.body;
    const normalizedInstitutionCode = normalizeInstitutionCode(institutionCode);

    if (!staffId || !password) {
      return res.status(400).json({ error: 'Staff ID and password are required' });
    }

    let institution;
    let result;
    let staff;

    if (normalizedInstitutionCode) {
      institution = await getInstitutionByCode(normalizedInstitutionCode);
      if (!institution) {
        return res.status(404).json({ error: 'Invalid institution code' });
      }

      result = await pool.query(
        `SELECT s.*, i.name as institution_name, i.address as inst_address, i.city as inst_city, i.region as inst_region,
                i.latitude as inst_lat, i.longitude as inst_lon, i.geofence_radius, i.institution_code as inst_institution_code
         FROM staff s
         JOIN institutions i ON s.institution_id = i.id
         WHERE s.staff_id = $1 AND s.member_type = 'staff' AND s.institution_id = $2 AND s.is_active = true`,
        [staffId.toUpperCase(), institution.id]
      );
      if (result.rows.length === 0) {
        return res.status(401).json({
          error:
            `No account found with Staff ID "${staffId}" for institution code "${normalizedInstitutionCode}". Please check your Staff ID and institution code, or contact your institution administrator.`,
        });
      }
    } else {
      // No institution code provided — try to resolve by staffId across institutions
      result = await pool.query(
        `SELECT s.*, i.name as institution_name, i.address as inst_address, i.city as inst_city, i.region as inst_region, i.latitude as inst_lat, i.longitude as inst_lon, i.geofence_radius, i.institution_code
         FROM staff s
         JOIN institutions i ON s.institution_id = i.id
         WHERE s.staff_id = $1 AND s.member_type = 'staff' AND s.is_active = true AND s.role IN ('admin','super_admin')`,
        [staffId.toUpperCase()]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ error: 'Staff not found. Please provide your institution code.' });
      }
      if (result.rows.length > 1) {
        return res.status(400).json({ error: 'Multiple institutions found for this Staff ID — please provide your institution code.' });
      }
      institution = { id: result.rows[0].institution_id, institution_code: result.rows[0].institution_code };
    }

    staff = result.rows[0];
    if (!staff.password_hash) {
      return res.status(401).json({ error: 'This account signs in with Google. Tap "Continue with Google", or reset your password to use one.' });
    }
    const validPassword = await bcrypt.compare(password, staff.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    logDevice(staff.id, { deviceId, deviceModel, osVersion }, 'login', req.ip);

    const institutionCodeOut =
      institution?.institution_code ||
      staff.inst_institution_code ||
      normalizedInstitutionCode ||
      null;

    res.json(await buildAuthPayload(staff, institutionCodeOut));
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error', debug: err.message });
  }
};

// Log device info (non-blocking — don't fail login if this errors)
function logDevice(staffUuid, { deviceId, deviceModel, osVersion }, action, ipAddress) {
  if (!deviceId) return;
  pool.query(
    `INSERT INTO device_logs (staff_uuid, device_id, device_model, os_version, action, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [staffUuid, String(deviceId).slice(0, 255), deviceModel ? String(deviceModel).slice(0, 255) : null,
     osVersion ? String(osVersion).slice(0, 255) : null, action, ipAddress]
  ).catch(err => console.error('Device log error:', err.message));
}

/** Token + user/institution/subscription payload returned by every sign-in route. */
async function buildAuthPayload(staff, institutionCode) {
  const token = jwt.sign(
    { userId: staff.id, role: staff.role, institutionId: staff.institution_id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );

  const subscription = await getSubscriptionPayloadSafe(staff.institution_id);

  return {
    token,
    user: {
      id: staff.id,
      staffId: staff.staff_id,
      firstName: staff.first_name,
      lastName: staff.last_name,
      email: staff.email,
      phone: staff.phone,
      role: staff.role,
      department: staff.department,
      position: staff.position,
      institutionId: staff.institution_id,
      institutionName: staff.institution_name,
      profilePhoto: staff.profile_photo_url,
    },
    institution: {
      code: institutionCode || staff.inst_institution_code || null,
      name: staff.institution_name,
      address: staff.inst_address,
      city: staff.inst_city,
      region: staff.inst_region,
      latitude: parseFloat(staff.inst_lat),
      longitude: parseFloat(staff.inst_lon),
      geofenceRadius: staff.geofence_radius,
    },
    subscription,
  };
}

// ========== GOOGLE SIGN-IN ==========

const googleClient = new OAuth2Client();

const STAFF_WITH_INSTITUTION_SQL = `
  SELECT s.*, i.name as institution_name, i.address as inst_address, i.city as inst_city, i.region as inst_region,
         i.latitude as inst_lat, i.longitude as inst_lon, i.geofence_radius, i.institution_code as inst_institution_code
  FROM staff s
  JOIN institutions i ON s.institution_id = i.id`;

async function getStaffWithInstitution(id) {
  const result = await pool.query(`${STAFF_WITH_INSTITUTION_SQL} WHERE s.id = $1`, [id]);
  return result.rows[0];
}

/**
 * Verifies a Google ID token issued to one of our OAuth clients and returns the
 * Google profile. The token is checked against Google's signing keys, so the
 * client can't just claim an identity.
 */
async function verifyGoogleIdToken(idToken) {
  const audience = (process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (audience.length === 0) {
    const err = new Error('Google sign-in is not configured on the server');
    err.status = 503;
    throw err;
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience });
    payload = ticket.getPayload();
  } catch (e) {
    console.error('Google token verification failed:', e.message);
    const err = new Error('Google sign-in could not be verified. Please try again.');
    err.status = 401;
    throw err;
  }

  return {
    googleId: String(payload.sub),
    email: payload.email ? payload.email.toLowerCase() : null,
    emailVerified: payload.email_verified === true,
    ...googleNameParts(payload),
    picture: payload.picture || null,
  };
}

/**
 * Google's given_name/family_name are optional: many accounts only have a
 * display name, or a first name with the surname left blank. Fall back to the
 * full display name, but only split it when it is unambiguous; otherwise leave
 * the last name empty so the sign-up form asks for it.
 */
function googleNameParts(payload) {
  const full = String(payload.name || '').trim().replace(/\s+/g, ' ');
  let first = String(payload.given_name || '').trim();
  let last = String(payload.family_name || '').trim();

  if (!last && full) {
    if (first && full.toLowerCase().startsWith(`${first.toLowerCase()} `)) {
      // e.g. given_name "Ama", name "Ama Mensah" -> last "Mensah"
      last = full.slice(first.length).trim();
    } else if (!first) {
      // No given_name either: "Ama Mensah" -> Ama / Mensah
      const parts = full.split(' ');
      last = parts.length > 1 ? parts.pop() : '';
      first = parts.join(' ');
    }
  }
  if (!first) first = full;

  return { firstName: first.slice(0, 100), lastName: last.slice(0, 100) };
}

/**
 * Finds the staff account for a Google identity: first by linked google_id,
 * then by a verified email match (which links the Google account to it).
 * Returns { staff } or { error, status }.
 */
async function findStaffForGoogle(google, institution) {
  const byGoogleId = await pool.query(
    `${STAFF_WITH_INSTITUTION_SQL} WHERE s.google_id = $1 AND s.member_type = 'staff'`,
    [google.googleId]
  );
  if (byGoogleId.rows.length > 0) {
    const staff = byGoogleId.rows[0];
    if (institution && staff.institution_id !== institution.id) {
      return { status: 409, error: 'This Google account is already linked to a different institution.' };
    }
    if (!staff.is_active) {
      return { status: 403, error: 'Your account has been deactivated. Please contact your administrator.' };
    }
    return { staff };
  }

  if (!google.email || !google.emailVerified) return { staff: null };

  const params = [google.email];
  let sql = `${STAFF_WITH_INSTITUTION_SQL}
    WHERE LOWER(s.email) = $1 AND s.member_type = 'staff' AND s.is_active = true AND s.google_id IS NULL`;
  if (institution) {
    sql += ' AND s.institution_id = $2';
    params.push(institution.id);
  }
  const byEmail = await pool.query(sql, params);
  if (byEmail.rows.length === 0) return { staff: null };
  if (byEmail.rows.length > 1) {
    return { status: 400, error: 'Multiple accounts use this email — please enter your institution code.' };
  }

  const staff = byEmail.rows[0];
  await pool.query(
    'UPDATE staff SET google_id = $1, profile_photo_url = COALESCE(profile_photo_url, $2), updated_at = NOW() WHERE id = $3',
    [google.googleId, google.picture, staff.id]
  );
  staff.google_id = google.googleId;
  return { staff };
}

const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{6,18}[0-9]$/;

/**
 * Step 1 of Google sign-in / sign-up. Signs in a linked account that has a
 * phone number on file; otherwise asks the app to collect the missing details
 * (phone, institution) and call /auth/google/complete.
 */
const googleAuthHandler = async (req, res) => {
  try {
    const { idToken, institutionCode, deviceId, deviceModel, osVersion } = req.body;
    if (!idToken) return res.status(400).json({ error: 'Google ID token is required' });

    const google = await verifyGoogleIdToken(idToken);

    const normalizedInstitutionCode = normalizeInstitutionCode(institutionCode);
    let institution = null;
    if (normalizedInstitutionCode) {
      institution = await getInstitutionByCode(normalizedInstitutionCode);
      if (!institution) return res.status(404).json({ error: 'Invalid institution code' });
    }

    const found = await findStaffForGoogle(google, institution);
    if (found.error) return res.status(found.status).json({ error: found.error });
    const { staff } = found;

    if (!staff || !staff.phone) {
      return res.json({
        needsProfile: true,
        existingAccount: !!staff,
        profile: {
          email: staff?.email || google.email,
          firstName: staff?.first_name || google.firstName,
          lastName: staff?.last_name || google.lastName,
          photo: staff?.profile_photo_url || google.picture,
          institutionCode: staff?.inst_institution_code || normalizedInstitutionCode || null,
          institutionName: staff?.institution_name || null,
        },
      });
    }

    logDevice(staff.id, { deviceId, deviceModel, osVersion }, 'google_login', req.ip);
    res.json(await buildAuthPayload(staff));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Google auth error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Step 2 of Google sign-in / sign-up: saves the phone number (and name) for a
 * linked account, or creates a new staff account from the Google profile.
 */
const completeGoogleSignupHandler = async (req, res) => {
  try {
    const {
      idToken, institutionCode, phone, firstName, lastName, staffId, department, position,
      deviceId, deviceModel, osVersion,
    } = req.body;
    if (!idToken) return res.status(400).json({ error: 'Google ID token is required' });

    const cleanPhone = String(phone || '').trim();
    if (!PHONE_PATTERN.test(cleanPhone)) {
      return res.status(400).json({ error: 'Please enter a valid phone number' });
    }
    const cleanFirstName = String(firstName || '').trim().slice(0, 100);
    const cleanLastName = String(lastName || '').trim().slice(0, 100);

    const google = await verifyGoogleIdToken(idToken);

    const normalizedInstitutionCode = normalizeInstitutionCode(institutionCode);
    let institution = null;
    if (normalizedInstitutionCode) {
      institution = await getInstitutionByCode(normalizedInstitutionCode);
      if (!institution) return res.status(404).json({ error: 'Invalid institution code' });
    }

    const found = await findStaffForGoogle(google, institution);
    if (found.error) return res.status(found.status).json({ error: found.error });

    let staffUuid;
    let created = false;

    if (found.staff) {
      staffUuid = found.staff.id;
      await pool.query(
        `UPDATE staff SET phone = $1,
           first_name = COALESCE(NULLIF($2, ''), first_name),
           last_name = COALESCE(NULLIF($3, ''), last_name),
           updated_at = NOW()
         WHERE id = $4`,
        [cleanPhone, cleanFirstName, cleanLastName, staffUuid]
      );
    } else {
      if (!institution) {
        return res.status(400).json({ error: 'Institution code is required to create your account' });
      }
      if (!cleanFirstName || !cleanLastName) {
        return res.status(400).json({ error: 'First name and last name are required' });
      }

      let finalStaffId = String(staffId || '').trim().toUpperCase().slice(0, 50);
      if (finalStaffId) {
        const taken = await pool.query(
          'SELECT id FROM staff WHERE staff_id = $1 AND institution_id = $2',
          [finalStaffId, institution.id]
        );
        if (taken.rows.length > 0) {
          return res.status(409).json({ error: 'That Staff ID is already registered. Leave it blank to get one assigned.' });
        }
      } else {
        for (let attempt = 0; attempt < 5 && !finalStaffId; attempt++) {
          const candidate = 'G' + crypto.randomBytes(3).toString('hex').toUpperCase();
          const taken = await pool.query(
            'SELECT id FROM staff WHERE staff_id = $1 AND institution_id = $2',
            [candidate, institution.id]
          );
          if (taken.rows.length === 0) finalStaffId = candidate;
        }
        if (!finalStaffId) return res.status(500).json({ error: 'Could not assign a Staff ID — please try again' });
      }

      const insert = await pool.query(
        `INSERT INTO staff (institution_id, staff_id, first_name, last_name, email, phone, department, position,
                            google_id, profile_photo_url, qr_code_data, role, member_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'staff', 'staff')
         RETURNING id`,
        [institution.id, finalStaffId, cleanFirstName, cleanLastName, google.email, cleanPhone,
         department ? String(department).trim().slice(0, 100) : null,
         position ? String(position).trim().slice(0, 100) : null,
         google.googleId, google.picture, `STAFF-${institution.id}-${finalStaffId}`]
      );
      staffUuid = insert.rows[0].id;
      created = true;

      logAudit({
        institutionId: institution.id,
        action: 'google_signup',
        entityType: 'staff',
        entityId: staffUuid,
        details: { staffId: finalStaffId, name: `${cleanFirstName} ${cleanLastName}`, email: google.email, phone: cleanPhone },
        performedBy: staffUuid,
        ipAddress: req.ip,
      });
    }

    const staff = await getStaffWithInstitution(staffUuid);
    logDevice(staff.id, { deviceId, deviceModel, osVersion }, 'google_login', req.ip);
    res.status(created ? 201 : 200).json(await buildAuthPayload(staff));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Complete Google signup error:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This Google account or Staff ID is already registered' });
    }
    res.status(500).json({ error: 'Server error' });
  }
};

const registerHandler = async (req, res) => {
  try {
    const { staffId, firstName, lastName, email, phone, password, department, position, institutionCode } = req.body;
    const normalizedInstitutionCode = normalizeInstitutionCode(institutionCode);

    if (!staffId || !firstName || !lastName || !password || !normalizedInstitutionCode) {
      return res.status(400).json({ error: 'Staff ID, first name, last name, password, and institution code are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const institution = await getInstitutionByCode(normalizedInstitutionCode);
    if (!institution) {
      return res.status(404).json({ error: 'Invalid institution code' });
    }
    const institutionId = institution.id;

    // Check if staff ID already exists
    const existing = await pool.query(
      'SELECT id FROM staff WHERE staff_id = $1 AND institution_id = $2',
      [staffId.toUpperCase(), institutionId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Staff ID already registered. Please login or contact admin.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const qrData = `STAFF-${institutionId}-${staffId.toUpperCase()}`;

    const result = await pool.query(
      `INSERT INTO staff (institution_id, staff_id, first_name, last_name, email, phone, department, position, password_hash, qr_code_data, role, member_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'staff', 'staff')
       RETURNING id`,
      [institutionId, staffId.toUpperCase(), firstName, lastName, email || null, phone || null, department || null, position || null, passwordHash, qrData]
    );

    res.status(201).json({ message: 'Registration successful. You can now login with your Staff ID and password.' });
  } catch (err) {
    console.error('Register error:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Staff ID or email already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new passwords are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const result = await req.tenantDb.query('SELECT password_hash FROM staff WHERE id = $1', [req.user.id]);
    if (!result.rows[0]?.password_hash) {
      return res.status(400).json({ error: 'This account signs in with Google and has no password yet. Use Forgot Password to set one.' });
    }
    const validPassword = await bcrypt.compare(currentPassword, result.rows[0].password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await req.tenantDb.query('UPDATE staff SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, req.user.id]);

    // Clear any stored plaintext credential for this institution so the super admin
    // can no longer hand out a stale password; they must reset it from the dashboard.
    await req.tenantDb.query(
      'DELETE FROM institution_admin_credentials WHERE institution_id = $1',
      [req.user.institution_id]
    ).catch(() => {});

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const forgotPasswordHandler = async (req, res) => {
  try {
    const { staffId, email, newPassword, institutionCode } = req.body;
    const normalizedInstitutionCode = normalizeInstitutionCode(institutionCode);

    if (!staffId || !email || !newPassword || !normalizedInstitutionCode) {
      return res.status(400).json({ error: 'Staff ID, email, new password, and institution code are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const institution = await getInstitutionByCode(normalizedInstitutionCode);
    if (!institution) {
      return res.status(404).json({ error: 'Invalid institution code' });
    }

    const result = await req.tenantDb.query(
      "SELECT id FROM staff WHERE staff_id = $1 AND email = $2 AND member_type = 'staff' AND institution_id = $3 AND is_active = true",
      [staffId.toUpperCase(), email.toLowerCase().trim(), institution.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No account found with that Staff ID and email combination' });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await req.tenantDb.query('UPDATE staff SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, result.rows[0].id]);

    res.json({ message: 'Password reset successfully. You can now login with your new password.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Public helper: find a user's Staff ID using institution code + email.
const forgotStaffIdHandler = async (req, res) => {
  try {
    const { institutionCode, email } = req.body;
    const normalizedInstitutionCode = normalizeInstitutionCode(institutionCode);

    if (!email || !normalizedInstitutionCode) {
      return res.status(400).json({ error: 'Email and institution code are required' });
    }

    const institution = await getInstitutionByCode(normalizedInstitutionCode);
    if (!institution) {
      return res.status(404).json({ error: 'Invalid institution code' });
    }

    const result = await req.tenantDb.query(
      "SELECT staff_id, first_name, last_name FROM staff WHERE LOWER(email) = $1 AND member_type = 'staff' AND institution_id = $2 AND is_active = true",
      [email.toLowerCase().trim(), institution.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No account found with that email' });
    }

    res.json({
      staffId: result.rows[0].staff_id,
      firstName: result.rows[0].first_name,
      lastName: result.rows[0].last_name,
    });
  } catch (err) {
    console.error('Forgot staff ID error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Super-admin helper: create the initial admin for an institution and return credentials.
exports.createInitialAdmin = async (req, res) => {
  try {
    const { institutionCode, staffId, firstName, lastName, email, phone } = req.body;
    const normalizedInstitutionCode = normalizeInstitutionCode(institutionCode);

    if (!normalizedInstitutionCode) {
      return res.status(400).json({ error: 'Institution code is required' });
    }

    const institution = await getInstitutionByCode(normalizedInstitutionCode);
    if (!institution) {
      return res.status(404).json({ error: 'Invalid institution code' });
    }

    const institutionId = institution.id;

    // Prevent creating a second admin if one already exists for this institution
    const existingAdmin = await req.tenantDb.query(
      "SELECT id FROM staff WHERE institution_id = $1 AND role IN ('admin','super_admin')",
      [institutionId]
    );
    if (existingAdmin.rows.length > 0) {
      return res.status(409).json({ error: 'An admin account already exists for this institution' });
    }

    const finalStaffId = staffId ? staffId.toUpperCase() : ('ADMIN' + crypto.randomBytes(3).toString('hex').toUpperCase());

    // Ensure unique staff id within institution
    const collide = await req.tenantDb.query('SELECT id FROM staff WHERE staff_id = $1 AND institution_id = $2', [finalStaffId, institutionId]);
    if (collide.rows.length > 0) {
      return res.status(409).json({ error: 'Generated Staff ID already exists — try again' });
    }

    const rawPassword = crypto.randomBytes(4).toString('hex');
    const passwordHash = await bcrypt.hash(rawPassword, 12);
    const qrData = `STAFF-${institutionId}-${finalStaffId}`;

    const insertResult = await req.tenantDb.query(
      `INSERT INTO staff (institution_id, staff_id, first_name, last_name, email, phone, password_hash, qr_code_data, role, member_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'admin', 'staff')
       RETURNING id, staff_id, first_name, last_name, email`,
      [institutionId, finalStaffId, firstName || 'Admin', lastName || 'User', email || null, phone || null, passwordHash, qrData]
    );

    // Store the credentials AES-encrypted at rest so the super admin can
    // decrypt them later; the plaintext is only present in this response.
    await req.tenantDb.query(
      `INSERT INTO institution_admin_credentials (institution_id, admin_staff_id, admin_password)
       VALUES ($1, $2, $3)
       ON CONFLICT (institution_id) DO UPDATE SET
         admin_staff_id = EXCLUDED.admin_staff_id,
         admin_password = EXCLUDED.admin_password,
         updated_at = NOW()`,
      [institutionId, finalStaffId, require('../utils/credentialsCrypto').encrypt(rawPassword)]
    ).catch(err => console.error('Create initial admin: store credentials error:', err.message));

    // Return the plaintext password once so the super-admin can relay it securely.
    res.status(201).json({
      message: 'Initial admin created',
      credentials: { staffId: finalStaffId, password: rawPassword },
      staff: insertResult.rows[0],
    });
  } catch (err) {
    console.error('Create initial admin error:', err);
    if (err.code === '23505') return res.status(409).json({ error: 'Staff ID or email already exists' });
    res.status(500).json({ error: 'Server error' });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    const staff = req.user;
    const token = jwt.sign(
      {
        userId: staff.userId || staff.id,
        role: staff.role,
        institutionId: staff.institution_id || staff.institutionId,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );
    res.json({ token });
  } catch (err) {
    console.error('Refresh token error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.savePushToken = async (req, res) => {
  try {
    const { pushToken } = req.body;
    if (!pushToken) return res.status(400).json({ error: 'Push token is required' });

    await req.tenantDb.query(
      `UPDATE staff SET push_token = $1, updated_at = NOW() WHERE id = $2`,
      [pushToken, req.user.id]
    );
    res.json({ message: 'Push token saved' });
  } catch (err) {
    console.error('Save push token error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const result = await req.tenantDb.query(
      `SELECT s.id, s.staff_id, s.first_name, s.last_name, s.email, s.phone,
              s.department, s.position, s.role, s.profile_photo_url, s.qr_code_data,
              i.name as institution_name, i.latitude, i.longitude, i.geofence_radius
       FROM staff s
       JOIN institutions i ON s.institution_id = i.id
       WHERE s.id = $1`,
      [req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};


// Public sign-in flows run before a user identity exists, so Postgres RLS has
// no institution context yet - they execute with the system bypass and the
// handlers themselves verify the institution link before issuing a JWT.
const withSystem = (handler) => (req, res) =>
  pool.withSystemContext(() => handler(req, res));

exports.login = withSystem(loginHandler);
exports.googleAuth = withSystem(googleAuthHandler);
exports.completeGoogleSignup = withSystem(completeGoogleSignupHandler);
exports.register = withSystem(registerHandler);
exports.forgotPassword = withSystem(forgotPasswordHandler);
exports.forgotStaffId = withSystem(forgotStaffIdHandler);