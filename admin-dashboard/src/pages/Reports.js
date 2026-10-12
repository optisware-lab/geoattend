import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { FiDownload, FiFileText, FiFilter, FiAlertTriangle } from 'react-icons/fi';
import { getAttendanceReport, getDepartments, getFraudReport, getTodaySummary, getGeofenceEvents } from '../services/api';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const styles = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' },
  title: { fontSize: '24px', fontWeight: '700' },
  exportBtns: { display: 'flex', gap: '8px' },
  exportBtn: (color) => ({
    display: 'flex', alignItems: 'center', gap: '6px',
    padding: '10px 16px', background: color, color: '#fff',
    borderRadius: '8px', fontSize: '13px', fontWeight: '500',
  }),
  filters: {
    display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap',
    background: '#fff', padding: '16px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  field: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '11px', fontWeight: '600', color: '#95a5a6', textTransform: 'uppercase' },
  input: { padding: '8px 12px', border: '1px solid #e0e0e0', borderRadius: '6px', fontSize: '13px' },
  select: { padding: '8px 12px', border: '1px solid #e0e0e0', borderRadius: '6px', fontSize: '13px', background: '#fff' },
  filterBtn: {
    alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: '6px',
    padding: '8px 16px', background: '#1a5276', color: '#fff', borderRadius: '6px', fontSize: '13px',
  },
  table: { width: '100%', background: '#fff', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  th: { padding: '12px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '600', color: '#7f8c8d', textTransform: 'uppercase', borderBottom: '2px solid #f0f0f0' },
  td: { padding: '12px 14px', fontSize: '13px', borderBottom: '1px solid #f5f5f5' },
  lateBadge: { color: '#f39c12', fontWeight: '600' },
  absentBadge: { color: '#e74c3c', fontWeight: '600' },
  onTimeBadge: { color: '#27ae60', fontWeight: '600' },
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

export default function Reports() {
  const [records, setRecords] = useState([]);
  const [fraudEvents, setFraudEvents] = useState([]);
  const [geofenceEvents, setGeofenceEvents] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [filters, setFilters] = useState({ startDate: '', endDate: '', department: '', staffId: '' });
  const [period, setPeriod] = useState('');
  const [todaySummary, setTodaySummary] = useState({ present: 0, late: 0, absent: 0 });

  useEffect(() => {
    getDepartments().then(r => setDepartments(r.data)).catch(() => {});
    fetchReport();
  }, []);

  const handlePeriodChange = (value) => {
    setPeriod(value);
    const range = periodRange(value);
    if (range) {
      setFilters(f => ({ ...f, startDate: range.startDate, endDate: range.endDate }));
    } else {
      setFilters(f => ({ ...f, startDate: '', endDate: '' }));
    }
  };

  const fetchReport = () => {
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    getAttendanceReport(params)
      .then(r => setRecords(r.data.records))
      .catch(() => toast.error('Failed to load report'));

    getFraudReport(params)
      .then(r => setFraudEvents(r.data.events || []))
      .catch(() => {});

    getGeofenceEvents({ ...params, onlyExits: true })
      .then(r => setGeofenceEvents(r.data.events || []))
      .catch(() => {});

    getTodaySummary()
      .then(r => setTodaySummary(r.data))
      .catch(() => {});
  };

  const handleExport = (format) => {
    const token = localStorage.getItem('token');
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params.append(k, v); });

    const url = `${API_BASE}/reports/export/${format}?${params.toString()}`;
    // Open in new tab with auth header via fetch
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `attendance_report.${format === 'excel' ? 'xlsx' : 'pdf'}`;
        link.click();
      })
      .catch(() => toast.error('Export failed'));
  };

  const handleWhatsAppShare = () => {
    const text = `GeoAttend Staff Report
Today: ${todaySummary.present || 0} present, ${todaySummary.late || 0} late, ${todaySummary.absent || 0} absent.
Filters: ${filters.startDate || 'all'} to ${filters.endDate || 'all'}, Dept: ${filters.department || 'all'}.`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Attendance Reports</h1>
        <div style={styles.exportBtns}>
          <button style={styles.exportBtn('#25D366')} onClick={handleWhatsAppShare}>
            WhatsApp
          </button>
          <button style={styles.exportBtn('#27ae60')} onClick={() => handleExport('excel')}>
            <FiDownload size={14} /> Excel
          </button>
          <button style={styles.exportBtn('#e74c3c')} onClick={() => handleExport('pdf')}>
            <FiFileText size={14} /> PDF
          </button>
        </div>
      </div>

      <div style={styles.filters}>
        <div style={styles.field}>
          <label style={styles.label}>Period</label>
          <select
            style={styles.select}
            value={period}
            onChange={e => {
              handlePeriodChange(e.target.value);
            }}
          >
            {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Start Date</label>
          <input
            style={styles.input}
            type="date"
            value={filters.startDate}
            onChange={e => {
              setPeriod('');
              setFilters(f => ({ ...f, startDate: e.target.value }));
            }}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>End Date</label>
          <input
            style={styles.input}
            type="date"
            value={filters.endDate}
            onChange={e => {
              setPeriod('');
              setFilters(f => ({ ...f, endDate: e.target.value }));
            }}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Department</label>
          <select style={styles.select} value={filters.department} onChange={e => setFilters(f => ({ ...f, department: e.target.value }))}>
            <option value="">All</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Staff ID</label>
          <input
            style={styles.input}
            placeholder="e.g. STF001"
            value={filters.staffId}
            onChange={e => setFilters(f => ({ ...f, staffId: e.target.value }))}
          />
        </div>
        <button style={styles.filterBtn} onClick={fetchReport}>
          <FiFilter size={14} /> Apply
        </button>
      </div>

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Date</th>
            <th style={styles.th}>Staff ID</th>
            <th style={styles.th}>Name</th>
            <th style={styles.th}>Department</th>
            <th style={styles.th}>Check In</th>
            <th style={styles.th}>Check Out</th>
            <th style={styles.th}>Method</th>
            <th style={styles.th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, idx) => {
            const isAbsent = !r.check_in_time;
            return (
              <tr key={r.id || `absent-${r.staff_id}-${idx}`}>
                <td style={styles.td}>{r.date ? new Date(r.date).toLocaleDateString() : '-'}</td>
                <td style={styles.td}><strong>{r.staff_id}</strong></td>
                <td style={styles.td}>{r.first_name} {r.last_name}</td>
                <td style={styles.td}>{r.department || '-'}</td>
                <td style={styles.td}>{isAbsent ? '-' : new Date(r.check_in_time).toLocaleTimeString()}</td>
                <td style={styles.td}>{isAbsent ? '-' : (r.check_out_time ? new Date(r.check_out_time).toLocaleTimeString() : '-')}</td>
                <td style={styles.td}>{r.check_in_method || '-'}</td>
                <td style={styles.td}>
                  {isAbsent
                    ? <span style={styles.absentBadge}>Absent</span>
                    : r.is_late
                      ? <span style={styles.lateBadge}>Late</span>
                      : <span style={styles.onTimeBadge}>On Time</span>}
                </td>
              </tr>
            );
          })}
          {records.length === 0 && (
            <tr><td colSpan={8} style={{ ...styles.td, textAlign: 'center', padding: '40px', color: '#95a5a6' }}>No records found</td></tr>
          )}
        </tbody>
      </table>

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
                <td style={styles.td}>{new Date(f.created_at).toLocaleString()}</td>
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
                <td style={styles.td}>{new Date(e.created_at).toLocaleString()}</td>
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
