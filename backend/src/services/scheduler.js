const cron = require('node-cron');
const pool = require('../config/database');
const { sendAbsenceAlert, sendDailySummary, sendWeeklySummary, sendAutoSuspendNotice } = require('./emailService');
const { sendAbsentAlert } = require('./smsService');
const { formatDate } = require('../utils/dateFormat');

// ─── AUTO CHECK-OUT ─────────────────────────────────────────────────────────
// Runs every day at the institution's work_end_time (default: 5:30 PM)
async function autoCheckOut() {
  console.log('[Scheduler] Running auto check-out...');
  try {
    const rules = await pool.query(
      "SELECT institution_id, work_end_time FROM attendance_rules WHERE member_type = 'staff'"
    );
    const today = new Date().toISOString().split('T')[0];

    for (const rule of rules.rows) {
      const result = await pool.query(
        `UPDATE attendance_records
         SET check_out_time = NOW(), check_out_method = 'manual', notes = COALESCE(notes, '') || ' [Auto check-out]'
         WHERE institution_id = $1 AND date = $2 AND check_out_time IS NULL
         RETURNING staff_uuid`,
        [rule.institution_id, today]
      );

      if (result.rowCount > 0) {
        console.log(`[Scheduler] Auto-checked out ${result.rowCount} member(s) for institution ${rule.institution_id}`);

        // Log overtime for those who were auto-checked out past work end time
        for (const row of result.rows) {
          await pool.query(
            `INSERT INTO overtime_records (staff_uuid, institution_id, date, overtime_minutes, reason)
             SELECT $1, $2, $3,
               EXTRACT(EPOCH FROM (NOW() - (CURRENT_DATE + $4::TIME))) / 60,
               'auto_checkout'
             WHERE NOW() > (CURRENT_DATE + $4::TIME)`,
            [row.staff_uuid, rule.institution_id, today, rule.work_end_time]
          ).catch(() => {}); // ignore if no overtime
        }
      }
    }
  } catch (err) {
    console.error('[Scheduler] Auto check-out error:', err.message);
  }
}

// ─── ABSENCE DETECTION & NOTIFICATIONS ──────────────────────────────────────
// Runs daily after late threshold to detect who didn't check in
async function detectAbsences() {
  console.log('[Scheduler] Running absence detection...');
  try {
    const institutions = await pool.query(`
      SELECT i.id, i.name, ar.working_days
      FROM institutions i
      JOIN attendance_rules ar ON ar.institution_id = i.id AND ar.member_type = 'staff'
    `);

    const today = new Date();
    const todayDate = today.toISOString().split('T')[0];
    const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon...

    for (const inst of institutions.rows) {
      const workingDays = inst.working_days || [1, 2, 3, 4, 5];
      if (!workingDays.includes(dayOfWeek)) continue;

      // Find active staff who haven't checked in today and don't have approved leave
      const absent = await pool.query(`
        SELECT s.id, s.staff_id, s.first_name, s.last_name, s.department, s.email, s.phone
        FROM staff s
        WHERE s.institution_id = $1 AND s.member_type = 'staff' AND s.is_active = true
          AND s.id NOT IN (SELECT staff_uuid FROM attendance_records WHERE institution_id = $1 AND date = $2)
          AND s.id NOT IN (
            SELECT staff_uuid FROM leave_requests
            WHERE institution_id = $1 AND status = 'approved'
              AND start_date <= $2 AND end_date >= $2
          )
      `, [inst.id, todayDate]);

      if (absent.rows.length === 0) continue;

      // Get admin emails for notifications
      const admins = await pool.query(
        `SELECT email FROM staff WHERE institution_id = $1 AND role IN ('admin', 'super_admin') AND email IS NOT NULL AND is_active = true`,
        [inst.id]
      );
      const adminEmails = admins.rows.map(a => a.email).filter(Boolean);

      // Send email alert to admins
      if (adminEmails.length > 0) {
        await sendAbsenceAlert({
          adminEmails,
          absentMembers: absent.rows,
          date: todayDate,
          institutionName: inst.name,
        });
      }

      // Send SMS to absent members
      for (const member of absent.rows) {
        if (member.phone) {
          await sendAbsentAlert(member.phone, `${member.first_name} ${member.last_name}`, todayDate);
        }
      }

      console.log(`[Scheduler] ${absent.rows.length} staff absence(s) for ${inst.name}`);
    }
  } catch (err) {
    console.error('[Scheduler] Absence detection error:', err.message);
  }
}

// ─── DAILY SUMMARY REPORT ───────────────────────────────────────────────────
async function sendDailyReport() {
  console.log('[Scheduler] Sending daily summary reports...');
  try {
    const institutions = await pool.query('SELECT id, name FROM institutions');
    const today = new Date().toISOString().split('T')[0];

    for (const inst of institutions.rows) {
      const [totalResult, presentResult, lateResult, autoCheckoutResult, overtimeResult] = await Promise.all([
        pool.query("SELECT COUNT(*) FROM staff WHERE institution_id = $1 AND member_type = 'staff' AND is_active = true", [inst.id]),
        pool.query("SELECT COUNT(DISTINCT ar.staff_uuid) FROM attendance_records ar JOIN staff s ON s.id = ar.staff_uuid AND s.member_type = 'staff' WHERE ar.institution_id = $1 AND ar.date = $2", [inst.id, today]),
        pool.query("SELECT COUNT(DISTINCT ar.staff_uuid) FROM attendance_records ar JOIN staff s ON s.id = ar.staff_uuid AND s.member_type = 'staff' WHERE ar.institution_id = $1 AND ar.date = $2 AND ar.is_late = true", [inst.id, today]),
        pool.query("SELECT COUNT(*) FROM attendance_records WHERE institution_id = $1 AND date = $2 AND notes LIKE '%Auto check-out%'", [inst.id, today]),
        pool.query('SELECT COUNT(*) FROM overtime_records WHERE institution_id = $1 AND date = $2', [inst.id, today]).catch(() => ({ rows: [{ count: 0 }] })),
      ]);

      const total = parseInt(totalResult.rows[0].count);
      const present = parseInt(presentResult.rows[0].count);
      const stats = {
        total,
        present,
        late: parseInt(lateResult.rows[0].count),
        absent: total - present,
        autoCheckedOut: parseInt(autoCheckoutResult.rows[0].count),
        overtime: parseInt(overtimeResult.rows[0].count),
      };

      const admins = await pool.query(
        `SELECT email FROM staff WHERE institution_id = $1 AND role IN ('admin', 'super_admin') AND email IS NOT NULL AND is_active = true`,
        [inst.id]
      );
      const adminEmails = admins.rows.map(a => a.email).filter(Boolean);

      if (adminEmails.length > 0) {
        await sendDailySummary({ adminEmails, stats, date: today, institutionName: inst.name });
      }
    }
  } catch (err) {
    console.error('[Scheduler] Daily report error:', err.message);
  }
}

// ─── WEEKLY SUMMARY REPORT ──────────────────────────────────────────────────
async function sendWeeklyReport() {
  console.log('[Scheduler] Sending weekly summary reports...');
  try {
    const institutions = await pool.query('SELECT id, name FROM institutions');

    for (const inst of institutions.rows) {
      const totalStaff = await pool.query("SELECT COUNT(*) FROM staff WHERE institution_id = $1 AND member_type = 'staff' AND is_active = true", [inst.id]);
      const total = parseInt(totalStaff.rows[0].count);

      const weekData = await pool.query(`
        SELECT ar.date,
          COUNT(DISTINCT ar.staff_uuid) as present,
          COUNT(DISTINCT CASE WHEN ar.is_late THEN ar.staff_uuid END) as late
        FROM attendance_records ar
        JOIN staff s ON s.id = ar.staff_uuid AND s.member_type = 'staff'
        WHERE ar.institution_id = $1 AND ar.date >= CURRENT_DATE - INTERVAL '7 days' AND ar.date <= CURRENT_DATE
        GROUP BY ar.date ORDER BY ar.date
      `, [inst.id]);

      const data = weekData.rows.map(d => ({
        date: formatDate(d.date),
        present: parseInt(d.present),
        late: parseInt(d.late),
        absent: total - parseInt(d.present),
        rate: total > 0 ? Math.round((parseInt(d.present) / total) * 100) : 0,
      }));

      const admins = await pool.query(
        `SELECT email FROM staff WHERE institution_id = $1 AND role IN ('admin', 'super_admin') AND email IS NOT NULL AND is_active = true`,
        [inst.id]
      );
      const adminEmails = admins.rows.map(a => a.email).filter(Boolean);

      if (adminEmails.length > 0 && data.length > 0) {
        const weekRange = `${data[0].date} - ${data[data.length - 1].date}`;
        await sendWeeklySummary({ adminEmails, weekData: data, institutionName: inst.name, weekRange });
      }
    }
  } catch (err) {
    console.error('[Scheduler] Weekly report error:', err.message);
  }
}

// ─── AUTO-SUSPEND INACTIVE ACCOUNTS ─────────────────────────────────────────
async function autoSuspendInactive() {
  console.log('[Scheduler] Checking for inactive accounts...');
  try {
    const inactiveDays = parseInt(process.env.AUTO_SUSPEND_DAYS, 10) || 30;

    // Find active non-admin accounts with no attendance in X days and no approved leave
    const inactive = await pool.query(`
      SELECT s.id, s.staff_id, s.first_name, s.last_name, s.email, s.institution_id
      FROM staff s
      WHERE s.is_active = true
        AND s.role = 'staff'
        AND s.member_type = 'staff'
        AND s.id NOT IN (
          SELECT DISTINCT staff_uuid FROM attendance_records
          WHERE date >= CURRENT_DATE - $1::INTEGER
        )
        AND s.id NOT IN (
          SELECT staff_uuid FROM leave_requests
          WHERE status = 'approved' AND end_date >= CURRENT_DATE - $1::INTEGER
        )
        AND s.created_at < CURRENT_DATE - $1::INTEGER
    `, [inactiveDays]);

    for (const member of inactive.rows) {
      await pool.query('UPDATE staff SET is_active = false, updated_at = NOW() WHERE id = $1', [member.id]);

      // Log the action
      await pool.query(
        `INSERT INTO audit_logs (institution_id, action, entity_type, entity_id, details, performed_by)
         VALUES ($1, 'auto_suspend', 'staff', $2, $3, 'system')`,
        [member.institution_id, member.id, JSON.stringify({ reason: `No attendance for ${inactiveDays} days`, staffId: member.staff_id })]
      );

      if (member.email) {
        await sendAutoSuspendNotice({
          email: member.email,
          name: `${member.first_name} ${member.last_name}`,
          staffId: member.staff_id,
          reason: `No attendance recorded for ${inactiveDays} days`,
        });
      }

      console.log(`[Scheduler] Auto-suspended ${member.staff_id} (${member.first_name} ${member.last_name})`);
    }

    if (inactive.rows.length > 0) {
      console.log(`[Scheduler] Auto-suspended ${inactive.rows.length} inactive account(s)`);
    }
  } catch (err) {
    console.error('[Scheduler] Auto-suspend error:', err.message);
  }
}

// ─── QR CODE ROTATION ───────────────────────────────────────────────────────
async function rotateQRCodes() {
  console.log('[Scheduler] Rotating QR codes...');
  try {
    const { v4: uuidv4 } = require('uuid');

    // Rotate institution QR codes (change the code component)
    const institutions = await pool.query('SELECT id FROM institutions');
    for (const inst of institutions.rows) {
      await pool.query(
        `UPDATE institutions SET qr_rotation_token = $1, qr_rotated_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [uuidv4(), inst.id]
      );
    }

    // Rotate individual staff QR codes
    const staff = await pool.query('SELECT id, institution_id, staff_id FROM staff WHERE is_active = true');
    for (const s of staff.rows) {
      const newQrData = `STAFF-${s.institution_id}-${s.staff_id}-${uuidv4().slice(0, 8)}`;
      await pool.query('UPDATE staff SET qr_code_data = $1, updated_at = NOW() WHERE id = $2', [newQrData, s.id]);
    }

    console.log(`[Scheduler] Rotated QR codes for ${institutions.rows.length} institution(s) and ${staff.rows.length} member(s)`);
  } catch (err) {
    console.error('[Scheduler] QR rotation error:', err.message);
  }
}

// ─── START ALL SCHEDULED JOBS ───────────────────────────────────────────────
// Cron jobs run without a user, so each one executes on a connection with the
// RLS system bypass. The wrapper also keeps the console-error contract.
function guarded(name, fn) {
  return async () => {
    try {
      await pool.withSystemContext(() => fn());
    } catch (err) {
      console.error(`[Scheduler] ${name} error:`, err.message);
    }
  };
}

function startScheduler() {
  console.log('[Scheduler] Starting scheduled jobs...');

  // Auto check-out: every day at 5:30 PM (17:30)
  cron.schedule('30 17 * * 1-5', guarded('Auto check-out', autoCheckOut), { timezone: 'Africa/Accra' });

  // Absence detection: every working day at 10:00 AM (after late threshold)
  cron.schedule('0 10 * * 1-5', guarded('Absence detection', detectAbsences), { timezone: 'Africa/Accra' });

  // Daily summary: every working day at 6:00 PM
  cron.schedule('0 18 * * 1-5', guarded('Daily report', sendDailyReport), { timezone: 'Africa/Accra' });

  // Weekly summary: every Friday at 6:30 PM
  cron.schedule('30 18 * * 5', guarded('Weekly report', sendWeeklyReport), { timezone: 'Africa/Accra' });

  // Auto-suspend inactive accounts: every Sunday at midnight
  cron.schedule('0 0 * * 0', guarded('Auto-suspend', autoSuspendInactive), { timezone: 'Africa/Accra' });

  // QR code rotation: first day of every month at 2:00 AM
  cron.schedule('0 2 1 * *', guarded('QR rotation', rotateQRCodes), { timezone: 'Africa/Accra' });

  console.log('[Scheduler] Scheduled jobs:');
  console.log('  - Auto check-out: Mon-Fri 5:30 PM');
  console.log('  - Absence detection: Mon-Fri 10:00 AM');
  console.log('  - Daily summary: Mon-Fri 6:00 PM');
  console.log('  - Weekly summary: Friday 6:30 PM');
  console.log('  - Auto-suspend inactive: Sunday midnight');
  console.log('  - QR code rotation: 1st of month 2:00 AM');
}

module.exports = {
  startScheduler,
  autoCheckOut,
  detectAbsences,
  sendDailyReport,
  sendWeeklyReport,
  autoSuspendInactive,
  rotateQRCodes,
};
