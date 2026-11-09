// Week-by-week attendance for a date range, shared by the PDF, the Excel
// export and the dashboard's "Week by week" panel.
//
// Weeks run Monday to Sunday and are numbered from the start of the range.
// A work day with no sign-in counts as missed, unless the person was on
// approved leave or had not joined yet.

const { toDate, dayKey } = require('../utils/dateFormat');

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function mondayOf(d) {
  return addDays(d, -((d.getDay() + 6) % 7));
}

function displayName(s) {
  return `${s.first_name || ''} ${s.last_name || ''}`.trim();
}

/** Staff, sign-ins, approved leave and work days for one institution. */
async function loadAttendanceData(db, institutionId, { startDate, endDate, department, staffId } = {}) {
  const staffParams = [institutionId];
  let staffWhere = "s.institution_id = $1 AND s.member_type = 'staff' AND s.is_active = true";
  if (department) { staffParams.push(department); staffWhere += ` AND s.department = $${staffParams.length}`; }
  if (staffId) { staffParams.push(`%${staffId}%`); staffWhere += ` AND s.staff_id ILIKE $${staffParams.length}`; }

  const recParams = [...staffParams];
  let recWhere = `ar.institution_id = $1 AND ${staffWhere}`;
  if (startDate) { recParams.push(startDate); recWhere += ` AND ar.date >= $${recParams.length}`; }
  if (endDate) { recParams.push(endDate); recWhere += ` AND ar.date <= $${recParams.length}`; }

  const leaveParams = [...staffParams];
  let leaveWhere = `lr.institution_id = $1 AND lr.status = 'approved' AND ${staffWhere}`;
  if (startDate) { leaveParams.push(startDate); leaveWhere += ` AND lr.end_date >= $${leaveParams.length}`; }
  if (endDate) { leaveParams.push(endDate); leaveWhere += ` AND lr.start_date <= $${leaveParams.length}`; }

  const [inst, rules, staff, records, leaves] = await Promise.all([
    db.query('SELECT name FROM institutions WHERE id = $1', [institutionId]),
    db.query("SELECT working_days FROM attendance_rules WHERE institution_id = $1 AND member_type = 'staff'", [institutionId]),
    db.query(
      `SELECT s.id, s.staff_id, s.first_name, s.last_name, s.department, s.created_at
       FROM staff s WHERE ${staffWhere}
       ORDER BY s.first_name, s.last_name`,
      staffParams
    ),
    db.query(
      `SELECT ar.staff_uuid, ar.date, ar.check_in_time, ar.check_out_time, ar.check_in_method, ar.is_late
       FROM attendance_records ar
       JOIN staff s ON s.id = ar.staff_uuid
       WHERE ${recWhere}
       ORDER BY ar.date, ar.check_in_time`,
      recParams
    ),
    db.query(
      `SELECT lr.staff_uuid, lr.start_date, lr.end_date, lr.leave_type
       FROM leave_requests lr
       JOIN staff s ON s.id = lr.staff_uuid
       WHERE ${leaveWhere}`,
      leaveParams
    ),
  ]);

  const workingDays = rules.rows[0]?.working_days;
  return {
    institutionName: inst.rows[0]?.name || 'Institution',
    workingDays: Array.isArray(workingDays) && workingDays.length ? workingDays.map(Number) : DEFAULT_WORKING_DAYS,
    staff: staff.rows,
    records: records.rows,
    leaves: leaves.rows,
  };
}

/**
 * Turns raw rows into totals plus one entry per week.
 * Each person-day is one of: 'ontime', 'late', 'leave', 'absent', or null
 * (not a work day, or before they joined).
 */
function buildWeeklyBreakdown({ staff, records, leaves, workingDays }, { startDate, endDate } = {}, now = new Date()) {
  const today = startOfDay(now);
  const workSet = new Set(workingDays || DEFAULT_WORKING_DAYS);

  // First sign-in of each person on each day
  const byPersonDay = new Map();
  const daysWithRecords = new Set();
  records.forEach((r) => {
    const key = `${r.staff_uuid}|${dayKey(r.date)}`;
    daysWithRecords.add(dayKey(r.date));
    const prev = byPersonDay.get(key);
    if (!prev || new Date(r.check_in_time) < new Date(prev.check_in_time)) byPersonDay.set(key, r);
  });

  const leaveDays = new Map();
  leaves.forEach((l) => {
    const from = toDate(l.start_date);
    const to = toDate(l.end_date);
    if (!from || !to) return;
    for (let d = startOfDay(from); d <= to; d = addDays(d, 1)) {
      leaveDays.set(`${l.staff_uuid}|${dayKey(d)}`, l.leave_type || 'leave');
    }
  });

  const firstRecord = records.length ? toDate(records[0].date) : null;
  const lastRecord = records.length ? toDate(records[records.length - 1].date) : null;
  const rangeStart = startOfDay(toDate(startDate) || firstRecord || today);
  const requestedEnd = startOfDay(toDate(endDate) || today);
  // Days after today haven't happened, unless someone already has a record there
  let rangeEnd = requestedEnd > today ? today : requestedEnd;
  if (lastRecord && lastRecord > rangeEnd && lastRecord <= requestedEnd) rangeEnd = startOfDay(lastRecord);

  const people = staff.map((s) => ({
    id: s.id,
    staffId: s.staff_id,
    name: displayName(s),
    department: s.department || '',
    joined: s.created_at ? startOfDay(new Date(s.created_at)) : null,
  }));

  const cellFor = (person, day) => {
    const key = dayKey(day);
    const rec = byPersonDay.get(`${person.id}|${key}`);
    if (rec) {
      return {
        status: rec.is_late ? 'late' : 'ontime',
        checkIn: rec.check_in_time,
        checkOut: rec.check_out_time,
        method: rec.check_in_method,
      };
    }
    const isWork = workSet.has(day.getDay());
    if (!isWork || (person.joined && day < person.joined)) return null;
    if (leaveDays.has(`${person.id}|${key}`)) return { status: 'leave' };
    return { status: 'absent' };
  };

  const weeks = [];
  const totals = { expected: 0, attended: 0, signIns: 0, onTime: 0, late: 0, missed: 0, leave: 0 };
  const everActive = new Set();

  if (rangeStart <= rangeEnd) {
    for (let weekStart = mondayOf(rangeStart), n = 1; weekStart <= rangeEnd; weekStart = addDays(weekStart, 7)) {
      const from = weekStart < rangeStart ? rangeStart : weekStart;
      const sunday = addDays(weekStart, 6);
      const to = sunday > rangeEnd ? rangeEnd : sunday;

      const days = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if (workSet.has(d.getDay()) || daysWithRecords.has(dayKey(d))) days.push(d);
      }
      if (!days.length) continue;

      const week = {
        number: n++,
        start: dayKey(days[0]),
        end: dayKey(days[days.length - 1]),
        days: days.map((d) => ({ date: dayKey(d), weekday: d.getDay(), isWorkDay: workSet.has(d.getDay()) })),
        expected: 0,
        attended: 0,
        signIns: 0,
        onTime: 0,
        late: 0,
        missed: 0,
        leave: 0,
        active: [],
        inactive: [],
        onLeave: [],
      };

      people.forEach((p) => {
        const cells = {};
        const row = { id: p.id, staffId: p.staffId, name: p.name, department: p.department, cells, daysIn: 0, late: 0, expected: 0, missed: 0, leave: 0 };
        days.forEach((d) => {
          const cell = cellFor(p, d);
          cells[dayKey(d)] = cell;
          if (!cell) return;
          const isWork = workSet.has(d.getDay());
          if (cell.status === 'ontime' || cell.status === 'late') {
            row.daysIn += 1;
            if (cell.status === 'late') row.late += 1;
            if (isWork) { row.expected += 1; week.attended += 1; }
          } else if (cell.status === 'absent') {
            row.expected += 1;
            row.missed += 1;
          } else if (cell.status === 'leave') {
            row.leave += 1;
          }
        });

        week.expected += row.expected;
        week.signIns += row.daysIn;
        week.late += row.late;
        week.onTime += row.daysIn - row.late;
        week.missed += row.missed;
        week.leave += row.leave;

        if (row.daysIn > 0) {
          week.active.push(row);
          everActive.add(p.id);
        } else if (row.expected > 0) week.inactive.push(row);
        else if (row.leave > 0) week.onLeave.push(row);
      });

      week.rate = week.expected ? Math.round((week.attended / week.expected) * 100) : null;
      week.staffCounted = week.active.length + week.inactive.length;
      weeks.push(week);

      totals.expected += week.expected;
      totals.attended += week.attended;
      totals.signIns += week.signIns;
      totals.onTime += week.onTime;
      totals.late += week.late;
      totals.missed += week.missed;
      totals.leave += week.leave;
    }
  }

  const workDayCount = new Set(
    weeks.flatMap((w) => w.days.filter((d) => d.isWorkDay).map((d) => d.date))
  ).size;

  return {
    start: dayKey(rangeStart),
    end: dayKey(rangeStart <= rangeEnd ? rangeEnd : requestedEnd),
    staffCount: people.length,
    workDayCount,
    activeStaff: everActive.size,
    neverSignedIn: people.filter((p) => !everActive.has(p.id)).map((p) => ({ staffId: p.staffId, name: p.name })),
    totals: { ...totals, rate: totals.expected ? Math.round((totals.attended / totals.expected) * 100) : null },
    weeks,
  };
}

module.exports = { loadAttendanceData, buildWeeklyBreakdown };
