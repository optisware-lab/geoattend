const pool = require('../config/database');
const excel4node = require('excel4node');
const PDFDocument = require('pdfkit');
const { formatDate } = require('../utils/dateFormat');

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

exports.exportExcel = async (req, res) => {
  try {
    const { startDate, endDate, department } = req.query;
    const institutionId = req.user.institution_id;

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
    if (department) { query += ` AND s.department = $${paramIndex}`; params.push(department); paramIndex++; }

    query += ' ORDER BY ar.date DESC, s.last_name';
    const result = await req.tenantDb.query(query, params);

    const wb = new excel4node.Workbook();
    const ws = wb.addWorksheet('Attendance Report');

    const headerStyle = wb.createStyle({
      font: { bold: true, size: 12, color: '#ffffff' },
      fill: { type: 'pattern', patternType: 'solid', fgColor: '#1a5276' },
      alignment: { horizontal: 'center' },
    });

    const headers = ['Date', 'Staff ID', 'First Name', 'Last Name', 'Department', 'Position', 'Check In', 'Check Out', 'Method', 'Late', 'Within Geofence', 'Left Premises', 'Returned'];
    headers.forEach((h, i) => ws.cell(1, i + 1).string(h).style(headerStyle));

    result.rows.forEach((row, i) => {
      const r = i + 2;
      ws.cell(r, 1).string(formatDate(row.date));
      ws.cell(r, 2).string(row.staff_id || '');
      ws.cell(r, 3).string(row.first_name || '');
      ws.cell(r, 4).string(row.last_name || '');
      ws.cell(r, 5).string(row.department || '');
      ws.cell(r, 6).string(row.position || '');
      ws.cell(r, 7).string(row.check_in_time ? new Date(row.check_in_time).toLocaleTimeString() : '');
      ws.cell(r, 8).string(row.check_out_time ? new Date(row.check_out_time).toLocaleTimeString() : 'N/A');
      ws.cell(r, 9).string(row.check_in_method || '');
      ws.cell(r, 10).string(row.is_late ? 'Yes' : 'No');
      ws.cell(r, 11).string(row.is_within_geofence ? 'Yes' : 'No');
      ws.cell(r, 12).string(row.premises_left_at ? new Date(row.premises_left_at).toLocaleTimeString() : '');
      ws.cell(r, 13).string(row.premises_returned_at ? new Date(row.premises_returned_at).toLocaleTimeString() : '');
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
    const { startDate, endDate, department } = req.query;
    const institutionId = req.user.institution_id;

    // Get institution info
    const instResult = await req.tenantDb.query('SELECT name FROM institutions WHERE id = $1', [institutionId]);
    const institutionName = instResult.rows[0]?.name || 'Institution';

    // Use LEFT JOIN so absent staff also appear in PDF
    let joinConditions = `ar.staff_uuid = s.id AND ar.institution_id = s.institution_id`;
    const params = [institutionId];
    let paramIndex = 2;

    if (startDate) { joinConditions += ` AND ar.date >= $${paramIndex}`; params.push(startDate); paramIndex++; }
    if (endDate) { joinConditions += ` AND ar.date <= $${paramIndex}`; params.push(endDate); paramIndex++; }

    let query = `
      SELECT ar.date, s.staff_id, s.first_name, s.last_name, s.department,
             ar.check_in_time, ar.check_out_time, ar.is_late, ar.check_in_method
      FROM staff s
      LEFT JOIN attendance_records ar ON ${joinConditions}
      WHERE s.institution_id = $1 AND s.member_type = 'staff' AND s.is_active = true`;

    if (department) { query += ` AND s.department = $${paramIndex}`; params.push(department); paramIndex++; }

    query += ' ORDER BY ar.date DESC NULLS LAST, s.last_name';
    const result = await req.tenantDb.query(query, params);

    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_report_${startDate || 'all'}_${endDate || 'all'}.pdf`);

    doc.pipe(res);

    // Header
    doc.fontSize(18).text(institutionName, { align: 'center' });
    doc.fontSize(14).text('Attendance Report', { align: 'center' });
    doc.fontSize(10).text(
      `Period: ${startDate || 'All'} to ${endDate || 'All'}${department ? ` | Department: ${department}` : ''}`,
      { align: 'center' }
    );
    doc.moveDown();

    // Table header
    const tableTop = doc.y;
    const colWidths = [68, 55, 78, 64, 55, 55, 45, 40];
    const colHeaders = ['Date', 'Staff ID', 'Name', 'Department', 'Check In', 'Check Out', 'Method', 'Status'];

    doc.fontSize(8).font('Helvetica-Bold');
    let x = 40;
    colHeaders.forEach((header, i) => {
      doc.text(header, x, tableTop, { width: colWidths[i], align: 'left' });
      x += colWidths[i] + 5;
    });

    doc.moveTo(40, tableTop + 15).lineTo(555, tableTop + 15).stroke();

    // Table rows
    doc.font('Helvetica').fontSize(7);
    let y = tableTop + 20;

    result.rows.forEach((row) => {
      if (y > 750) {
        doc.addPage();
        y = 40;
      }

      x = 40;
      const status = !row.check_in_time ? 'Absent' : row.is_late ? 'Late' : 'Present';
      const cells = [
        formatDate(row.date, '-'),
        row.staff_id || '',
        `${row.first_name} ${row.last_name}`,
        row.department || '-',
        row.check_in_time ? new Date(row.check_in_time).toLocaleTimeString() : '-',
        row.check_out_time ? new Date(row.check_out_time).toLocaleTimeString() : '-',
        row.check_in_method || '-',
        status,
      ];

      cells.forEach((cell, i) => {
        doc.text(cell, x, y, { width: colWidths[i], align: 'left' });
        x += colWidths[i] + 5;
      });

      y += 15;
    });

    // Footer
    doc.fontSize(8).text(`Generated on ${formatDate(new Date())} ${new Date().toLocaleTimeString()}`, 40, 780, { align: 'center' });

    doc.end();
  } catch (err) {
    console.error('Export PDF error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
