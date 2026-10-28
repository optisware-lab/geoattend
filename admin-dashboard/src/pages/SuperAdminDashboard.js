import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { FiList, FiPlusCircle, FiShield, FiTrendingUp, FiLogOut, FiMapPin } from 'react-icons/fi';
import { useIsMobile } from '../components/ui';
import { formatDate } from '../utils/format';

const navItems = [
  { path: '/institutions', label: 'Institutions', icon: FiList, end: true },
  { path: '/institutions/new', label: 'New institution', icon: FiPlusCircle },
  { path: '/analytics', label: 'Analytics', icon: FiTrendingUp },
  { path: '/audit', label: 'Audit log', icon: FiShield },
];

export default function SuperAdminDashboard({ onLogout }) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const user = (() => { try { return JSON.parse(localStorage.getItem('user')) || {}; } catch { return {}; } })();

  const handleSignOut = () => {
    try { localStorage.removeItem('token'); localStorage.removeItem('user'); } catch (e) { /* ignore */ }
    if (typeof onLogout === 'function') onLogout();
    navigate('/login');
  };

  const link = ({ isActive }) => ({
    display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '8px 12px' : '11px 20px',
    fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', borderRadius: isMobile ? 999 : 0,
    color: isActive ? '#fff' : 'rgba(255,255,255,0.7)',
    background: isActive ? 'rgba(255,255,255,0.12)' : 'transparent',
    borderLeft: isMobile ? 'none' : `3px solid ${isActive ? '#3498db' : 'transparent'}`,
  });

  const nav = navItems.map(({ path, label, icon: Icon, end }) => (
    <NavLink key={path} to={path} end={end} className="ga-nav-link" style={link}>
      <Icon size={17} /> {label}
    </NavLink>
  ));

  const signOutBtn = (
    <button type="button" onClick={handleSignOut} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 13, padding: '8px 0' }}>
      <FiLogOut size={14} /> Sign out
    </button>
  );

  if (isMobile) {
    return (
      <div style={{ minHeight: '100vh' }}>
        <header style={{ background: 'linear-gradient(180deg, #1a5276 0%, #154360 100%)', color: '#fff', padding: '14px 14px 10px', position: 'sticky', top: 0, zIndex: 50 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}><FiMapPin /> GeoAttend · Super Admin</div>
            {signOutBtn}
          </div>
          <nav style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>{nav}</nav>
        </header>
        <main style={{ padding: '18px 14px' }}><Outlet /></main>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: 250, background: 'linear-gradient(180deg, #1a5276 0%, #154360 100%)', color: '#fff', position: 'fixed', top: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', zIndex: 100 }}>
        <div style={{ padding: '24px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <FiMapPin size={22} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>GeoAttend</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>Super Admin · {formatDate(new Date())}</div>
          </div>
        </div>
        <nav style={{ flex: 1, padding: '12px 0' }}>{nav}</nav>
        <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{[user.firstName, user.lastName].filter(Boolean).join(' ') || 'Super Admin'}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', marginBottom: 6 }}>Platform owner</div>
          {signOutBtn}
        </div>
      </aside>
      <main style={{ flex: 1, marginLeft: 250, padding: '28px 32px', minWidth: 0 }}>
        <Outlet />
      </main>
    </div>
  );
}
