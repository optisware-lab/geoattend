/**
 * Hourly-rate payroll.
 *
 * Institutions set payment_mode = 'hourly' (Settings page) and a per-staff
 * hourly_rate. The system then derives pay from attendance:
 *
 *   earnings = rate × hours_worked + rate × (overtime_multiplier − 1) × overtime
 *
 * Overtime minutes come from overtime_records (auto checkout / manual checkout
 * past work_end_time). Away time (premises_left_at / premises_returned_at) is
 * reported per staff so the admin can review "checked in at the gate but never
 * actually worked" cases before paying.
 *
 * Institutions paying monthly see the same hours/away stats without earnings.
 */

const isDateParam = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

function resolveRange(period, anchorDate) {
  const anchor = isDateParam(anchorDate) ? anchorDate : new Date().toISOString().split('T')[0];
  let startSql;
  if (period === 'day') {
    startSql = `$2::date`;
  } else if (period === 'week') {
    startSql = `date_trunc('week', $2::date)::date`;
  } else {
    // month
    startSql = `date_trunc('month', $2::date)::date`;
  }
  // end of range: day → same day; week → +6 days; month → last day of month
  let endSql;
  if (period === 'day') {
    endSql = `$2::date`;
  } else if (period === 'week') {
    endSql = `date_trunc('week', $2::date)::date + INTERVAL '6 days'`;
  } else {
    endSql = `(date_trunc('month', $2::date) + INTERVAL '1 month - 1 day')::date`;
  }
  return { anchor, startSql, endSql };
}

function money(value) {
  return value === null || value === undefined ? null : Math.round(value * 100) / 100;
}

async function loadPaySettings(db, institutionId) {
  const result = await db.query(
    'SELECT name, payment_mode, currency FROM institutions WHERE id = $1',
    [institutionId]
  );
  const inst = result.rows[0] || {};
  const rules = await db.query(
    "SELECT overtime_multiplier FROM attendance_rules WHERE institution_id = $1 AND member_type = 'staff'",
    [institutionId]
  );
  return {
    institutionName: inst.name || null,
    paymentMode: inst.payment_mode || 'monthly',
    currency: inst.currency || 'GHS',
    overtimeMultiplier: rules.rows[0]?.overtime_multiplier ? parseFloat(rules.rows[0].overtime_multiplier) : 1.5,
  };
}

function decorate(rows, pay, period, anchor) {
  return rows.map((row) => {
    const hours = parseFloat(row.hours_worked || 0);
    const overtimeHours = (parseInt(row.overtime_minutes || 0, 10)) / 60;
    const rate = row.hourly_rate ? parseFloat(row.hourly_rate) : null;
    const overtimeMultiplier = pay.overtimeMultiplier;
    const earnings = (pay.paymentMode === 'hourly' && rate !== null)
      ? rate * Math.max(0, hours) + rate * (overtimeMultiplier - 1) * Math.max(0, overtimeHours)
      : null;
    delete row.hours_worked;
    return {
      ...row,
      hoursWorked: money(hours),
      overtimeHours: money(overtimeHours),
      hourlyRate: rate,
      earnings: money(earnings),
      notReturned: parseInt(row.not_returned || 0, 10),
    };
  });
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// Admin: per-staff hours/overtime/away/earnings for a day, week or month
exports.summary = async (req, res) => {
  const db = req.tenantDb;
  try {
    const period = ['day', 'week', 'month'].includes(req.query.period) ? req.query.period : 'week';
    const department = req.query.department || null;
    const pay = await loadPaySettings(db, req.user.institution_id);
    const { anchor, startSql, endSql } = resolveRange(period, req.query.date);

    const result = await db.query(
      `WITH hours AS (
         SELECT ar.staff_uuid,
                COUNT(ar.id) AS days_worked,
                SUM(EXTRACT(EPOCH FROM (
                  COALESCE(ar.check_out_time,
                    CASE WHEN ar.date = CURRENT_DATE THEN NOW() ELSE ar.check_in_time END
                 ) - ar.check_in_time)) / 3600.0) AS hours_worked
         FROM attendance_records ar
         WHERE ar.institution_id = $1 AND ar.date >= ${startSql} AND ar.date <= ${endSql}
         GROUP BY ar.staff_uuid
       ), overtime AS (
         SELECT o.staff_uuid, SUM(o.overtime_minutes) AS overtime_minutes
         FROM overtime_records o
         WHERE o.institution_id = $1 AND o.date >= ${startSql} AND o.date <= ${endSql}
         GROUP BY o.staff_uuid
       ), away AS (
         SELECT ar.staff_uuid,
                SUM(EXTRACT(EPOCH FROM (ar.premises_returned_at - ar.premises_left_at)) / 60.0) AS away_minutes,
                COUNT(*) FILTER (WHERE ar.premises_left_at IS NOT NULL AND ar.premises_returned_at IS NULL) AS not_returned
         FROM attendance_records ar
         WHERE ar.institution_id = $1 AND ar.date >= ${startSql} AND ar.date <= ${endSql}
           AND ar.premises_left_at IS NOT NULL
         GROUP BY ar.staff_uuid
       )
       SELECT s.id, s.staff_id, s.first_name, s.last_name, s.department, s.position, s.hourly_rate,
              h.days_worked, h.hours_worked, o.overtime_minutes, a.away_minutes, a.not_returned
       FROM staff s
       LEFT JOIN hours h ON h.staff_uuid = s.id
       LEFT JOIN overtime o ON o.staff_uuid = s.id
       LEFT JOIN away a ON a.staff_uuid = s.id
       WHERE s.institution_id = $1 AND s.member_type = 'staff' AND s.is_active = true
         AND ($4::text IS NULL OR s.department = $4)
       ORDER BY s.last_name, s.first_name`,
      [req.user.institution_id, anchor, department]
    );

    const staffRows = decorate(result.rows, pay, period, anchor);

    const totals = staffRows.reduce(
      (acc, r) => {
        acc.hours += r.hoursWorked || 0;
        acc.overtime += r.overtimeHours || 0;
        acc.away += parseFloat(r.away_minutes || 0);
        acc.earnings += r.earnings || 0;
        acc.flagged += r.notReturned || 0;
        return acc;
      },
      { hours: 0, overtime: 0, away: 0, earnings: 0, flagged: 0 }
    );

    const params = { period, anchor: anchor, department, paymentMode: pay.paymentMode, currency: pay.currency, overtimeMultiplier: pay.overtimeMultiplier, institutionName: pay.institutionName };
    res.json({
      params,
      totals: {
        hours: money(totals.hours),
        overtimeHours: money(totals.overtime),
        awayMinutes: money(totals.away),
        earnings: money(totals.earnings),
        flaggedCount: totals.flagged,
      },
      staff: staffRows,
    });
  } catch (err) {
    console.error('Payroll summary error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Admin: CSV export of the same summary (audit-friendly for payroll review)
exports.summaryCsv = async (req, res) => {
  const db = req.tenantDb;
  try {
    const period = ['day', 'week', 'month'].includes(req.query.period) ? req.query.period : 'week';
    const department = req.query.department || null;
    const pay = await loadPaySettings(db, req.user.institution_id);
    const { anchor, startSql, endSql } = resolveRange(period, req.query.date);

    const result = await db.query(
      `WITH hours AS (
         SELECT ar.staff_uuid, COUNT(ar.id) AS days_worked,
                SUM(EXTRACT(EPOCH FROM (
                  COALESCE(ar.check_out_time,
                    CASE WHEN ar.date = CURRENT_DATE THEN NOW() ELSE ar.check_in_time END
                 ) - ar.check_in_time)) / 3600.0) AS hours_worked
         FROM attendance_records ar
         WHERE ar.institution_id = $1 AND ar.date >= ${startSql} AND ar.date <= ${endSql}
         GROUP BY ar.staff_uuid
       ), overtime AS (
         SELECT o.staff_uuid, SUM(o.overtime_minutes) AS overtime_minutes
         FROM overtime_records o
         WHERE o.institution_id = $1 AND o.date >= ${startSql} AND o.date <= ${endSql}
         GROUP BY o.staff_uuid
       ), away AS (
         SELECT ar.staff_uuid,
                SUM(EXTRACT(EPOCH FROM (ar.premises_returned_at - ar.premises_left_at)) / 60.0) AS away_minutes,
                COUNT(*) FILTER (WHERE ar.premises_left_at IS NOT NULL AND ar.premises_returned_at IS NULL) AS not_returned
         FROM attendance_records ar
         WHERE ar.institution_id = $1 AND ar.date >= ${startSql} AND ar.date <= ${endSql}
           AND ar.premises_left_at IS NOT NULL
         GROUP BY ar.staff_uuid
       )
       SELECT s.staff_id, s.first_name, s.last_name, s.department, s.position, s.hourly_rate,
              h.days_worked, h.hours_worked, o.overtime_minutes, a.away_minutes, a.not_returned
       FROM staff s
       LEFT JOIN hours h ON h.staff_uuid = s.id
       LEFT JOIN overtime o ON o.staff_uuid = s.id
       LEFT JOIN away a ON a.staff_uuid = s.id
       WHERE s.institution_id = $1 AND s.member_type = 'staff' AND s.is_active = true
         AND ($4::text IS NULL OR s.department = $4)
       ORDER BY s.last_name, s.first_name`,
      [req.user.institution_id, anchor, department]
    );

    const rows = decorate(result.rows, pay, period, anchor);
    const lines = [];
    lines.push(`${pay.institutionName || 'Institution'} — Payroll Summary (${period} of ${anchor})`);
    lines.push(`Payment mode: ${pay.paymentMode} | Currency: ${pay.currency} | Overtime multiplier: ${pay.overtimeMultiplier}`);
    lines.push('');
    lines.push(['Staff ID', 'First Name', 'Last Name', 'Department', 'Position', 'Days Worked', 'Hours', 'Overtime Hours', 'Rate', 'Away Minutes', 'Never Returned', pay.paymentMode === 'hourly' ? `Earnings (${pay.currency})` : 'Earnings'].join(','));
    rows.forEach((r) => {
      lines.push([r.staff_id, r.first_name, r.last_name, r.department, r.position, r.days_worked, r.hoursWorked ?? 0, r.overtimeHours ?? 0, r.hourlyRate ?? '', r.away_minutes ?? 0, r.notReturned, r.earnings ?? (pay.paymentMode === 'hourly' ? 'N/A' : '')].map(csvEscape).join(','));
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=payroll_${period}_${anchor}.csv`);
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('Payroll CSV error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Staff: my own hours + earnings for a period (mobile / dashboard)
exports.myEarnings = async (req, res) => {
  const db = req.tenantDb;
  try {
    const period = ['day', 'week', 'month'].includes(req.query.period) ? req.query.period : 'month';
    const pay = await loadPaySettings(db, req.user.institution_id);
    const { anchor, startSql, endSql } = resolveRange(period, req.query.date);

    const result = await db.query(
      `SELECT ar.date,
              ar.check_in_time, ar.check_out_time,
              EXTRACT(EPOCH FROM (
                COALESCE(ar.check_out_time,
                  CASE WHEN ar.date = CURRENT_DATE THEN NOW() ELSE ar.check_in_time END
               ) - ar.check_in_time)) / 3600.0 AS hours_worked,
              ar.is_late,
              ar.premises_left_at, ar.premises_returned_at,
              EXTRACT(EPOCH FROM (ar.premises_returned_at - ar.premises_left_at)) / 60.0 AS away_minutes
       FROM attendance_records ar
       WHERE ar.staff_uuid = $1 AND ar.institution_id = $2 AND ar.date >= ${startSql} AND ar.date <= ${endSql}
       ORDER BY ar.date`,
      [req.user.id, req.user.institution_id, anchor]
    );

    const rateResult = await db.query('SELECT hourly_rate FROM staff WHERE id = $1', [req.user.id]);
    const rate = rateResult.rows[0]?.hourly_rate ? parseFloat(rateResult.rows[0].hourly_rate) : null;

    const daily = result.rows.map((row) => {
      const hours = parseFloat(row.hours_worked || 0);
      const awayMinutes = row.away_minutes ? money(parseFloat(row.away_minutes)) : null;
      return {
        date: row.date,
        hours: money(hours),
        late: row.is_late,
        awayMinutes,
        leftPremises: row.premises_left_at || null,
        returned: row.premises_returned_at || null,
        earnings: (pay.paymentMode === 'hourly' && rate !== null) ? money(rate * hours) : null,
      };
    });

    const totalHours = daily.reduce((sum, d) => sum + (d.hours || 0), 0);
    const otResult = await db.query(
      `SELECT SUM(overtime_minutes) AS ot FROM overtime_records WHERE staff_uuid = $1 AND date >= ${startSql} AND date <= ${endSql}`,
      [req.user.id, anchor]
    );
    const overtimeHours = (parseInt(otResult.rows[0]?.ot || 0, 10)) / 60;

    const earnings = (pay.paymentMode === 'hourly' && rate !== null)
      ? rate * totalHours + rate * (pay.overtimeMultiplier - 1) * overtimeHours
      : null;

    res.json({
      period,
      anchor,
      paymentMode: pay.paymentMode,
      currency: pay.currency,
      overtimeMultiplier: pay.overtimeMultiplier,
      hourlyRate: rate,
      totalHours: money(totalHours),
      overtimeHours: money(overtimeHours),
      earnings: money(earnings),
      daily,
    });
  } catch (err) {
    console.error('My earnings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Admin: daily totals across the chosen period (for charts)
exports.daily = async (req, res) => {
  const db = req.tenantDb;
  try {
    const period = ['week', 'month'].includes(req.query.period) ? req.query.period : 'month';
    const pay = await loadPaySettings(db, req.user.institution_id);
    const { anchor, startSql, endSql } = resolveRange(period, req.query.date);

    const result = await db.query(
      `SELECT ar.date,
              COUNT(DISTINCT ar.staff_uuid) AS present,
              SUM(EXTRACT(EPOCH FROM (
                COALESCE(ar.check_out_time,
                  CASE WHEN ar.date = CURRENT_DATE THEN NOW() ELSE ar.check_in_time END
               ) - ar.check_in_time)) / 3600.0) AS total_hours,
              COUNT(*) FILTER (WHERE ar.premises_left_at IS NOT NULL AND ar.premises_returned_at IS NULL) AS not_returned
       FROM attendance_records ar
       WHERE ar.institution_id = $1 AND ar.date >= ${startSql} AND ar.date <= ${endSql}
       GROUP BY ar.date
       ORDER BY ar.date`,
      [req.user.institution_id, anchor]
    );

    res.json({
      period,
      anchor,
      currency: pay.currency,
      daily: result.rows.map((r) => ({
        date: r.date,
        present: parseInt(r.present, 10),
        totalHours: money(parseFloat(r.total_hours || 0)),
        notReturned: parseInt(r.not_returned || 0, 10),
      })),
    });
  } catch (err) {
    console.error('Payroll daily error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
