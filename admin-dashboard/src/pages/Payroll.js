import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'react-toastify';
import { FiClock, FiDollarSign, FiAlertTriangle, FiDownload, FiRefreshCw } from 'react-icons/fi';
import api, { getPayrollSummary } from '../services/api';

const styles = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' },
  title: { fontSize: '24px', fontWeight: '700' },
  periodTabs: { display: 'flex', gap: '6px' },
  tab: (active) => ({
    padding: '8px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
    background: active ? '#1a5276' : '#f0f0f0', color: active ? '#fff' : '#7f8c8d',
    border: 'none', cursor: 'pointer',
  }),
  controls: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '20px' },
  input: { padding: '8px 12px', border: '1px solid #e0e0e0', borderRadius: '8px', fontSize: '13px' },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' },
  card: { background: '#fff', borderRadius: '12px', padding: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardLabel: { fontSize: '11px', fontWeight: '600', color: '#7f8c8d', textTransform: 'uppercase', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' },
  cardValue: { fontSize: '22px', fontWeight: '700', color: '#2c3e50' },
  banner: { display: 'flex', gap: '10px', alignItems: 'center', background: '#fdecea', border: '1px solid #f5c6cb', color: '#8e2f24', borderRadius: '10px', padding: '12px 16px', fontSize: '13px', marginBottom: '16px' },
  tableWrap: { background: '#fff', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '760px' },
  th: { textAlign: 'left', padding: '12px 14px', background: '#f7f9fa', color: '#5d6d7e', fontSize: '11px', textTransform: 'uppercase', borderBottom: '1px solid #e0e0e0', whiteSpace: 'nowrap' },
  td: { padding: '11px 14px', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' },
  flag: { display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '600', background: '#fdecea', color: '#c0392b' },
  muted: { color: '#95a5a6' },
  btn: {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    padding: '10px 20px', background: '#1a5276', color: '#fff',
    borderRadius: '8px', fontSize: '13px', fontWeight: '600', border: 'none', cursor: 'pointer',
  },
  btnSecondary: {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    padding: '10px 20px', background: '#fff', color: '#1a5276',
    borderRadius: '8px', fontSize: '13px', fontWeight: '600', border: '1px solid #e0e0e0', cursor: 'pointer',
  },
};

const periodLabels = { day: 'Day', week: 'Week', month: 'Month' };
const rangeFor = (period, date) => {
  const d = new Date(`${date}T00:00:00`);
  if (period === 'day') return [date, date];
  if (period === 'week') {
    const start = new Date(d);
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    start.setDate(d.getDate() - dow);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return [start.toISOString().split('T')[0], end.toISOString().split('T')[0]];
  }
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return [start.toISOString().split('T')[0], end.toISOString().split('T')[0]];
};

export default function Payroll() {
  const today = new Date().toISOString().split('T')[0];
  const [period, setPeriod] = useState('week');
  const [date, setDate] = useState(today);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async (opts = {}) => {
    setLoading(true);
    try {
      const params = { period: opts.period || period, date: opts.date || date };
      const { data: payload } = await getPayrollSummary(params);
      setData({ ...payload, range: rangeFor(params.period, params.date) });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load payroll');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const choosePeriod = (p) => {
    setPeriod(p);
    load({ period: p, date });
  };
  const chooseDate = (d) => {
    setDate(d);
    load({ period, date: d });
  };

  const downloadCsv = async () => {
    try {
      const res = await api.get('/payroll/summary.csv', {
        params: { period, date },
        responseType: 'blob',
        timeout: 60000,
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `payroll_${period}_${date}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download CSV');
    }
  };

  const paymentMode = data?.params?.paymentMode || 'monthly';
  const currency = data?.params?.currency || 'GHS';
  const multiplier = data?.params?.overtimeMultiplier || 1.5;

  const fmt = (value, suffix = '') => (value === null || value === undefined ? '—' : `${value}${suffix}`);

  const flagRows = useMemo(() => (data?.staff || []).filter(s => s.notReturned > 0).length, [data]);

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Payroll</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={styles.btnSecondary} onClick={() => load()} disabled={loading}>
            <FiRefreshCw size={14} /> {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button style={styles.btn} onClick={downloadCsv} disabled={loading}>
            <FiDownload size={14} /> Export CSV
          </button>
        </div>
      </div>

      <div style={styles.controls}>
        <div style={styles.periodTabs}>
          {['day', 'week', 'month'].map(p => (
            <button key={p} style={styles.tab(period === p)} onClick={() => choosePeriod(p)}>
              {periodLabels[p]}
            </button>
          ))}
        </div>
        <input style={styles.input} type="date" value={date} onChange={e => chooseDate(e.target.value)} />
        {data?.range && (
          <span style={{ fontSize: '12px', color: '#7f8c8d' }}>
            {data.range[0]} → {data.range[1]}
          </span>
        )}
      </div>

      {data && (
        <p style={{ fontSize: '12px', color: '#95a5a6', marginBottom: '16px' }}>
          {data.params?.institutionName} — payment mode: <strong>{paymentMode}</strong>
          {' '}({paymentMode === 'hourly' ? `earnings auto-calculated at each staff member's hourly rate, overtime × ${multiplier}` : 'earnings not calculated — hours tracked for reference'})
        </p>
      )}

      <div style={styles.cards}>
        <div style={styles.card}>
          <div style={styles.cardLabel}><FiClock size={12} /> Total Hours</div>
          <div style={styles.cardValue}>{fmt(data?.totals?.hours, '')}</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardLabel}><FiClock size={12} /> Overtime Hours</div>
          <div style={styles.cardValue}>{fmt(data?.totals?.overtimeHours, '')}</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardLabel}><FiClock size={12} /> Away Minutes</div>
          <div style={styles.cardValue}>{fmt(data?.totals?.awayMinutes, '')}</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardLabel}><FiAlertTriangle size={12} /> Never Returned</div>
          <div style={styles.cardValue}>{fmt(data?.totals?.flaggedCount, '')}</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardLabel}><FiDollarSign size={12} /> {paymentMode === 'hourly' ? `Earnings (${currency})` : 'Earnings'}</div>
          <div style={styles.cardValue}>{paymentMode === 'hourly' ? fmt(data?.totals?.earnings) : 'Monthly'}</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardLabel}>Overtime Multiplier</div>
          <div style={styles.cardValue}>{multiplier}</div>
        </div>
      </div>

      {flagRows > 0 && (
        <div style={styles.banner}>
          <FiAlertTriangle />
          <span>
            {flagRows} staff member{flagRows > 1 ? 's' : ''} checked in but left the premises without returning — review the
            highlighted rows before paying their hours.
          </span>
        </div>
      )}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Staff ID</th>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Department</th>
              <th style={styles.th}>Days</th>
              <th style={styles.th}>Hours</th>
              <th style={styles.th}>Overtime (h)</th>
              <th style={styles.th}>Away (min)</th>
              <th style={styles.th}>Flag</th>
              <th style={styles.th}>Rate</th>
              {paymentMode === 'hourly' && <th style={styles.th}>{`Earnings (${currency})`}</th>}
            </tr>
          </thead>
          <tbody>
            {(data?.staff || []).length === 0 ? (
              <tr><td style={{ ...styles.td, ...styles.muted, textAlign: 'center' }} colSpan={paymentMode === 'hourly' ? 10 : 9}>No attendance data for this period</td></tr>
            ) : (
              (data?.staff || []).map(s => (
                <tr key={s.id} style={s.notReturned > 0 ? { background: '#fdf3f2' } : undefined}>
                  <td style={styles.td}>{s.staff_id}</td>
                  <td style={styles.td}>{s.first_name} {s.last_name}</td>
                  <td style={styles.td}>{s.department || <span style={styles.muted}>—</span>}</td>
                  <td style={styles.td}>{s.days_worked ?? 0}</td>
                  <td style={styles.td}>{s.hoursWorked ?? 0}</td>
                  <td style={styles.td}>{s.overtimeHours ?? 0}</td>
                  <td style={styles.td}>{s.away_minutes ? Math.round(parseFloat(s.away_minutes)) : 0}</td>
                  <td style={styles.td}>
                    {s.notReturned > 0 ? <span style={styles.flag}>Left premises</span> : <span style={styles.muted}>OK</span>}
                  </td>
                  <td style={styles.td}>{s.hourlyRate !== null && s.hourlyRate !== undefined ? s.hourlyRate : <span style={styles.muted}>{paymentMode === 'hourly' ? 'Not set' : '—'}</span>}</td>
                  {paymentMode === 'hourly' && (
                    <td style={{ ...styles.td, fontWeight: '600' }}>
                      {s.earnings !== null && s.earnings !== undefined ? s.earnings : <span style={{ ...styles.muted, fontWeight: '400' }}>Set rate</span>}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
