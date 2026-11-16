import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { FiLock, FiLogOut } from 'react-icons/fi';
import { changeMyPassword, logoutOtherDevices, authSession } from '../services/api';

const card = { background: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginTop: '24px', maxWidth: '900px' };
const title = { fontSize: '16px', fontWeight: '600', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' };
const text = { fontSize: '13px', color: '#7f8c8d', margin: '0 0 16px', lineHeight: 1.5 };
const label = { fontSize: '12px', fontWeight: '600', color: '#7f8c8d', textTransform: 'uppercase' };
const input = { padding: '10px 14px', border: '1px solid #e0e0e0', borderRadius: '8px', fontSize: '14px', width: '100%', boxSizing: 'border-box' };
const btn = (bg, color = '#fff', border = bg) => ({
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 8,
  background: bg, color, border: `1px solid ${border}`, fontSize: 14, fontWeight: 600, cursor: 'pointer',
});

/**
 * Admin: change password and end logins on other computers. Both keep this
 * computer logged in and log out everywhere else (a lost laptop, a shared PC).
 */
export default function SecuritySettings() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState('');

  const savePassword = async (e) => {
    e.preventDefault();
    if (!current || !next) { toast.error('Enter your current and new password'); return; }
    if (next.length < 6) { toast.error('The new password must be at least 6 characters'); return; }
    if (next !== confirm) { toast.error('The new passwords do not match'); return; }
    setBusy('password');
    try {
      const { data } = await changeMyPassword(current, next);
      authSession.replaceToken(data?.token);
      setCurrent(''); setNext(''); setConfirm('');
      toast.success('Password changed. Every other computer and phone was logged out.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not change the password');
    } finally {
      setBusy('');
    }
  };

  const logoutOthers = async () => {
    if (!window.confirm('Log out of GeoAttend on every other computer and phone? This one stays logged in.')) return;
    setBusy('others');
    try {
      const { data } = await logoutOtherDevices();
      authSession.replaceToken(data?.token);
      toast.success('Logged out on every other computer and phone.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not log out the other devices');
    } finally {
      setBusy('');
    }
  };

  return (
    <div style={card}>
      <h3 style={title}><FiLock size={16} /> Login security</h3>
      <p style={text}>
        If a computer with GeoAttend open is lost, shared or used by someone else, log it out here.
        Changing your password does the same: every other computer and phone is logged out, and this one stays in.
      </p>

      <button type="button" style={{ ...btn('#fff', '#c0392b', '#e6b0aa'), opacity: busy === 'others' ? 0.7 : 1 }}
        disabled={Boolean(busy)} onClick={logoutOthers}>
        <FiLogOut size={14} /> {busy === 'others' ? 'Logging out...' : 'Log out all other devices'}
      </button>

      <form onSubmit={savePassword} style={{ marginTop: 24, display: 'grid', gap: 12, maxWidth: 360 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#2c3e50' }}>Change password</div>
        <input type="text" name="username" autoComplete="username" value={authSession.user()?.staffId || ''} readOnly hidden />
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>Current password</span>
          <input style={input} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>New password</span>
          <input style={input} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>New password again</span>
          <input style={input} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        <div>
          <button type="submit" style={{ ...btn('#1a5276'), opacity: busy === 'password' ? 0.7 : 1 }} disabled={Boolean(busy)}>
            {busy === 'password' ? 'Saving...' : 'Change password'}
          </button>
        </div>
      </form>
    </div>
  );
}
