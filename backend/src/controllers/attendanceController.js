const { isWithinGeofence } = require('../utils/geofence');
const { decodeQrFromBuffer } = require('../utils/qrDecoder');

async function logFraudEvent(db, { institutionId, staffUuid, eventType, details, ipAddress }) {
  try {
    await db.query(
      `INSERT INTO fraud_events (institution_id, staff_uuid, event_type, details, ip_address)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [institutionId, staffUuid || null, eventType, details ? JSON.stringify(details) : null, ipAddress || null]
    );
  } catch (err) {
    console.error('Fraud log error:', err.message);
  }
}

const MAX_OFFLINE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Check-ins/outs made without internet are queued on the phone and synced
 * later. They carry when they happened (recordedAt) and the phone's clock at
 * sync time (sentAt); the difference to server time corrects a wrong phone
 * clock. Returns { at: Date|null, note: string|null } — at is null for live
 * requests — or { error } when the entry is too old to accept.
 */
function resolveOfflineTime(body) {
  if (!body.offline || !body.recordedAt) return { at: null, note: null };
  const recorded = Date.parse(body.recordedAt);
  if (!Number.isFinite(recorded)) return { at: null, note: null };

  const now = Date.now();
  const sent = Date.parse(body.sentAt);
  const clockSkew = Number.isFinite(sent) ? now - sent : 0;
  const corrected = Math.min(recorded + clockSkew, now);
  if (now - corrected > MAX_OFFLINE_AGE_MS) {
    return { error: 'This offline record is more than 24 hours old and was not accepted. Please contact your administrator.' };
  }
  const at = new Date(corrected);
  return { at, note: `Recorded offline at ${at.toISOString()}, synced at ${new Date(now).toISOString()}` };
}

/** Institution entrance QR payload looks like `INST-<uuid>`; returns the uuid or null. */
function parseInstitutionQrCode(qrCode) {
  if (typeof qrCode !== 'string' || !qrCode.startsWith('INST-')) return null;
  return qrCode.slice(5);
}

/** Day-level earnings estimate for institutions that pay an hourly rate. */
function computeEarningsEstimate(record, staffRate, workEndTime, overtimeMultiplier) {
  if (!record || !staffRate) return { hoursToday: null, estimatedEarnings: null, overtimeMultiplier };
  const start = new Date(record.check_in_time);
  const end = record.check_out_time ? new Date(record.check_out_time) : new Date();
  const hoursToday = Math.max(0, (end - start) / 3600000);

  let overtimeHours = 0;
  if (workEndTime) {
    const [endHour, endMin] = workEndTime.split(':').map(Number);
    const workEnd = new Date(record.check_in_time);
    workEnd.setHours(endHour, endMin, 0, 0);
    if (end > workEnd) {
      overtimeHours = Math.max(0, Math.min((end - workEnd) / 3600000, hoursToday));
    }
  }

  const multiplier = overtimeMultiplier && overtimeMultiplier > 0 ? overtimeMultiplier : 1;
  const estimatedEarnings = staffRate * (hoursToday - overtimeHours) + staffRate * multiplier * overtimeHours;
  return { hoursToday, estimatedEarnings, overtimeMultiplier: multiplier };
}

async function loadEarningsContext(db, institutionId, staffUuid) {
  const institution = await db.query(
    'SELECT latitude, longitude, geofence_radius, payment_mode, currency, qr_rotation_token FROM institutions WHERE id = $1',
    [institutionId]
  );
  const staff = await db.query(
    'SELECT hourly_rate FROM staff WHERE id = $1',
    [staffUuid]
  );
  const rules = await db.query(
    "SELECT work_start_time, work_end_time, late_threshold_minutes, overtime_multiplier FROM attendance_rules WHERE institution_id = $1 AND member_type = 'staff'",
    [institutionId]
  );
  return {
    institution: institution.rows[0] || null,
    staffRate: staff.rows[0]?.hourly_rate ? parseFloat(staff.rows[0].hourly_rate) : null,
    rules: rules.rows[0] || null,
  };
}

exports.checkIn = async (req, res) => {
  await runCheckIn(req, res, req.body || {});
};

/** Shared check-in core: direct /check-in (scanned QR payload arrives in the JSON
 *  body) and /check-in-from-image (QR decoded server-side from an uploaded photo)
 *  both funnel into the exact same validation and record creation. */
async function runCheckIn(req, res, body) {
  const db = req.tenantDb;
  try {
    const { latitude, longitude, method, deviceId, qrCode, qrToken } = body;
    const staffUuid = req.user.id;
    const institutionId = req.user.institution_id;

    // Validate method
    const validMethods = ['gps', 'qr_code', 'nfc', 'manual'];
    if (!validMethods.includes(method)) {
      return res.status(400).json({ error: 'Invalid check-in method' });
    }

    const offline = resolveOfflineTime(body);
    if (offline.error) return res.status(400).json({ error: offline.error });
    const eventTime = offline.at || new Date();

    // Payments / geofence context
    const { institution: inst, staffRate, rules } = await loadEarningsContext(db, institutionId, staffUuid);

    // ── Location is REQUIRED for every check-in method ──────────────────────
    // Scanning QR or tapping GPS from home must never produce a valid record.
    if (!latitude || !longitude) {
      await logFraudEvent(db, {
        institutionId,
        staffUuid,
        eventType: 'missing_location_attempt',
        details: { method, date: new Date().toISOString() },
        ipAddress: req.ip,
      });
      return res.status(400).json({
        error: 'Location required — turn on GPS and allow location access, then try again.',
      });
    }

    // ── QR code validation ───────────────────────────────────────────────────
    if (method === 'qr_code' && qrCode) {
      const institutionQrId = parseInstitutionQrCode(qrCode);
      if (institutionQrId) {
        // Entrance QR printed and posted by the admin. The scanner must belong
        // to this institution, and (once a token has been issued) must carry
        // the current rotation token so an old photo of a retired poster
        // cannot be replayed.
        if (institutionQrId !== String(institutionId)) {
          await logFraudEvent(db, {
            institutionId,
            staffUuid,
            eventType: 'wrong_institution_qr',
            details: { qrCode: qrCode.slice(0, 40), method },
            ipAddress: req.ip,
          });
          return res.status(400).json({ error: 'This QR code belongs to a different institution' });
        }
        const rotationToken = inst?.qr_rotation_token || null;
        if (rotationToken && String(qrToken || '') !== String(rotationToken)) {
          await logFraudEvent(db, {
            institutionId,
            staffUuid,
            eventType: 'stale_qr_attempt',
            details: { method },
            ipAddress: req.ip,
          });
          return res.status(400).json({ error: 'This entrance QR code has expired. Ask your admin to scan the current poster.' });
        }
      } else {
        // Personal ID-card QR: the code must belong to the requesting staff
        const qrResult = await db.query(
          'SELECT id FROM staff WHERE qr_code_data = $1 AND id = $2',
          [qrCode, staffUuid]
        );
        if (qrResult.rows.length === 0) {
          await logFraudEvent(db, {
            institutionId,
            staffUuid,
            eventType: 'invalid_qr_attempt',
            details: { method, qrCode: String(qrCode || '').slice(0, 30) },
            ipAddress: req.ip,
          });
          return res.status(400).json({ error: 'Invalid QR code' });
        }
      }
    }

    // Check for duplicate check-in today
    const today = eventTime.toISOString().split('T')[0];
    const existing = await db.query(
      'SELECT id, check_out_time FROM attendance_records WHERE staff_uuid = $1 AND date = $2 ORDER BY check_in_time DESC LIMIT 1',
      [staffUuid, today]
    );

    if (existing.rows.length > 0 && !existing.rows[0].check_out_time) {
      await logFraudEvent(db, {
        institutionId,
        staffUuid,
        eventType: 'duplicate_checkin_attempt',
        details: { method, date: today },
        ipAddress: req.ip,
      });
      return res.status(400).json({ error: 'You already have an active check-in. Please check out first.' });
    }

    // ── Geofence verification (required for every method) ────────────────────
    let withinGeofence = false;
    if (inst) {
      const geofenceCheck = isWithinGeofence(
        latitude, longitude,
        parseFloat(inst.latitude), parseFloat(inst.longitude),
        inst.geofence_radius
      );
      withinGeofence = geofenceCheck.isWithin;

      if (!withinGeofence) {
        await logFraudEvent(db, {
          institutionId,
          staffUuid,
          eventType: 'outside_geofence_attempt',
          details: { distance: geofenceCheck.distance, radius: geofenceCheck.radius, method },
          ipAddress: req.ip,
        });
        return res.status(403).json({
          error: 'You are outside the institution geofence',
          distance: geofenceCheck.distance,
          radius: geofenceCheck.radius,
        });
      }
    } else {
      return res.status(400).json({ error: 'Institution geofence not configured' });
    }

    // Check if late
    let isLate = false;
    if (rules) {
      const now = eventTime;
      const [startHour, startMin] = rules.work_start_time.split(':').map(Number);
      const lateTime = new Date(now);
      lateTime.setHours(startHour, startMin + (rules.late_threshold_minutes || 0), 0, 0);
      isLate = now > lateTime;
    }

    // Record check-in
    const record = await db.query(
      `INSERT INTO attendance_records
        (staff_uuid, institution_id, check_in_time, check_in_latitude, check_in_longitude,
         check_in_method, device_id, is_late, is_within_geofence, date, notes)
       VALUES ($1, $2, COALESCE($10::timestamptz, NOW()), $3, $4, $5, $6, $7, $8, $9, $11)
       RETURNING *`,
      [staffUuid, institutionId, latitude, longitude, method, deviceId || null, isLate, withinGeofence, today,
       offline.at ? offline.at.toISOString() : null, offline.note]
    );

    // Log device
    if (deviceId) {
      await db.query(
        `INSERT INTO device_logs (staff_uuid, device_id, action, ip_address)
         VALUES ($1, $2, 'check_in', $3)`,
        [staffUuid, deviceId, req.ip]
      );
    }

    const earnings = inst?.payment_mode === 'hourly'
      ? computeEarningsEstimate(record.rows[0], staffRate, rules?.work_end_time, rules?.overtime_multiplier)
      : null;

    res.status(201).json({
      message: 'Check-in successful',
      record: record.rows[0],
      isLate,
      withinGeofence,
      payment: {
        mode: inst?.payment_mode || 'monthly',
        currency: inst?.currency || 'GHS',
        hourlyRate: staffRate,
        ...earnings,
      },
    });
  } catch (err) {
    console.error('Check-in error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/** Check-in from a photo of the QR code (gallery pick). The image is decoded
 *  server-side, then validated with the full standard QR check-in pipeline. */
exports.checkInFromImage = async (req, res) => {
  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
    return res.status(400).json({ error: 'No image uploaded. Attach the QR photo as the "image" field.' });
  }

  try {
    const decoded = await decodeQrFromBuffer(req.file.buffer);
    if (!decoded) {
      return res.status(400).json({
        error: 'No QR code found in this image. Make sure the whole QR code is clearly visible in the photo.',
      });
    }

    let qrData;
    try {
      qrData = JSON.parse(decoded);
    } catch {
      return res.status(400).json({ error: 'This image does not contain a GeoAttend QR code.' });
    }

    let qrCode = null;
    let qrToken = null;
    if (qrData.type === 'institution_checkin') {
      qrCode = qrData.code;
      qrToken = qrData.token || null;
    } else if (qrData.staffId) {
      qrCode = qrData.code;
    } else {
      return res.status(400).json({ error: 'This is not a valid GeoAttend QR code.' });
    }

    await runCheckIn(req, res, {
      latitude: parseFloat(req.body.latitude),
      longitude: parseFloat(req.body.longitude),
      method: 'qr_code',
      deviceId: req.body.deviceId,
      qrCode,
      qrToken,
    });
  } catch (err) {
    console.error('QR image check-in error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
};

exports.checkOut = async (req, res) => {
  const db = req.tenantDb;
  try {
    const { latitude, longitude, method, deviceId } = req.body;
    const staffUuid = req.user.id;
    const institutionId = req.user.institution_id;

    const offline = resolveOfflineTime(req.body);
    if (offline.error) return res.status(400).json({ error: offline.error });
    const eventTime = offline.at || new Date();
    const today = eventTime.toISOString().split('T')[0];

    // Find active check-in
    const active = await db.query(
      'SELECT id FROM attendance_records WHERE staff_uuid = $1 AND date = $2 AND check_out_time IS NULL ORDER BY check_in_time DESC LIMIT 1',
      [staffUuid, today]
    );

    if (active.rows.length === 0) {
      return res.status(400).json({ error: 'No active check-in found' });
    }

    // ── Location is REQUIRED for check-out too ───────────────────────────────
    if (!latitude || !longitude) {
      await logFraudEvent(db, {
        institutionId,
        staffUuid,
        eventType: 'missing_location_attempt',
        details: { method, action: 'check_out', date: today },
        ipAddress: req.ip,
      });
      return res.status(400).json({
        error: 'Location required — turn on GPS and allow location access, then try again.',
      });
    }

    // ── Geofence verification (required for every method) ────────────────────
    const instResult = await db.query(
      'SELECT latitude, longitude, geofence_radius, payment_mode, currency FROM institutions WHERE id = $1',
      [institutionId]
    );
    const inst = instResult.rows[0];
    if (inst) {
      const geofenceCheck = isWithinGeofence(
        latitude, longitude,
        parseFloat(inst.latitude), parseFloat(inst.longitude),
        inst.geofence_radius
      );

      // Someone who already left the premises cannot close the day from home.
      if (!geofenceCheck.isWithin) {
        await logFraudEvent(db, {
          institutionId,
          staffUuid,
          eventType: 'outside_geofence_attempt',
          details: { distance: geofenceCheck.distance, radius: geofenceCheck.radius, method, action: 'check_out' },
          ipAddress: req.ip,
        });
        return res.status(403).json({
          error: 'You are outside the institution geofence',
          distance: geofenceCheck.distance,
          radius: geofenceCheck.radius,
        });
      }
    }

    const record = await db.query(
      `UPDATE attendance_records
       SET check_out_time = GREATEST(COALESCE($5::timestamptz, NOW())::timestamp, check_in_time),
           check_out_latitude = $1, check_out_longitude = $2, check_out_method = $3,
           notes = CASE WHEN $6::text IS NULL THEN notes ELSE concat_ws(' | ', notes, $6::text) END
       WHERE id = $4
       RETURNING *`,
      [latitude, longitude, method || 'gps', active.rows[0].id,
       offline.at ? offline.at.toISOString() : null, offline.note]
    );

    // Track overtime if checking out after work end time
    let overtimeMultiplierDecimal = null;
    let workEndTimeForEarnings = null;
    try {
      const rules = await db.query(
        "SELECT work_end_time, overtime_multiplier FROM attendance_rules WHERE institution_id = $1 AND member_type = 'staff'",
        [institutionId]
      );
      if (rules.rows.length > 0) {
        overtimeMultiplierDecimal = parseFloat(rules.rows[0].overtime_multiplier);
        workEndTimeForEarnings = rules.rows[0].work_end_time;
        const now = eventTime;
        const [endHour, endMin] = rules.rows[0].work_end_time.split(':').map(Number);
        const endTime = new Date(now);
        endTime.setHours(endHour, endMin, 0, 0);
        if (now > endTime) {
          const overtimeMinutes = Math.round((now - endTime) / 60000);
          if (overtimeMinutes > 0) {
            await db.query(
              `INSERT INTO overtime_records (staff_uuid, institution_id, date, overtime_minutes, reason)
               VALUES ($1, $2, $3, $4, 'manual_checkout')
               ON CONFLICT DO NOTHING`,
              [staffUuid, institutionId, today, overtimeMinutes]
            );
          }
        }
      }
    } catch (otErr) {
      console.error('Overtime tracking error:', otErr.message);
    }

    if (deviceId) {
      await db.query(
        `INSERT INTO device_logs (staff_uuid, device_id, action, ip_address)
         VALUES ($1, $2, 'check_out', $3)`,
        [staffUuid, deviceId, req.ip]
      );
    }

    const staffRate = await db.query('SELECT hourly_rate FROM staff WHERE id = $1', [staffUuid]);
    const rate = staffRate.rows[0]?.hourly_rate ? parseFloat(staffRate.rows[0].hourly_rate) : null;
    const earnings = inst?.payment_mode === 'hourly'
      ? computeEarningsEstimate(record.rows[0], rate, workEndTimeForEarnings, overtimeMultiplierDecimal)
      : null;

    res.json({
      message: 'Check-out successful',
      record: record.rows[0],
      payment: {
        mode: inst?.payment_mode || 'monthly',
        currency: inst?.currency || 'GHS',
        hourlyRate: rate,
        ...earnings,
      },
    });
  } catch (err) {
    console.error('Check-out error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getMyAttendance = async (req, res) => {
  const db = req.tenantDb;
  try {
    const { startDate, endDate, page = 1, limit = 30 } = req.query;
    const offset = (page - 1) * limit;
    const staffUuid = req.user.id;

    let query = 'SELECT * FROM attendance_records WHERE staff_uuid = $1';
    const params = [staffUuid];
    let paramIndex = 2;

    if (startDate) {
      query += ` AND date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    if (endDate) {
      query += ` AND date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` ORDER BY date DESC, check_in_time DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await db.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM attendance_records WHERE staff_uuid = $1';
    const countParams = [staffUuid];
    if (startDate) countParams.push(startDate);
    if (endDate) countParams.push(endDate);
    if (startDate) countQuery += ' AND date >= $2';
    if (endDate) countQuery += ` AND date <= $${countParams.length}`;

    const countResult = await db.query(countQuery, countParams);

    res.json({
      records: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  } catch (err) {
    console.error('Get attendance error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getTodayStatus = async (req, res) => {
  const db = req.tenantDb;
  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await db.query(
      'SELECT * FROM attendance_records WHERE staff_uuid = $1 AND date = $2 ORDER BY check_in_time DESC LIMIT 1',
      [req.user.id, today]
    );

    if (result.rows.length === 0) {
      return res.json({ status: 'not_checked_in', record: null });
    }

    const record = result.rows[0];
    const status = record.check_out_time ? 'checked_out' : 'checked_in';

    res.json({ status, record });
  } catch (err) {
    console.error('Get today status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getWeeklyStats = async (req, res) => {
  const db = req.tenantDb;
  try {
    const staffUuid = req.user.id;

    // Get stats for the current month
    const result = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE check_in_time IS NOT NULL) as total_present,
         COUNT(*) FILTER (WHERE is_late = true) as total_late,
         COUNT(*) FILTER (WHERE check_in_time IS NOT NULL AND is_late = false) as total_on_time,
         ROUND(AVG(EXTRACT(EPOCH FROM (check_out_time - check_in_time)) / 3600)::numeric, 1) as avg_hours
       FROM attendance_records
       WHERE staff_uuid = $1
         AND date >= date_trunc('month', CURRENT_DATE)
         AND date <= CURRENT_DATE`,
      [staffUuid]
    );

    // Get this week's records
    const weekResult = await db.query(
      `SELECT date, check_in_time, check_out_time, is_late,
              premises_left_at, premises_returned_at
       FROM attendance_records
       WHERE staff_uuid = $1
         AND date >= date_trunc('week', CURRENT_DATE)
         AND date <= CURRENT_DATE
       ORDER BY date`,
      [staffUuid]
    );

    // Get working days this month from rules
    const rulesResult = await db.query(
      `SELECT working_days FROM attendance_rules WHERE institution_id = $1 AND member_type = 'staff'`,
      [req.user.institution_id]
    );
    const workingDays = rulesResult.rows[0]?.working_days || [1, 2, 3, 4, 5];

    // Count working days in current month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let totalWorkingDays = 0;
    for (let d = new Date(monthStart); d <= now; d.setDate(d.getDate() + 1)) {
      if (workingDays.includes(d.getDay())) totalWorkingDays++;
    }

    const stats = result.rows[0];
    const totalAbsent = Math.max(0, totalWorkingDays - parseInt(stats.total_present || 0));

    res.json({
      month: {
        present: parseInt(stats.total_present || 0),
        late: parseInt(stats.total_late || 0),
        onTime: parseInt(stats.total_on_time || 0),
        absent: totalAbsent,
        avgHours: parseFloat(stats.avg_hours || 0),
        workingDays: totalWorkingDays,
      },
      week: weekResult.rows,
    });
  } catch (err) {
    console.error('Get weekly stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
