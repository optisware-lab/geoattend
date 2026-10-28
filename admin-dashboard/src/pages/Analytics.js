import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { FiTrendingUp, FiUsers, FiClock, FiAlertTriangle } from 'react-icons/fi';
import { getAttendanceTrends, getTopAbsentees, getDepartmentAnalytics, getOvertimeSummary } from '../services/api';
import { formatDate } from '../utils/format';

const styles = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' },
  title: { fontSize: '24px', fontWeight: '700' },
  periodSelect: { padding: '8px 14px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#fff', fontSize: '14px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '20px' },
  card: {
    background: '#fff', borderRadius: '12px', padding: '20px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  cardTitle: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: '#2c3e50' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '600', color: '#7f8c8d', textTransform: 'uppercase', borderBottom: '2px solid #f0f0f0' },
  td: { padding: '10px 12px', fontSize: '13px', borderBottom: '1px solid #f5f5f5' },
  bar: (pct, color) => ({
    height: '8px', borderRadius: '4px', background: '#f0f0f0', position: 'relative', overflow: 'hidden',
  }),
  barFill: (pct, color) => ({
    position: 'absolute', top: 0, left: 0, height: '100%', width: `${Math.min(pct, 100)}%`,
    borderRadius: '4px', background: color, transition: 'width 0.5s ease',
  }),
  trendRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f5f5f5' },
};

export default function Analytics() {
  const [days, setDays] = useState(30);
  const [trends, setTrends] = useState([]);
  const [absentees, setAbsentees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [overtime, setOvertime] = useState([]);

  useEffect(() => {
    getAttendanceTrends({ days }).then(r => setTrends(r.data)).catch(() => toast.error('Failed to load trends'));
    getTopAbsentees({ days }).then(r => setAbsentees(r.data)).catch(() => {});
    getDepartmentAnalytics({ days }).then(r => setDepartments(r.data)).catch(() => {});
    getOvertimeSummary({ days }).then(r => setOvertime(r.data)).catch(() => {});
  }, [days]);

  const avgRate = trends.length > 0 ? Math.round(trends.reduce((s, t) => s + t.rate, 0) / trends.length) : 0;

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Analytics</h1>
        <select style={styles.periodSelect} value={days} onChange={e => setDays(parseInt(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={60}>Last 60 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {[
          { label: 'Avg Attendance Rate', value: `${avgRate}%`, color: '#27ae60', icon: FiTrendingUp },
          { label: 'Total Members', value: trends[0]?.total || 0, color: '#3498db', icon: FiUsers },
          { label: 'Overtime Incidents', value: overtime.reduce((s, o) => s + o.overtimeDays, 0), color: '#f39c12', icon: FiClock },
          { label: 'Frequent Absentees', value: absentees.filter(a => a.attendanceRate < 70).length, color: '#e74c3c', icon: FiAlertTriangle },
        ].map((s, i) => (
          <div key={i} style={{ flex: 1, minWidth: '160px', padding: '16px 20px', background: '#fff', borderRadius: '12px', borderLeft: `4px solid ${s.color}`, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <s.icon size={18} color={s.color} />
              <span style={{ fontSize: '12px', color: '#7f8c8d' }}>{s.label}</span>
            </div>
            <div style={{ fontSize: '28px', fontWeight: '700', color: s.color, marginTop: '4px' }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={styles.grid}>
        {/* Attendance Trends */}
        <div style={styles.card}>
          <div style={styles.cardTitle}><FiTrendingUp color="#3498db" /> Attendance Trend</div>
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {trends.slice(-14).map((t, i) => (
              <div key={i} style={styles.trendRow}>
                <span style={{ fontSize: '12px', color: '#7f8c8d', width: '104px', whiteSpace: 'nowrap' }}>{formatDate(t.date)}</span>
                <div style={{ flex: 1, margin: '0 12px' }}>
                  <div style={styles.bar(t.rate, '#27ae60')}>
                    <div style={styles.barFill(t.rate, '#27ae60')} />
                  </div>
                </div>
                <span style={{ fontSize: '13px', fontWeight: '600', color: t.rate >= 80 ? '#27ae60' : t.rate >= 60 ? '#f39c12' : '#e74c3c', width: '45px', textAlign: 'right' }}>{t.rate}%</span>
                <span style={{ fontSize: '11px', color: '#95a5a6', width: '60px', textAlign: 'right' }}>{t.present}/{t.total}</span>
              </div>
            ))}
            {trends.length === 0 && <p style={{ color: '#95a5a6', textAlign: 'center', padding: '20px' }}>No data available</p>}
          </div>
        </div>

        {/* Top Absentees */}
        <div style={styles.card}>
          <div style={styles.cardTitle}><FiAlertTriangle color="#e74c3c" /> Top Absentees</div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Member</th>
                <th style={styles.th}>Dept</th>
                <th style={styles.th}>Present</th>
                <th style={styles.th}>Absent</th>
                <th style={styles.th}>Rate</th>
              </tr>
            </thead>
            <tbody>
              {absentees.slice(0, 10).map(a => (
                <tr key={a.id}>
                  <td style={styles.td}>
                    <strong>{a.staff_id}</strong>
                    <div style={{ fontSize: '11px', color: '#7f8c8d' }}>{a.first_name} {a.last_name}</div>
                  </td>
                  <td style={styles.td}>{a.department || '-'}</td>
                  <td style={{ ...styles.td, color: '#27ae60', fontWeight: '600' }}>{a.daysPresent}</td>
                  <td style={{ ...styles.td, color: '#e74c3c', fontWeight: '600' }}>{a.daysAbsent}</td>
                  <td style={styles.td}>
                    <span style={{
                      padding: '3px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: '600',
                      background: a.attendanceRate >= 80 ? '#e8f5e9' : a.attendanceRate >= 60 ? '#fff8e1' : '#ffebee',
                      color: a.attendanceRate >= 80 ? '#27ae60' : a.attendanceRate >= 60 ? '#f39c12' : '#e74c3c',
                    }}>{a.attendanceRate}%</span>
                  </td>
                </tr>
              ))}
              {absentees.length === 0 && <tr><td colSpan={5} style={{ ...styles.td, textAlign: 'center', color: '#95a5a6' }}>No data</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Department Comparison */}
        <div style={styles.card}>
          <div style={styles.cardTitle}><FiUsers color="#8e44ad" /> Department Comparison</div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Department</th>
                <th style={styles.th}>Members</th>
                <th style={styles.th}>Check-ins</th>
                <th style={styles.th}>Late %</th>
                <th style={styles.th}>Avg Hours</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((d, i) => (
                <tr key={i}>
                  <td style={{ ...styles.td, fontWeight: '600' }}>{d.department}</td>
                  <td style={styles.td}>{d.totalMembers}</td>
                  <td style={styles.td}>{d.totalCheckins}</td>
                  <td style={styles.td}>
                    <span style={{ color: d.lateRate > 30 ? '#e74c3c' : d.lateRate > 15 ? '#f39c12' : '#27ae60', fontWeight: '600' }}>
                      {d.lateRate}%
                    </span>
                  </td>
                  <td style={styles.td}>{d.avgHours}h</td>
                </tr>
              ))}
              {departments.length === 0 && <tr><td colSpan={5} style={{ ...styles.td, textAlign: 'center', color: '#95a5a6' }}>No data</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Overtime Summary */}
        <div style={styles.card}>
          <div style={styles.cardTitle}><FiClock color="#f39c12" /> Overtime Summary</div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Member</th>
                <th style={styles.th}>Dept</th>
                <th style={styles.th}>Days</th>
                <th style={styles.th}>Total Hours</th>
                <th style={styles.th}>Avg/Day</th>
              </tr>
            </thead>
            <tbody>
              {overtime.map((o, i) => (
                <tr key={i}>
                  <td style={styles.td}>
                    <strong>{o.staff_id}</strong>
                    <div style={{ fontSize: '11px', color: '#7f8c8d' }}>{o.first_name} {o.last_name}</div>
                  </td>
                  <td style={styles.td}>{o.department || '-'}</td>
                  <td style={styles.td}>{o.overtimeDays}</td>
                  <td style={{ ...styles.td, fontWeight: '600', color: '#f39c12' }}>{o.totalOvertimeHours}h</td>
                  <td style={styles.td}>{o.avgOvertimeMinutes}m</td>
                </tr>
              ))}
              {overtime.length === 0 && <tr><td colSpan={5} style={{ ...styles.td, textAlign: 'center', color: '#95a5a6' }}>No overtime recorded</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
