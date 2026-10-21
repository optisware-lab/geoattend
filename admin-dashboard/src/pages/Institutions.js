import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'react-toastify';
import { FiSearch, FiMapPin, FiUsers, FiCopy, FiEye, FiEyeOff, FiRefreshCw, FiLock, FiTrash2, FiShield } from 'react-icons/fi';
import { getAllInstitutions, getInstitutionAdminCredentials, createInstitutionAdminCredentials, deleteInstitution } from '../services/api';

const styles = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  title: { fontSize: '24px', fontWeight: '700' },
  searchBox: {
    display: 'flex', alignItems: 'center', gap: '8px',
    background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px',
    padding: '8px 14px', width: '320px', marginBottom: '16px',
  },
  searchInput: { border: 'none', flex: 1, fontSize: '14px', outline: 'none' },
  table: { width: '100%', background: '#fff', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', borderCollapse: 'collapse' },
  th: { padding: '14px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#7f8c8d', textTransform: 'uppercase', borderBottom: '2px solid #f0f0f0' },
  td: { padding: '14px 16px', fontSize: '13px', borderBottom: '1px solid #f5f5f5', verticalAlign: 'top' },
  code: { fontFamily: 'monospace', fontSize: '12px', background: '#f6f8fa', padding: '2px 6px', borderRadius: '4px' },
  badge: (color, bg) => ({
    padding: '3px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '600', color, background: bg,
    display: 'inline-block', textTransform: 'capitalize',
  }),
  copyBtn: { background: 'none', color: '#7f8c8d', padding: '2px', marginLeft: '4px', verticalAlign: 'middle', cursor: 'pointer', border: 'none' },
  credsBox: { background: '#f6f8fa', borderRadius: '8px', padding: '8px 10px', minWidth: '160px' },
  credsLabel: { fontSize: '11px', color: '#7f8c8d', textTransform: 'uppercase', letterSpacing: '0.3px' },
  credsValue: { fontFamily: 'monospace', fontSize: '13px', fontWeight: '600', color: '#2c3e50' },
  actionBtn: {
    marginTop: '8px', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
    border: '1px solid #d0d0d0', background: '#fff', color: '#1a5276', cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: '5px',
  },
  resetBtn: { color: '#e74c3c', borderColor: '#f5c6cb' },
  revealBtn: { background: 'none', border: 'none', color: '#7f8c8d', cursor: 'pointer', padding: '2px 4px', verticalAlign: 'middle' },
  empty: { textAlign: 'center', padding: '40px', color: '#95a5a6' },
  deleteRowBtn: {
    padding: '6px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
    border: '1px solid #f5c6cb', background: '#fff', color: '#e74c3c', cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: '5px',
  },
  modalOverlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: '#fff', borderRadius: '12px', padding: '24px',
    width: '440px', maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  confirmInput: {
    width: '100%', padding: '10px 12px', border: '1px solid #e0e0e0', borderRadius: '8px',
    fontSize: '14px', fontFamily: 'monospace', margin: '6px 0 20px', boxSizing: 'border-box',
  },
  cancelBtn: {
    padding: '8px 20px', borderRadius: '6px', fontSize: '14px',
    background: '#f0f0f0', color: '#333', border: 'none', cursor: 'pointer',
  },
  deleteBtn: {
    padding: '8px 20px', borderRadius: '6px', fontSize: '14px',
    background: '#e74c3c', color: '#fff', border: 'none', cursor: 'pointer',
  },
};

const SUBSCRIPTION_COLORS = {
  trialing: { color: '#f39c12', bg: '#fff8e1' },
  active: { color: '#27ae60', bg: '#e8f5e9' },
  past_due: { color: '#e74c3c', bg: '#ffebee' },
  cancelled: { color: '#7f8c8d', bg: '#f0f0f0' },
};

function daysRemaining(dateStr) {
  if (!dateStr) return null;
  const ms = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export default function Institutions() {
  const [institutions, setInstitutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [creds, setCreds] = useState({});
  const [resettingId, setResettingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    getAllInstitutions()
      .then(r => setInstitutions(r.data))
      .catch(() => toast.error('Failed to load institutions'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return institutions;
    return institutions.filter(i =>
      (i.name || '').toLowerCase().includes(q) ||
      (i.institution_code || '').toLowerCase().includes(q) ||
      (i.city || '').toLowerCase().includes(q) ||
      (i.region || '').toLowerCase().includes(q)
    );
  }, [institutions, search]);

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard');
    } catch {
      toast.info(text);
    }
  };

  const showCredentials = async (id) => {
    setCreds(prev => ({ ...prev, [id]: { ...prev[id], loading: true } }));
    try {
      const { data } = await getInstitutionAdminCredentials(id);
      setCreds(prev => ({
        ...prev,
        [id]: {
          loaded: true,
          staffId: data.credentials.staffId,
          password: data.credentials.password,
          passwordUnavailable: Boolean(data.credentials.passwordUnavailable),
          revealed: true,
          loading: false,
        },
      }));
      if (data.credentials.passwordUnavailable) {
        toast.warn('Stored password unreadable with the current server key — use Generate Credentials to replace it');
      }
    } catch (err) {
      if (err.response?.status === 404) {
        setCreds(prev => ({ ...prev, [id]: { loaded: true, missing: true, loading: false } }));
      } else {
        setCreds(prev => ({ ...prev, [id]: { loaded: false, loading: false, error: err.response?.data?.error || 'Failed to load' } }));
        toast.error(err.response?.data?.error || 'Failed to load admin credentials');
      }
    }
  };

  const generateCredentials = async (id) => {
    setResettingId(id);
    try {
      const { data } = await createInstitutionAdminCredentials(id);
      setCreds(prev => ({
        ...prev,
        [id]: { loaded: true, staffId: data.credentials.staffId, password: data.credentials.password, revealed: true, loading: false },
      }));
      toast.success(data.message || 'Admin credentials generated');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to generate admin credentials');
    } finally {
      setResettingId(null);
    }
  };

  // Codes are unique but names repeat (e.g. several "Rising Soul"), so confirm with the code
  const confirmValue = (inst) => inst.institution_code || inst.name;

  const openDelete = (inst) => {
    setDeleteTarget(inst);
    setConfirmText('');
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteInstitution(deleteTarget.id);
      setInstitutions(prev => prev.filter(i => i.id !== deleteTarget.id));
      toast.success(`${deleteTarget.name} deleted`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete institution');
    } finally {
      setDeleting(false);
    }
  };

  const toggleReveal = (id) => {
    setCreds(prev => ({ ...prev, [id]: { ...prev[id], revealed: !prev[id].revealed } }));
  };

  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Institution code copied');
    } catch {
      toast.info(`Code: ${code}`);
    }
  };

  const renderCredentialsCell = (inst) => {
    const c = creds[inst.id];

    if (c?.loading) {
      return <div style={{ color: '#95a5a6', fontSize: '12px' }}>Loading...</div>;
    }

    if (c?.loaded) {
      if (c.missing) {
        return (
          <div style={styles.credsBox}>
            <div style={{ fontSize: '12px', color: '#856404', background: '#fff3cd', borderRadius: '4px', padding: '4px 8px', marginBottom: '6px' }}>
              No credentials stored
            </div>
            <button style={styles.actionBtn} onClick={() => generateCredentials(inst.id)} disabled={resettingId === inst.id}>
              <FiLock size={12} /> {resettingId === inst.id ? 'Generating...' : 'Generate Credentials'}
            </button>
          </div>
        );
      }

      return (
        <div style={styles.credsBox}>
          <div>
            <span style={styles.credsLabel}>Admin ID</span>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={styles.credsValue}>{c.staffId}</span>
              <button style={styles.copyBtn} title="Copy Admin ID" onClick={() => copyText(c.staffId)}><FiCopy size={12} /></button>
            </div>
          </div>
          <div style={{ marginTop: '4px' }}>
            <span style={styles.credsLabel}>Password</span>
            {c.passwordUnavailable ? (
              <div style={{ fontSize: '12px', color: '#856404', background: '#fff3cd', borderRadius: '4px', padding: '4px 8px', marginTop: '2px' }}>
                Cannot be decrypted with this server's key — generate new credentials to replace it
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={styles.credsValue}>{c.revealed ? c.password : '••••••••'}</span>
                <button style={styles.revealBtn} title={c.revealed ? 'Hide' : 'Show'} onClick={() => toggleReveal(inst.id)}>
                  {c.revealed ? <FiEyeOff size={13} /> : <FiEye size={13} />}
                </button>
                <button style={styles.copyBtn} title="Copy Password" onClick={() => copyText(c.password)}><FiCopy size={12} /></button>
              </div>
            )}
          </div>
          <button style={{ ...styles.actionBtn, ...styles.resetBtn }} onClick={() => generateCredentials(inst.id)} disabled={resettingId === inst.id}>
            <FiRefreshCw size={12} /> {resettingId === inst.id ? 'Resetting...' : 'Reset Password'}
          </button>
        </div>
      );
    }

    return (
      <button style={styles.actionBtn} onClick={() => showCredentials(inst.id)}>
        <FiLock size={12} /> Show Credentials
      </button>
    );
  };

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>All Institutions ({institutions.length})</h1>
      </div>

      <div style={styles.searchBox}>
        <FiSearch size={16} color="#95a5a6" />
        <input
          style={styles.searchInput}
          placeholder="Search by name, code, city or region..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Institution</th>
            <th style={styles.th}>Code</th>
            <th style={styles.th}>Location</th>
            <th style={styles.th}>Geofence</th>
            <th style={styles.th}>Members</th>
            <th style={styles.th}>Admin Credentials</th>
            <th style={styles.th}>Subscription</th>
            <th style={styles.th}>Created</th>
            <th style={styles.th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(inst => {
            const subColor = SUBSCRIPTION_COLORS[inst.subscription_status] || SUBSCRIPTION_COLORS.cancelled;
            const remaining = inst.subscription_status === 'trialing'
              ? daysRemaining(inst.subscription_trial_end)
              : inst.subscription_status === 'active'
                ? daysRemaining(inst.subscription_period_end)
                : null;

            return (
              <tr key={inst.id}>
                <td style={styles.td}>
                  <strong>{inst.name}</strong>
                  {(inst.city || inst.region) && (
                    <div style={{ color: '#95a5a6', fontSize: '12px', marginTop: '2px' }}>
                      <FiMapPin size={11} /> {[inst.city, inst.region].filter(Boolean).join(', ')}
                    </div>
                  )}
                </td>
                <td style={styles.td}>
                  <span style={styles.code}>{inst.institution_code || 'N/A'}</span>
                  {inst.institution_code && (
                    <button style={styles.copyBtn} title="Copy code" onClick={() => copyCode(inst.institution_code)}>
                      <FiCopy size={12} />
                    </button>
                  )}
                </td>
                <td style={styles.td}>
                  {inst.address || '-'}
                  {(inst.latitude && inst.longitude) && (
                    <div style={{ color: '#95a5a6', fontSize: '11px', marginTop: '2px' }}>
                      {Number(inst.latitude).toFixed(5)}, {Number(inst.longitude).toFixed(5)}
                    </div>
                  )}
                </td>
                <td style={styles.td}>{inst.geofence_radius ? `${inst.geofence_radius}m` : '-'}</td>
                <td style={styles.td}>
                  <div><FiUsers size={12} /> {inst.staff_count} total</div>
                  <div style={{ color: '#95a5a6', fontSize: '11px', marginTop: '2px' }}>
                    {inst.active_staff_count} active · {inst.admin_count} admin(s)
                  </div>
                </td>
                <td style={styles.td}>{renderCredentialsCell(inst)}</td>
                <td style={styles.td}>
                  <span style={styles.badge(subColor.color, subColor.bg)}>
                    {(inst.subscription_status || 'none').replace('_', ' ')}
                  </span>
                  {remaining !== null && (
                    <div style={{ color: '#95a5a6', fontSize: '11px', marginTop: '4px' }}>
                      {remaining} day(s) left
                    </div>
                  )}
                </td>
                <td style={styles.td}>{inst.created_at ? new Date(inst.created_at).toLocaleDateString() : '-'}</td>
                <td style={styles.td}>
                  {Number(inst.super_admin_count) > 0 ? (
                    <span style={{ color: '#95a5a6', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }} title="Holds the super admin account">
                      <FiShield size={12} /> Protected
                    </span>
                  ) : (
                    <button style={styles.deleteRowBtn} onClick={() => openDelete(inst)}>
                      <FiTrash2 size={12} /> Delete
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {!loading && filtered.length === 0 && (
            <tr><td colSpan={9} style={styles.empty}>No institutions found</td></tr>
          )}
        </tbody>
      </table>

      {deleteTarget && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3 style={{ margin: '0 0 12px', fontSize: '18px', color: '#2c3e50' }}>Delete Institution</h3>
            <p style={{ margin: '0 0 8px', color: '#555', fontSize: '14px' }}>
              Delete <strong>{deleteTarget.name}</strong>
              {deleteTarget.institution_code && <> (<span style={styles.code}>{deleteTarget.institution_code}</span>)</>}?
            </p>
            <p style={{ margin: '0 0 16px', color: '#e74c3c', fontSize: '13px' }}>
              This permanently removes its {deleteTarget.staff_count} member account(s), attendance records,
              leave requests and subscription. It cannot be undone.
            </p>
            <label style={{ fontSize: '13px', color: '#555' }}>
              Type <strong style={{ fontFamily: 'monospace' }}>{confirmValue(deleteTarget)}</strong> to confirm
            </label>
            <input
              style={styles.confirmInput}
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              autoFocus
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setDeleteTarget(null)} style={styles.cancelBtn} disabled={deleting}>Cancel</button>
              <button
                onClick={handleDelete}
                style={{ ...styles.deleteBtn, opacity: confirmText.trim() === confirmValue(deleteTarget) && !deleting ? 1 : 0.5 }}
                disabled={confirmText.trim() !== confirmValue(deleteTarget) || deleting}
              >
                {deleting ? 'Deleting...' : 'Delete Institution'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
