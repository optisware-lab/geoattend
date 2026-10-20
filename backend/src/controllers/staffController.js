const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { generateQRCode } = require('../utils/qrcode');

exports.getAllStaff = async (req, res) => {
  try {
    const { page = 1, limit = 50, search, department, status } = req.query;
    const offset = (page - 1) * limit;
    const institutionId = req.user.institution_id;

    let query = `
      SELECT s.id, s.staff_id, s.first_name, s.last_name, s.email, s.phone,
             s.department, s.position, s.role, s.is_active, s.profile_photo_url, s.created_at,
             s.hourly_rate,
             (s.google_id IS NOT NULL) AS google_linked
      FROM staff s WHERE s.institution_id = $1 AND s.member_type = 'staff'`;
    const params = [institutionId];
    let paramIndex = 2;

    if (search) {
      query += ` AND (s.first_name ILIKE $${paramIndex} OR s.last_name ILIKE $${paramIndex} OR s.staff_id ILIKE $${paramIndex} OR s.email ILIKE $${paramIndex} OR s.phone ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (department) {
      query += ` AND s.department = $${paramIndex}`;
      params.push(department);
      paramIndex++;
    }
    if (status === 'active') {
      query += ' AND s.is_active = true';
    } else if (status === 'inactive') {
      query += ' AND s.is_active = false';
    }

    const countQuery = query.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) FROM');
    const countResult = await req.tenantDb.query(countQuery, params);

    query += ` ORDER BY s.last_name, s.first_name LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await req.tenantDb.query(query, params);

    res.json({
      staff: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  } catch (err) {
    console.error('Get staff error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getStaffById = async (req, res) => {
  try {
    const result = await req.tenantDb.query(
      `SELECT s.id, s.staff_id, s.first_name, s.last_name, s.email, s.phone,
              s.department, s.position, s.role, s.is_active, s.profile_photo_url,
              s.qr_code_data, s.hourly_rate, s.created_at, s.updated_at, (s.google_id IS NOT NULL) AS google_linked
       FROM staff s WHERE s.id = $1 AND s.institution_id = $2`,
      [req.params.id, req.user.institution_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get staff by ID error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.createStaff = async (req, res) => {
  try {
    const { staffId, firstName, lastName, email, phone, department, position, role, password, hourlyRate } = req.body;
    const institutionId = req.user.institution_id;

    if (!staffId || !firstName || !lastName || !password) {
      return res.status(400).json({ error: 'ID, first name, last name, and password are required' });
    }

    // Check if staff ID already exists
    const existing = await req.tenantDb.query(
      'SELECT id FROM staff WHERE staff_id = $1 AND institution_id = $2',
      [staffId.toUpperCase(), institutionId]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Staff ID already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const id = uuidv4();
    const qrCodeData = `STAFF-${institutionId}-${staffId.toUpperCase()}`;

    const result = await req.tenantDb.query(
      `INSERT INTO staff (id, institution_id, staff_id, first_name, last_name, email, phone, department, position, role, password_hash, qr_code_data, member_type, hourly_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'staff', $13)
       RETURNING id, staff_id, first_name, last_name, email, phone, department, position, role, qr_code_data, hourly_rate, created_at`,
      [id, institutionId, staffId.toUpperCase(), firstName, lastName, email || null, phone || null,
       department || null, position || null, role || 'staff', passwordHash, qrCodeData, hourlyRate || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create staff error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateStaff = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, department, position, role, isActive, hourlyRate } = req.body;
    const { id } = req.params;
    const institutionId = req.user.institution_id;

    const existing = await req.tenantDb.query(
      'SELECT id FROM staff WHERE id = $1 AND institution_id = $2',
      [id, institutionId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    const hourlyRateValue = hourlyRate === '' || hourlyRate === null ? null : (hourlyRate !== undefined ? hourlyRate : undefined);

    const result = await req.tenantDb.query(
      `UPDATE staff SET
        first_name = COALESCE($1, first_name),
        last_name = COALESCE($2, last_name),
        email = COALESCE($3, email),
        phone = COALESCE($4, phone),
        department = COALESCE($5, department),
        position = COALESCE($6, position),
        role = COALESCE($7, role),
        is_active = COALESCE($8, is_active),
        hourly_rate = CASE WHEN $10 THEN $9::numeric ELSE hourly_rate END,
        updated_at = NOW()
       WHERE id = $11
       RETURNING id, staff_id, first_name, last_name, email, phone, department, position, role, is_active, hourly_rate, updated_at`,
      [firstName, lastName, email, phone, department, position, role, isActive, hourlyRateValue ?? null, hourlyRateValue !== undefined, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update staff error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    const institutionId = req.user.institution_id;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await req.tenantDb.query(
      'SELECT id FROM staff WHERE id = $1 AND institution_id = $2',
      [id, institutionId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await req.tenantDb.query('UPDATE staff SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, id]);

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getStaffQRCode = async (req, res) => {
  try {
    const result = await req.tenantDb.query(
      'SELECT id, staff_id, institution_id, qr_code_data FROM staff WHERE id = $1 AND institution_id = $2',
      [req.params.id, req.user.institution_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    const qrCode = await generateQRCode(result.rows[0]);
    res.json({ qrCode, staffId: result.rows[0].staff_id });
  } catch (err) {
    console.error('Get QR code error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getDepartments = async (req, res) => {
  try {
    const result = await req.tenantDb.query(
      "SELECT DISTINCT department FROM staff WHERE institution_id = $1 AND member_type = 'staff' AND department IS NOT NULL ORDER BY department",
      [req.user.institution_id]
    );
    res.json(result.rows.map(r => r.department));
  } catch (err) {
    console.error('Get departments error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.bulkImport = async (req, res) => {
  try {
    const { staff } = req.body;
    const institutionId = req.user.institution_id;

    if (!staff || !Array.isArray(staff) || staff.length === 0) {
      return res.status(400).json({ error: 'Please provide an array of staff members' });
    }

    if (staff.length > 500) {
      return res.status(400).json({ error: 'Maximum 500 staff per import' });
    }

    const results = { success: 0, failed: 0, errors: [] };

    for (const s of staff) {
      try {
        if (!s.staffId || !s.firstName || !s.lastName) {
          results.errors.push({ staffId: s.staffId, error: 'Missing required fields' });
          results.failed++;
          continue;
        }

        const passwordHash = await require('bcryptjs').hash(s.password || 'Pass@123', 12);
        const qrData = require('uuid').v4();

        await req.tenantDb.query(
          `INSERT INTO staff (institution_id, staff_id, first_name, last_name, email, phone, department, position, password_hash, qr_code_data, member_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'staff')
           ON CONFLICT (institution_id, staff_id) DO NOTHING`,
          [institutionId, s.staffId.toUpperCase(), s.firstName, s.lastName, s.email || null, s.phone || null, s.department || null, s.position || null, passwordHash, qrData]
        );
        results.success++;
      } catch (err) {
        results.errors.push({ staffId: s.staffId, error: err.message });
        results.failed++;
      }
    }

    res.json({ message: `Imported ${results.success} staff, ${results.failed} failed`, ...results });
  } catch (err) {
    console.error('Bulk import error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const institutionId = req.user.institution_id;

    // Verify staff belongs to the same institution
    const staff = await req.tenantDb.query(
      'SELECT id, staff_id, first_name, last_name FROM staff WHERE id = $1 AND institution_id = $2',
      [id, institutionId]
    );

    if (staff.rows.length === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    // Prevent admins from deleting themselves
    if (id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    // Delete staff (attendance_records and device_logs cascade automatically)
    await req.tenantDb.query('DELETE FROM staff WHERE id = $1', [id]);

    res.json({ message: `Staff member ${staff.rows[0].first_name} ${staff.rows[0].last_name} deleted successfully` });
  } catch (err) {
    console.error('Delete staff error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
