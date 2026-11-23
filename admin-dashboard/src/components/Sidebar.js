import React, { useState, useEffect, useCallback, useRef } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FiHome, FiUsers, FiClock, FiBarChart2, FiSettings, FiLogOut, FiMapPin, FiMenu, FiX, FiCalendar, FiTrendingUp, FiShield, FiDollarSign, FiCreditCard } from 'react-icons/fi';
import { getLeaveStats } from '../services/api';
import { formatDate } from '../utils/format';
import InstitutionLogo from './InstitutionLogo';

const navItems = [
  { path: '/', label: 'Dashboard', icon: FiHome },
  { path: '/staff', label: 'Staff', icon: FiUsers },
  { path: '/attendance', label: 'Attendance', icon: FiClock },
  { path: '/reports', label: 'Reports', icon: FiBarChart2 },
  { path: '/leave', label: 'Leave', icon: FiCalendar },
  { path: '/analytics', label: 'Analytics', icon: FiTrendingUp },
  { path: '/audit', label: 'Audit Log', icon: FiShield },
  { path: '/billing', label: 'Billing', icon: FiCreditCard },
  { path: '/settings', label: 'Settings', icon: FiSettings },
];

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [breakpoint]);
  return isMobile;
}

const styles = {
  sidebar: {
    width: '250px',
    background: 'linear-gradient(180deg, #1a5276 0%, #154360 100%)',
    color: '#fff',
    position: 'fixed',
    top: 0,
    left: 0,
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    zIndex: 1000,
    transition: 'transform 0.3s ease',
  },
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 999,
  },
  topBar: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: '52px',
    zIndex: 1001,
    background: 'linear-gradient(180deg, #1a5276 0%, #154360 100%)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '0 12px 0 6px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
  },
  menuBtn: {
    position: 'relative',
    background: 'transparent',
    color: '#fff',
    width: '44px',
    height: '44px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  menuDot: {
    position: 'absolute', top: 9, right: 8, width: 9, height: 9, borderRadius: '50%',
    background: '#f39c12', border: '2px solid #1a5276',
  },
  logo: {
    padding: '24px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  logoIcon: { fontSize: '24px' },
  logoText: { fontSize: '18px', fontWeight: '700', letterSpacing: '-0.5px' },
  nav: { flex: 1, padding: '12px 0', overflowY: 'auto' },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 24px',
    color: 'rgba(255,255,255,0.7)',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all 0.2s',
    borderLeft: '3px solid transparent',
  },
  activeLink: {
    color: '#fff',
    background: 'rgba(255,255,255,0.1)',
    borderLeftColor: '#3498db',
  },
  userSection: {
    padding: '16px 20px',
    borderTop: '1px solid rgba(255,255,255,0.1)',
  },
  userName: { fontSize: '14px', fontWeight: '600', marginBottom: '2px' },
  userRole: { fontSize: '11px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' },
  logoutBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '12px',
    padding: '8px 0',
    background: 'none',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '13px',
    width: '100%',
    textAlign: 'left',
  },
};

export default function Sidebar({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const [pendingLeave, setPendingLeave] = useState(0);
  const isAdmin = ['admin', 'super_admin'].includes((user?.role || '').toLowerCase());

  // Keep the Leave badge current without a page reload, and speak up when a
  // new request arrives while the dashboard is open (most admins have no
  // phone push or email set up, so this is how they hear about it).
  const lastPending = useRef(null);
  const baseTitle = useRef(document.title);
  const loadBadges = useCallback(() => {
    if (!isAdmin) return;
    getLeaveStats().then((r) => {
      const pending = Number(r.data?.pending || 0);
      const prev = lastPending.current;
      lastPending.current = pending;
      setPendingLeave(pending);
      if (prev !== null && pending > prev) {
        const added = pending - prev;
        toast.info(`${added} new leave request${added === 1 ? '' : 's'} waiting for review. Click to open.`, {
          toastId: 'new-leave-request',
          autoClose: 10000,
          onClick: () => navigate('/leave'),
        });
      }
    }).catch(() => {});
  }, [isAdmin, navigate]);
  useEffect(() => { loadBadges(); }, [loadBadges, location.pathname]);
  useEffect(() => {
    const id = setInterval(loadBadges, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') loadBadges(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [loadBadges]);
  // Waiting count in the browser tab, visible from other tabs
  useEffect(() => {
    const title = baseTitle.current;
    document.title = pendingLeave > 0 ? `(${pendingLeave}) ${title}` : title;
    return () => { document.title = title; };
  }, [pendingLeave]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    if (isMobile) setOpen(false);
  }, [location.pathname, isMobile]);

  const sidebarStyle = {
    ...styles.sidebar,
    // Phone: slides in below the top bar, which keeps the close button
    ...(isMobile ? { top: '52px', transform: open ? 'translateX(0)' : 'translateX(-100%)' } : {}),
  };
  // Build nav items; add "Request Leave" for non-admin roles
  const finalNavItems = [...navItems];
  if (user && user.role && user.role.toLowerCase() !== 'admin') {
    // insert near Leave
    const insertIndex = finalNavItems.findIndex(i => i.path === '/leave');
    const item = { path: '/request-leave', label: 'Request Leave', icon: FiCalendar };
    if (insertIndex >= 0) finalNavItems.splice(insertIndex + 1, 0, item);
    else finalNavItems.push(item);
  } else if (user && user.role && (user.role.toLowerCase() === 'admin' || user.role.toLowerCase() === 'super_admin')) {
    // Payroll review for admin/super_admin
    const insertIndex = finalNavItems.findIndex(i => i.path === '/analytics');
    const item = { path: '/payroll', label: 'Payroll', icon: FiDollarSign };
    if (insertIndex >= 0) finalNavItems.splice(insertIndex + 1, 0, item);
    else finalNavItems.push(item);
  }

  // Add Create Institution link for super_admin only
  if (user && user.role && user.role.toLowerCase() === 'super_admin') {
    const instItem = { path: '/institutions/new', label: 'Create Institution', icon: FiMapPin };
    // place near top after Dashboard
    finalNavItems.splice(1, 0, instItem);
  }

  return (
    <>
      {isMobile && (
        // Phone: a bar across the top, so the menu button never covers the page
        <header style={styles.topBar}>
          <button
            type="button"
            style={styles.menuBtn}
            onClick={() => setOpen(!open)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
          >
            {open ? <FiX size={22} /> : <FiMenu size={22} />}
            {!open && pendingLeave > 0 && <span style={styles.menuDot} aria-hidden="true" />}
          </button>
          <InstitutionLogo
            institutionId={user?.institutionId}
            size={28}
            style={{ background: '#fff', borderRadius: 6, padding: 2 }}
            fallback={<FiMapPin size={20} />}
          />
          <span style={{ fontWeight: 700, fontSize: 16, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {(finalNavItems.find((i) => (i.path === '/' ? location.pathname === '/' : location.pathname.startsWith(i.path))) || {}).label || 'GeoAttend'}
          </span>
        </header>
      )}

      {isMobile && open && <div style={styles.overlay} onClick={() => setOpen(false)} />}

      <aside style={sidebarStyle}>
        <div style={styles.logo}>
          <InstitutionLogo
            institutionId={user?.institutionId}
            size={36}
            style={{ background: '#fff', borderRadius: 8, padding: 3 }}
            fallback={<FiMapPin style={styles.logoIcon} />}
          />
          <div>
            <div style={styles.logoText}>GeoAttend</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>{formatDate(new Date())}</div>
          </div>
        </div>

        <nav style={styles.nav}>
          {finalNavItems.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              className="ga-nav-link"
              style={({ isActive }) => ({
                ...styles.link,
                ...(isActive ? styles.activeLink : {}),
              })}
            >
              <Icon size={18} />
              <span style={{ flex: 1 }}>{label}</span>
              {path === '/leave' && pendingLeave > 0 && (
                <span title={`${pendingLeave} waiting for review`} style={{ minWidth: 20, padding: '1px 7px', borderRadius: 999, background: '#f39c12', color: '#fff', fontSize: 11, fontWeight: 700, textAlign: 'center' }}>
                  {pendingLeave}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div style={styles.userSection}>
          <div style={styles.userName}>{user.firstName} {user.lastName}</div>
          <div style={styles.userRole}>{user.role}</div>
          <button style={styles.logoutBtn} onClick={onLogout}>
            <FiLogOut size={14} /> Log Out
          </button>
        </div>
      </aside>
    </>
  );
}
