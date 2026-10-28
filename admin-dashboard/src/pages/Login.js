import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { login, register } from '../services/api';
import { FiMapPin, FiUser, FiLock, FiEye, FiEyeOff } from 'react-icons/fi';

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #1a5276 0%, #2980b9 100%)',
    padding: '20px',
  },
  card: {
    background: '#fff',
    borderRadius: '16px',
    padding: '48px 40px',
    width: '100%',
    maxWidth: '420px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    marginBottom: '8px',
    color: '#1a5276',
  },
  title: { fontSize: '28px', fontWeight: '700' },
  subtitle: { textAlign: 'center', color: '#7f8c8d', marginBottom: '32px', fontSize: '14px' },
  inputGroup: { position: 'relative', marginBottom: '20px' },
  inputIcon: {
    position: 'absolute',
    left: '14px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#95a5a6',
  },
  input: {
    width: '100%',
    padding: '14px 44px 14px 44px',
    border: '2px solid #e0e0e0',
    borderRadius: '10px',
    fontSize: '15px',
    transition: 'border-color 0.2s',
    boxSizing: 'border-box',
  },
  eyeButton: {
    position: 'absolute',
    right: '14px',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#95a5a6',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
  },
  button: {
    width: '100%',
    padding: '14px',
    background: '#1a5276',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    fontSize: '16px',
    fontWeight: '600',
    marginTop: '8px',
    cursor: 'pointer',
  },
  footer: { textAlign: 'center', marginTop: '24px', fontSize: '12px', color: '#95a5a6' },
};

export default function Login({ onLogin }) {
  const [institutionCode, setInstitutionCode] = useState(localStorage.getItem('institutionCode') || '');
  const [staffId, setStaffId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!staffId || !password) {
      toast.error('Please enter Staff ID and password');
      return;
    }

    setLoading(true);
    try {
      const codeTrim = institutionCode.trim();
      // Super admin (ADMIN001) can login without institution code
      const { data } = await login(staffId, password, codeTrim || undefined);
      localStorage.setItem('token', data.token);
      const resolvedCode = data.institution?.code || codeTrim;
      if (resolvedCode) localStorage.setItem('institutionCode', String(resolvedCode).toUpperCase());

      if (data.user.role !== 'admin' && data.user.role !== 'super_admin') {
        toast.error('Admin access required');
        localStorage.removeItem('token');
        setLoading(false);
        return;
      }

      onLogin(data.user);
      toast.success('Login successful');
    } catch (err) {
      console.error('Login error:', err);
      const msg = err.response?.data?.error || err.message || 'Network error - check console';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <FiMapPin size={32} />
          <span style={styles.title}>GeoAttend</span>
        </div>
        <p style={styles.subtitle}>Admin Dashboard - Sign in to continue</p>

        <form onSubmit={handleSubmit}>
          <div style={{ fontSize: 12, color: '#2c3e50', marginBottom: 12, padding: 10, background: '#e8f5e9', borderRadius: 8, lineHeight: 1.5 }}>
            <strong style={{ color: '#27ae60' }}>Super Admin (ADMIN001):</strong> Leave institution code empty to login<br/>
            <strong style={{ color: '#3498db', marginTop: 4, display: 'inline-block' }}>Institution Admins:</strong> Enter your institution code and credentials provided by super admin
          </div>
          <div style={styles.inputGroup}>
            <FiMapPin style={styles.inputIcon} size={18} />
            <input
              style={styles.input}
              type="text"
              placeholder="Institution Code (optional for ADMIN001)"
              value={institutionCode}
              onChange={(e) => setInstitutionCode(e.target.value.toUpperCase())}
            />
          </div>
          <div style={styles.inputGroup}>
            <FiUser style={styles.inputIcon} size={18} />
            <input
              style={styles.input}
              type="text"
              placeholder="Admin ID"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
            />
          </div>
          <div style={styles.inputGroup}>
            <FiLock style={styles.inputIcon} size={18} />
            <input
              style={styles.input}
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              style={styles.eyeButton}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <FiEyeOff size={18} /> : <FiEye size={18} />}
            </button>
          </div>
          <button style={{ ...styles.button, opacity: loading ? 0.7 : 1 }} disabled={loading} type="submit">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={{ marginTop: 12, padding: 12, background: '#fff3cd', borderRadius: 8, fontSize: 13, lineHeight: 1.5 }}>
          <strong>Don't have admin credentials?</strong> Contact your super administrator to create an admin account for your institution. Regular signup creates staff accounts without admin access.
        </div>

        <p style={styles.footer}>Geofenced Staff Attendance Management System</p>
      </div>
    </div>
  );
}
