const pool = require('../config/database');
const { sendExpoPushNotifications } = require('../services/pushNotificationService');
const { sendEmail } = require('../services/emailService');
const { formatDateRange } = require('../utils/dateFormat');

// Every query runs on req.tenantDb: the request's own connection, which
// Postgres row-level security limits to the signed-in user's institution.

const LEAVE_TYPES = ['personal', 'sick', 'vacation', 'maternity', 'paternity', 'bereavement', 'other'];
const LIST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];
const MAX_REASON = 1000;
const MAX_NOTE = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

/** "2026-11-04" -> same string if it is a real calendar date, else null. */
function calendarDate(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value ? value : null;
}

/** Earliest start date allowed: yesterday on the server's UTC clock, so a
 *  phone a few hours ahead of UTC can still pick its own "today". */
const earliestStartIso = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const LEAVE_COLUMNS = `lr.id, lr.staff_uuid, lr.institution_id, lr.leave_type, lr.start_date, lr.end_date,
  lr.reason, lr.status, lr.reviewed_by, lr.reviewed_at, lr.review_note, lr.created_at, lr.updated_at`;

/**
 * Tells the institution's admins about a new request: a phone push to admins
 * using the app, and an email to every admin with an address. Runs after the
 * response is sent and never fails the request.
 */
function notifyAdminsOfRequest(institutionId, staffUser, leaveType, startDate, endDate, leaveId) {
  pool.withSystemContext(async (client) => {
    const admins = await client.query(
      `SELECT email, push_token FROM staff
       WHERE institution_id = $1 AND role IN ('admin','super_admin') AND is_active = true`,
      [institutionId]
    );
    const staffName = `${staffUser.first_name || ''} ${staffUser.last_name || ''}`.trim() || staffUser.staff_id || 'A staff member';
    const when = formatDateRange(startDate, endDate);
    const body = `${staffName} has requested ${leaveType} leave for ${when}.`;

    const pushes = admins.rows
      .filter((a) => a.push_token)
      .map((a) => ({
        to: a.push_token,
        title: 'New Leave Request',
        body,
        data: { type: 'leave_request', leaveId },
      }));
    if (pushes.length) await sendExpoPushNotifications(pushes).catch(() => {});

    const emails = [...new Set(admins.rows.map((a) => a.email).filter(Boolean))];
    const dashboardUrl = (process.env.ADMIN_DASHBOARD_URL || 'https://geoattend-mu.vercel.app').replace(/\/$/, '');
    await Promise.all(emails.map((to) => sendEmail({
      to,
      subject: `New leave request from ${staffName}`,
      html: `<p>${escapeHtml(body)}</p>
        <p>Staff ID: ${escapeHtml(staffUser.staff_id || '')}</p>
        <p><a href="${escapeHtml(`${dashboardUrl}/leave`)}">Review it in the GeoAttend dashboard</a></p>`,
    }).catch(() => null)));
  }).catch((err) => console.error('Leave request notify error:', err.message));
}

/** Tells the staff member their request was approved or rejected. */
function notifyRequesterOfReview(id, status, reviewNote) {
  pool.withSystemContext(async (client) => {
    const rows = await client.query(
      `SELECT s.push_token, s.first_name, lr.leave_type, lr.start_date, lr.end_date
       FROM leave_requests lr
       JOIN staff s ON lr.staff_uuid = s.id
       WHERE lr.id = $1`,
      [id]
    );
    if (!rows.rows.length || !rows.rows[0].push_token) return;
    const { push_token, first_name, leave_type, start_date, end_date } = rows.rows[0];
    const label = status === 'approved' ? 'approved' : 'rejected';
    await sendExpoPushNotifications([{
      to: push_token,
      title: `Leave Request ${label.charAt(0).toUpperCase() + label.slice(1)}`,
      body: `Hi ${first_name}, your ${leave_type} leave (${formatDateRange(start_date, end_date)}) has been ${label}.${reviewNote ? ` Note: ${reviewNote}` : ''}`,
      data: { type: 'leave_review', leaveId: id, status },
    }]).catch(() => {});
  }).catch((err) => console.error('Leave review notify error:', err.message));
}

// Staff: request leave
exports.requestLeave = async (req, res) => {
  const db = req.tenantDb;
  try {
    const { leaveType, reason } = req.body || {};
    const startDate = calendarDate(req.body?.startDate);
    const endDate = calendarDate(req.body?.endDate);
    const leave = leaveType || 'personal';

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start and end dates are required' });
    }
    if (!LEAVE_TYPES.includes(leave)) {
      return res.status(400).json({ error: 'Please choose a valid leave type' });
    }
    if (startDate > endDate) {
      return res.status(400).json({ error: 'Start date must be before end date' });
    }
    if (startDate < earliestStartIso()) {
      return res.status(400).json({ error: 'Cannot request leave for past dates' });
    }
    const reasonText = typeof reason === 'string' ? reason.trim().slice(0, MAX_REASON) : '';

    const overlap = await db.query(
      `SELECT id FROM leave_requests
       WHERE staff_uuid = $1 AND status IN ('pending', 'approved')
         AND start_date <= $3::date AND end_date >= $2::date
       LIMIT 1`,
      [req.user.id, startDate, endDate]
    );
    if (overlap.rows.length > 0) {
      return res.status(400).json({ error: 'You already have a leave request for these dates' });
    }

    const result = await db.query(
      `INSERT INTO leave_requests (staff_uuid, institution_id, leave_type, start_date, end_date, reason)
       VALUES ($1, $2, $3, $4::date, $5::date, $6)
       RETURNING *`,
      [req.user.id, req.user.institution_id, leave, startDate, endDate, reasonText || null]
    );

    res.status(201).json(result.rows[0]);
    notifyAdminsOfRequest(req.user.institution_id, req.user, leave, startDate, endDate, result.rows[0].id);
  } catch (err) {
    console.error('Request leave error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Staff: get my leave requests
exports.getMyLeaves = async (req, res) => {
  try {
    const result = await req.tenantDb.query(
      `SELECT ${LEAVE_COLUMNS},
              r.first_name AS reviewer_first_name, r.last_name AS reviewer_last_name
       FROM leave_requests lr
       LEFT JOIN staff r ON lr.reviewed_by = r.id
       WHERE lr.staff_uuid = $1
       ORDER BY lr.created_at DESC
       LIMIT 200`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get my leaves error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Staff: cancel own pending leave
exports.cancelLeave = async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(404).json({ error: 'Leave request not found or cannot be cancelled' });
    }
    const result = await req.tenantDb.query(
      `UPDATE leave_requests SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND staff_uuid = $2 AND status = 'pending'
       RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Leave request not found or cannot be cancelled' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Cancel leave error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Admin: get all leave requests for the institution
exports.getAllLeaves = async (req, res) => {
  try {
    const institutionId = req.user.institution_id;
    const status = LIST_STATUSES.includes(req.query.status) ? req.query.status : null;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    const params = [institutionId];
    let where = 'lr.institution_id = $1';
    if (status) {
      params.push(status);
      where += ` AND lr.status = $${params.length}`;
    }

    const [result, countResult] = await Promise.all([
      req.tenantDb.query(
        `SELECT ${LEAVE_COLUMNS}, s.staff_id, s.first_name, s.last_name, s.department,
                r.first_name AS reviewer_first_name, r.last_name AS reviewer_last_name
         FROM leave_requests lr
         JOIN staff s ON lr.staff_uuid = s.id
         LEFT JOIN staff r ON lr.reviewed_by = r.id
         WHERE ${where}
         ORDER BY lr.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      req.tenantDb.query(`SELECT COUNT(*)::int AS count FROM leave_requests lr WHERE ${where}`, params),
    ]);

    res.json({
      leaves: result.rows,
      total: countResult.rows[0].count,
      page,
      limit,
    });
  } catch (err) {
    console.error('Get all leaves error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Admin: approve or reject leave
exports.reviewLeave = async (req, res) => {
  const db = req.tenantDb;
  try {
    const { status, reviewNote } = req.body || {};
    const { id } = req.params;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be approved or rejected' });
    }
    if (!isUuid(id)) {
      return res.status(404).json({ error: 'Leave request not found' });
    }
    const note = typeof reviewNote === 'string' ? reviewNote.trim().slice(0, MAX_NOTE) : '';

    // Only a pending request of this institution can be decided, checked in
    // the same statement so two admins can't both decide it.
    const result = await db.query(
      `UPDATE leave_requests
       SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_note = $3, updated_at = NOW()
       WHERE id = $4 AND institution_id = $5 AND status = 'pending'
       RETURNING *`,
      [status, req.user.id, note || null, id, req.user.institution_id]
    );

    if (result.rows.length === 0) {
      const existing = await db.query(
        'SELECT status FROM leave_requests WHERE id = $1 AND institution_id = $2',
        [id, req.user.institution_id]
      );
      if (existing.rows.length === 0) return res.status(404).json({ error: 'Leave request not found' });
      return res.status(400).json({ error: 'Can only review pending requests' });
    }

    res.json(result.rows[0]);
    notifyRequesterOfReview(id, status, note);
  } catch (err) {
    console.error('Review leave error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Leave counts for the dashboard and the sidebar badge
exports.getLeaveStats = async (req, res) => {
  try {
    const result = await req.tenantDb.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
        COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
        COUNT(*) FILTER (WHERE status = 'approved' AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE)::int AS on_leave_today
      FROM leave_requests WHERE institution_id = $1
    `, [req.user.institution_id]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Leave stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
