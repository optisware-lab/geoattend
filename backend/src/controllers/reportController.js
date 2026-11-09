const pool = require('../config/database');
const excel4node = require('excel4node');
const { formatDate, formatDateRange, formatTime } = require('../utils/dateFormat');
const { loadAttendanceData, buildWeeklyBreakdown } = require('../services/attendanceSummary');
const { renderAttendancePdf } = require('../services/attendancePdf');

exports.getDashboardStats = async (req, res) => {
  try {
    const institutionId = req.user.institution_id;
    const today = new Date().toISOString().split('T')[0];

    const [totalStaff, presentToday, lateToday, absentToday] = await Promise.all([
      req.tenantDb.query("SELECT COUNT(*) FROM staff WHERE institution_id = $1 AND member_type = 'staff' AND is_active = true", [institutionId]),
      req.tenantDb.query(
        `SELECT COUNT(DISTINCT ar.staff_uuid)
         FROM attendance_records ar
         JOIN staff s ON s.id = ar.staff_uuid
         WHERE ar.institution_id = $1 AND ar.date = $2 AND s.member_type = 'staff'`,
        [institutionId, today]
      ),
      req.tenantDb.query(
        `SELECT COUNT(DISTINCT ar.staff_uuid)
         FROM attendance_records ar
         JOIN staff s ON s.id = ar.staff_uuid
         WHERE ar.institution_id = $1 AND ar.date = $2 AND ar.is_late = true AND s.member_type = 'staff'`,
        [institutionId, today]
      ),
      req.tenantDb.query(
        `SELECT COUNT(*) FROM staff s
         WHERE s.institution_id = $1 AND s.member_type = 'staff' AND s.is_active = true
         AND s.id NOT IN (
           SELECT staff_uuid FROM attendance_records WHERE institution_id = $1 AND date = $2
         )`,
        [institutionId, today]
      ),
    ]);

    res.json({
      totalStaff: parseInt(totalStaff.rows[0].count, 10),
      presentToday: parseInt(presentToday.rows[0].count, 10),
      lateToday: parseInt(lateToday.rows[0].count, 10),
      absentToday: parseInt(absentToday.rows[0].count, 10),
      date: today,
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getTodaySummary = async (req, res) => {
  try {
    const institutionId = req.user.institution_id;
    const today = new Date().toISOString().split('T')[0];

    const [presentToday, lateToday, absentToday] = await Promise.all([
      req.tenantDb.query(
        `SELECT COUNT(DISTINCT ar.staff_uuid)
         FROM attendance_records ar
         JOIN staff s ON s.id = ar.staff_uuid
         WHERE ar.institution_id = $1 AND ar.date = $2 AND s.member_type = 'staff'`,
        [institutionId, today]
      ),
      req.tenantDb.query(
        `SELECT COUNT(DISTINCT ar.staff_uuid)
         FROM attendance_records ar
         JOIN staff s ON s.id = ar.staff_uuid
         WHERE ar.institution_id = $1 AND ar.date = $2 AND ar.is_late = true AND s.member_type = 'staff'`,
        [institutionId, today]
      ),
      req.tenantDb.query(
        `SELECT COUNT(*)
         FROM staff s
         WHERE s.institution_id = $1 AND s.member_type = 'staff' AND s.is_active = true
           AND s.id NOT IN (
             SELECT staff_uuid FROM attendance_records WHERE institution_id = $1 AND date = $2
           )`,
        [institutionId, today]
      ),
    ]);

    res.json({
      date: today,
      present: parseInt(presentToday.rows[0].count, 10),
      late: parseInt(lateToday.rows[0].count, 10),
      absent: parseInt(absentToday.rows[0].count, 10),
    });
  } catch (err) {
    console.error('Today summary error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getFraudReport = async (req, res) => {
  try {
    const institutionId = req.user.institution_id;
    const { startDate, endDate, page = 1, limit = 100 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT f.*, s.staff_id, s.first_name, s.last_name
      FROM fraud_events f
      LEFT JOIN staff s ON s.id = f.staff_uuid
      WHERE f.institution_id = $1 AND (s.id IS NULL OR s.member_type = 'staff')`;
    const params = [institutionId];
    let i = 2;

    if (startDate) {
      query += ` AND DATE(f.created_at) >= $${i}`;
      params.push(startDate);
      i++;
    }
    if (endDate) {
      query += ` AND DATE(f.created_at) <= $${i}`;
      params.push(endDate);
      i++;
    }

    query += ` ORDER BY f.created_at DESC LIMIT $${i} OFFSET $${i + 1}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await req.tenantDb.query(query, params);
    res.json({ events: result.rows, page: parseInt(page, 10), limit: parseInt(limit, 10) });
  } catch (err) {
    console.error('Fraud report error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getAttendanceReport = async (req, res) => {
  try {
    const { startDate, endDate, department, staffId, page = 1, limit = 50 } = req.query;
    const institutionId = req.user.institution_id;
    const offset = (page - 1) * limit;

    // Build LEFT JOIN so all active staff appear, even those with no attendance records
    let joinConditions = `ar.staff_uuid = s.id AND ar.institution_id = s.institution_id`;
    const params = [institutionId];
    let paramIndex = 2;

    if (startDate) {
      joinConditions += ` AND ar.date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    if (endDate) {
      joinConditions += ` AND ar.date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    let query = `
      SELECT ar.id, ar.date, ar.check_in_time, ar.check_out_time, ar.check_in_method, ar.is_late,
             ar.premises_left_at, ar.premises_returned_at,
             s.staff_id, s.first_name, s.last_name, s.department, s.position
      FROM staff s
      LEFT JOIN attendance_records ar ON ${joinConditions}
      WHERE s.institution_id = $1 AND s.member_type = 'staff' AND s.is_active = true`;

    if (department) {
      query += ` AND s.department = $${paramIndex}`;
      params.push(department);
      paramIndex++;
    }
    if (staffId) {
      query += ` AND s.staff_id ILIKE $${paramIndex}`;
      params.push(`%${staffId}%`);
      paramIndex++;
    }

    query += ` ORDER BY ar.date DESC NULLS LAST, s.last_name, s.first_name, ar.check_in_time DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await req.tenantDb.query(query, params);

    res.json({
      records: result.rows,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  } catch (err) {
    console.error('Attendance report error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getRealTimeAttendance = async (req, res) => {
  try {
    const institutionId = req.user.institution_id;
    const today = new Date().toISOString().split('T')[0];

    const result = await req.tenantDb.query(
      `SELECT ar.*, s.staff_id, s.first_name, s.last_name, s.department, s.position, s.profile_photo_url
       FROM attendance_records ar
       JOIN staff s ON ar.staff_uuid = s.id
       WHERE ar.institution_id = $1 AND ar.date = $2 AND s.member_type = 'staff'
       ORDER BY ar.check_in_time DESC`,
      [institutionId, today]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Real-time attendance error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getGeofenceEvents = async (req, res) => {
  try {
    const institutionId = req.user.institution_id;
    const {
      startDate,
      endDate,
      department,
      onlyExits = 'true',
      page = 1,
      limit = 100,
    } = req.query;
    const offset = (page - 1) * limit;

    const params = [institutionId];
    let i = 2;
    let where = "g.institution_id = $1 AND s.member_type = 'staff'";

    if (startDate) {
      where += ` AND DATE(g.created_at) >= $${i}`;
      params.push(startDate);
      i++;
    }
    if (endDate) {
      where += ` AND DATE(g.created_at) <= $${i}`;
      params.push(endDate);
      i++;
    }
    if (onlyExits === 'true') {
      where += ` AND g.event = 'exit'`;
    }

    if (department) {
      where += ` AND s.department = $${i}`;
      params.push(department);
      i++;
    }

    const query = `
      SELECT
        g.*,
        s.staff_id,
        s.first_name,
        s.last_name,
        s.department
      FROM geofence_events g
      JOIN staff s ON s.id = g.staff_uuid
      WHERE ${where}
      ORDER BY g.created_at DESC
      LIMIT $${i} OFFSET $${i + 1}
    `;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await req.tenantDb.query(query, params);
    res.json({
      events: result.rows,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  } catch (err) {
    console.error('Geofence events report error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getWeeklySummary = async (req, res) => {
  try {
    const institutionId = req.user.institution_id;
    const result = await req.tenantDb.query(
      `SELECT
        ar.date,
        COUNT(DISTINCT ar.staff_uuid) as present,
        COUNT(DISTINCT CASE WHEN ar.is_late THEN ar.staff_uuid END) as late,
        (SELECT COUNT(*) FROM staff WHERE institution_id = $1 AND member_type = 'staff' AND is_active = true) as total_staff
       FROM attendance_records ar
       JOIN staff s ON s.id = ar.staff_uuid
       WHERE ar.institution_id = $1 AND s.member_type = 'staff' AND ar.date >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY ar.date
       ORDER BY ar.date`,
      [institutionId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Weekly summary error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

function reportFilters(query) {
  const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return {
    startDate: clean(query.startDate),
    endDate: clean(query.endDate),
    department: clean(query.department),
    staffId: clean(query.staffId),
  };
}

// Week-by-week view for the dashboard: who signed in each week, who didn't
exports.getWeeklyBreakdown = async (req, res) => {
  try {
    const filters = reportFilters(req.query);
    const data = await loadAttendanceData(req.tenantDb, req.user.institution_id, filters);
    const summary = buildWeeklyBreakdown(data, filters);

    // The dashboard needs each person's day marks, not the full records
    res.json({
      ...summary,
      weeks: summary.weeks.map((w) => ({
        ...w,
        active: w.active.map(({ cells, ...r }) => ({
          ...r,
          days: Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, c ? { status: c.status, checkIn: c.checkIn || null } : null])),
        })),
        inactive: w.inactive.map(({ cells, ...r }) => r),
        onLeave: w.onLeave.map(({ cells, ...r }) => r),
      })),
    });
  } catch (err) {
    console.error('Weekly breakdown error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const CELL_TEXT = { leave: 'Leave', absent: 'Missed' };

exports.exportExcel = async (req, res) => {
  try {
    const filters = reportFilters(req.query);
    const { startDate, endDate } = filters;
    const institutionId = req.user.institution_id;

    const data = await loadAttendanceData(req.tenantDb, institutionId, filters);
    const summary = buildWeeklyBreakdown(data, filters);

    let query = `
      SELECT ar.date, s.staff_id, s.first_name, s.last_name, s.department, s.position,
             ar.check_in_time, ar.check_out_time, ar.check_in_method, ar.is_late, ar.is_within_geofence,
             ar.premises_left_at, ar.premises_returned_at
      FROM attendance_records ar
      JOIN staff s ON ar.staff_uuid = s.id
      WHERE ar.institution_id = $1 AND s.member_type = 'staff'`;
    const params = [institutionId];
    let paramIndex = 2;

    if (startDate) { query += ` AND ar.date >= $${paramIndex}`; params.push(startDate); paramIndex++; }
    if (endDate) { query += ` AND ar.date <= $${paramIndex}`; params.push(endDate); paramIndex++; }
    if (filters.department) { query += ` AND s.department = $${paramIndex}`; params.push(filters.department); paramIndex++; }
    if (filters.staffId) { query += ` AND s.staff_id ILIKE $${paramIndex}`; params.push(`%${filters.staffId}%`); paramIndex++; }

    query += ' ORDER BY ar.date DESC, s.last_name';
    const result = await req.tenantDb.query(query, params);

    const wb = new excel4node.Workbook();
    const headerStyle = wb.createStyle({
      font: { bold: true, size: 11, color: '#ffffff' },
      fill: { type: 'pattern', patternType: 'solid', fgColor: '#1a5276' },
      alignment: { horizontal: 'center' },
    });
    const weekStyle = wb.createStyle({
      font: { bold: true, size: 12, color: '#1a5276' },
      fill: { type: 'pattern', patternType: 'solid', fgColor: '#eaf1f7' },
    });
    const titleStyle = wb.createStyle({ font: { bold: true, size: 14, color: '#1a5276' } });
    const colors = { ontime: '#1e8449', late: '#c0640f', leave: '#2471a3', absent: '#c0392b' };
    const cellStyles = Object.fromEntries(
      Object.entries(colors).map(([k, c]) => [k, wb.createStyle({ font: { color: c, bold: k === 'late' }, alignment: { horizontal: 'center' } })])
    );

    // Sheet 1: week by week
    const wk = wb.addWorksheet('Week by week');
    wk.column(1).setWidth(30);
    wk.column(2).setWidth(12);
    wk.column(3).setWidth(18);
    for (let c = 4; c <= 13; c += 1) wk.column(c).setWidth(13);

    let r = 1;
    wk.cell(r, 1).string(`${data.institutionName} - Attendance by week`).style(titleStyle);
    r += 1;
    wk.cell(r, 1).string(`Period: ${formatDateRange(summary.start, summary.end)}`);
    r += 1;
    wk.cell(r, 1).string(
      `${summary.activeStaff} of ${summary.staffCount} staff signed in at least once. `
      + `On time: ${summary.totals.onTime}. Late: ${summary.totals.late}. Missed work days: ${summary.totals.missed}. `
      + `Attendance rate: ${summary.totals.rate == null ? '-' : `${summary.totals.rate}%`}.`
    );
    r += 2;

    summary.weeks.forEach((w) => {
      const lastCol = 3 + w.days.length + 3;
      wk.cell(r, 1, r, lastCol, true)
        .string(`Week ${w.number}:  ${formatDateRange(w.start, w.end)}   |   ${w.active.length} of ${w.staffCounted} staff signed in   |   `
          + `${w.onTime} on time, ${w.late} late, ${w.missed} missed   |   Rate ${w.rate == null ? '-' : `${w.rate}%`}`)
        .style(weekStyle);
      r += 1;
      const heads = ['Name', 'Staff ID', 'Department', ...w.days.map((d) => formatDate(d.date).replace(/, \d{4}$/, '')), 'Days signed in', 'Late', 'Missed'];
      heads.forEach((h, i) => wk.cell(r, i + 1).string(h).style(headerStyle));
      r += 1;

      [...w.active, ...w.inactive, ...w.onLeave].forEach((p) => {
        wk.cell(r, 1).string(p.name);
        wk.cell(r, 2).string(p.staffId || '');
        wk.cell(r, 3).string(p.department || '');
        w.days.forEach((d, i) => {
          const c = p.cells[d.date];
          if (!c) return;
          const text = c.checkIn ? formatTime(c.checkIn) : CELL_TEXT[c.status] || '';
          wk.cell(r, 4 + i).string(text).style(cellStyles[c.status]);
        });
        wk.cell(r, 4 + w.days.length).number(p.daysIn);
        wk.cell(r, 5 + w.days.length).number(p.late);
        wk.cell(r, 6 + w.days.length).number(p.missed);
        r += 1;
      });
      r += 1;
    });

    // Sheet 2: every sign-in
    const ws = wb.addWorksheet('Sign-in log');
    const headers = ['Date', 'Staff ID', 'First Name', 'Last Name', 'Department', 'Position', 'Sign In', 'Sign Out', 'Method', 'Late', 'Within Geofence', 'Left Premises', 'Returned'];
    headers.forEach((h, i) => ws.cell(1, i + 1).string(h).style(headerStyle));
    ws.column(1).setWidth(20);
    ws.column(4).setWidth(16);

    result.rows.forEach((row, i) => {
      const rr = i + 2;
      ws.cell(rr, 1).string(formatDate(row.date));
      ws.cell(rr, 2).string(row.staff_id || '');
      ws.cell(rr, 3).string(row.first_name || '');
      ws.cell(rr, 4).string(row.last_name || '');
      ws.cell(rr, 5).string(row.department || '');
      ws.cell(rr, 6).string(row.position || '');
      ws.cell(rr, 7).string(formatTime(row.check_in_time));
      ws.cell(rr, 8).string(formatTime(row.check_out_time, 'N/A'));
      ws.cell(rr, 9).string(row.check_in_method || '');
      ws.cell(rr, 10).string(row.is_late ? 'Yes' : 'No');
      ws.cell(rr, 11).string(row.is_within_geofence ? 'Yes' : 'No');
      ws.cell(rr, 12).string(formatTime(row.premises_left_at));
      ws.cell(rr, 13).string(formatTime(row.premises_returned_at));
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_report_${startDate || 'all'}_${endDate || 'all'}.xlsx`);

    wb.write('report.xlsx', res);
  } catch (err) {
    console.error('Export Excel error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.exportPDF = async (req, res) => {
  try {
    const filters = reportFilters(req.query);
    const data = await loadAttendanceData(req.tenantDb, req.user.institution_id, filters);
    const summary = buildWeeklyBreakdown(data, filters);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_report_${filters.startDate || 'all'}_${filters.endDate || 'all'}.pdf`);

    renderAttendancePdf(res, {
      institutionName: data.institutionName,
      department: filters.department,
      staffIdFilter: filters.staffId,
      summary,
      records: data.records,
      staffById: new Map(data.staff.map((s) => [s.id, s])),
    });
  } catch (err) {
    console.error('Export PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
};

