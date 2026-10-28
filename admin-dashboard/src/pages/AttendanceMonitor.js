import React, { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FiRefreshCw, FiSearch, FiPhone, FiClock, FiUserX, FiCheckCircle, FiAlertCircle, FiMapPin, FiCalendar } from 'react-icons/fi';
import { getRealTimeAttendance, getStaff, getAllLeaves } from '../services/api';
import { PageHeader, Avatar, Badge, EmptyState, useAutoRefresh, useNow } from '../components/ui';
import { formatDateLong, formatTime, formatDuration, formatDateRange, timeAgo, toDate } from '../utils/format';

const VIEWS = [
  { key: 'all', label: 'Checked in' },
  { key: 'onsite', label: 'On site' },
  { key: 'late', label: 'Late' },
  { key: 'left', label: 'Left' },
  { key: 'missing', label: 'Not in yet' },
  { key: 'leave', label: 'On leave' },
];

function coversToday(leave, today) {
  const a = toDate(leave.start_date);
  const b = toDate(leave.end_date);
  if (!a || !b) return false;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return a <= t && t <= b;
}

export default function AttendanceMonitor() {
  const [params, setParams] = useSearchParams();
  const view = VIEWS.some((v) => v.key === params.get('view')) ? params.get('view') : 'all';
  const setView = (key) => setParams(key === 'all' ? {} : { view: key }, { replace: true });

  const now = useNow(30000);
  const [records, setRecords] = useState([]);
  const [staff, setStaff] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, s, l] = await Promise.allSettled([
      getRealTimeAttendance(),
      getStaff({ status: 'active', limit: 2000 }),
      getAllLeaves({ status: 'approved', limit: 200 }),
    ]);
    if (r.status === 'fulfilled' && Array.isArray(r.value.data)) setRecords(r.value.data);
    if (s.status === 'fulfilled') setStaff(s.value.data.staff || []);
    if (l.status === 'fulfilled') setLeaves(l.value.data.leaves || []);
    setUpdatedAt(new Date());
    setLoading(false);
    setLoaded(true);
  }, []);

  useAutoRefresh(load, 30000);

  const groups = useMemo(() => {
    const today = new Date();
    const inToday = new Set(records.map((r) => r.staff_uuid));
    const leaveToday = leaves.filter((l) => coversToday(l, today));
    const leaveByStaff = new Map(leaveToday.map((l) => [l.staff_uuid, l]));
    const notIn = staff.filter((s) => !inToday.has(s.id));
    return {
      all: records,
      onsite: records.filter((r) => !r.check_out_time),
      late: records.filter((r) => r.is_late),
      left: records.filter((r) => r.check_out_time),
      missing: notIn.filter((s) => !leaveByStaff.has(s.id)),
      leave: notIn.filter((s) => leaveByStaff.has(s.id)).map((s) => ({ ...s, leave: leaveByStaff.get(s.id) })),
    };
  }, [records, staff, leaves]);

  const q = search.trim().toLowerCase();
  const matches = (p) => !q || [p.first_name, p.last_name, p.staff_id, p.department, p.phone]
    .some((v) => (v || '').toLowerCase().includes(q));
  const list = (groups[view] || []).filter(matches);
  const isPeopleView = view === 'missing' || view === 'leave';

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      <PageHeader
        title="Live Attendance"
        subtitle={(
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {formatDateLong(now)}
            <span style={{ color: '#cfd6dd' }}>|</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="ga-live-dot" /> Updates every 30 s · last {updatedAt ? timeAgo(updatedAt) : '...'}
            </span>
          </span>
        )}
        actions={(
          <button type="button" className="ga-btn" onClick={load} disabled={loading}>
            <FiRefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
          </button>
        )}
      />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {VIEWS.map((v) => (
          <button key={v.key} type="button" className={`ga-chip${view === v.key ? ' is-active' : ''}`} onClick={() => setView(v.key)}>
            {v.label}
            <span className="ga-chip-count">{(groups[v.key] || []).length}</span>
          </button>
        ))}
      </div>

      <div className="ga-card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 16, maxWidth: 420 }}>
        <FiSearch color="#95a5a6" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, staff ID, department or phone"
          aria-label="Search staff"
          style={{ border: 'none', flex: 1, fontSize: 14, background: 'transparent' }}
        />
      </div>

      {!loaded ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))', gap: 12 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="ga-skeleton" style={{ height: 78 }} />)}
        </div>
      ) : list.length === 0 ? (
        <div className="ga-card">
          {view === 'missing' && !q ? (
            <EmptyState icon={FiCheckCircle} title="Everyone is accounted for" text="All active staff have checked in or are on approved leave." />
          ) : (
            <EmptyState icon={q ? FiSearch : FiClock} title={q ? 'No one matches your search' : 'Nobody here yet'} />
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))', gap: 12 }}>
          {isPeopleView ? list.map((s) => (
            <div key={s.id} className="ga-card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <Avatar first={s.first_name} last={s.last_name} photo={s.profile_photo_url} size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{s.first_name} {s.last_name}</div>
                <div style={{ fontSize: 12, color: '#95a5a6', marginTop: 2 }}>
                  {s.staff_id}{s.department ? ` · ${s.department}` : ''}
                </div>
                {s.leave && (
                  <div style={{ fontSize: 12, color: '#2471a3', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <FiCalendar size={11} /> {s.leave.leave_type} leave · {formatDateRange(s.leave.start_date, s.leave.end_date)}
                  </div>
                )}
              </div>
              {view === 'missing' && s.phone ? (
                <a href={`tel:${s.phone}`} className="ga-btn ga-btn-sm" title={`Call ${s.phone}`}>
                  <FiPhone size={12} /> Call
                </a>
              ) : view === 'missing' ? (
                <Badge tone="red" icon={FiUserX}>Not in</Badge>
              ) : (
                <Badge tone="blue">On leave</Badge>
              )}
            </div>
          )) : list.map((r) => {
            const out = r.check_out_time;
            const onSiteMs = (out ? toDate(out) : now) - toDate(r.check_in_time);
            return (
              <div key={r.id} className="ga-card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
                <Avatar first={r.first_name} last={r.last_name} photo={r.profile_photo_url} size={44} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.first_name} {r.last_name}</div>
                  <div style={{ fontSize: 12, color: '#95a5a6', marginTop: 2 }}>
                    {r.staff_id}{r.department ? ` · ${r.department}` : ''}
                  </div>
                  <div style={{ fontSize: 12.5, color: '#5d6d7e', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span>In <strong>{formatTime(r.check_in_time)}</strong></span>
                    {out && <span>Out <strong>{formatTime(out)}</strong></span>}
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><FiClock size={11} /> {formatDuration(onSiteMs)}</span>
                    {r.check_in_method && r.check_in_method !== 'gps' && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><FiMapPin size={11} /> {r.check_in_method.replace('_', ' ')}</span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  {out ? <Badge tone="gray" icon={FiCheckCircle}>Left</Badge> : <Badge tone="green">On site</Badge>}
                  {r.is_late && <Badge tone="orange" icon={FiAlertCircle}>Late</Badge>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
