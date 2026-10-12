import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { FiShield, FiFilter, FiClock } from 'react-icons/fi';
import { getAuditLogs, getSchedulerStatus } from '../services/api';

const actionLabels = {
  create_staff: 'Created Member',
  update_staff: 'Updated Member',
  delete_staff: 'Deleted Member',
  reset_password: 'Reset Password',
  bulk_import: 'Bulk Import',
  review_leave: 'Reviewed Leave',
  auto_suspend: 'Auto-Suspended',
};

const actionColors = {
  create_staff: '#27ae60',
  update_staff: '#3498db',
  delete_staff: '#e74c3c',
  reset_password: '#f39c12',
  bulk_import: '#8e44ad',
  review_leave: '#2980b9',
  auto_suspend: '#e67e22',
};

const styles = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' },
  title: { fontSize: '24px', fontWeight: '700' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px', alignItems: 'flex-start' },
  card: { background: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  filters: { display: 'flex', gap: '12px', marginBottom: '16px' },
  select: { padding: '8px 14px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#fff', fontSize: '14px' },
  logItem: { padding: '14px 0', borderBottom: '1px solid #f5f5f5' },
  logAction: (action) => ({
    display: 'inline-block', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '600',
    background: `${actionColors[action] || '#95a5a6'}15`, color: actionColors[action] || '#95a5a6',
  }),
  logMeta: { fontSize: '12px', color: '#95a5a6', marginTop: '4px' },
  scheduleItem: { padding: '12px 0', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
};

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [schedulerJobs, setSchedulerJobs] = useState([]);
  const [actionFilter, setActionFilter] = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 900);

  useEffect(() => {
    getAuditLogs({ action: actionFilter || undefined })
      .then(r => setLogs(r.data.logs))
      .catch(() => toast.error('Failed to load audit logs'));
    getSchedulerStatus()
      .then(r => setSchedulerJobs(r.data.jobs))
      .catch(() => {});
  }, [actionFilter]);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Audit Log & Automation</h1>
      </div>

      <div style={{
        ...styles.grid,
        gridTemplateColumns: isMobile ? '1fr' : '1fr 300px',
      }}>
        {/* Audit Logs */}
        <div style={styles.card}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FiShield color="#1a5276" /> Activity Log
          </h3>

          <div style={styles.filters}>
            <FiFilter size={16} color="#95a5a6" style={{ alignSelf: 'center' }} />
            <select style={styles.select} value={actionFilter} onChange={e => setActionFilter(e.target.value)}>
              <option value="">All Actions</option>
              <option value="create_staff">Created Member</option>
              <option value="update_staff">Updated Member</option>
              <option value="delete_staff">Deleted Member</option>
              <option value="reset_password">Reset Password</option>
              <option value="bulk_import">Bulk Import</option>
              <option value="review_leave">Reviewed Leave</option>
              <option value="auto_suspend">Auto-Suspended</option>
            </select>
          </div>

          <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
            {logs.map(log => (
              <div key={log.id} style={styles.logItem}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={styles.logAction(log.action)}>{actionLabels[log.action] || log.action}</span>
                  <span style={{ fontSize: '13px', fontWeight: '500', color: '#2c3e50' }}>
                    {log.entity_type}: {log.entity_id ? log.entity_id.slice(0, 8) + '...' : '-'}
                  </span>
                </div>
                <div style={styles.logMeta}>
                  By: {log.performer_first_name ? `${log.performer_first_name} ${log.performer_last_name}` : log.performed_by === 'system' ? 'System (Automated)' : 'Unknown'}
                  {' | '}
                  {new Date(log.created_at).toLocaleString()}
                  {log.ip_address && ` | IP: ${log.ip_address}`}
                </div>
                {log.details && (
                  <div style={{ fontSize: '12px', color: '#7f8c8d', marginTop: '4px', background: '#f8f9fa', padding: '6px 8px', borderRadius: '4px' }}>
                    {typeof log.details === 'string' ? log.details : JSON.stringify(log.details).slice(0, 200)}
                  </div>
                )}
              </div>
            ))}
            {logs.length === 0 && <p style={{ color: '#95a5a6', textAlign: 'center', padding: '40px' }}>No audit logs found</p>}
          </div>
        </div>

        {/* Scheduled Jobs */}
        <div>
          <div style={styles.card}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FiClock color="#f39c12" /> Scheduled Automations
            </h3>
            {schedulerJobs.map((job, i) => (
              <div key={i} style={styles.scheduleItem}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#2c3e50' }}>{job.name}</div>
                  <div style={{ fontSize: '11px', color: '#95a5a6' }}>{job.timezone}</div>
                </div>
                <div style={{ fontSize: '12px', color: '#3498db', fontWeight: '500' }}>{job.schedule}</div>
              </div>
            ))}
          </div>

          <div style={{ ...styles.card, marginTop: '20px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '14px', color: '#2c3e50' }}>Email Configuration</h3>
            <p style={{ fontSize: '12px', color: '#7f8c8d', margin: '0 0 8px' }}>
              To enable email notifications, set these environment variables:
            </p>
            <div style={{ background: '#f8f9fa', padding: '10px', borderRadius: '6px', fontSize: '11px', fontFamily: 'monospace', color: '#555' }}>
              SMTP_HOST=smtp.gmail.com<br/>
              SMTP_PORT=587<br/>
              SMTP_USER=your@email.com<br/>
              SMTP_PASS=your_app_password<br/>
              SMTP_FROM="GeoAttend" &lt;noreply@geoattend.app&gt;
            </div>
          </div>

          <div style={{ ...styles.card, marginTop: '20px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '14px', color: '#2c3e50' }}>SMS Configuration</h3>
            <p style={{ fontSize: '12px', color: '#7f8c8d', margin: '0 0 8px' }}>
              For SMS alerts (Ghana), set:
            </p>
            <div style={{ background: '#f8f9fa', padding: '10px', borderRadius: '6px', fontSize: '11px', fontFamily: 'monospace', color: '#555' }}>
              SMS_PROVIDER=arkesel<br/>
              SMS_API_KEY=your_api_key<br/>
              SMS_SENDER_ID=GeoAttend
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

