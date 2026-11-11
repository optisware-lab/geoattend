import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { FiHash, FiRefreshCw } from 'react-icons/fi';
import { getStaffIdSettings, updateStaffIdSettings } from '../services/api';

const card = { background: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' };
const label = { fontSize: '12px', fontWeight: '600', color: '#7f8c8d', textTransform: 'uppercase' };
const input = { padding: '10px 14px', border: '1px solid #e0e0e0', borderRadius: '8px', fontSize: '16px', fontWeight: 700, letterSpacing: 1, width: 120, textTransform: 'uppercase' };
const btn = (bg, color = '#fff', border = bg) => ({
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 8,
  background: bg, color, border: `1px solid ${border}`, fontSize: 14, fontWeight: 600, cursor: 'pointer',
});

/**
 * Admin: the school's staff ID initials (RSS001, RSS002, ...). Changing them
 * and renumbering affects every staff member; their old IDs keep working.
 */
export default function StaffIdSettings() {
  const [info, setInfo] = useState(null);
  const [prefix, setPrefix] = useState('');
  const [busy, setBusy] = useState('');
  const [lastChanges, setLastChanges] = useState(null);

  const load = useCallback(() => {
    getStaffIdSettings()
      .then(({ data }) => { setInfo(data); setPrefix(data.prefix); })
      .catch(() => toast.error('Could not load staff ID settings'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const clean = prefix.trim().toUpperCase();
  const valid = /^[A-Z]{2,5}$/.test(clean);
  const changed = info && clean !== info.prefix;

  const apply = async (renumber) => {
    if (!valid) { toast.error('Initials must be 2 to 5 letters, e.g. RSS'); return; }
    if (renumber === 'all' && !window.confirm(
      `Give all ${info.staffCount} staff new IDs starting ${clean}001?\n\n`
      + 'Their old IDs keep working for logging in and on printed QR cards. Admin accounts keep their IDs.'
    )) return;
    setBusy(renumber);
    try {
      const { data } = await updateStaffIdSettings({ prefix: clean, renumber });
      setInfo(data);
      setPrefix(data.prefix);
      setLastChanges(data.changes || []);
      toast.success(data.changed ? `${data.changed} staff ID(s) updated` : 'Saved. New staff will get these initials.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not update staff IDs');
    } finally {
      setBusy('');
    }
  };

  return (
    <div style={{ ...card, marginTop: '24px', maxWidth: '900px' }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <FiHash size={16} /> Staff IDs
      </h3>
      <p style={{ fontSize: 13, color: '#7f8c8d', marginBottom: 16, lineHeight: 1.5 }}>
        Every staff ID starts with your school&apos;s initials, followed by a number: new staff get the next one automatically.
        Old IDs keep working for logging in and on printed QR cards.
      </p>

      {!info ? (
        <div style={{ color: '#95a5a6', fontSize: 14 }}>Loading...</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={label}>School initials</span>
              <input style={input} value={prefix} maxLength={5} onChange={(e) => setPrefix(e.target.value.replace(/[^a-zA-Z]/g, ''))} aria-describedby="prefix-hint" />
            </label>
            <div>
              <div style={label}>Next new staff ID</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1a5276', marginTop: 8 }}>
                {changed && valid ? `${clean}${String(1).padStart(3, '0')}*` : info.nextId}
              </div>
            </div>
            <div>
              <div style={label}>Staff</div>
              <div style={{ fontSize: 14, marginTop: 8 }}>
                {info.staffCount} total
                {info.notFollowing > 0 && <span style={{ color: '#b9770e', fontWeight: 600 }}> · {info.notFollowing} without {info.prefix} IDs</span>}
              </div>
            </div>
          </div>
          <div id="prefix-hint" style={{ fontSize: 12, color: '#95a5a6', marginBottom: 16 }}>
            {!valid ? <span style={{ color: '#c0392b' }}>Use 2 to 5 letters.</span>
              : info.custom ? `Set by an admin. From your school name it would be ${info.suggested}.`
                : `From your school name. You can change it.`}
            {changed && valid && ' * after you save.'}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {(changed || info.notFollowing > 0) && (
              <button type="button" style={btn('#1a5276')} disabled={!!busy || !valid} onClick={() => apply('missing')}>
                {busy === 'missing' ? 'Saving...' : info.notFollowing > 0 ? `Save and update ${info.notFollowing} staff without ${clean} IDs` : 'Save initials for new staff'}
              </button>
            )}
            <button type="button" style={btn('#fff', '#c0392b', '#f5c6cb')} disabled={!!busy || !valid || !info.staffCount} onClick={() => apply('all')}>
              <FiRefreshCw size={14} /> {busy === 'all' ? 'Renumbering...' : `Renumber all staff (${clean}001, ${clean}002, ...)`}
            </button>
          </div>

          {lastChanges && lastChanges.length > 0 && (
            <details style={{ marginTop: 16 }} open={lastChanges.length <= 15}>
              <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{lastChanges.length} ID(s) changed</summary>
              <table style={{ marginTop: 8, fontSize: 13, borderCollapse: 'collapse' }}>
                <tbody>
                  {lastChanges.map((c) => (
                    <tr key={c.id}>
                      <td style={{ padding: '4px 12px 4px 0' }}>{c.name}</td>
                      <td style={{ padding: '4px 8px', color: '#95a5a6' }}>{c.from}</td>
                      <td style={{ padding: '4px 8px' }}>→ <strong>{c.to}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}
    </div>
  );
}
