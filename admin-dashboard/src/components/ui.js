import React, { useEffect, useState } from 'react';

// Small shared pieces so every admin page looks and behaves the same.

export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [breakpoint]);
  return isMobile;
}

/** Re-renders every `ms` so "x min ago" and live timers stay current. */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Runs `fn` now, every `ms`, and when the browser tab becomes visible again. */
export function useAutoRefresh(fn, ms = 60000) {
  useEffect(() => {
    fn();
    const id = setInterval(() => { if (document.visibilityState === 'visible') fn(); }, ms);
    const onVisible = () => { if (document.visibilityState === 'visible') fn(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fn, ms]);
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
      <div style={{ minWidth: 0 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2c3e50', letterSpacing: '-0.3px' }}>{title}</h1>
        {subtitle && <div style={{ fontSize: 13.5, color: '#7f8c8d', marginTop: 4 }}>{subtitle}</div>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, color = '#1a5276', icon: Icon, onClick }) {
  const clickable = typeof onClick === 'function';
  return (
    <div
      className={`ga-card${clickable ? ' ga-hover' : ''}`}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      style={{ padding: '18px 18px 16px', cursor: clickable ? 'pointer' : 'default', borderTop: `3px solid ${color}`, minWidth: 0 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#7f8c8d', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
        {Icon && (
          <span style={{ width: 32, height: 32, borderRadius: 9, background: `${color}18`, color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon size={16} />
          </span>
        )}
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color: '#2c3e50', marginTop: 6, lineHeight: 1.1 }}>{value}</div>
      {hint && <div style={{ fontSize: 12.5, color: '#95a5a6', marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

const BADGE_TONES = {
  green: ['#1e8449', '#e8f6ee'],
  orange: ['#b9770e', '#fef5e7'],
  red: ['#c0392b', '#fdecea'],
  blue: ['#2471a3', '#eaf3fb'],
  gray: ['#5d6d7e', '#eef1f4'],
  purple: ['#7d3c98', '#f4ecf7'],
};

export function Badge({ tone = 'gray', children, icon: Icon }) {
  const [color, bg] = BADGE_TONES[tone] || BADGE_TONES.gray;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, color, background: bg, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
      {Icon && <Icon size={11} />}
      {children}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div style={{ textAlign: 'center', padding: '44px 20px', color: '#95a5a6' }}>
      {Icon && <Icon size={34} style={{ opacity: 0.5 }} />}
      <div style={{ fontSize: 15, fontWeight: 600, color: '#5d6d7e', marginTop: 10 }}>{title}</div>
      {text && <div style={{ fontSize: 13, marginTop: 4 }}>{text}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function Avatar({ first, last, photo, size = 40 }) {
  const initials = `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase() || '?';
  if (photo) {
    return <img src={photo} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: '#e8eef5', color: '#1a5276', fontWeight: 700, fontSize: size * 0.38, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {initials}
    </div>
  );
}

export function Card({ title, icon: Icon, action, children, style, bodyStyle }) {
  return (
    <section className="ga-card" style={{ padding: 20, minWidth: 0, ...style }}>
      {(title || action) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
          <h3 style={{ fontSize: 15.5, fontWeight: 700, color: '#2c3e50', display: 'flex', alignItems: 'center', gap: 8 }}>
            {Icon && <Icon size={16} color="#1a5276" />}
            {title}
          </h3>
          {action}
        </div>
      )}
      <div style={bodyStyle}>{children}</div>
    </section>
  );
}
