import React, { useMemo, useState } from 'react';
import { FiUserX } from 'react-icons/fi';
import { formatWeekdayDay } from '../utils/format';

// Who was absent in the chosen period, with present, late and leave days
// alongside so the admin can decide what to do. Most absent first.

export const SHOW_OPTIONS = [
  { value: 0, label: 'All staff' },
  { value: 1, label: 'Absent at least once' },
  { value: 3, label: 'Absent 3+ days' },
  { value: 5, label: 'Absent 5+ days' },
  { value: 10, label: 'Absent 10+ days' },
];

function rateColor(rate) {
  if (rate == null) return '#95a5a6';
  if (rate >= 90) return '#1e8449';
  if (rate >= 70) return '#c0640f';
  return '#c0392b';
}

function Tile({ label, value, color = '#1a5276', sub }) {
  return (
    <div className="ga-card" style={{ padding: '12px 14px', borderTop: `3px solid ${color}`, minWidth: 0 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#7f8c8d', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11.5, color: '#95a5a6', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

const perPerson = (n, people) => (people ? Math.round((n / people) * 10) / 10 : 0);

const num = { textAlign: 'center', whiteSpace: 'nowrap' };
const DATES_SHOWN = 4;

export default function AbsenceReport({ data, loading, message, minAbsent, onMinAbsentChange }) {
  const [expanded, setExpanded] = useState(() => new Set());

  const counts = useMemo(() => {
    const people = data?.people || [];
    return Object.fromEntries(SHOW_OPTIONS.map((o) => [o.value, people.filter((p) => p.missed >= o.value).length]));
  }, [data]);

  if (message) {
    return (
      <div className="ga-card" style={{ padding: 32, textAlign: 'center', color: '#7f8c8d', marginBottom: 24 }}>
        <FiUserX size={22} style={{ marginBottom: 8 }} />
        <div style={{ fontSize: 14 }}>{message}</div>
      </div>
    );
  }
  if (!data) {
    return <div className="ga-card" style={{ padding: 32, textAlign: 'center', color: '#95a5a6', marginBottom: 24 }}>{loading ? 'Loading...' : 'No report yet'}</div>;
  }

  const t = data.totals;
  // Absences and late sign-ins are totals for everyone: say what they're out of
  const staffDays = t.staffDays ?? (data.people || []).reduce((n, p) => n + (p.expected || 0), 0);
  const shown = data.people.filter((p) => p.missed >= minAbsent);
  const toggle = (id) => setExpanded((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div style={{ marginBottom: 24, opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 14 }}>
        <Tile label="Work days" value={data.workDayCount} sub="in this period" />
        <Tile label="Staff counted" value={t.staffCount} />
        <Tile label="Staff with absences" value={t.withAbsences} color="#c0392b" sub={`of ${t.staffCount} staff`} />
        <Tile label="Absences (all staff)" value={t.absent} color="#c0392b" sub={`of ${staffDays} staff-days · ${perPerson(t.absent, t.staffCount)} each`} />
        <Tile label="Late sign-ins (all staff)" value={t.late} color="#c0640f" sub={`${perPerson(t.late, t.staffCount)} each on average`} />
        <Tile label="Leave days (all staff)" value={t.leave} color="#2471a3" />
        <Tile label="Attendance rate" value={t.rate == null ? '-' : `${t.rate}%`} color={rateColor(t.rate)} sub="days present ÷ staff-days" />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {SHOW_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`ga-chip${minAbsent === o.value ? ' is-active' : ''}`}
            onClick={() => onMinAbsentChange(o.value)}
          >
            {o.label} <span className="ga-chip-count">{counts[o.value]}</span>
          </button>
        ))}
      </div>

      <div className="ga-card" style={{ overflowX: 'auto' }}>
        <table className="ga-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>Staff</th>
              <th>Department</th>
              <th style={num}>Work days</th>
              <th style={num}>Present</th>
              <th style={num}>Late</th>
              <th style={num}>Leave</th>
              <th style={num}>Absent</th>
              <th style={num}>Rate</th>
              <th>Days absent</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p, i) => {
              const open = expanded.has(p.id);
              const dates = open ? p.absentDates : p.absentDates.slice(0, DATES_SHOWN);
              const more = p.absentDates.length - DATES_SHOWN;
              return (
                <tr key={p.id}>
                  <td style={{ color: '#95a5a6' }}>{i + 1}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: '#95a5a6' }}>{p.staffId}</div>
                  </td>
                  <td>{p.department || '-'}</td>
                  <td style={num}>{p.expected}</td>
                  <td style={{ ...num, color: '#1e8449', fontWeight: 600 }}>{p.daysIn}</td>
                  <td style={{ ...num, color: p.late ? '#c0640f' : '#b0b8bf', fontWeight: p.late ? 700 : 400 }}>{p.late}</td>
                  <td style={{ ...num, color: p.leave ? '#2471a3' : '#b0b8bf' }}>{p.leave}</td>
                  <td style={{ ...num, color: p.missed ? '#c0392b' : '#b0b8bf', fontWeight: 800, fontSize: 14 }}>{p.missed}</td>
                  <td style={{ ...num, color: rateColor(p.rate), fontWeight: 700 }}>{p.rate == null ? '-' : `${p.rate}%`}</td>
                  <td style={{ fontSize: 12.5, color: '#5d6d7e', minWidth: 220 }}>
                    {p.absentDates.length === 0 ? <span style={{ color: '#b0b8bf' }}>None</span> : dates.map(formatWeekdayDay).join(', ')}
                    {more > 0 && (
                      <button
                        type="button"
                        onClick={() => toggle(p.id)}
                        style={{ marginLeft: 6, border: 'none', background: 'none', color: '#2471a3', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: 0 }}
                      >
                        {open ? 'show less' : `+${more} more`}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: 40, color: '#95a5a6' }}>
                  {loading ? 'Loading...' : minAbsent ? 'Nobody was absent that often in this period.' : 'No staff for these filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: '#95a5a6', marginTop: 8 }}>
        Absences and late sign-ins above are totals for all staff together: {data.workDayCount} work days × {t.staffCount} staff = {staffDays} staff-days expected
        (fewer for people who joined later). Each person&apos;s own figures are in the table.
        Absent means a work day with no sign-in and no approved leave. Days before someone joined, and days still to come, are not counted.
      </div>
    </div>
  );
}
