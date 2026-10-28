import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { requestLeave, getMyLeaves, cancelLeave } from '../services/api';
import { formatDateRange } from '../utils/format';

const styles = {
  container: { maxWidth: 860, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 700 },
  form: { background: '#fff', padding: 20, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 20 },
  row: { display: 'flex', gap: 12, marginBottom: 12 },
  input: { flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 14 },
  textarea: { width: '100%', padding: 10, borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 14, minHeight: 100 },
  btn: (bg) => ({ padding: '8px 16px', borderRadius: 8, background: bg, color: '#fff', border: 'none', cursor: 'pointer' }),
  table: { width: '100%', background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  th: { padding: '12px 14px', textAlign: 'left', fontSize: 12, color: '#7f8c8d', borderBottom: '1px solid #f0f0f0' },
  td: { padding: '12px 14px', fontSize: 13, borderBottom: '1px solid #f5f5f5' }
};

export default function RequestLeave() {
  const [leaveType, setLeaveType] = useState('personal');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [myLeaves, setMyLeaves] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchMyLeaves = () => {
    getMyLeaves().then(r => setMyLeaves(r.data)).catch(() => {});
  };

  useEffect(() => { fetchMyLeaves(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!startDate || !endDate) return toast.error('Start and end date required');
    setLoading(true);
    try {
      await requestLeave({ leaveType, startDate, endDate, reason });
      toast.success('Leave request submitted');
      setLeaveType('personal'); setStartDate(''); setEndDate(''); setReason('');
      fetchMyLeaves();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit leave');
    } finally { setLoading(false); }
  };

  const handleCancel = async (id) => {
    try {
      await cancelLeave(id);
      toast.success('Leave cancelled');
      fetchMyLeaves();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to cancel');
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Request Leave</h2>
      </div>

      <form style={styles.form} onSubmit={submit}>
        <div style={styles.row}>
          <select style={{...styles.input, maxWidth: 220}} value={leaveType} onChange={e => setLeaveType(e.target.value)}>
            <option value="personal">Personal</option>
            <option value="sick">Sick</option>
            <option value="vacation">Vacation</option>
          </select>
          <input style={styles.input} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <input style={styles.input} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <textarea style={styles.textarea} placeholder="Reason (optional)" value={reason} onChange={e => setReason(e.target.value)} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={() => { setLeaveType('personal'); setStartDate(''); setEndDate(''); setReason(''); }} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e0e0e0', background: '#fff' }}>Reset</button>
          <button type="submit" disabled={loading} style={styles.btn('#27ae60')}>{loading ? 'Submitting...' : 'Submit Request'}</button>
        </div>
      </form>

      <div style={{ marginTop: 8 }}>
        <h3 style={{ marginBottom: 8 }}>My Leave Requests</h3>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Dates</th>
              <th style={styles.th}>Type</th>
              <th style={styles.th}>Reason</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {myLeaves.map(l => (
              <tr key={l.id}>
                <td style={styles.td}>{formatDateRange(l.start_date, l.end_date)}</td>
                <td style={styles.td}>{l.leave_type}</td>
                <td style={styles.td}>{l.reason || '-'}</td>
                <td style={styles.td}>{l.status}</td>
                <td style={styles.td}>
                  {l.status === 'pending' && <button onClick={() => handleCancel(l.id)} style={{ ...styles.btn('#e74c3c') }}>Cancel</button>}
                </td>
              </tr>
            ))}
            {myLeaves.length === 0 && (
              <tr><td colSpan={5} style={{ ...styles.td, textAlign: 'center', padding: 20, color: '#95a5a6' }}>No leave requests found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
