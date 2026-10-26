import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IoLocation, IoQrCode, IoCalendar, IoPerson, IoImageOutline } from 'react-icons/io5';
import {
  session, getTodayStatus, getWeeklyStats, getMyAttendance, getProfile,
  checkIn, checkOut, checkInFromImage, webDeviceId, errorMessage,
} from './staffApi';
import { decodeFrame, decodeImageFile, parseQrPayload } from './qr';

// Same palette as the mobile app (mobile-app/src/services/theme.js)
const C = {
  bg: '#f0f2f5', card: '#fff', text: '#2c3e50', textSecondary: '#7f8c8d', textMuted: '#95a5a6',
  primary: '#1a5276', green: '#27ae60', red: '#e74c3c', blue: '#3498db', orange: '#f39c12', border: '#e0e0e0',
};
const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const TAB_BAR_HEIGHT = 64;

const st = {
  page: { minHeight: '100vh', background: C.bg, fontFamily: FONT, color: C.text, paddingBottom: `calc(${TAB_BAR_HEIGHT + 16}px + env(safe-area-inset-bottom))` },
  scroll: { maxWidth: 520, margin: '0 auto', padding: '20px 20px 0' },
  header: { marginBottom: 24, paddingTop: 20 },
  greeting: { fontSize: 16, color: C.textSecondary },
  name: { fontSize: 28, fontWeight: 700, marginTop: 2 },
  date: { fontSize: 13, color: C.textMuted, marginTop: 4 },
  title: { fontSize: 24, fontWeight: 700, margin: 0 },
  subtitle: { fontSize: 14, color: C.textSecondary, marginTop: 4 },
  card: (accent) => ({
    background: C.card, borderRadius: 12, padding: 18, marginBottom: 12,
    borderLeft: accent ? `4px solid ${accent}` : 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
  }),
  cardLabel: { fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  cardValue: { fontSize: 18, fontWeight: 700 },
  cardDetail: { fontSize: 13, color: C.textSecondary, marginTop: 4 },
  statBox: (bg) => ({ flex: 1, borderRadius: 10, padding: '12px 4px', textAlign: 'center', background: bg }),
  statNumber: { fontSize: 22, fontWeight: 700 },
  statLabel: { fontSize: 10, fontWeight: 600, color: C.textSecondary, marginTop: 2 },
  actionBtn: (bg, disabled) => ({
    width: '100%', padding: '20px 12px', borderRadius: 16, border: 'none', background: bg, color: '#fff',
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    fontFamily: FONT,
  }),
  actionText: { fontSize: 20, fontWeight: 700, display: 'block' },
  actionSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 4, display: 'block' },
  outlineBtn: {
    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: '13px 20px', borderRadius: 10, border: `2px solid ${C.primary}`, background: '#fff',
    color: C.primary, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
  },
  textLink: { background: 'none', border: 'none', color: C.primary, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '8px 0 0', fontFamily: FONT },
  banner: (type) => ({
    marginBottom: 12, padding: '12px 14px', borderRadius: 10, fontSize: 14, lineHeight: 1.45,
    background: type === 'error' ? '#fdedec' : type === 'success' ? '#eafaf1' : '#ebf5fb',
    color: type === 'error' ? '#c0392b' : type === 'success' ? '#1e8449' : C.primary,
  }),
  tabBar: {
    position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20, background: '#fff', borderTop: `1px solid ${C.border}`,
    display: 'flex', paddingTop: 8, paddingBottom: 'calc(8px + env(safe-area-inset-bottom))', boxShadow: '0 -2px 10px rgba(0,0,0,0.06)',
  },
  tab: (active) => ({
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'none', border: 'none',
    cursor: 'pointer', color: active ? C.primary : C.textMuted, fontSize: 11, fontWeight: 600, fontFamily: FONT, padding: 0,
  }),
};

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser cannot share your location.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => reject(new Error(err.code === 1
        ? 'Location is blocked. Allow location for this site (iPhone: Settings > Privacy & Security > Location Services > Safari Websites > While Using), then try again.'
        : 'Could not get your location. Turn on Location/GPS and try again.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone;

function greetingFor(date) {
  const h = date.getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

// ---------- Check-In tab ----------

function CheckInTab({ user, institution, status, record, stats, location, locationError, onRefreshLocation, onCheckIn, onCheckOut, busy, message }) {
  const now = new Date();
  const radius = institution?.geofenceRadius || 200;
  const distance = location && institution?.latitude != null
    ? distanceMeters(location.latitude, location.longitude, Number(institution.latitude), Number(institution.longitude))
    : null;
  const isWithin = distance != null && distance <= radius;
  const outside = distance != null && !isWithin;

  return (
    <div style={st.scroll}>
      <div style={st.header}>
        <div style={st.greeting}>{greetingFor(now)},</div>
        <div style={st.name}>{user?.firstName || 'Staff'}</div>
        <div style={st.date}>{now.toLocaleDateString('en-GH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
      </div>

      {message && <div style={st.banner(message.type)}>{message.text}</div>}

      {institution?.name && (
        <div style={st.card(C.primary)}>
          <div style={st.cardLabel}>INSTITUTION</div>
          <div style={st.cardValue}>{institution.name}</div>
          {(institution.address || institution.city) && (
            <div style={st.cardDetail}>{[institution.address, institution.city, institution.region].filter(Boolean).join(', ')}</div>
          )}
        </div>
      )}

      <div style={st.card(distance == null ? C.textMuted : isWithin ? C.green : C.red)}>
        <div style={st.cardLabel}>LOCATION STATUS</div>
        {locationError ? (
          <div style={{ ...st.cardDetail, color: '#c0392b' }}>{locationError}</div>
        ) : distance == null ? (
          <div style={st.cardDetail}>Getting your location...</div>
        ) : (
          <>
            <div style={{ ...st.cardValue, color: isWithin ? C.green : C.red }}>{isWithin ? 'Within Geofence' : 'Outside Geofence'}</div>
            <div style={st.cardDetail}>{distance}m from {institution?.name || 'institution'} ({radius}m radius)</div>
          </>
        )}
        <button type="button" style={st.textLink} onClick={onRefreshLocation}>Refresh location</button>
      </div>

      <div style={st.card(C.blue)}>
        <div style={st.cardLabel}>TODAY'S STATUS</div>
        <div style={st.cardValue}>
          {status === 'checked_in' ? 'Checked In' : status === 'checked_out' ? 'Checked Out' : status ? 'Not Checked In' : 'Loading...'}
        </div>
        {record?.check_in_time && (
          <div style={st.cardDetail}>
            In: {formatTime(record.check_in_time)}
            {record.check_out_time && ` | Out: ${formatTime(record.check_out_time)}`}
            {record.is_late && ' | LATE'}
          </div>
        )}
      </div>

      {stats && (
        <div style={st.card()}>
          <div style={{ ...st.cardLabel, marginBottom: 12 }}>THIS MONTH</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={st.statBox('#eafaf1')}><div style={{ ...st.statNumber, color: C.green }}>{stats.present}</div><div style={st.statLabel}>Present</div></div>
            <div style={st.statBox('#fef9e7')}><div style={{ ...st.statNumber, color: C.orange }}>{stats.late}</div><div style={st.statLabel}>Late</div></div>
            <div style={st.statBox('#fdedec')}><div style={{ ...st.statNumber, color: C.red }}>{stats.absent}</div><div style={st.statLabel}>Absent</div></div>
            <div style={st.statBox('#ebf5fb')}><div style={{ ...st.statNumber, color: C.blue }}>{stats.avgHours || 0}h</div><div style={st.statLabel}>Avg Hours</div></div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 20, marginBottom: 12 }}>
        {status === 'checked_in' ? (
          <button type="button" style={st.actionBtn(C.red, !!busy)} disabled={!!busy} onClick={onCheckOut}>
            <span style={st.actionText}>{busy === 'checkout' ? 'Checking out...' : 'Check Out'}</span>
            <span style={st.actionSub}>Tap to end your day</span>
          </button>
        ) : status === 'checked_out' ? (
          <button type="button" style={st.actionBtn(C.textMuted, true)} disabled>
            <span style={st.actionText}>Done for Today</span>
            <span style={st.actionSub}>See you tomorrow!</span>
          </button>
        ) : (
          <button type="button" style={st.actionBtn(C.green, !!busy || outside)} disabled={!!busy || outside} onClick={onCheckIn}>
            <span style={st.actionText}>{busy === 'checkin' ? 'Checking in...' : 'Check In'}</span>
            <span style={st.actionSub}>{outside ? `Move within ${radius}m to check in` : 'Tap to check in with GPS'}</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- QR Scan tab ----------

function CameraScanner({ active, onResult }) {
  const videoRef = useRef(null);
  const resultRef = useRef(onResult);
  const [error, setError] = useState('');
  resultRef.current = onResult;

  useEffect(() => {
    if (!active) return undefined;
    let stream = null;
    let frame = 0;
    let lastScan = 0;
    let done = false;
    setError('');

    const scan = (time) => {
      if (done) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && time - lastScan > 150) {
        lastScan = time;
        const text = decodeFrame(video);
        if (text) {
          done = true;
          resultRef.current(text);
          return;
        }
      }
      frame = requestAnimationFrame(scan);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (done) { stream.getTracks().forEach((t) => t.stop()); return; }
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        frame = requestAnimationFrame(scan);
      } catch (err) {
        setError(err?.name === 'NotAllowedError'
          ? 'Camera access is blocked. Allow the camera for this site, or upload a photo of the QR code below.'
          : 'Could not open the camera. Upload a photo of the QR code below instead.');
      }
    })();

    return () => {
      done = true;
      cancelAnimationFrame(frame);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [active]);

  return (
    <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', background: '#000', aspectRatio: '3 / 4', maxHeight: '52vh', width: '100%' }}>
      <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '62%', aspectRatio: '1 / 1', border: '3px solid #fff', borderRadius: 16 }} />
      </div>
      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(0,0,0,0.75)', color: '#fff', textAlign: 'center', fontSize: 14, lineHeight: 1.5 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function QrTab({ active, onQrText, onPhoto, busy, message }) {
  const fileRef = useRef(null);
  const [paused, setPaused] = useState(false);

  const handleResult = useCallback(async (text) => {
    setPaused(true);
    await onQrText(text);
    // Give time to read the result before scanning again
    setTimeout(() => setPaused(false), 3000);
  }, [onQrText]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await onPhoto(file);
  };

  return (
    <div style={st.scroll}>
      <div style={{ padding: '10px 0 16px' }}>
        <h1 style={st.title}>QR Code Check-In</h1>
        <div style={st.subtitle}>Scan the institution QR code or your staff ID card</div>
      </div>

      {message && <div style={st.banner(message.type)}>{message.text}</div>}

      <div style={{ position: 'relative' }}>
        <CameraScanner active={active && !paused && !busy} onResult={handleResult} />
        {busy === 'qr' && (
          <div style={{ position: 'absolute', inset: 0, borderRadius: 16, background: 'rgba(0,0,0,0.6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 600 }}>
            Checking in...
          </div>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <button type="button" style={{ ...st.outlineBtn, opacity: busy ? 0.6 : 1 }} disabled={!!busy} onClick={() => fileRef.current?.click()}>
          <IoImageOutline size={20} /> Upload QR Code Image
        </button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
      </div>
      <p style={{ fontSize: 13, color: C.textSecondary, textAlign: 'center', lineHeight: 1.5, marginTop: 12 }}>
        Point your camera at the QR code posted at the entrance or on your staff ID card, or upload a photo of it.
        GPS must be enabled — check-in is rejected outside your institution's geofence.
      </p>
    </div>
  );
}

// ---------- History tab ----------

function HistoryTab({ active }) {
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (pageNum) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await getMyAttendance({ page: pageNum, limit: 20 });
      setRecords((prev) => (pageNum === 1 ? data.records || [] : [...prev, ...(data.records || [])]));
      setTotal(data.total || 0);
      setPage(pageNum);
    } catch (err) {
      setError(errorMessage(err, 'Could not load your history.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (active) load(1); }, [active, load]);

  return (
    <div style={st.scroll}>
      <div style={{ padding: '10px 0 16px' }}>
        <h1 style={st.title}>Attendance History</h1>
        <div style={st.subtitle}>{total} records</div>
      </div>
      {error && <div style={st.banner('error')}>{error}</div>}
      {records.map((r) => {
        const date = new Date(r.date);
        const hours = r.check_in_time && r.check_out_time
          ? ((new Date(r.check_out_time) - new Date(r.check_in_time)) / 3600000).toFixed(1)
          : null;
        return (
          <div key={r.id} style={{ ...st.card(), display: 'flex', gap: 14, alignItems: 'center', padding: 14 }}>
            <div style={{ width: 56, flexShrink: 0, textAlign: 'center', background: C.primary, color: '#fff', borderRadius: 10, padding: '8px 0' }}>
              <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.85 }}>{date.toLocaleDateString('en-GH', { weekday: 'short' })}</div>
              <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{date.getDate()}</div>
              <div style={{ fontSize: 11, opacity: 0.85 }}>{date.toLocaleDateString('en-GH', { month: 'short' })}</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700 }}>In {formatTime(r.check_in_time) || '-'}</span>
                <span style={{ color: C.textMuted }}>→</span>
                <span style={{ fontWeight: 700 }}>Out {formatTime(r.check_out_time) || '-'}</span>
                {r.is_late && <span style={{ background: '#fdedec', color: C.red, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8 }}>LATE</span>}
              </div>
              <div style={{ ...st.cardDetail, marginTop: 4 }}>
                {(r.check_in_method || 'gps').replace('_', ' ').toUpperCase()}{hours ? ` · ${hours}h` : ''}
              </div>
            </div>
          </div>
        );
      })}
      {!loading && records.length === 0 && !error && (
        <p style={{ textAlign: 'center', color: C.textMuted, marginTop: 40 }}>No attendance records found</p>
      )}
      {records.length < total && (
        <button type="button" style={{ ...st.outlineBtn, marginBottom: 12 }} disabled={loading} onClick={() => load(page + 1)}>
          {loading ? 'Loading...' : 'Load more'}
        </button>
      )}
      {loading && records.length === 0 && <p style={{ textAlign: 'center', color: C.textMuted }}>Loading...</p>}
    </div>
  );
}

// ---------- Profile tab ----------

function ProfileTab({ active, onSignOut }) {
  const { user, institution } = session.get();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!active) return;
    getProfile().then(({ data }) => { if (data && typeof data === 'object') setProfile(data); }).catch(() => {});
  }, [active]);

  const p = profile || {
    first_name: user?.firstName, last_name: user?.lastName, staff_id: user?.staffId, email: user?.email,
    phone: user?.phone, department: user?.department, position: user?.position,
    institution_name: user?.institutionName || institution?.name, role: user?.role, profile_photo_url: user?.profilePhoto,
  };
  const initials = `${p.first_name?.[0] || ''}${p.last_name?.[0] || ''}`.toUpperCase();
  const rows = [
    ['Email', p.email], ['Phone', p.phone], ['Department', p.department], ['Position', p.position],
    ['Institution', p.institution_name], ['Role', p.role],
  ];

  return (
    <div style={st.scroll}>
      <div style={{ padding: '10px 0 16px' }}><h1 style={st.title}>Profile</h1></div>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        {p.profile_photo_url ? (
          <img src={p.profile_photo_url} alt="" style={{ width: 80, height: 80, borderRadius: 40, objectFit: 'cover' }} />
        ) : (
          <div style={{ width: 80, height: 80, borderRadius: 40, background: C.primary, color: '#fff', fontSize: 28, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            {initials || '?'}
          </div>
        )}
        <div style={{ fontSize: 20, fontWeight: 700, marginTop: 12 }}>{[p.first_name, p.last_name].filter(Boolean).join(' ')}</div>
        <div style={{ fontSize: 14, color: C.textSecondary, marginTop: 2 }}>{p.staff_id}</div>
      </div>

      <div style={{ ...st.card(), padding: '4px 18px' }}>
        {rows.map(([label, value], i) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '13px 0', borderBottom: i < rows.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
            <span style={{ fontSize: 14, color: C.textSecondary }}>{label}</span>
            <span style={{ fontSize: 14, fontWeight: 600, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>{value || '-'}</span>
          </div>
        ))}
      </div>

      {isIos && !isStandalone && (
        <div style={{ ...st.card(C.blue), fontSize: 14, lineHeight: 1.5 }}>
          <strong>Use it like an app:</strong> tap the Share button in Safari, then <strong>Add to Home Screen</strong>.
        </div>
      )}

      <button type="button" style={{ width: '100%', padding: 16, borderRadius: 12, border: '1px solid #f5c6cb', background: '#fff', color: C.red, fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 8, fontFamily: FONT }} onClick={onSignOut}>
        Sign Out
      </button>
      <p style={{ textAlign: 'center', fontSize: 12, color: C.textMuted, marginTop: 16 }}>GeoAttend · Powered by Optisware</p>
    </div>
  );
}

// ---------- Shell with bottom tabs (like the mobile app) ----------

const TABS = [
  { key: 'home', label: 'Staff Check-In', Icon: IoLocation },
  { key: 'qr', label: 'QR Scan', Icon: IoQrCode },
  { key: 'history', label: 'History', Icon: IoCalendar },
  { key: 'profile', label: 'Profile', Icon: IoPerson },
];

export default function StaffHome({ onSignOut }) {
  const { user, institution } = session.get();
  const [tab, setTab] = useState('home');
  const [status, setStatus] = useState(null);
  const [record, setRecord] = useState(null);
  const [stats, setStats] = useState(null);
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);

  const handleAuthError = useCallback((err) => {
    if (err?.response?.status === 401) {
      session.clear();
      onSignOut('Your session has expired. Please sign in again.');
      return true;
    }
    return false;
  }, [onSignOut]);

  const loadToday = useCallback(async () => {
    try {
      const { data } = await getTodayStatus();
      setStatus(data.status);
      setRecord(data.record);
    } catch (err) {
      if (!handleAuthError(err)) setMessage({ type: 'error', text: errorMessage(err, 'Could not load today\'s status.') });
    }
    getWeeklyStats().then(({ data }) => setStats(data.month)).catch(() => {});
  }, [handleAuthError]);

  const refreshLocation = useCallback(async () => {
    setLocationError('');
    try {
      const loc = await getLocation();
      setLocation(loc);
      return loc;
    } catch (err) {
      setLocationError(err.message);
      return null;
    }
  }, []);

  useEffect(() => {
    loadToday();
    refreshLocation();
  }, [loadToday, refreshLocation]);

  const afterCheckIn = (data, how) => {
    setMessage({ type: 'success', text: data.isLate ? `Checked in ${how}. You are marked as LATE.` : `Checked in ${how}. Have a good day!` });
    setStatus('checked_in');
    setRecord(data.record || null);
    getWeeklyStats().then(({ data: s }) => setStats(s.month)).catch(() => {});
  };

  const fail = (err, fallback) => {
    if (!handleAuthError(err)) setMessage({ type: 'error', text: errorMessage(err, fallback) });
  };

  const doGpsCheckIn = async () => {
    setBusy('checkin');
    setMessage(null);
    try {
      const loc = await refreshLocation();
      if (!loc) return;
      const { data } = await checkIn({ latitude: loc.latitude, longitude: loc.longitude, method: 'gps', deviceId: webDeviceId() });
      afterCheckIn(data, 'with GPS');
    } catch (err) {
      fail(err, 'Check-in failed. Please try again.');
    } finally {
      setBusy('');
    }
  };

  const doCheckOut = async () => {
    setBusy('checkout');
    setMessage(null);
    try {
      const loc = await refreshLocation();
      if (!loc) return;
      const { data } = await checkOut({ latitude: loc.latitude, longitude: loc.longitude, method: 'gps', deviceId: webDeviceId() });
      setMessage({ type: 'success', text: 'Checked out. See you tomorrow!' });
      setStatus('checked_out');
      setRecord(data.record || record);
    } catch (err) {
      fail(err, 'Check-out failed. Please try again.');
    } finally {
      setBusy('');
    }
  };

  const checkInWithQrText = async (text) => {
    const parsed = parseQrPayload(text, user);
    if (parsed.error) {
      setMessage({ type: 'error', text: parsed.error });
      return;
    }
    const loc = await refreshLocation();
    if (!loc) {
      setMessage({ type: 'error', text: 'GPS location is required for QR check-in. Turn on location and try again.' });
      return;
    }
    const { data } = await checkIn({
      latitude: loc.latitude, longitude: loc.longitude, method: 'qr_code',
      qrCode: parsed.qrCode, qrToken: parsed.qrToken, deviceId: webDeviceId(),
    });
    afterCheckIn(data, 'with QR code');
  };

  const onQrText = async (text) => {
    setBusy('qr');
    setMessage(null);
    try {
      await checkInWithQrText(text);
    } catch (err) {
      fail(err, 'Check-in failed. Please try again.');
    } finally {
      setBusy('');
    }
  };

  const onPhoto = async (file) => {
    setBusy('qr');
    setMessage(null);
    try {
      const text = await decodeImageFile(file);
      if (text) {
        await checkInWithQrText(text);
        return;
      }
      // The browser couldn't read it: let the server try before giving up
      const loc = await refreshLocation();
      if (!loc) return;
      const form = new FormData();
      form.append('image', file);
      form.append('latitude', String(loc.latitude));
      form.append('longitude', String(loc.longitude));
      form.append('deviceId', webDeviceId());
      const { data } = await checkInFromImage(form);
      afterCheckIn(data, 'with QR code');
    } catch (err) {
      fail(err, 'We could not read a QR code in that photo. Try a clearer, straight-on photo.');
    } finally {
      setBusy('');
    }
  };

  const switchTab = (key) => {
    setTab(key);
    setMessage(null);
    if (key === 'home') loadToday();
    window.scrollTo(0, 0);
  };

  const signOut = () => {
    session.clear();
    onSignOut();
  };

  return (
    <div style={st.page}>
      {tab === 'home' && (
        <CheckInTab
          user={user} institution={institution} status={status} record={record} stats={stats}
          location={location} locationError={locationError} onRefreshLocation={refreshLocation}
          onCheckIn={doGpsCheckIn} onCheckOut={doCheckOut} busy={busy} message={message}
        />
      )}
      {tab === 'qr' && <QrTab active onQrText={onQrText} onPhoto={onPhoto} busy={busy} message={message} />}
      {tab === 'history' && <HistoryTab active />}
      {tab === 'profile' && <ProfileTab active onSignOut={signOut} />}

      <nav style={st.tabBar}>
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} type="button" style={st.tab(tab === key)} onClick={() => switchTab(key)}>
            <Icon size={24} />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
