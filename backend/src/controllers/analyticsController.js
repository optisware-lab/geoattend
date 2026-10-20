const pool = require('../config/database');

// Attendance trends (last 30 days)
exports.getAttendanceTrends = async (req, res) => {
  try {
    const institutionId = req.user.institution_id;
    const { days = 30 } = req.query;

    const totalStaff = await req.tenantDb.query(
      "SELECT COUNT(*) FROM staff WHERE institution_id = $1 AND member_type = 'staff' AND is_active = true",
      [institutionId]
    );
    const total = parseInt(totalStaff.rows[0].count);

    const result = await req.tenantDb.query(`
      SELECT
        ar.date,
        COUNT(DISTINCT ar.staff_uuid) as present,
        COUNT(DISTINCT CASE WHEN ar.is_late THEN ar.staff_uuid END) as late,
        ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(ar.check_out_time, NOW()) - ar.check_in_time)) / 3600)::numeric, 1) as avg_hours
      FROM attendance_records ar
      JOIN staff s ON s.id = ar.staff_uuid AND s.member_type = 'staff'
      WHERE ar.institution_id = $1 AND ar.date >= CURRENT_DATE - $2::INTEGER
      GROUP BY ar.date
      ORDER BY ar.date
    `, [institutionId, parseInt(days)]);

    const trends = result.rows.map(r => ({
      date: r.date,
      present: parseInt(r.present),
      late: parseInt(r.late),
      absent: total - parseInt(r.present),
      total,
      rate: total > 0 ? Math.round((parseInt(r.present) / total) * 100) : 0,
      avgHours: parseFloat(r.avg_hours || 0),
    }));

    res.json(trends);
  } catch (err) {
    console.error('Attendance trends error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Top absentees
exports.getTopAbsentees = async (req, res) => {
  try {
    const institutionId = req.user.institution_id;
    const { days = 30 } = req.query;

    // Get working days count
    const rules = await req.tenantDb.query(
      "SELECT working_days FROM attendance_rules WHERE institution_id = $1 AND member_type = 'staff'",
      [institutionId]
    );
    const workingDays = rules.rows[0]?.working_days || [1, 2, 3, 4, 5];

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - parseInt(days));
    let totalWorkDays = 0;
    for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 1)) {
      if (workingDays.includes(d.getDay())) totalWorkDays++;
    }

    const result = await req.tenantDb.query(`
      SELECT s.id, s.staff_id, s.first_name, s.last_name, s.department,
             COUNT(ar.id) as days_present,
             COUNT(CASE WHEN ar.is_late THEN 1 END) as days_late
      FROM staff s
      LEFT JOIN attendance_records ar ON ar.staff_uuid = s.id
        AND ar.date >= CURRENT_DATE - $2::INTEGER
      WHERE s.institution_id = $1 AND s.member_type = 'staff' AND s.is_active = true
      GROUP BY s.id, s.staff_id, s.first_name, s.last_name, s.department
      ORDER BY COUNT(ar.id) ASC
      LIMIT 20
    `, [institutionId, parseInt(days)]);

    const absentees = result.rows.map(r => ({
      ...r,
      daysPresent: parseInt(r.days_present),
      daysLate: parseInt(r.days_late),
      daysAbsent: totalWorkDays - parseInt(r.days_present),
      totalWorkDays,
      attendanceRate: totalWorkDays > 0 ? Math.round((parseInt(r.days_present) / totalWorkDays) * 100) : 0,
    }));

    res.json(absentees);
  } catch (err) {
    console.error('Top absentees error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Department comparison
exports.getDepartmentStats = async (req, res) => {
  try {
    const institutionId = req.user.institution_id;
    const { days = 30 } = req.query;

    const result = await req.tenantDb.query(`
      SELECT
        s.department,
        COUNT(DISTINCT s.id) as total_members,
        COUNT(DISTINCT ar.staff_uuid) as members_with_attendance,
        COUNT(ar.id) as total_checkins,
        COUNT(CASE WHEN ar.is_late THEN 1 END) as total_late,
        ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(ar.check_out_time, NOW()) - ar.check_in_time)) / 3600)::numeric, 1) as avg_hours
      FROM staff s
      LEFT JOIN attendance_records ar ON ar.staff_uuid = s.id
        AND ar.date >= CURRENT_DATE - $2::INTEGER
      WHERE s.institution_id = $1 AND s.member_type = 'staff' AND s.is_active = true AND s.department IS NOT NULL
      GROUP BY s.department
      ORDER BY s.department
    `, [institutionId, parseInt(days)]);

    res.json(result.rows.map(r => ({
      department: r.department,
      totalMembers: parseInt(r.total_members),
      totalCheckins: parseInt(r.total_checkins),
      totalLate: parseInt(r.total_late),
      avgHours: parseFloat(r.avg_hours || 0),
      lateRate: parseInt(r.total_checkins) > 0
        ? Math.round((parseInt(r.total_late) / parseInt(r.total_checkins)) * 100) : 0,
    })));
  } catch (err) {
    console.error('Department stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Overtime summary
exports.getOvertimeSummary = async (req, res) => {
  try {
    const institutionId = req.user.institution_id;
    const { days = 30 } = req.query;

    const result = await req.tenantDb.query(`
      SELECT s.staff_id, s.first_name, s.last_name, s.department,
             COUNT(o.id) as overtime_days,
             SUM(o.overtime_minutes) as total_overtime_minutes,
             ROUND(AVG(o.overtime_minutes)::numeric, 0) as avg_overtime_minutes
      FROM overtime_records o
      JOIN staff s ON o.staff_uuid = s.id
      WHERE o.institution_id = $1 AND s.member_type = 'staff' AND o.date >= CURRENT_DATE - $2::INTEGER
      GROUP BY s.staff_id, s.first_name, s.last_name, s.department
      ORDER BY SUM(o.overtime_minutes) DESC
      LIMIT 20
    `, [institutionId, parseInt(days)]);

    res.json(result.rows.map(r => ({
      ...r,
      overtimeDays: parseInt(r.overtime_days),
      totalOvertimeMinutes: parseInt(r.total_overtime_minutes),
      totalOvertimeHours: Math.round(parseInt(r.total_overtime_minutes) / 60 * 10) / 10,
      avgOvertimeMinutes: parseInt(r.avg_overtime_minutes),
    })));
  } catch (err) {
    console.error('Overtime summary error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Audit logs
exports.getAuditLogs = async (req, res) => {
  try {
    const institutionId = req.user.institution_id;
    const { page = 1, limit = 50, action, entityType } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT al.*, s.first_name as performer_first_name, s.last_name as performer_last_name
      FROM audit_logs al
      LEFT JOIN staff s ON al.performed_by::uuid = s.id
      WHERE al.institution_id = $1`;
    const params = [institutionId];
    let paramIndex = 2;

    if (action) {
      query += ` AND al.action = $${paramIndex}`;
      params.push(action);
      paramIndex++;
    }
    if (entityType) {
      query += ` AND al.entity_type = $${paramIndex}`;
      params.push(entityType);
      paramIndex++;
    }

    query += ` ORDER BY al.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await req.tenantDb.query(query, params);

    res.json({
      logs: result.rows,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  } catch (err) {
    console.error('Audit logs error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Scheduler status (for admin settings)
exports.getSchedulerStatus = async (req, res) => {
  res.json({
    jobs: [
      { name: 'Auto Check-Out', schedule: 'Mon-Fri 5:30 PM', timezone: 'Africa/Accra' },
      { name: 'Absence Detection', schedule: 'Mon-Fri 10:00 AM', timezone: 'Africa/Accra' },
      { name: 'Daily Summary', schedule: 'Mon-Fri 6:00 PM', timezone: 'Africa/Accra' },
      { name: 'Weekly Summary', schedule: 'Friday 6:30 PM', timezone: 'Africa/Accra' },
      { name: 'Auto-Suspend Inactive', schedule: 'Sunday midnight', timezone: 'Africa/Accra' },
      { name: 'QR Code Rotation', schedule: '1st of month 2:00 AM', timezone: 'Africa/Accra' },
    ],
  });
};
