const bcrypt = require('bcryptjs');
const { normalizeInstitutionType, guessInstitutionType, leaveEnabledFor } = require('../utils/institutionType');
const { normalizeGender } = require('../utils/gender');
const jwt = require('jsonwebtoken');
const { signSessionToken, optionsFromClaims } = require('../utils/authToken');
const { nextStaffId, prefixFor, hasPrefix } = require('../utils/staffIds');
const { freeAdminId } = require('../utils/institutionCodes');
const { formatName } = require('../utils/names');
const { sendServerError } = require('../utils/serverError');
const pool = require('../config/database');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { logAudit } = require('../middleware/audit');
const { sendEmail } = require('../services/emailService');
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
    const { staffId, password, institutionCode, deviceId, deviceModel, osVersion, dashboard, remember } = req.body;
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
         WHERE (s.staff_id = $1 OR $1 = ANY(s.legacy_staff_ids))
           AND s.member_type = 'staff' AND s.institution_id = $2 AND s.is_active = true
         ORDER BY (s.staff_id = $1) DESC
         LIMIT 1`,
        [staffId.toUpperCase(), institution.id]
      );
      if (result.rows.length === 0) {
        return res.status(401).json({
          error:
            `No account found with Staff ID "${staffId}" for institution code "${normalizedInstitutionCode}". Please check your Staff ID and institution code, or contact your institution administrator.`,
        });
      }
    } else {
      // No institution code provided — admins are found by their Admin ID
      // alone (it starts with the school code, e.g. RSSADMIN). An old ID
      // that was renamed still works.
      result = await pool.query(
        `SELECT s.*, i.name as institution_name, i.address as inst_address, i.city as inst_city, i.region as inst_region, i.latitude as inst_lat, i.longitude as inst_lon, i.geofence_radius, i.institution_code
         FROM staff s
         JOIN institutions i ON s.institution_id = i.id
         WHERE (s.staff_id = $1 OR $1 = ANY(s.legacy_staff_ids))
           AND s.member_type = 'staff' AND s.is_active = true AND s.role IN ('admin','super_admin')`,
        [staffId.trim().toUpperCase()]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ error: 'Staff not found. Please enter your school code too.' });
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

    res.json(await buildAuthPayload(staff, institutionCodeOut, { dashboard: dashboard === true, remember: remember === true }));
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

/** Token + user/institution/subscription payload returned by every login route. */
async function buildAuthPayload(staff, institutionCode, tokenOptions) {
  const token = signSessionToken(staff, tokenOptions);

  const subscription = await getSubscriptionPayloadSafe(staff.institution_id);
  // School or business decides whether the apps show leave requests
  let institutionType = 'school';
  try {
    const t = await pool.query('SELECT institution_type FROM institutions WHERE id = $1', [staff.institution_id]);
    institutionType = t.rows[0]?.institution_type || 'school';
  } catch { /* keep the default */ }

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
      type: institutionType,
      leaveEnabled: leaveEnabledFor(institutionType),
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
    const err = new Error('Google login is not configured on the server');
    err.status = 503;
    throw err;
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience });
    payload = ticket.getPayload();
  } catch (e) {
    console.error('Google token verification failed:', e.message);
    const err = new Error('Google login could not be verified. Please try again.');
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

// Ghana numbers are written as 0550687839 or +233550687839; the last 9
// digits are the same either way, so compare on those.
const PHONE_KEY_SQL = "RIGHT(regexp_replace(COALESCE(s.phone, ''), '[^0-9]', '', 'g'), 9)";
const phoneKey = (phone) => String(phone || '').replace(/\D/g, '').slice(-9);

/**
 * Finds an account at this institution that already uses the email or phone,
 * so the same person can't sign up a second time with another Google account
 * or a password. Returns a 409 { status, error } or null.
 */
async function findDuplicateSignup(institutionId, { email, phone, excludeId = null }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const key = phoneKey(phone);
  if (!cleanEmail && key.length < 9) return null;

  const { rows } = await pool.query(
    `SELECT s.staff_id, s.google_id IS NOT NULL AS uses_google,
            ($2 <> '' AND LOWER(s.email) = $2) AS email_match
       FROM staff s
      WHERE s.institution_id = $1
        AND ($4::uuid IS NULL OR s.id <> $4::uuid)
        AND (($2 <> '' AND LOWER(s.email) = $2) OR (LENGTH($3) = 9 AND ${PHONE_KEY_SQL} = $3))
      ORDER BY s.created_at
      LIMIT 1`,
    [institutionId, cleanEmail, key, excludeId]
  );
  if (rows.length === 0) return null;

  const match = rows[0];
  const what = match.email_match ? 'email address' : 'phone number';
  const how = match.uses_google
    ? 'Sign in with Google using the account you used before'
    : `Log in with Staff ID ${match.staff_id}, or use Forgot Password`;
  return {
    status: 409,
    error: `This ${what} is already registered (Staff ID ${match.staff_id}). ${how}. If this isn't you, ask your admin.`,
  };
}

/**
 * Step 1 of Google login / sign-up. Signs in a linked account that has a
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
 * Step 2 of Google login / sign-up: saves the phone number (and name) for a
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
    const cleanFirstName = formatName(String(firstName || ''));
    const cleanLastName = formatName(String(lastName || ''));
    const gender = normalizeGender(req.body.gender);
    if (gender === undefined) return res.status(400).json({ error: 'Gender must be male or female' });

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
      const dup = await findDuplicateSignup(found.staff.institution_id, { phone: cleanPhone, excludeId: staffUuid });
      if (dup) return res.status(dup.status).json({ error: dup.error });
      await pool.query(
        `UPDATE staff SET phone = $1,
           first_name = COALESCE(NULLIF($2, ''), first_name),
           last_name = COALESCE(NULLIF($3, ''), last_name),
           gender = COALESCE($5, gender),
           updated_at = NOW()
         WHERE id = $4`,
        [cleanPhone, cleanFirstName, cleanLastName, staffUuid, gender]
      );
    } else {
      if (!institution) {
        return res.status(400).json({ error: 'Institution code is required to create your account' });
      }
      if (!cleanFirstName || !cleanLastName) {
        return res.status(400).json({ error: 'First name and last name are required' });
      }

      const dup = await findDuplicateSignup(institution.id, { email: google.email, phone: cleanPhone });
      if (dup) return res.status(dup.status).json({ error: dup.error });

      // Staff IDs follow the school's pattern (e.g. RSS001). A typed ID that
      // doesn't is kept as an extra login ID, and a proper one is assigned.
      const typedStaffId = String(staffId || '').trim().toUpperCase().slice(0, 50);
      let finalStaffId = null;
      let legacyIds = [];
      if (typedStaffId) {
        const taken = await pool.query(
          'SELECT id FROM staff WHERE (staff_id = $1 OR $1 = ANY(legacy_staff_ids)) AND institution_id = $2',
          [typedStaffId, institution.id]
        );
        if (taken.rows.length > 0) {
          return res.status(409).json({ error: 'That Staff ID is already registered. Leave it blank to get one assigned.' });
        }
        if (hasPrefix(typedStaffId, await prefixFor(pool, institution.id))) finalStaffId = typedStaffId;
        else legacyIds = [typedStaffId];
      }
      if (!finalStaffId) finalStaffId = await nextStaffId(pool, institution.id);

      const insert = await pool.query(
        `INSERT INTO staff (institution_id, staff_id, first_name, last_name, email, phone, department, position,
                            google_id, profile_photo_url, qr_code_data, role, member_type, gender, legacy_staff_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'staff', 'staff', $12, $13)
         RETURNING id`,
        [institution.id, finalStaffId, cleanFirstName, cleanLastName, google.email, cleanPhone,
         department ? String(department).trim().slice(0, 100) : null,
         position ? String(position).trim().slice(0, 100) : null,
         google.googleId, google.picture, `STAFF-${institution.id}-${finalStaffId}`, gender, legacyIds]
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

    if (!firstName || !lastName || !password || !normalizedInstitutionCode) {
      return res.status(400).json({ error: 'First name, last name, password, and institution code are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const gender = normalizeGender(req.body.gender);
    if (gender === undefined) return res.status(400).json({ error: 'Gender must be male or female' });

    const institution = await getInstitutionByCode(normalizedInstitutionCode);
    if (!institution) {
      return res.status(404).json({ error: 'Invalid institution code' });
    }
    const institutionId = institution.id;

    // Check if staff ID already exists (current or old IDs)
    const typedStaffId = String(staffId || '').trim().toUpperCase().slice(0, 50);
    const existing = typedStaffId ? await pool.query(
      'SELECT id FROM staff WHERE (staff_id = $1 OR $1 = ANY(legacy_staff_ids)) AND institution_id = $2',
      [typedStaffId, institutionId]
    ) : { rows: [] };
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Staff ID already registered. Please login or contact admin.' });
    }

    const dup = await findDuplicateSignup(institutionId, { email, phone });
    if (dup) return res.status(dup.status).json({ error: dup.error });

    // IDs follow the school's pattern (e.g. RSS001). The ID they typed still
    // works for logging in, so the app can sign them straight in with it.
    const followsPattern = Boolean(typedStaffId) && hasPrefix(typedStaffId, await prefixFor(pool, institutionId));
    const finalStaffId = followsPattern ? typedStaffId : await nextStaffId(pool, institutionId);
    const legacyIds = followsPattern || !typedStaffId ? [] : [typedStaffId];

    const passwordHash = await bcrypt.hash(password, 12);
    const qrData = `STAFF-${institutionId}-${finalStaffId}`;

    const result = await pool.query(
      `INSERT INTO staff (institution_id, staff_id, first_name, last_name, email, phone, department, position, password_hash, qr_code_data, role, member_type, gender, legacy_staff_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'staff', 'staff', $11, $12)
       RETURNING id`,
      [institutionId, finalStaffId, formatName(firstName), formatName(lastName), email || null, phone || null, department || null, position || null, passwordHash, qrData, gender, legacyIds]
    );

    res.status(201).json({
      message: `Registration successful. Your Staff ID is ${finalStaffId}.`,
      staffId: finalStaffId,
    });
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
    // A new password ends every other login (a lost laptop, a shared PC).
    // This device gets a fresh token so it stays logged in.
    const updated = await req.tenantDb.query(
      `UPDATE staff SET password_hash = $1, token_version = token_version + 1, updated_at = NOW()
       WHERE id = $2 RETURNING token_version`,
      [newHash, req.user.id]
    );
    const token = signSessionToken(
      { ...req.user, token_version: updated.rows[0].token_version },
      optionsFromClaims(req.tokenClaims)
    );

    // If this is the school's admin, forget the password the super admin saved
    // for them, so a stale one is never handed out; it can be reset from the dashboard.
    await req.tenantDb.query(
      'DELETE FROM institution_admin_credentials WHERE institution_id = $1 AND admin_staff_id = $2',
      [req.user.institution_id, req.user.staff_id]
    ).catch(() => {});

    res.json({ message: 'Password changed. You were logged out on every other device.', token });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ========== FORGOT PASSWORD (code sent by email) ==========
// Step 1: the person gives their school code, Staff ID and email. If they
// match an account, a 6-digit code is emailed to that address. Step 2: they
// type the code and a new password. Without the email inbox nobody can reset
// someone else's password.

const RESET_CODE_MINUTES = 15;
const RESET_CODE_MAX_TRIES = 5;
const RESET_CODE_RESEND_SECONDS = 60;
const RESET_SENT_MESSAGE =
  'If the Staff ID and email match an account, we have emailed a 6-digit code to that address. Check your inbox (and spam folder); it can take a minute.';
const NO_EMAIL_MESSAGE =
  "We can't email reset codes right now. Ask your school administrator to reset your password in the GeoAttend dashboard.";

function emailReady() {
  return Boolean(process.env.SMTP_HOST);
}

/** Codes are stored as a keyed hash, never as typed. */
function hashResetCode(staffUuid, code) {
  return crypto.createHmac('sha256', String(process.env.JWT_SECRET || 'geoattend'))
    .update(`${staffUuid}:${String(code).trim()}`)
    .digest('hex');
}

/** The active account matching school code + Staff ID + email, or null. */
async function findResetAccount(db, { institutionCode, staffId, email }) {
  const normalizedInstitutionCode = normalizeInstitutionCode(institutionCode);
  if (!normalizedInstitutionCode || !staffId || !email) return null;
  const institution = await getInstitutionByCode(normalizedInstitutionCode);
  if (!institution) return null;
  const result = await db.query(
    `SELECT s.id, s.staff_id, s.first_name, s.email, s.reset_code_hash, s.reset_code_expires_at,
            s.reset_code_attempts, s.reset_code_sent_at, i.name AS institution_name
     FROM staff s JOIN institutions i ON i.id = s.institution_id
     WHERE (s.staff_id = $1 OR $1 = ANY(s.legacy_staff_ids)) AND LOWER(s.email) = $2
       AND s.member_type = 'staff' AND s.institution_id = $3 AND s.is_active = true
     ORDER BY (s.staff_id = $1) DESC LIMIT 1`,
    [String(staffId).trim().toUpperCase(), String(email).trim().toLowerCase(), institution.id]
  );
  return result.rows[0] || null;
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (v) => String(v || '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

const sendResetCodeHandler = async (req, res) => {
  try {
    const { institutionCode, staffId, email } = req.body;
    if (!normalizeInstitutionCode(institutionCode) || !staffId || !email) {
      return res.status(400).json({ error: 'Enter your school code, Staff ID and email.' });
    }
    if (!emailReady()) {
      return res.status(503).json({ error: NO_EMAIL_MESSAGE, noEmail: true });
    }

    const account = await findResetAccount(req.tenantDb, { institutionCode, staffId, email });
    // Same answer whether or not the details match, so nobody can use this
    // to find out which emails belong to which Staff IDs.
    if (!account) return res.json({ message: RESET_SENT_MESSAGE });

    const sentAgo = account.reset_code_sent_at
      ? (Date.now() - new Date(account.reset_code_sent_at).getTime()) / 1000
      : Infinity;
    if (sentAgo < RESET_CODE_RESEND_SECONDS) return res.json({ message: RESET_SENT_MESSAGE });

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await req.tenantDb.query(
      `UPDATE staff SET reset_code_hash = $2, reset_code_expires_at = NOW() + ($3 || ' minutes')::INTERVAL,
         reset_code_attempts = 0, reset_code_sent_at = NOW()
       WHERE id = $1`,
      [account.id, hashResetCode(account.id, code), String(RESET_CODE_MINUTES)]
    );

    const sent = await sendEmail({
      to: account.email,
      subject: `Your GeoAttend password reset code: ${code}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#1a5276;margin:0 0 12px">Reset your GeoAttend password</h2>
          <p>Hello ${escapeHtml(account.first_name) || 'there'},</p>
          <p>Use this code to reset the password for Staff ID <strong>${escapeHtml(account.staff_id)}</strong> at ${escapeHtml(account.institution_name)}:</p>
          <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:20px 0;color:#1a5276">${code}</p>
          <p>The code works for ${RESET_CODE_MINUTES} minutes.</p>
          <p style="color:#7f8c8d;font-size:13px">Didn't ask for this? Ignore this email; your password stays the same.</p>
        </div>`,
    });
    if (!sent) {
      // Forget the code so a failed email can be retried straight away
      await req.tenantDb.query(
        'UPDATE staff SET reset_code_hash = NULL, reset_code_expires_at = NULL, reset_code_sent_at = NULL WHERE id = $1',
        [account.id]
      );
      return res.status(503).json({ error: NO_EMAIL_MESSAGE, noEmail: true });
    }

    res.json({ message: RESET_SENT_MESSAGE });
  } catch (err) {
    console.error('Send reset code error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const forgotPasswordHandler = async (req, res) => {
  try {
    const { staffId, email, newPassword, institutionCode, code } = req.body;

    if (!staffId || !email || !normalizeInstitutionCode(institutionCode)) {
      return res.status(400).json({ error: 'Enter your school code, Staff ID and email.' });
    }
    if (!code || !/^\d{6}$/.test(String(code).trim())) {
      return res.status(400).json({ error: 'Enter the 6-digit code we emailed you.', needsCode: true });
    }
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const wrong = 'That code is wrong or has run out. Check the email, or ask for a new code.';
    const account = await findResetAccount(req.tenantDb, { institutionCode, staffId, email });
    if (!account || !account.reset_code_hash) return res.status(400).json({ error: wrong });

    if (!account.reset_code_expires_at || new Date(account.reset_code_expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'That code has run out. Ask for a new code.' });
    }
    if (Number(account.reset_code_attempts) >= RESET_CODE_MAX_TRIES) {
      return res.status(400).json({ error: 'Too many wrong codes. Ask for a new code.' });
    }

    const expected = Buffer.from(account.reset_code_hash, 'hex');
    const given = Buffer.from(hashResetCode(account.id, code), 'hex');
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
      await req.tenantDb.query('UPDATE staff SET reset_code_attempts = reset_code_attempts + 1 WHERE id = $1', [account.id]);
      const left = RESET_CODE_MAX_TRIES - Number(account.reset_code_attempts) - 1;
      return res.status(400).json({
        error: left > 0
          ? `That code is wrong. ${left} ${left === 1 ? 'try' : 'tries'} left.`
          : 'Too many wrong codes. Ask for a new code.',
      });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    // The code is used up, and the new password ends every existing login
    await req.tenantDb.query(
      `UPDATE staff SET password_hash = $1, token_version = token_version + 1,
         reset_code_hash = NULL, reset_code_expires_at = NULL, reset_code_attempts = 0, updated_at = NOW()
       WHERE id = $2`,
      [hash, account.id]
    );

    res.json({ message: 'Password changed. You can now log in with your new password.', staffId: account.staff_id });
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

    const finalStaffId = staffId ? staffId.toUpperCase() : await freeAdminId(req.tenantDb, institution.institution_code);

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
    // req.user is the current database row, so a changed role or institution
    // is picked up, and deactivated accounts never get here.
    const token = signSessionToken(req.user, optionsFromClaims(req.tokenClaims));
    res.json({ token });
  } catch (err) {
    sendServerError(res, 'refresh', err, req);
  }
};

// "Log out all other devices": every login of this account ends except this
// one, which gets a fresh token.
exports.logoutOtherDevices = async (req, res) => {
  try {
    const updated = await req.tenantDb.query(
      'UPDATE staff SET token_version = token_version + 1, updated_at = NOW() WHERE id = $1 RETURNING token_version',
      [req.user.id]
    );
    const token = signSessionToken(
      { ...req.user, token_version: updated.rows[0].token_version },
      optionsFromClaims(req.tokenClaims)
    );
    logAudit({
      institutionId: req.user.institution_id, action: 'logout_other_devices', entityType: 'staff',
      entityId: req.user.id, performedBy: req.user.staff_id, ipAddress: req.ip,
    });
    res.json({ message: 'Logged out on every other device.', token });
  } catch (err) {
    sendServerError(res, 'logout-others', err, req);
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
              s.department, s.position, s.role, s.profile_photo_url, s.qr_code_data, s.gender,
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


// Public login flows run before a user identity exists, so Postgres RLS has
// no institution context yet - they execute with the system bypass and the
// handlers themselves verify the institution link before issuing a JWT.
const withSystem = (handler) => (req, res) =>
  pool.withSystemContext(() => handler(req, res));

exports.login = withSystem(loginHandler);
exports.googleAuth = withSystem(googleAuthHandler);
exports.completeGoogleSignup = withSystem(completeGoogleSignupHandler);
exports.register = withSystem(registerHandler);
exports.forgotPassword = withSystem(forgotPasswordHandler);
exports.sendResetCode = withSystem(sendResetCodeHandler);
exports.emailReady = emailReady;
exports.forgotStaffId = withSystem(forgotStaffIdHandler);