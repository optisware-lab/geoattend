import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { authSession } from '../services/api';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FiDownload, FiFileText, FiFilter, FiAlertTriangle, FiShare2, FiPrinter, FiCalendar } from 'react-icons/fi';
import {
  API_BASE_URL, getAttendanceReport, getDepartments, getFraudReport, getGeofenceEvents, getWeeklyBreakdown,
  getAbsenceReport, getInstitution, updateTerm,
} from '../services/api';
import { PageHeader, Badge } from '../components/ui';
import WeekByWeek from '../components/WeekByWeek';
import AbsenceReport from '../components/AbsenceReport';
import DateField from '../components/DateField';
import { formatDate, formatDateTime, formatDateRange, formatDay, formatTime, formatDuration, daysInclusive, toInputDate } from '../utils/format';

// Longest period a report can cover (the server enforces the same limit)
const MAX_RANGE_DAYS = 366;

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

function periodRange(period, term) {
  const today = new Date();
  const start = new Date(today);
  const end = new Date(today);
  const sinceMonday = (today.getDay() + 6) % 7; // weeks run Monday to Sunday

  switch (period) {
    case 'this_term':
      return term?.start ? { startDate: term.start, endDate: term.end } : null;
    case 'last_3_months': {
      const from = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate() + 1);
      return { startDate: toDateStr(from), endDate: toDateStr(end) };
    }
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
      start.setDate(start.getDate() - sinceMonday);
      break;
    case 'last_week':
      start.setDate(start.getDate() - sinceMonday - 7);
      end.setDate(end.getDate() - sinceMonday - 1);
      break;
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
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This week' },
  { value: 'last_week', label: 'Last week' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_3_months', label: 'Last 3 months' },
  { value: 'this_term', label: 'This term' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'this_year', label: 'This year' },
  { value: '', label: 'All time' },
];

const VIEWS = [
  { key: 'absence', label: 'Absence report' },
  { key: 'attendance', label: 'Attendance and sign-ins' },
];

/** Why these dates can't be used, or null when they are fine */
function rangeProblem(startDate, endDate) {
  if (startDate && endDate && endDate < startDate) return 'The "To" date is before the "From" date.';
  if (startDate) {
    const days = daysInclusive(startDate, endDate || toInputDate());
    if (days > MAX_RANGE_DAYS) return `A report can cover up to one year. This period is ${days} days; please shorten it.`;
  }
  return null;
}

function cleanParams(f) {
  const params = {};
  Object.entries(f).forEach(([k, v]) => { if (v && String(v).trim()) params[k] = String(v).trim(); });
  return params;
}

// The absence report always needs both ends of the period
function absenceParams(f) {
  return { ...cleanParams(f), endDate: f.endDate || toInputDate() };
}

function savedView() {
  try { return localStorage.getItem('reports.view'); } catch { return null; }
}

async function errorMessage(res) {
  try {
    const body = await res.json();
    if (body?.error) return body.error;
  } catch { /* not JSON */ }
  return 'Export failed. Please try again.';
}

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
  const initialPeriod = PERIOD_OPTIONS.some((o) => o.value === requested) && requested && requested !== 'this_term' ? requested : 'this_month';
  const initialRange = periodRange(initialPeriod) || { startDate: '', endDate: '' };
  // ?view= wins; a link with ?period= (e.g. "Today's report") opens sign-ins;
  // otherwise the view used last time
  const [view, setViewState] = useState(() => {
    const v = searchParams.get('view') || (requested ? 'attendance' : savedView());
    return VIEWS.some((o) => o.key === v) ? v : 'absence';
  });
  const setView = (v) => {
    setViewState(v);
    try { localStorage.setItem('reports.view', v); } catch { /* not saved */ }
  };
  const [absence, setAbsence] = useState(null);
  const [absenceLoading, setAbsenceLoading] = useState(false);
  const [minAbsent, setMinAbsent] = useState(1);
  const [term, setTerm] = useState(null); // { name, start, end } saved by the admin
  const [termForm, setTermForm] = useState(null); // open editor: { name, start, end }
  const [savingTerm, setSavingTerm] = useState(false);

  const [records, setRecords] = useState([]);
  const [fraudEvents, setFraudEvents] = useState([]);
  const [geofenceEvents, setGeofenceEvents] = useState([]);
  const [weekly, setWeekly] = useState(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [filters, setFilters] = useState({ ...initialRange, department: '', staffId: '' });
  const [period, setPeriod] = useState(initialPeriod);
  const [statusView, setStatusView] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState('');

  useEffect(() => {
    getDepartments().then(r => setDepartments(r.data)).catch(() => {});
    getInstitution()
      .then((r) => {
        const i = r.data || {};
        if (i.term_start && i.term_end) setTerm({ name: i.term_name || 'This term', start: i.term_start, end: i.term_end });
      })
      .catch(() => {});
  }, []);

  const problem = rangeProblem(filters.startDate, filters.endDate);

  const fetchAbsence = useCallback((f) => {
    setAbsenceLoading(true);
    getAbsenceReport(absenceParams(f))
      .then((r) => setAbsence(r.data))
      .catch((err) => {
        setAbsence(null);
        toast.error(err.response?.data?.error || 'Failed to load the absence report');
      })
      .finally(() => setAbsenceLoading(false));
  }, []);

  const fetchReport = useCallback((f) => {
    const params = cleanParams(f);
    setLoading(true);
    getAttendanceReport(params)
      .then(r => setRecords(r.data.records || []))
      .catch(() => toast.error('Failed to load report'))
      .finally(() => setLoading(false));

    setWeeklyLoading(true);
    getWeeklyBreakdown(params)
      .then(r => setWeekly(r.data))
      .catch(() => setWeekly(null))
      .finally(() => setWeeklyLoading(false));

    getFraudReport(params)
      .then(r => setFraudEvents(r.data.events || []))
      .catch(() => {});

    getGeofenceEvents({ ...params, onlyExits: true })
      .then(r => setGeofenceEvents(r.data.events || []))
      .catch(() => {});
  }, []);

  // Filters apply by themselves; typing a staff ID waits until you pause.
  // Only the open view is loaded.
  const firstRun = useRef(true);
  const needsDates = view === 'absence' && !filters.startDate;
  useEffect(() => {
    if (problem || needsDates) return undefined;
    const delay = firstRun.current ? 0 : 400;
    firstRun.current = false;
    const id = setTimeout(() => (view === 'absence' ? fetchAbsence(filters) : fetchReport(filters)), delay);
    return () => clearTimeout(id);
  }, [filters, view, problem, needsDates, fetchReport, fetchAbsence]);

  const handlePeriodChange = (value) => {
    if (value === 'this_term' && !term) {
      // No term saved yet: ask for its dates first
      setTermForm({ name: '', start: filters.startDate, end: filters.endDate });
      return;
    }
    setPeriod(value);
    const range = periodRange(value, term);
    setFilters(f => ({ ...f, startDate: range ? range.startDate : '', endDate: range ? range.endDate : '' }));
  };

  const saveTerm = async () => {
    const { name, start, end } = termForm;
    if (!start || !end) { toast.error('Enter the first and last day of the term.'); return; }
    if (end < start) { toast.error('The term ends before it starts.'); return; }
    setSavingTerm(true);
    try {
      const r = await updateTerm({ name: name.trim(), startDate: start, endDate: end });
      const saved = { name: r.data.term_name, start: r.data.term_start, end: r.data.term_end };
      setTerm(saved);
      setTermForm(null);
      setPeriod('this_term');
      setFilters(f => ({ ...f, startDate: saved.start, endDate: saved.end }));
      toast.success('Term dates saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save the term dates');
    } finally {
      setSavingTerm(false);
    }
  };

  const clearTerm = async () => {
    setSavingTerm(true);
    try {
      await updateTerm({ clear: true });
      setTerm(null);
      setTermForm(null);
      if (period === 'this_term') setPeriod('');
      toast.success('Term dates removed');
    } catch {
      toast.error('Could not remove the term dates');
    } finally {
      setSavingTerm(false);
    }
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

  const blocked = problem || (needsDates ? 'Pick a period (for example This month or This term) to see who was absent.' : null);

  // Downloads the open report as PDF or Excel; 'print' opens the PDF in a
  // new tab, where the browser's print button prints it
  const handleExport = async (format) => {
    if (blocked) { toast.error(blocked); return; }
    const isAbsence = view === 'absence';
    const pdf = format !== 'excel';
    const params = new URLSearchParams(isAbsence ? absenceParams(filters) : cleanParams(filters));
    if (isAbsence && minAbsent) params.append('minAbsent', String(minAbsent));
    const path = isAbsence ? `absence/${pdf ? 'pdf' : 'excel'}` : (pdf ? 'pdf' : 'excel');
    const printTab = format === 'print' ? window.open('', '_blank') : null;
    setExporting(format);
    try {
      const token = authSession.token();
      const res = await fetch(`${API_BASE_URL}/reports/export/${path}?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(await errorMessage(res));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (printTab) {
        printTab.location.href = url;
      } else {
        const link = document.createElement('a');
        link.href = url;
        const span = filters.startDate ? `${filters.startDate}_to_${params.get('endDate') || filters.startDate}` : 'all-time';
        link.download = `${isAbsence ? 'absence' : 'attendance'}_${span}.${pdf ? 'pdf' : 'xlsx'}`;
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      if (printTab) printTab.close();
      toast.error(err.message || 'Export failed. Please try again.');
    } finally {
      setExporting('');
    }
  };

  const handleWhatsAppShare = () => {
    const where = `${rangeLabel}${filters.department ? ` · ${filters.department}` : ''}`;
    let lines;
    if (view === 'absence' && absence) {
      const t = absence.totals;
      const top = absence.people.filter((p) => p.missed > 0).slice(0, 10);
      lines = [
        'GeoAttend absence report',
        where,
        `${t.withAbsences} of ${t.staffCount} staff absent at least once · ${t.absent} absent work days · ${t.late} late sign-ins`,
        ...(top.length ? ['', 'Most absent:', ...top.map((p) => `${p.name}: ${p.missed} day${p.missed === 1 ? '' : 's'}`)] : []),
      ];
    } else {
      lines = [
        'GeoAttend attendance report',
        where,
        `On time: ${counts.ontime} · Late: ${counts.late} · Absent: ${counts.absent}`,
        `Total records: ${counts['']}`,
      ];
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`, '_blank', 'noopener');
  };

  const busy = view === 'absence' ? absenceLoading : loading;

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      <PageHeader
        title="Attendance Reports"
        subtitle={<>Showing <strong>{rangeLabel}</strong>{busy ? ' · loading...' : ''}</>}
        actions={(
          <>
            <button type="button" className="ga-btn" style={{ color: '#128C7E' }} onClick={handleWhatsAppShare}>
              <FiShare2 size={14} /> WhatsApp
            </button>
            <button type="button" className="ga-btn" onClick={() => handleExport('print')} disabled={!!exporting}>
              <FiPrinter size={14} /> {exporting === 'print' ? 'Preparing...' : 'Print'}
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

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }} role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            className={`ga-chip${view === v.key ? ' is-active' : ''}`}
            style={{ fontSize: 13.5, padding: '8px 16px' }}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div style={styles.filters}>
        <div style={styles.field}>
          <label style={styles.label} htmlFor="rep-period">Period</label>
          <select id="rep-period" style={styles.select} value={period} onChange={e => handlePeriodChange(e.target.value)}>
            {PERIOD_OPTIONS.map(o => (
              <option key={o.value || 'all'} value={o.value}>
                {o.value === '' && (filters.startDate || filters.endDate) ? 'Custom dates'
                  : o.value === 'this_term' ? (term ? `This term (${term.name})` : 'This term (set its dates)')
                    : o.label}
              </option>
            ))}
          </select>
        </div>
        <div style={styles.field}>
          <label style={styles.label} htmlFor="rep-start">From</label>
          <DateField
            id="rep-start"
            value={filters.startDate}
            max={filters.endDate || undefined}
            placeholder="Start date"
            onChange={v => { setPeriod(''); setFilters(f => ({ ...f, startDate: v })); }}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label} htmlFor="rep-end">To</label>
          <DateField
            id="rep-end"
            value={filters.endDate}
            min={filters.startDate || undefined}
            placeholder="End date"
            onChange={v => { setPeriod(''); setFilters(f => ({ ...f, endDate: v })); }}
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
        <div style={{ ...styles.field, justifyContent: 'flex-end', gap: 6 }}>
          <button
            type="button"
            className="ga-btn ga-btn-sm"
            onClick={() => setTermForm(term ? { ...term } : { name: '', start: filters.startDate, end: filters.endDate })}
          >
            <FiCalendar size={12} /> {term ? 'Change term dates' : 'Set term dates'}
          </button>
          <span style={{ fontSize: 12, color: '#95a5a6', display: 'inline-flex', alignItems: 'center', gap: 6, paddingBottom: 4 }}>
            <FiFilter size={12} /> Updates as you change filters
          </span>
        </div>
      </div>

      {termForm && (
        <div className="ga-card" style={{ padding: 16, marginBottom: 14, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flexBasis: '100%', fontSize: 13, color: '#5d6d7e' }}>
            Save the current term's dates once, then pick <strong>This term</strong> under Period to report on the whole term.
          </div>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="term-name">Term name</label>
            <input id="term-name" style={styles.input} placeholder="e.g. First term 2026/27" maxLength={60}
              value={termForm.name} onChange={e => setTermForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="term-start">First day</label>
            <DateField id="term-start" value={termForm.start || ''} placeholder="First day"
              onChange={v => setTermForm(f => ({ ...f, start: v }))} />
          </div>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="term-end">Last day</label>
            <DateField id="term-end" value={termForm.end || ''} min={termForm.start || undefined} placeholder="Last day"
              onChange={v => setTermForm(f => ({ ...f, end: v }))} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="ga-btn ga-btn-primary" onClick={saveTerm} disabled={savingTerm}>
              {savingTerm ? 'Saving...' : 'Save term'}
            </button>
            <button type="button" className="ga-btn" onClick={() => setTermForm(null)} disabled={savingTerm}>Cancel</button>
            {term && (
              <button type="button" className="ga-btn ga-btn-red" onClick={clearTerm} disabled={savingTerm}>Remove</button>
            )}
          </div>
          {term && (
            <div style={{ flexBasis: '100%', fontSize: 12, color: '#95a5a6' }}>
              Saved now: {term.name}, {formatDay(term.start)} to {formatDay(term.end)}
            </div>
          )}
        </div>
      )}

      {problem && (
        <div className="ga-card" style={{ padding: '12px 16px', marginBottom: 14, color: '#c0392b', background: '#fdecea', fontSize: 13.5 }}>
          {problem}
        </div>
      )}

      {view === 'absence' && !problem && (
        <AbsenceReport
          data={absence}
          loading={absenceLoading}
          message={blocked}
          minAbsent={minAbsent}
          onMinAbsentChange={setMinAbsent}
        />
      )}

      {view === 'attendance' && (
      <>
      <WeekByWeek data={weekly} loading={weeklyLoading} />

      <h2 style={{ fontSize: 16, margin: '8px 0 10px', color: '#2c3e50' }}>Sign-in records</h2>
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
              <th>Sign in</th>
              <th>Sign out</th>
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
      </>
      )}
    </div>
  );
}
