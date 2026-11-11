import React, { useState } from 'react';

// A one-time "what's new" notice. Each notice has a key; once someone taps OK
// it is remembered on this phone and never shown again. To announce something
// new, change NOTICE (with a new key).
const NOTICE = {
  key: '2026-11-offline-signin',
  title: 'GeoAttend has been updated',
  points: [
    'No data? You can still sign in and out. It is saved on your phone and sent automatically when you are back online.',
    'Using the web page? Open it once with internet today so your phone keeps a copy. Tip: add it to your Home Screen.',
    'Saw "Error 500" or "Couldn\'t load your status"? That is fixed. Just open GeoAttend again.',
    "You stay logged in. Please don't tap Log Out.",
  ],
};

const storageKey = `staffNoticeSeen:${NOTICE.key}`;

function alreadySeen() {
  try { return localStorage.getItem(storageKey) === '1'; } catch { return true; }
}

export default function UpdateNotice() {
  const [open, setOpen] = useState(() => !alreadySeen());
  if (!open) return null;

  const close = () => {
    try { localStorage.setItem(storageKey, '1'); } catch { /* storage blocked: just close */ }
    setOpen(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-notice-title"
        style={{ background: '#fff', borderRadius: 16, padding: '22px 20px 18px', width: '100%', maxWidth: 420, boxShadow: '0 20px 50px rgba(0,0,0,0.3)', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: '#2c3e50' }}
      >
        <h2 id="update-notice-title" style={{ margin: '0 0 12px', fontSize: 19, fontWeight: 700, color: '#1a5276' }}>{NOTICE.title}</h2>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 10 }}>
          {NOTICE.points.map((p) => (
            <li key={p} style={{ fontSize: 14.5, lineHeight: 1.45 }}>{p}</li>
          ))}
        </ul>
        <button
          type="button"
          onClick={close}
          autoFocus
          style={{ marginTop: 18, width: '100%', padding: 14, border: 'none', borderRadius: 12, background: '#1a5276', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          OK
        </button>
      </div>
    </div>
  );
}
