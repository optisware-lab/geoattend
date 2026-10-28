import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FiDownload, FiFileText, FiFilter, FiAlertTriangle, FiShare2 } from 'react-icons/fi';
import { API_BASE_URL, getAttendanceReport, getDepartments, getFraudReport, getGeofenceEvents } from '../services/api';
import { PageHeader, Badge } from '../components/ui';
import { formatDate, formatDateTime, formatDateRange, formatTime, formatDuration } from '../utils/format';

const styles = {
  filters: {
    display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap',
    background: '#fff', padding: '16px', borderRadius: '14px', boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 2px 8px rgba(16,24,40,0.06)',
  },
  field: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '11px', fontWeight: '700', color: '#95a5a6', textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { padding: '8px 12px', border: '1px solid #e0e0e0', borderRadius: '8px', fontSize: '13px' },
  select: { padding: '8px 12px', border: '1px solid #e0e0e0', borderRadius: '8px', fontSize: '13px', background: '#fff' },
  table: { width: '100%', background: '#fff', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  th: { padding: '12px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '600', color: '#7f8c8d', textTransform: 'uppercase', borderBottom: '2px solid #f0f0f0' },
  td: { padding: '12px 14px', fontSize: '13px', borderBottom: '1px solid #f5f5f5' },
};

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function periodRange(period) {
  const today = new Date();
  const start = new Date(today);
  const end = new Date(today);

  switch (period) {
    case 'today':
      break;
    case 'yesterday':
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
      break;
    case 'last7':
      start.setDate(start.getDate() - 6);
      break;
    case 'last30':
      start.setDate(start.getDate() - 29);
      break;
    case 'this_week':
      start.setDate(start.getDate() - start.getDay());
      break;
    case 'last_week': {
      const dow = start.getDay();
      start.setDate(start.getDate() - dow - 7);
      end.setDate(end.getDate() - dow - 1);
      break;
    }
    case 'this_month':
      start.setDate(1);
      break;
    case 'last_month': {
      start.setDate(1);
      start.setMonth(start.getMonth() - 1);
      end.setDate(0);
      break;
    }
    case 'this_year':
      start.setMonth(0, 1);
      break;
    default:
      return null;
  }

  return { startDate: toDateStr(start), endDate: toDateStr(end) };
}

const PERIOD_OPTIONS = [
  { value: '', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'this_week', label: 'This week' },
  { value: 'last_week', label: 'Last week' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_year', label: 'This year' },
];

const STATUS_VIEWS = [
  { key: '', label: 'All' },
  { key: 'ontime', label: 'On time' },
  { key: 'late', label: 'Late' },
  { key: 'absent', label: 'Absent' },
];

function rowStatus(r) {
  if (!r.check_in_time) return 'absent';
  return r.is_late ? 'late' : 'ontime';
}

export default function Reports() {
  const [searchParams] = useSearchParams();
  const requested = searchParams.get('period');
  const initialPeriod = PERIOD_OPTIONS.some((o) => o.value === requested) && requested ? requested : 'last7';
  const initialRange = periodRange(initialPeriod) || { startDate: '', endDate: '' };

  const [records, setRecords] = useState([]);
  const [fraudEvents, setFraudEvents] = useState([]);
  const [geofenceEvents, setGeofenceEvents] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [filters, setFilters] = useState({ ...initialRange, department: '', staffId: '' });
  const [period, setPeriod] = useState(initialPeriod);
  const [statusView, setStatusView] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState('');

  useEffect(() => {
    getDepartments().then(r => setDepartments(r.data)).catch(() => {});
  }, []);

  const fetchReport = useCallback((f) => {
    const params = {};
    Object.entries(f).forEach(([k, v]) => { if (v && String(v).trim()) params[k] = String(v).trim(); });
    setLoading(true);
    getAttendanceReport(params)
      .then(r => setRecords(r.data.records || []))
      .catch(() => toast.error('Failed to load report'))
      .finally(() => setLoading(false));

    getFraudReport(params)
      .then(r => setFraudEvents(r.data.events || []))
      .catch(() => {});

    getGeofenceEvents({ ...params, onlyExits: true })
      .then(r => setGeofenceEvents(r.data.events || []))
      .catch(() => {});
  }, []);

  // Filters apply by themselves; typing a staff ID waits until you pause
  const firstRun = useRef(true);
  useEffect(() => {
    const delay = firstRun.current ? 0 : 400;
    firstRun.current = false;
    const id = setTimeout(() => fetchReport(filters), delay);
    return () => clearTimeout(id);
  }, [filters, fetchReport]);

  const handlePeriodChange = (value) => {
    setPeriod(value);
    const range = periodRange(value);
    setFilters(f => ({ ...f, startDate: range ? range.startDate : '', endDate: range ? range.endDate : '' }));
  };

  const counts = useMemo(() => {
    const c = { '': records.length, ontime: 0, late: 0, absent: 0 };
    records.forEach((r) => { c[rowStatus(r)] += 1; });
    return c;
  }, [records]);

  const shown = statusView ? records.filter((r) => rowStatus(r) === statusView) : records;
  const rangeLabel = filters.startDate || filters.endDate
    ? formatDateRange(filters.startDate || filters.endDate, filters.endDate || filters.startDate)
    : 'All time';

  const handleExport = async (format) => {
    const token = localStorage.getItem('token');
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params.append(k, v); });
    setExporting(format);
    try {
      const res = await fetch(`${API_BASE_URL}/reports/export/${format}?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      const span = filters.startDate ? `${filters.startDate}_to_${filters.endDate || filters.startDate}` : 'all-time';
      link.download = `attendance_${span}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    } catch {
      toast.error('Export failed. Please try again.');
    } finally {
      setExporting('');
    }
  };

  const handleWhatsAppShare = () => {
    const lines = [
      'GeoAttend attendance report',
      `${rangeLabel}${filters.department ? ` · ${filters.department}` : ''}`,
      `On time: ${counts.ontime} · Late: ${counts.late} · Absent: ${counts.absent}`,
      `Total records: ${counts['']}`,
    ];
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`, '_blank', 'noopener');
  };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      <PageHeader
        title="Attendance Reports"
        subtitle={<>Showing <strong>{rangeLabel}</strong>{loading ? ' · loading...' : ''}</>}
        actions={(
          <>
            <button type="button" className="ga-btn" style={{ color: '#128C7E' }} onClick={handleWhatsAppShare}>
              <FiShare2 size={14} /> WhatsApp
            </button>
            <button type="button" className="ga-btn ga-btn-green" onClick={() => handleExport('excel')} disabled={!!exporting}>
              <FiDownload size={14} /> {exporting === 'excel' ? 'Preparing...' : 'Excel'}
            </button>
            <button type="button" className="ga-btn ga-btn-primary" onClick={() => handleExport('pdf')} disabled={!!exporting}>
              <FiFileText size={14} /> {exporting === 'pdf' ? 'Preparing...' : 'PDF'}
            </button>
          </>
        )}
      />

      <div style={styles.filters}>
        <div style={styles.field}>
          <label style={styles.label} htmlFor="rep-period">Period</label>
          <select id="rep-period" style={styles.select} value={period} onChange={e => handlePeriodChange(e.target.value)}>
            {PERIOD_OPTIONS.map(o => (
              <option key={o.value || 'all'} value={o.value}>
                {o.value === '' && (filters.startDate || filters.endDate) ? 'Custom dates' : o.label}
              </option>
            ))}
          </select>
        </div>
        <div style={styles.field}>
          <label style={styles.label} htmlFor="rep-start">From</label>
          <input
            id="rep-start"
            style={styles.input}
            type="date"
            value={filters.startDate}
            onChange={e => { setPeriod(''); setFilters(f => ({ ...f, startDate: e.target.value })); }}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label} htmlFor="rep-end">To</label>
          <input
            id="rep-end"
            style={styles.input}
            type="date"
            value={filters.endDate}
            onChange={e => { setPeriod(''); setFilters(f => ({ ...f, endDate: e.target.value })); }}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label} htmlFor="rep-dept">Department</label>
          <select id="rep-dept" style={styles.select} value={filters.department} onChange={e => setFilters(f => ({ ...f, department: e.target.value }))}>
            <option value="">All</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div style={styles.field}>
          <label style={styles.label} htmlFor="rep-staff">Staff ID</label>
          <input
            id="rep-staff"
            style={styles.input}
            placeholder="e.g. STF001"
            value={filters.staffId}
            onChange={e => setFilters(f => ({ ...f, staffId: e.target.value.toUpperCase() }))}
          />
        </div>
        <div style={{ ...styles.field, justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 12, color: '#95a5a6', display: 'inline-flex', alignItems: 'center', gap: 6, paddingBottom: 9 }}>
            <FiFilter size={12} /> Updates as you change filters
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {STATUS_VIEWS.map(v => (
          <button key={v.key || 'all'} type="button" className={`ga-chip${statusView === v.key ? ' is-active' : ''}`} onClick={() => setStatusView(v.key)}>
            {v.label} <span className="ga-chip-count">{counts[v.key]}</span>
          </button>
        ))}
      </div>

      <div className="ga-card" style={{ overflowX: 'auto' }}>
        <table className="ga-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Staff</th>
              <th>Department</th>
              <th>Check in</th>
              <th>Check out</th>
              <th>Hours</th>
              <th>Method</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, idx) => {
              const status = rowStatus(r);
              const hours = r.check_in_time && r.check_out_time ? new Date(r.check_out_time) - new Date(r.check_in_time) : null;
              return (
                <tr key={r.id || `absent-${r.staff_id}-${r.date}-${idx}`}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.date)}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.first_name} {r.last_name}</div>
                    <div style={{ fontSize: 12, color: '#95a5a6' }}>{r.staff_id}</div>
                  </td>
                  <td>{r.department || '-'}</td>
                  <td>{status === 'absent' ? '-' : formatTime(r.check_in_time)}</td>
                  <td>{status === 'absent' ? '-' : formatTime(r.check_out_time)}</td>
                  <td>{hours ? formatDuration(hours) : '-'}</td>
                  <td style={{ textTransform: 'capitalize' }}>{r.check_in_method ? r.check_in_method.replace('_', ' ') : '-'}</td>
                  <td>
                    {status === 'absent' ? <Badge tone="red">Absent</Badge>
                      : status === 'late' ? <Badge tone="orange">Late</Badge>
                        : <Badge tone="green">On time</Badge>}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#95a5a6' }}>{loading ? 'Loading...' : 'No records for these filters'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FiAlertTriangle /> Fraud Report
        </h2>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Time</th>
              <th style={styles.th}>Type</th>
              <th style={styles.th}>User</th>
              <th style={styles.th}>ID</th>
            </tr>
          </thead>
          <tbody>
            {fraudEvents.map((f) => (
              <tr key={f.id}>
                <td style={styles.td}>{formatDateTime(f.created_at)}</td>
                <td style={styles.td}>{f.event_type}</td>
                <td style={styles.td}>{f.first_name ? `${f.first_name} ${f.last_name}` : '-'}</td>
                <td style={styles.td}>{f.staff_id || '-'}</td>
              </tr>
            ))}
            {fraudEvents.length === 0 && (
              <tr><td colSpan={4} style={{ ...styles.td, textAlign: 'center', color: '#95a5a6' }}>No suspicious events found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FiAlertTriangle /> Geofence Exits (Recent)
        </h2>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Time</th>
              <th style={styles.th}>Staff ID</th>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Department</th>
              <th style={styles.th}>Event</th>
              <th style={styles.th}>Distance (m)</th>
              <th style={styles.th}>Radius (m)</th>
            </tr>
          </thead>
          <tbody>
            {geofenceEvents.map((e) => (
              <tr key={e.id}>
                <td style={styles.td}>{formatDateTime(e.created_at)}</td>
                <td style={styles.td}><strong>{e.staff_id || '-'}</strong></td>
                <td style={styles.td}>{e.first_name ? `${e.first_name} ${e.last_name}` : '-'}</td>
                <td style={styles.td}>{e.department || '-'}</td>
                <td style={styles.td}>{e.event}</td>
                <td style={styles.td}>{typeof e.distance_m === 'number' ? e.distance_m : '-'}</td>
                <td style={styles.td}>{typeof e.radius_m === 'number' ? e.radius_m : '-'}</td>
              </tr>
            ))}
            {geofenceEvents.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: '#95a5a6' }}>
                  No geofence exits recorded
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
