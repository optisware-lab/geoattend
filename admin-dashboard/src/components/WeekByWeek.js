import React, { useEffect, useState } from 'react';
import { FiCalendar, FiChevronDown, FiChevronRight } from 'react-icons/fi';
import { Card } from './ui';
import { formatDay, formatTime, toDate } from '../utils/format';

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

function rangeText(start, end) {
  return start === end ? formatDay(start) : `${formatDay(start)} to ${formatDay(end)}`;
}

function dayHeading(key) {
  const d = toDate(key);
  return d ? { day: DAYS_SHORT[d.getDay()], date: `${d.getDate()}-${MONTHS_SHORT[d.getMonth()]}` } : { day: '', date: '' };
}

function rateColor(rate) {
  if (rate == null) return '#95a5a6';
  if (rate >= 85) return '#1e8449';
  if (rate >= 65) return '#c0640f';
  return '#c0392b';
}

const PILL_TONES = {
  blue: ['#2471a3', '#eaf3fb'],
  green: ['#1e8449', '#e9f7ef'],
  orange: ['#c0640f', '#fdf2e6'],
  red: ['#c0392b', '#fdedec'],
  purple: ['#7d3c98', '#f4ecf7'],
};

function Pill({ tone, children }) {
  const [color, bg] = PILL_TONES[tone];
  return <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: 12, fontWeight: 700, color, background: bg, whiteSpace: 'nowrap' }}>{children}</span>;
}

function DayCell({ cell }) {
  if (!cell) return <span style={{ color: '#d0d5da' }}>·</span>;
  if (cell.status === 'ontime') return <span style={{ color: '#1e8449', fontWeight: 600 }}>{formatTime(cell.checkIn)}</span>;
  if (cell.status === 'late') return <span style={{ color: '#c0640f', fontWeight: 700 }}>{formatTime(cell.checkIn)}</span>;
  if (cell.status === 'leave') return <span style={{ color: '#2471a3' }}>Leave</span>;
  return <span style={{ color: '#c0392b' }}>Absent</span>;
}

function NameList({ title, color, people }) {
  if (!people.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 6 }}>{title} ({people.length})</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {people.map((p) => (
          <span key={p.id} style={{ fontSize: 12.5, padding: '4px 10px', borderRadius: 999, background: '#f4f6f8', color: '#2c3e50' }}>
            {p.name} <span style={{ color: '#95a5a6' }}>{p.staffId}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function WeekDetail({ week }) {
  const active = [...week.active].sort((a, b) => b.daysIn - a.daysIn || a.name.localeCompare(b.name));
  return (
    <div style={{ padding: '4px 0 6px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1e8449', margin: '6px 0 8px' }}>Signed in this week ({active.length})</div>
      {active.length ? (
        <div style={{ overflowX: 'auto', border: '1px solid #eef1f4', borderRadius: 10 }}>
          <table className="ga-table" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>Name</th>
                {week.days.map((d) => {
                  const h = dayHeading(d.date);
                  return (
                    <th key={d.date} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {h.day}<div style={{ fontWeight: 500, textTransform: 'none', fontSize: 10.5 }}>{h.date}</div>
                    </th>
                  );
                })}
                <th style={{ textAlign: 'center' }}>Days</th>
                <th style={{ textAlign: 'center' }}>Late</th>
              </tr>
            </thead>
            <tbody>
              {active.map((p) => (
                <tr key={p.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 11.5, color: '#95a5a6' }}>{p.staffId}</div>
                  </td>
                  {week.days.map((d) => (
                    <td key={d.date} style={{ textAlign: 'center', whiteSpace: 'nowrap', fontSize: 12.5 }}>
                      <DayCell cell={p.days[d.date]} />
                    </td>
                  ))}
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{p.expected ? `${p.daysIn}/${p.expected}` : p.daysIn}</td>
                  <td style={{ textAlign: 'center', color: p.late ? '#c0640f' : '#95a5a6', fontWeight: p.late ? 700 : 400 }}>{p.late}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: '#95a5a6' }}>Nobody signed in this week.</div>
      )}
      <NameList title="Did not sign in this week" color="#c0392b" people={week.inactive} />
      <NameList title="On leave all week" color="#2471a3" people={week.onLeave} />
    </div>
  );
}

export default function WeekByWeek({ data, loading }) {
  const weeks = data?.weeks || [];
  const latest = weeks.length ? weeks[weeks.length - 1].number : null;
  const [open, setOpen] = useState(null);

  // Open the latest week whenever the period changes
  useEffect(() => {
    setOpen(latest);
  }, [data, latest]);

  return (
    <Card
      title="Week by week"
      icon={FiCalendar}
      style={{ marginBottom: 16 }}
      action={data && (
        <span style={{ fontSize: 12.5, color: '#7f8c8d' }}>
          {data.activeStaff} of {data.staffCount} staff signed in at least once
        </span>
      )}
    >
      {!weeks.length && (
        <div style={{ fontSize: 13, color: '#95a5a6', padding: '8px 0' }}>
          {loading ? 'Loading...' : 'No work days in this period yet.'}
        </div>
      )}

      {weeks.map((w) => {
        const isOpen = open === w.number;
        return (
          <div key={w.number} style={{ borderTop: '1px solid #eef1f4' }}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : w.number)}
              aria-expanded={isOpen}
              style={{ width: '100%', background: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 2px', textAlign: 'left', flexWrap: 'wrap' }}
            >
              {isOpen ? <FiChevronDown size={16} color="#1a5276" /> : <FiChevronRight size={16} color="#95a5a6" />}
              <div style={{ minWidth: 190 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, color: '#1a5276' }}>Week {w.number}</div>
                <div style={{ fontSize: 12.5, color: '#7f8c8d' }}>{rangeText(w.start, w.end)}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                <Pill tone="blue">{w.active.length} of {w.staffCounted} signed in</Pill>
                <Pill tone="green">{w.onTime} on time</Pill>
                {w.late > 0 && <Pill tone="orange">{w.late} late</Pill>}
                {w.missed > 0 && <Pill tone="red">{w.missed} absent</Pill>}
                {w.leave > 0 && <Pill tone="purple">{w.leave} leave</Pill>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 130 }}>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#eef1f4', overflow: 'hidden' }}>
                  <div style={{ width: `${w.rate || 0}%`, height: '100%', background: rateColor(w.rate) }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 13, color: rateColor(w.rate), minWidth: 36, textAlign: 'right' }}>
                  {w.rate == null ? '-' : `${w.rate}%`}
                </span>
              </div>
            </button>
            {isOpen && <WeekDetail week={w} />}
          </div>
        );
      })}
    </Card>
  );
}
