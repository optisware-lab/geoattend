const pool = require('../config/database');
const { sendExpoPushNotifications } = require('../services/pushNotificationService');
const { formatDateRange } = require('../utils/dateFormat');
let prisma;
try {
  prisma = require('../prismaClient');
} catch (e) {
  // Prisma not available; fallback to raw SQL pool
  prisma = null;
}

/**
 * Prisma connections don't carry the request's RLS context, so every Prisma
 * block runs inside an interactive transaction where the tenant setting is
 * applied transaction-locally (cleaned up automatically on commit/rollback).
 * The connection also drops into the restricted RLS app role first: the
 * connecting owner (DATABASE_URL) may carry rolbypassrls=true on hosted
 * Postgres, which makes the policies inert for it — SET LOCAL ROLE removes
 * that shortcut for the duration of the transaction.
 */
async function beginPrismaTenantTx(req, tx) {
  await tx.$executeRawUnsafe('SET LOCAL ROLE geoattend_app');
  if (req.user.role === 'super_admin') {
    await tx.$executeRawUnsafe("SELECT set_config('app.bypass_rls', 'on', true)");
  } else {
    await tx.$executeRawUnsafe("SELECT set_config('app.institution_id', $1, true)", req.user.institution_id);
  }
}

function withPrismaTenant(req, fn) {
  if (!prisma) return Promise.reject(new Error('Prisma not available'));
  return prisma.$transaction(async (tx) => {
    await beginPrismaTenantTx(req, tx);
    return fn(tx);
  });
}

/** Fire-and-forget admin push about a new leave request (system context). */
function notifyAdminsOfRequest(institutionId, staffUser, leaveType, startDate, endDate, leaveId) {
  pool.withSystemContext(async (client) => {
    const admins = await client.query(
      `SELECT push_token FROM staff WHERE institution_id = $1 AND role IN ('admin','super_admin') AND is_active = true AND push_token IS NOT NULL`,
      [institutionId]
    );
    const staffName = `${staffUser.first_name} ${staffUser.last_name}`.trim();
    const messages = admins.rows.map((a) => ({
      to: a.push_token,
      title: 'New Leave Request',
      body: `${staffName} has requested ${leaveType} leave from ${startDate} to ${endDate}.`,
      data: { type: 'leave_request', leaveId },
    }));
    return sendExpoPushNotifications(messages).catch(() => {});
  }).catch(() => {});
}

/** Fire-and-forget review notification to the requester (system context). */
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
    const statusLabel = status === 'approved' ? 'approved' : 'rejected';
    return sendExpoPushNotifications([{
      to: push_token,
      title: `Leave Request ${statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)}`,
      body: `Hi ${first_name}, your ${leave_type} leave (${formatDateRange(start_date, end_date)}) has been ${statusLabel}.${reviewNote ? ` Note: ${reviewNote}` : ''}`,
      data: { type: 'leave_review', leaveId: id, status },
    }]).catch(() => {});
  }).catch(() => {});
}

// Staff: request leave
exports.requestLeave = async (req, res) => {
  const db = req.tenantDb;
  try {
    const { leaveType, startDate, endDate, reason } = req.body;
    const staffUuid = req.user.id;
    const institutionId = req.user.institution_id;
    const leave = leaveType || 'personal';

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start and end dates are required' });
    }

    if (new Date(startDate) > new Date(endDate)) {
      return res.status(400).json({ error: 'Start date must be before end date' });
    }

    if (new Date(startDate) < new Date().setHours(0, 0, 0, 0)) {
      return res.status(400).json({ error: 'Cannot request leave for past dates' });
    }

    // Check for overlapping leave requests and insert (use Prisma when available)
    if (prisma) {
      const created = await withPrismaTenant(req, async (tx) => {
        const overlap = await tx.leave_requests.findFirst({
          where: {
            staff_uuid: staffUuid,
            status: { in: ['pending', 'approved'] },
            AND: [
              { start_date: { lte: new Date(endDate) } },
              { end_date: { gte: new Date(startDate) } }
            ]
          }
        });
        if (overlap) return null;

        return tx.leave_requests.create({
          data: {
            staff_uuid: staffUuid,
            institution_id: institutionId,
            leave_type: leave,
            start_date: new Date(startDate),
            end_date: new Date(endDate),
            reason: reason || null,
          }
        });
      });

      if (!created) {
        return res.status(400).json({ error: 'You already have a leave request for these dates' });
      }

      notifyAdminsOfRequest(institutionId, req.user, leave, startDate, endDate, created.id);
      return res.status(201).json(created);
    }

    // fallback: raw SQL
    const overlap = await db.query(
      `SELECT id FROM leave_requests
       WHERE staff_uuid = $1 AND status IN ('pending', 'approved')
         AND start_date <= $3 AND end_date >= $2`,
      [staffUuid, startDate, endDate]
    );

    if (overlap.rows.length > 0) {
      return res.status(400).json({ error: 'You already have a leave request for these dates' });
    }

    const result = await db.query(
      `INSERT INTO leave_requests (staff_uuid, institution_id, leave_type, start_date, end_date, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [staffUuid, institutionId, leave, startDate, endDate, reason || null]
    );

    notifyAdminsOfRequest(institutionId, req.user, leave, startDate, endDate, result.rows[0].id);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Request leave error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Staff: get my leave requests
exports.getMyLeaves = async (req, res) => {
  try {
    if (prisma) {
      const rows = await withPrismaTenant(req, (tx) =>
        tx.leave_requests.findMany({
          where: { staff_uuid: req.user.id },
          orderBy: { created_at: 'desc' },
        })
      );
      return res.json(rows);
    }

    const result = await req.tenantDb.query(
      `SELECT lr.*, s.first_name as reviewer_first_name, s.last_name as reviewer_last_name
       FROM leave_requests lr
       LEFT JOIN staff s ON lr.reviewed_by = s.id
       WHERE lr.staff_uuid = $1
       ORDER BY lr.created_at DESC`,
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
    if (prisma) {
      const result = await withPrismaTenant(req, async (tx) => {
        const existing = await tx.leave_requests.findFirst({
          where: { id: Number(req.params.id), staff_uuid: req.user.id, status: 'pending' }
        });
        if (!existing) return null;
        return tx.leave_requests.update({
          where: { id: existing.id },
          data: { status: 'cancelled', updated_at: new Date() }
        });
      });
      if (!result) return res.status(404).json({ error: 'Leave request not found or cannot be cancelled' });
      return res.json(result);
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

// Admin: get all leave requests for institution
exports.getAllLeaves = async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const institutionId = req.user.institution_id;

    if (prisma) {
      const data = await withPrismaTenant(req, async (tx) => {
        const where = { institution_id: institutionId };
        if (status) where.status = status;

        const [leaves, count] = await Promise.all([
          tx.leave_requests.findMany({
            where,
            orderBy: { created_at: 'desc' },
            take: parseInt(limit, 10),
            skip: parseInt(offset, 10),
          }),
          tx.leave_requests.count({ where }),
        ]);
        return { leaves, count };
      });
      return res.json({
        leaves: data.leaves,
        total: data.count,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
      });
    }

    let query = `
      SELECT lr.*, s.staff_id, s.first_name, s.last_name, s.department,
             r.first_name as reviewer_first_name, r.last_name as reviewer_last_name
      FROM leave_requests lr
      JOIN staff s ON lr.staff_uuid = s.id
      LEFT JOIN staff r ON lr.reviewed_by = r.id
      WHERE lr.institution_id = $1`;
    const params = [institutionId];
    let paramIndex = 2;

    if (status) {
      query += ` AND lr.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ` ORDER BY lr.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await req.tenantDb.query(query, params);

    const countQuery = `SELECT COUNT(*) FROM leave_requests WHERE institution_id = $1${status ? ' AND status = $2' : ''}`;
    const countParams = status ? [institutionId, status] : [institutionId];
    const countResult = await req.tenantDb.query(countQuery, countParams);

    res.json({
      leaves: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
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
    const { status, reviewNote } = req.body;
    const { id } = req.params;
    const institutionId = req.user.institution_id;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be approved or rejected' });
    }

    if (prisma) {
      const updated = await withPrismaTenant(req, async (tx) => {
        const existing = await tx.leave_requests.findFirst({ where: { id: Number(id), institution_id: institutionId } });
        if (!existing) return { notFound: true };
        if (existing.status !== 'pending') return { notPending: true };

        return tx.leave_requests.update({
          where: { id: existing.id },
          data: { status, reviewed_by: req.user.id, reviewed_at: new Date(), review_note: reviewNote || null, updated_at: new Date() }
        });
      });

      if (updated && updated.notFound) {
        return res.status(404).json({ error: 'Leave request not found' });
      }
      if (updated && updated.notPending) {
        return res.status(400).json({ error: 'Can only review pending requests' });
      }

      notifyRequesterOfReview(id, status, reviewNote);
      return res.json(updated);
    }

    const existing = await db.query(
      'SELECT id, status FROM leave_requests WHERE id = $1 AND institution_id = $2',
      [id, institutionId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    if (existing.rows[0].status !== 'pending') {
      return res.status(400).json({ error: 'Can only review pending requests' });
    }

    const result = await db.query(
      `UPDATE leave_requests
       SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_note = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, req.user.id, reviewNote || null, id]
    );

    notifyRequesterOfReview(id, status, reviewNote);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Review leave error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get leave stats for dashboard
exports.getLeaveStats = async (req, res) => {
  const db = req.tenantDb;
  try {
    const institutionId = req.user.institution_id;
    const result = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'approved') as approved,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        COUNT(*) FILTER (WHERE status = 'approved' AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE) as on_leave_today
      FROM leave_requests WHERE institution_id = $1
    `, [institutionId]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Leave stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
