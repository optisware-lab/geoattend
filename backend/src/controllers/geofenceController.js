const { isWithinGeofence } = require('../utils/geofence');
const { sendSMS } = require('../services/smsService');

async function getAdminsWithContacts(db, institutionId) {
  const admins = await db.query(
    `SELECT first_name, last_name, staff_id, phone, email, push_token
     FROM staff
     WHERE institution_id = $1
       AND role IN ('admin', 'super_admin')
       AND is_active = true`,
    [institutionId]
  );
  return admins.rows;
}

exports.recordEvent = async (req, res) => {
  const db = req.tenantDb;
  try {
    const { latitude, longitude, source } = req.body || {};
    const staffUuid = req.user.id;
    const institutionId = req.user.institution_id;

    if (latitude == null || longitude == null) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const instResult = await db.query(
      'SELECT latitude, longitude, geofence_radius, name FROM institutions WHERE id = $1',
      [institutionId]
    );
    if (instResult.rows.length === 0) {
      return res.status(400).json({ error: 'Institution not found' });
    }
    const inst = instResult.rows[0];

    const geofenceCheck = isWithinGeofence(
      parseFloat(latitude),
      parseFloat(longitude),
      parseFloat(inst.latitude),
      parseFloat(inst.longitude),
      inst.geofence_radius
    );

    const currentEvent = geofenceCheck.isWithin ? 'enter' : 'exit';
    const currentState = geofenceCheck.isWithin ? 'inside' : 'outside';

    // Get last event for this staff to determine state change
    const lastEventResult = await db.query(
      `SELECT event, created_at
       FROM geofence_events
       WHERE staff_uuid = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [staffUuid]
    );

    let previousState = 'unknown';
    if (lastEventResult.rows.length > 0) {
      previousState = lastEventResult.rows[0].event === 'exit' ? 'outside' : 'inside';
    }

    const isStateChange = previousState !== currentState;

    // Always record the event so reporting has full history
    const insertResult = await db.query(
      `INSERT INTO geofence_events (
         institution_id, staff_uuid, event,
         latitude, longitude, distance_m, radius_m
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        institutionId,
        staffUuid,
        currentEvent,
        latitude,
        longitude,
        geofenceCheck.distance,
        geofenceCheck.radius,
      ]
    );

    // ── Premises tracking ────────────────────────────────────────────────────
    // While a staff member is checked in, leaving the geofence marks their
    // attendance record. A record that shows "left and never returned" is the
    // sign of someone checked in at the entrance but not working on site.
    let attendanceFlagged = false;
    if (isStateChange) {
      const activeRecord = await db.query(
        `SELECT id FROM attendance_records
         WHERE staff_uuid = $1 AND date = CURRENT_DATE AND check_out_time IS NULL
         ORDER BY check_in_time DESC LIMIT 1`,
        [staffUuid]
      );

      if (activeRecord.rows.length > 0) {
        if (currentState === 'outside') {
          await db.query(
            `UPDATE attendance_records
             SET premises_left_at = NOW()
             WHERE id = $1 AND premises_left_at IS NULL`,
            [activeRecord.rows[0].id]
          );
          await db.query(
            `INSERT INTO fraud_events (institution_id, staff_uuid, event_type, details)
             VALUES ($1, $2, 'left_during_active_checkin', $3::jsonb)`,
            [institutionId, staffUuid, JSON.stringify({ source: source || 'unknown', at: new Date().toISOString() })]
          ).catch(() => {});
          attendanceFlagged = true;
        } else {
          await db.query(
            `UPDATE attendance_records
             SET premises_returned_at = NOW()
             WHERE id = $1 AND premises_left_at IS NOT NULL AND premises_returned_at IS NULL`,
            [activeRecord.rows[0].id]
          );
        }
      }
    }

    let alerted = false;

    // Anti-spam: only alert on inside -> outside transitions, with cooldown
    if (isStateChange && currentState === 'outside') {
      const cooldownMinutes = parseInt(process.env.GEOFENCE_ALERT_COOLDOWN_MINUTES || '15', 10);
      const recentExit = await db.query(
        `SELECT created_at
         FROM geofence_events
         WHERE staff_uuid = $1 AND event = 'exit'
         ORDER BY created_at DESC
         LIMIT 1`,
        [staffUuid]
      );

      let allowAlert = true;
      if (recentExit.rows.length > 0) {
        const lastExitAt = new Date(recentExit.rows[0].created_at);
        const diffMinutes = (Date.now() - lastExitAt.getTime()) / 60000;
        if (diffMinutes < cooldownMinutes) {
          allowAlert = false;
        }
      }

      if (allowAlert) {
        const staffResult = await db.query(
          `SELECT staff_id, first_name, last_name
           FROM staff
           WHERE id = $1`,
          [staffUuid]
        );
        const staff = staffResult.rows[0];
        const name = `${staff?.first_name || ''} ${staff?.last_name || ''}`.trim() || staff?.staff_id || 'Staff member';
        const idLabel = staff?.staff_id || '';

        const admins = await getAdminsWithContacts(db, institutionId);
        const message = `ALERT: ${name} (Staff ID ${idLabel}) left ${inst.name} geofence at ${new Date().toLocaleTimeString()}. Distance ${geofenceCheck.distance}m (radius ${geofenceCheck.radius}m).`;

        // SMS to admins where phone is available
        for (const admin of admins) {
          if (admin.phone) {
            try {
              await sendSMS(admin.phone, message);
              alerted = true;
            } catch (smsErr) {
              console.error('Geofence SMS error:', smsErr.message);
            }
          }
        }

        // TODO: email / push notifications can be added here using existing services
      }
    }

    res.status(201).json({
      message: 'Geofence event recorded',
      event: insertResult.rows[0],
      state: currentState,
      isWithin: geofenceCheck.isWithin,
      distance: geofenceCheck.distance,
      radius: geofenceCheck.radius,
      alerted,
      attendanceFlagged,
      source: source || 'unknown',
    });
  } catch (err) {
    console.error('Geofence event error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
