const pool = require('../config/database');
const excel4node = require('excel4node');
const { formatDate, formatDateRange, formatTime, dayKey } = require('../utils/dateFormat');
const { loadAttendanceData, buildWeeklyBreakdown, buildAbsenceReport } = require('../services/attendanceSummary');
const { renderAttendancePdf, renderAbsencePdf } = require('../services/attendancePdf');

// Longest period a report can cover (a full school year fits)
const MAX_RANGE_DAYS = 366;

function isCalendarDay(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
}

/**
 * Report filters from the query string, with the dates checked.
 * Returns { filters } or { error } (a message for the admin).
 */
function reportFilters(query, { requireDates = false } = {}) {
  const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const filters = {
    startDate: clean(query.startDate),
    endDate: clean(query.endDate),
    department: clean(query.department),
    staffId: clean(query.staffId),
  };
  for (const key of ['startDate', 'endDate']) {
    if (filters[key] && !isCalendarDay(filters[key])) return { error: 'Dates must be real days written as YYYY-MM-DD, e.g. 2026-09-10.' };
  }
  if (requireDates && (!filters.startDate || !filters.endDate)) return { error: 'Pick a start date and an end date.' };
  if (filters.startDate) {
    const end = filters.endDate || dayKey(new Date());
    if (end < filters.startDate) return { error: 'The end date is before the start date.' };
    const days = daysBetween(filters.startDate, end);
    if (days > MAX_RANGE_DAYS) return { error: `A report can cover up to one year. This period is ${days} days; please shorten it.` };
  }
  return { filters };
}

/** "Absent at least N work days" filter (0 = all staff) */
function minAbsentOf(query) {
  const n = parseInt(query.minAbsent, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_RANGE_DAYS) : 0;
}

function showLabelOf(minAbsent) {
  if (!minAbsent) return 'all staff';
  return minAbsent === 1 ? 'staff absent at least once' : `staff absent ${minAbsent} or more work days`;
}

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
    const { error } = reportFilters(req.query);
    if (error) return res.status(400).json({ error });
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

// Week-by-week view for the dashboard: who signed in each week, who didn't
exports.getWeeklyBreakdown = async (req, res) => {
  try {
    const { filters, error } = reportFilters(req.query);
    if (error) return res.status(400).json({ error });
    const data = await loadAttendanceData(req.tenantDb, req.user.institution_id, filters);
    const { people, ...summary } = buildWeeklyBreakdown(data, filters);

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

const CELL_TEXT = { leave: 'Leave', absent: 'Absent' };

// Absence report: each staff member's absent, present, late and leave days
// for the chosen period, most absent first
async function loadAbsenceReport(req) {
  const { filters, error } = reportFilters(req.query, { requireDates: true });
  if (error) return { error };
  const minAbsent = minAbsentOf(req.query);
  const data = await loadAttendanceData(req.tenantDb, req.user.institution_id, filters);
  const report = buildAbsenceReport(buildWeeklyBreakdown(data, filters), { minAbsent });
  return { filters, minAbsent, data, report };
}

exports.getAbsenceReport = async (req, res) => {
  try {
    const { error, report } = await loadAbsenceReport(req);
    if (error) return res.status(400).json({ error });
    res.json(report);
  } catch (err) {
    console.error('Absence report error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.exportAbsencePDF = async (req, res) => {
  try {
    const { error, filters, minAbsent, data, report } = await loadAbsenceReport(req);
    if (error) return res.status(400).json({ error });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=absence_report_${report.start}_to_${report.end}.pdf`);
    renderAbsencePdf(res, {
      institutionName: data.institutionName,
      institutionLogo: data.institutionLogo,
      report,
      department: filters.department,
      showLabel: showLabelOf(minAbsent),
    });
  } catch (err) {
    console.error('Absence PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
};

exports.exportAbsenceExcel = async (req, res) => {
  try {
    const { error, filters, minAbsent, data, report } = await loadAbsenceReport(req);
    if (error) return res.status(400).json({ error });

    const wb = new excel4node.Workbook();
    const headerStyle = wb.createStyle({
      font: { bold: true, size: 11, color: '#ffffff' },
      fill: { type: 'pattern', patternType: 'solid', fgColor: '#1a5276' },
      alignment: { horizontal: 'center' },
    });
    const titleStyle = wb.createStyle({ font: { bold: true, size: 14, color: '#1a5276' } });
    const redStyle = wb.createStyle({ font: { bold: true, color: '#c0392b' } });

    const ws = wb.addWorksheet('Absence');
    [6, 30, 12, 20, 11, 10, 8, 8, 9, 9, 60].forEach((w, i) => ws.column(i + 1).setWidth(w));
    let r = 1;
    ws.cell(r, 1, r, 11, true).string(`${data.institutionName} - Absence report`).style(titleStyle);
    r += 1;
    ws.cell(r, 1, r, 11, true).string(`Period: ${formatDateRange(report.start, report.end)}`);
    r += 1;
    ws.cell(r, 1, r, 11, true).string(
      [filters.department && `Department: ${filters.department}`, `Showing: ${showLabelOf(minAbsent)}`].filter(Boolean).join('   ·   ')
    );
    r += 1;
    const t = report.totals;
    ws.cell(r, 1, r, 11, true).string(
      `${report.workDayCount} work days. ${t.withAbsences} of ${t.staffCount} staff were absent at least once. `
      + `Absent work days: ${t.absent}. Late sign-ins: ${t.late}. Leave days: ${t.leave}. `
      + `Attendance rate: ${t.rate == null ? '-' : `${t.rate}%`}.`
    );
    r += 2;
    ['#', 'Name', 'Staff ID', 'Department', 'Work days', 'Present', 'Late', 'Leave', 'Absent', 'Rate %', 'Days absent']
      .forEach((h, i) => ws.cell(r, i + 1).string(h).style(headerStyle));
    r += 1;
    report.people.forEach((p, i) => {
      ws.cell(r, 1).number(i + 1);
      ws.cell(r, 2).string(p.name);
      ws.cell(r, 3).string(p.staffId || '');
      ws.cell(r, 4).string(p.department || '');
      ws.cell(r, 5).number(p.expected);
      ws.cell(r, 6).number(p.daysIn);
      ws.cell(r, 7).number(p.late);
      ws.cell(r, 8).number(p.leave);
      const absent = ws.cell(r, 9).number(p.missed);
      if (p.missed) absent.style(redStyle);
      if (p.rate != null) ws.cell(r, 10).number(p.rate);
      ws.cell(r, 11).string(p.absentDates.map((d) => formatDate(d)).join('; '));
      r += 1;
    });

    // One line per absent day, easy to sort and filter
    const days = wb.addWorksheet('Days absent');
    [20, 30, 12, 20].forEach((w, i) => days.column(i + 1).setWidth(w));
    ['Date', 'Name', 'Staff ID', 'Department'].forEach((h, i) => days.cell(1, i + 1).string(h).style(headerStyle));
    const lines = report.people.flatMap((p) => p.absentDates.map((d) => ({ d, p })))
      .sort((a, b) => a.d.localeCompare(b.d) || a.p.name.localeCompare(b.p.name));
    lines.forEach(({ d, p }, i) => {
      days.cell(i + 2, 1).string(formatDate(d));
      days.cell(i + 2, 2).string(p.name);
      days.cell(i + 2, 3).string(p.staffId || '');
      days.cell(i + 2, 4).string(p.department || '');
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=absence_report_${report.start}_to_${report.end}.xlsx`);
    wb.write(`absence_report_${report.start}_to_${report.end}.xlsx`, res);
  } catch (err) {
    console.error('Absence Excel error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
};

exports.exportExcel = async (req, res) => {
  try {
    const { filters, error } = reportFilters(req.query);
    if (error) return res.status(400).json({ error });
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
    // Institution logo in the top-left corner, title rows below it
    if (data.institutionLogo) {
      try {
        wk.addImage({ image: data.institutionLogo, type: 'picture', position: { type: 'oneCellAnchor', from: { col: 1, colOff: 0, row: 1, rowOff: 0 } } });
        wk.row(1).setHeight(60);
      } catch { /* report still downloads without it */ }
      r += 1;
    }
    wk.cell(r, 1).string(`${data.institutionName} - Attendance by week`).style(titleStyle);
    r += 1;
    wk.cell(r, 1).string(`Period: ${formatDateRange(summary.start, summary.end)}`);
    r += 1;
    wk.cell(r, 1).string(
      `${summary.activeStaff} of ${summary.staffCount} staff signed in at least once. `
      + `On time: ${summary.totals.onTime}. Late: ${summary.totals.late}. Absent work days: ${summary.totals.missed}. `
      + `Attendance rate: ${summary.totals.rate == null ? '-' : `${summary.totals.rate}%`}.`
    );
    r += 2;

    summary.weeks.forEach((w) => {
      const lastCol = 3 + w.days.length + 3;
      wk.cell(r, 1, r, lastCol, true)
        .string(`Week ${w.number}:  ${formatDateRange(w.start, w.end)}   |   ${w.active.length} of ${w.staffCounted} staff signed in   |   `
          + `${w.onTime} on time, ${w.late} late, ${w.missed} absent   |   Rate ${w.rate == null ? '-' : `${w.rate}%`}`)
        .style(weekStyle);
      r += 1;
      const heads = ['Name', 'Staff ID', 'Department', ...w.days.map((d) => formatDate(d.date).replace(/, \d{4}$/, '')), 'Days signed in', 'Late', 'Absent'];
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

    // Sheet 2: one summary per month
    const ms = wb.addWorksheet('Monthly summary');
    ms.column(1).setWidth(30);
    ms.column(2).setWidth(12);
    ms.column(3).setWidth(18);
    for (let c = 4; c <= 10; c += 1) ms.column(c).setWidth(12);
    let mr = 1;
    ms.cell(mr, 1).string(`${data.institutionName} - Monthly summary`).style(titleStyle);
    mr += 2;
    (summary.months || []).forEach((m) => {
      ms.cell(mr, 1, mr, 10, true)
        .string(`${m.label}   |   ${m.workDays} work days   |   ${m.activeCount} of ${m.staffCounted} staff signed in   |   `
          + `${m.onTime} on time, ${m.late} late, ${m.missed} absent, ${m.leave} leave   |   Rate ${m.rate == null ? '-' : `${m.rate}%`}`)
        .style(weekStyle);
      mr += 1;
      const notes = [
        m.perfect.length && `Full attendance, never late: ${m.perfect.map((p) => p.name).join(', ')}`,
        m.mostAbsent.length && `Most absent work days: ${m.mostAbsent.map((p) => `${p.name} (${p.count})`).join(', ')}`,
        m.neverIn.length && `Did not sign in at all: ${m.neverIn.map((p) => p.name).join(', ')}`,
      ].filter(Boolean);
      notes.forEach((n) => { ms.cell(mr, 1, mr, 10, true).string(n); mr += 1; });
      ['Name', 'Staff ID', 'Department', 'Days in', 'Work days', 'Late', 'Absent', 'Leave', 'Rate %', 'Avg hours'].forEach((h, i) => ms.cell(mr, i + 1).string(h).style(headerStyle));
      mr += 1;
      m.people.forEach((p) => {
        ms.cell(mr, 1).string(p.name);
        ms.cell(mr, 2).string(p.staffId || '');
        ms.cell(mr, 3).string(p.department || '');
        ms.cell(mr, 4).number(p.daysIn);
        ms.cell(mr, 5).number(p.expected);
        ms.cell(mr, 6).number(p.late);
        ms.cell(mr, 7).number(p.missed);
        ms.cell(mr, 8).number(p.leave);
        if (p.rate != null) ms.cell(mr, 9).number(p.rate);
        if (p.avgHours != null) ms.cell(mr, 10).number(p.avgHours);
        mr += 1;
      });
      mr += 1;
    });

    // Sheet 3: every sign-in
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
    const { filters, error } = reportFilters(req.query);
    if (error) return res.status(400).json({ error });
    const data = await loadAttendanceData(req.tenantDb, req.user.institution_id, filters);
    const summary = buildWeeklyBreakdown(data, filters);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_report_${filters.startDate || 'all'}_${filters.endDate || 'all'}.pdf`);

    renderAttendancePdf(res, {
      institutionName: data.institutionName,
      institutionLogo: data.institutionLogo,
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

