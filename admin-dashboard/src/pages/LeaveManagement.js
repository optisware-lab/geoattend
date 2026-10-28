import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { FiCheck, FiX, FiCalendar, FiCheckCircle, FiInbox } from 'react-icons/fi';
import { getAllLeaves, getLeaveStats, reviewLeave } from '../services/api';
import { PageHeader, StatCard, Badge, EmptyState, Avatar } from '../components/ui';
import { formatDateRange, formatDate, daysInclusive, relativeDay, timeAgo } from '../utils/format';

const STATUS_TONE = { pending: 'orange', approved: 'green', rejected: 'red', cancelled: 'gray' };
const FILTERS = [
  { key: 'pending', label: 'Waiting for you' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: '', label: 'All' },
];

const overlay = { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };

function whenLabel(l) {
  const rel = relativeDay(l.start_date);
  if (rel === 'Today') return 'Starts today';
  if (rel === 'Tomorrow') return 'Starts tomorrow';
  return null;
}

export default function LeaveManagement() {
  const [leaves, setLeaves] = useState([]);
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0, on_leave_today: 0 });
  const [statusFilter, setStatusFilter] = useState('pending');
  const [rejectTarget, setRejectTarget] = useState(null);
  const [reviewNote, setReviewNote] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const fetchData = useCallback(() => {
    getAllLeaves({ status: statusFilter || undefined, limit: 200 })
      .then((r) => setLeaves(r.data.leaves || []))
      .catch(() => toast.error('Failed to load leave requests'))
      .finally(() => setLoaded(true));
    getLeaveStats().then((r) => setStats(r.data)).catch(() => {});
  }, [statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const decide = async (leave, status, note) => {
    setBusyId(leave.id);
    try {
      await reviewLeave(leave.id, { status, reviewNote: note || undefined });
      toast.success(`${leave.first_name || 'Leave'}'s request ${status}`);
      // Drop it from the list straight away so the next request is right there
      if (statusFilter === 'pending') setLeaves((prev) => prev.filter((x) => x.id !== leave.id));
      fetchData();
      return true;
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to review request');
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const confirmReject = async () => {
    if (await decide(rejectTarget, 'rejected', reviewNote)) {
      setRejectTarget(null);
      setReviewNote('');
    }
  };

  const pending = leaves.filter((l) => l.status === 'pending');

  const approveAll = async () => {
    if (!pending.length) return;
    if (!window.confirm(`Approve all ${pending.length} pending leave request(s)?`)) return;
    setBulkBusy(true);
    let ok = 0;
    for (const l of pending) {
      try {
        await reviewLeave(l.id, { status: 'approved' });
        ok += 1;
      } catch { /* reported below */ }
    }
    setBulkBusy(false);
    if (ok === pending.length) toast.success(`Approved ${ok} request(s)`);
    else toast.warn(`Approved ${ok} of ${pending.length}. Please check the rest.`);
    fetchData();
  };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      <PageHeader
        title="Leave Management"
        subtitle="Approve with one click. Reject asks for a short note so staff know why."
        actions={statusFilter === 'pending' && pending.length > 1 ? (
          <button type="button" className="ga-btn ga-btn-green" onClick={approveAll} disabled={bulkBusy}>
            <FiCheckCircle size={14} /> {bulkBusy ? 'Approving...' : `Approve all ${pending.length}`}
          </button>
        ) : null}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 18 }}>
        <StatCard label="Waiting" value={stats.pending} color="#f39c12" onClick={() => setStatusFilter('pending')} />
        <StatCard label="On leave today" value={stats.on_leave_today} color="#3498db" />
        <StatCard label="Approved" value={stats.approved} color="#27ae60" onClick={() => setStatusFilter('approved')} />
        <StatCard label="Rejected" value={stats.rejected} color="#e74c3c" onClick={() => setStatusFilter('rejected')} />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {FILTERS.map((f) => (
          <button key={f.key || 'all'} type="button" className={`ga-chip${statusFilter === f.key ? ' is-active' : ''}`} onClick={() => setStatusFilter(f.key)}>
            {f.label}
            {f.key === 'pending' && Number(stats.pending) > 0 && <span className="ga-chip-count">{stats.pending}</span>}
          </button>
        ))}
      </div>

      <div className="ga-card" style={{ overflow: 'hidden' }}>
        {loaded && leaves.length === 0 ? (
          <EmptyState
            icon={statusFilter === 'pending' ? FiCheckCircle : FiInbox}
            title={statusFilter === 'pending' ? "You're all caught up" : 'No leave requests here'}
            text={statusFilter === 'pending' ? 'New requests from staff will appear here.' : undefined}
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="ga-table">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Type</th>
                  <th>Dates</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {leaves.map((l) => {
                  const days = daysInclusive(l.start_date, l.end_date);
                  const soon = l.status === 'pending' ? whenLabel(l) : null;
                  return (
                    <tr key={l.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Avatar first={l.first_name} last={l.last_name} size={34} />
                          <div>
                            <div style={{ fontWeight: 600 }}>{l.first_name} {l.last_name}</div>
                            <div style={{ fontSize: 12, color: '#95a5a6' }}>{l.staff_id}{l.department ? ` · ${l.department}` : ''}</div>
                          </div>
                        </div>
                      </td>
                      <td><Badge tone="blue">{l.leave_type}</Badge></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <FiCalendar size={12} color="#7f8c8d" />
                          {formatDateRange(l.start_date, l.end_date)}
                        </div>
                        <div style={{ fontSize: 12, color: '#95a5a6', marginTop: 3 }}>
                          {days} day{days === 1 ? '' : 's'}
                          {soon && <span style={{ color: '#c0392b', fontWeight: 600 }}> · {soon}</span>}
                          {l.created_at && <> · asked {timeAgo(l.created_at)}</>}
                        </div>
                      </td>
                      <td style={{ maxWidth: 280, color: l.reason ? '#2c3e50' : '#95a5a6' }}>{l.reason || 'No reason given'}</td>
                      <td>
                        <Badge tone={STATUS_TONE[l.status]}>{l.status}</Badge>
                        {l.reviewer_first_name && (
                          <div style={{ fontSize: 11.5, color: '#95a5a6', marginTop: 4 }}>
                            by {l.reviewer_first_name} {l.reviewer_last_name}{l.reviewed_at ? `, ${formatDate(l.reviewed_at)}` : ''}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {l.status === 'pending' && (
                          <div style={{ display: 'inline-flex', gap: 6 }}>
                            <button type="button" className="ga-btn ga-btn-sm ga-btn-green" disabled={busyId === l.id || bulkBusy} onClick={() => decide(l, 'approved')}>
                              <FiCheck size={12} /> {busyId === l.id ? '...' : 'Approve'}
                            </button>
                            <button type="button" className="ga-btn ga-btn-sm ga-btn-red" disabled={busyId === l.id || bulkBusy} onClick={() => { setRejectTarget(l); setReviewNote(''); }}>
                              <FiX size={12} /> Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rejectTarget && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setRejectTarget(null); }}>
          <div className="ga-card" role="dialog" aria-modal="true" aria-labelledby="reject-title" style={{ padding: 24, width: 440, maxWidth: '100%' }}>
            <h3 id="reject-title" style={{ fontSize: 18, marginBottom: 10 }}>Reject leave request</h3>
            <p style={{ fontSize: 14, color: '#555', marginBottom: 4 }}>
              <strong>{rejectTarget.first_name} {rejectTarget.last_name}</strong> ({rejectTarget.staff_id})
            </p>
            <p style={{ fontSize: 13, color: '#7f8c8d', marginBottom: 14 }}>
              {rejectTarget.leave_type} leave · {formatDateRange(rejectTarget.start_date, rejectTarget.end_date)}
            </p>
            <label htmlFor="reject-note" style={{ fontSize: 13, fontWeight: 600, color: '#5d6d7e' }}>Note to staff (optional)</label>
            <textarea
              id="reject-note"
              className="ga-input"
              autoFocus
              placeholder="e.g. We are short-staffed that week. Please pick other dates."
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              style={{ width: '100%', minHeight: 84, resize: 'vertical', margin: '6px 0 16px' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="ga-btn" onClick={() => setRejectTarget(null)}>Cancel</button>
              <button type="button" className="ga-btn" style={{ background: '#e74c3c', color: '#fff', borderColor: '#e74c3c' }} onClick={confirmReject} disabled={busyId === rejectTarget.id}>
                {busyId === rejectTarget.id ? 'Rejecting...' : 'Reject request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
