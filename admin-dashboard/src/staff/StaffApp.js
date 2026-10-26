import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  session, staffLogin, googleAuth, completeGoogleSignup, getTodayStatus, checkIn, checkOut, checkInFromImage,
  webDeviceId, errorMessage,
} from './staffApi';
import { decodeFrame, decodeImageFile, parseQrPayload } from './qr';
import GoogleButton from './GoogleButton';

const NAVY = '#1a5276';

const s = {
  page: { minHeight: '100vh', background: '#f0f2f5', fontFamily: 'Inter, -apple-system, Segoe UI, Roboto, sans-serif', color: '#2c3e50' },
  header: { background: NAVY, color: '#fff', padding: '18px 16px 22px' },
  wrap: { maxWidth: 480, margin: '0 auto', padding: '0 16px' },
  brand: { fontSize: 22, fontWeight: 700, margin: 0 },
  sub: { fontSize: 13, opacity: 0.8, margin: '4px 0 0' },
  card: { background: '#fff', borderRadius: 14, padding: 18, marginTop: 14, boxShadow: '0 2px 10px rgba(0,0,0,0.06)' },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#7f8c8d', margin: '0 0 6px' },
  input: { width: '100%', boxSizing: 'border-box', padding: '13px 14px', fontSize: 16, border: '1.5px solid #e0e0e0', borderRadius: 10, marginBottom: 14, outline: 'none' },
  primary: { width: '100%', padding: 16, fontSize: 17, fontWeight: 700, color: '#fff', background: NAVY, border: 'none', borderRadius: 12, cursor: 'pointer' },
  green: { background: '#27ae60' },
  red: { background: '#c0392b' },
  outline: { width: '100%', padding: 14, fontSize: 15, fontWeight: 700, color: NAVY, background: '#fff', border: `2px solid ${NAVY}`, borderRadius: 12, cursor: 'pointer', marginTop: 10 },
  link: { background: 'none', border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0 },
  muted: { fontSize: 13, color: '#7f8c8d' },
  banner: (type) => ({
    marginTop: 14, padding: '12px 14px', borderRadius: 10, fontSize: 14, lineHeight: 1.45,
    background: type === 'error' ? '#fdecea' : type === 'success' ? '#e8f5e9' : '#eef4f8',
    color: type === 'error' ? '#b03a2e' : type === 'success' ? '#1e8449' : NAVY,
  }),
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16 },
  video: { width: '100%', maxWidth: 420, borderRadius: 14, background: '#000' },
};

const STATUS_TEXT = { not_checked_in: 'Not checked in', checked_in: 'Checked in', checked_out: 'Checked out' };

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
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(new Error(err.code === 1
        ? 'Location is blocked. Allow location for this site (iPhone: Settings > Privacy & Security > Location Services > Safari Websites > While Using), then try again.'
        : 'Could not get your location. Turn on Location/GPS and try again.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone;

// ---------- Sign in ----------

function Divider({ text }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0' }}>
      <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
      <span style={{ fontSize: 12, color: '#95a5a6', fontWeight: 600 }}>{text}</span>
      <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
    </div>
  );
}

/** One-time step for a first Google sign-in: phone number (+ institution for new accounts). */
function CompleteGoogleProfile({ step, onDone, onCancel }) {
  const { idToken, profile, existingAccount } = step;
  const [code, setCode] = useState(profile.institutionCode || session.lastInstitutionCode());
  const [firstName, setFirstName] = useState(profile.firstName || '');
  const [lastName, setLastName] = useState(profile.lastName || '');
  const [phone, setPhone] = useState('');
  const [staffId, setStaffId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const institutionCode = code.trim().toUpperCase();
    if (!phone.trim()) { setError('Enter your phone number.'); return; }
    if (!existingAccount && (!institutionCode || !firstName.trim() || !lastName.trim())) {
      setError('Enter your institution code and your name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data } = await completeGoogleSignup({
        idToken,
        institutionCode: existingAccount ? undefined : institutionCode,
        phone: phone.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        staffId: staffId.trim() || undefined,
      });
      session.save(data, institutionCode);
      onDone();
    } catch (err) {
      const msg = errorMessage(err, 'Could not finish signing up. Please try again.');
      setError(/could not be verified/i.test(msg) ? 'Your Google sign-in expired. Tap Back and continue with Google again.' : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form style={s.card} onSubmit={submit}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>Almost done</div>
      <p style={{ ...s.muted, margin: '6px 0 16px' }}>
        {existingAccount
          ? `We found your account (${profile.email}). Add your phone number to finish.`
          : `Signed in as ${profile.email}. Tell us where you work. You only do this once.`}
      </p>
      {!existingAccount && (
        <>
          <label style={s.label} htmlFor="g-code">Institution Code</label>
          <input id="g-code" style={s.input} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. INST-123456" autoCapitalize="characters" />
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={s.label} htmlFor="g-first">First name</label>
              <input id="g-first" style={s.input} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={s.label} htmlFor="g-last">Last name</label>
              <input id="g-last" style={s.input} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
            </div>
          </div>
        </>
      )}
      <label style={s.label} htmlFor="g-phone">Phone number</label>
      <input id="g-phone" style={s.input} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
        placeholder="e.g. 024 123 4567" autoComplete="tel" />
      {!existingAccount && (
        <>
          <label style={s.label} htmlFor="g-staffid">Staff ID (optional)</label>
          <input id="g-staffid" style={s.input} value={staffId} onChange={(e) => setStaffId(e.target.value)}
            placeholder="Leave blank to get one assigned" autoCapitalize="characters" />
        </>
      )}
      <button type="submit" style={{ ...s.primary, opacity: busy ? 0.7 : 1 }} disabled={busy}>
        {busy ? 'Saving...' : 'Continue'}
      </button>
      <button type="button" style={s.outline} onClick={onCancel} disabled={busy}>Back</button>
      {error && <div style={s.banner('error')}>{error}</div>}
    </form>
  );
}

function SignIn({ onSignedIn }) {
  const [code, setCode] = useState(session.lastInstitutionCode());
  const [staffId, setStaffId] = useState(session.lastStaffId());
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [profileStep, setProfileStep] = useState(null);
  const [error, setError] = useState('');

  const handleGoogle = async (idToken) => {
    setGoogleBusy(true);
    setError('');
    try {
      const { data } = await googleAuth(idToken, code.trim().toUpperCase());
      if (data.needsProfile) {
        setProfileStep({ idToken, profile: data.profile || {}, existingAccount: !!data.existingAccount });
        return;
      }
      session.save(data);
      onSignedIn();
    } catch (err) {
      setError(errorMessage(err, 'Google sign-in failed. Please try again.'));
    } finally {
      setGoogleBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const institutionCode = code.trim().toUpperCase();
    if (!institutionCode || !staffId.trim() || !password) {
      setError('Enter your institution code, Staff ID and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data } = await staffLogin(institutionCode, staffId.trim().toUpperCase(), password);
      session.save(data, institutionCode);
      onSignedIn();
    } catch (err) {
      setError(errorMessage(err, 'Sign-in failed. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.wrap}>
          <h1 style={s.brand}>GeoAttend</h1>
          <p style={s.sub}>Staff check-in</p>
        </div>
      </div>
      <div style={s.wrap}>
        {profileStep ? (
          <CompleteGoogleProfile step={profileStep} onDone={onSignedIn} onCancel={() => setProfileStep(null)} />
        ) : (
          <form style={s.card} onSubmit={submit}>
            <GoogleButton onCredential={handleGoogle} disabled={googleBusy || busy} />
            <p style={{ ...s.muted, textAlign: 'center', margin: '10px 0 0' }}>
              {googleBusy ? 'Signing in with Google... (up to a minute if the server is waking up)' : 'One tap. New staff can sign up this way too.'}
            </p>

            <Divider text="OR USE YOUR STAFF ID" />

            <label style={s.label} htmlFor="code">Institution Code</label>
            <input id="code" style={s.input} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. INST-123456" autoCapitalize="characters" autoComplete="organization" />
            <label style={s.label} htmlFor="staffId">Staff ID</label>
            <input id="staffId" style={s.input} value={staffId} onChange={(e) => setStaffId(e.target.value)}
              placeholder="Your Staff ID" autoCapitalize="characters" autoComplete="username" />
            <label style={s.label} htmlFor="password">Password</label>
            <input id="password" style={s.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password" autoComplete="current-password" />
            <button type="submit" style={{ ...s.primary, opacity: busy ? 0.7 : 1 }} disabled={busy || googleBusy}>
              {busy ? 'Signing in...' : 'Sign In'}
            </button>
            {busy && <p style={{ ...s.muted, textAlign: 'center', marginBottom: 0 }}>The first sign-in can take up to a minute while the server wakes up.</p>}
            {error && <div style={s.banner('error')}>{error}</div>}
          </form>
        )}
        <p style={{ ...s.muted, textAlign: 'center', marginTop: 16 }}>
          Use the same Staff ID and password as the GeoAttend app. Forgot them? Ask your administrator.
        </p>
      </div>
    </div>
  );
}

// ---------- Camera QR scanner ----------

function QrScanner({ onResult, onClose }) {
  const videoRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stream = null;
    let frame = 0;
    let lastScan = 0;
    let done = false;

    const scan = (time) => {
      if (done) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && time - lastScan > 150) {
        lastScan = time;
        const text = decodeFrame(video);
        if (text) {
          done = true;
          onResult(text);
          return;
        }
      }
      frame = requestAnimationFrame(scan);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (done) return;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        frame = requestAnimationFrame(scan);
      } catch (err) {
        setError(err?.name === 'NotAllowedError'
          ? 'Camera access is blocked. Allow the camera for this site, or close this and upload a photo of the QR code instead.'
          : 'Could not open the camera. Close this and upload a photo of the QR code instead.');
      }
    })();

    return () => {
      done = true;
      cancelAnimationFrame(frame);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div style={s.overlay}>
      <p style={{ color: '#fff', fontWeight: 700, fontSize: 17, margin: '0 0 12px' }}>Point the camera at the QR code</p>
      <video ref={videoRef} style={s.video} playsInline muted />
      {error && <div style={{ ...s.banner('error'), maxWidth: 420 }}>{error}</div>}
      <button type="button" style={{ ...s.outline, maxWidth: 420 }} onClick={onClose}>Cancel</button>
    </div>
  );
}

// ---------- Check-in home ----------

function Home({ onSignOut }) {
  const { user, institution } = session.get();
  const [status, setStatus] = useState(null);
  const [record, setRecord] = useState(null);
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef(null);

  const radius = institution?.geofenceRadius || 200;
  const distance = location && institution?.latitude != null
    ? distanceMeters(location.latitude, location.longitude, Number(institution.latitude), Number(institution.longitude))
    : null;

  const loadStatus = useCallback(async () => {
    try {
      const { data } = await getTodayStatus();
      setStatus(data.status);
      setRecord(data.record);
    } catch (err) {
      if (err?.response?.status === 401) {
        session.clear();
        onSignOut('Your session has expired. Please sign in again.');
        return;
      }
      setMessage({ type: 'error', text: errorMessage(err, 'Could not load today\'s status.') });
    }
  }, [onSignOut]);

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
    loadStatus();
    refreshLocation();
  }, [loadStatus, refreshLocation]);

  const afterCheckIn = (data, how) => {
    setMessage({ type: 'success', text: data.isLate ? `Checked in ${how}. You are marked as LATE.` : `Checked in ${how}. Have a good day!` });
    setStatus('checked_in');
    setRecord(data.record || null);
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
      setMessage({ type: 'error', text: errorMessage(err, 'Check-in failed. Please try again.') });
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
      setMessage({ type: 'error', text: errorMessage(err, 'Check-out failed. Please try again.') });
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
    if (!loc) return;
    const { data } = await checkIn({
      latitude: loc.latitude, longitude: loc.longitude, method: 'qr_code',
      qrCode: parsed.qrCode, qrToken: parsed.qrToken, deviceId: webDeviceId(),
    });
    afterCheckIn(data, 'with QR code');
  };

  const handleScanned = useCallback(async (text) => {
    setScanning(false);
    setBusy('qr');
    setMessage(null);
    try {
      await checkInWithQrText(text);
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Check-in failed. Please try again.') });
    } finally {
      setBusy('');
    }
  // Stable on purpose: the camera scanner restarts whenever onResult changes
  }, []);

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
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
      setMessage({ type: 'error', text: errorMessage(err, 'We could not read a QR code in that photo. Try a clearer, straight-on photo.') });
    } finally {
      setBusy('');
    }
  };

  const signOut = () => {
    session.clear();
    onSignOut();
  };

  const within = distance != null && distance <= radius;

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={{ ...s.wrap, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h1 style={s.brand}>Hi, {user?.firstName || 'there'}</h1>
            <p style={s.sub}>{institution?.name || user?.institutionName || ''} · {user?.staffId}</p>
          </div>
          <button type="button" style={s.link} onClick={signOut}>Sign out</button>
        </div>
      </div>

      <div style={s.wrap}>
        <div style={s.card}>
          <div style={s.muted}>Today</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>
            {status ? STATUS_TEXT[status] || status : 'Loading...'}
          </div>
          {record?.check_in_time && (
            <div style={{ ...s.muted, marginTop: 6 }}>
              In: {formatTime(record.check_in_time)}{record.is_late ? ' (late)' : ''}
              {record.check_out_time ? ` · Out: ${formatTime(record.check_out_time)}` : ''}
            </div>
          )}
        </div>

        <div style={s.card}>
          <div style={s.muted}>Your location</div>
          {locationError ? (
            <div style={{ ...s.banner('error'), marginTop: 8 }}>{locationError}</div>
          ) : distance == null ? (
            <div style={{ marginTop: 6 }}>Getting your location...</div>
          ) : (
            <div style={{ marginTop: 6, fontWeight: 700, color: within ? '#1e8449' : '#b03a2e' }}>
              {within ? `Within your workplace (${distance} m away)` : `${distance} m away — you must be within ${radius} m`}
            </div>
          )}
          <button type="button" style={{ ...s.link, color: NAVY, marginTop: 8 }} onClick={refreshLocation}>Refresh location</button>
        </div>

        {message && <div style={s.banner(message.type)}>{message.text}</div>}

        <div style={{ marginTop: 16, marginBottom: 12 }}>
          {status !== 'checked_in' && (
            <>
              <button type="button" style={{ ...s.primary, ...s.green, opacity: busy ? 0.7 : 1 }} disabled={!!busy} onClick={doGpsCheckIn}>
                {busy === 'checkin' ? 'Checking in...' : 'Check In'}
              </button>
              <button type="button" style={s.outline} disabled={!!busy} onClick={() => setScanning(true)}>
                {busy === 'qr' ? 'Checking in...' : 'Scan QR Code'}
              </button>
              <button type="button" style={s.outline} disabled={!!busy} onClick={() => fileRef.current?.click()}>
                Upload QR Code Photo
              </button>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhoto} />
            </>
          )}
          {status === 'checked_in' && (
            <button type="button" style={{ ...s.primary, ...s.red, opacity: busy ? 0.7 : 1 }} disabled={!!busy} onClick={doCheckOut}>
              {busy === 'checkout' ? 'Checking out...' : 'Check Out'}
            </button>
          )}
        </div>

        <p style={{ ...s.muted, textAlign: 'center' }}>
          GPS must be on. Check-in only works inside your institution's area.
        </p>

        {isIos && !isStandalone && (
          <div style={{ ...s.card, marginBottom: 24, fontSize: 14 }}>
            <strong>Tip:</strong> add GeoAttend to your Home Screen — tap the Share button <span aria-hidden>⎋</span> in Safari, then <strong>Add to Home Screen</strong>.
          </div>
        )}
      </div>

      {scanning && <QrScanner onResult={handleScanned} onClose={() => setScanning(false)} />}
    </div>
  );
}

// ---------- Root ----------

export default function StaffApp() {
  const [signedIn, setSignedIn] = useState(() => !!session.get().token);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    document.title = 'GeoAttend Staff';
    // Home Screen icon should reopen this page, not the admin dashboard
    const manifest = document.querySelector('link[rel="manifest"]');
    if (manifest) manifest.setAttribute('href', '/staff-manifest.json');
  }, []);

  const handleSignOut = useCallback((reason) => {
    setNotice(reason || '');
    setSignedIn(false);
  }, []);

  if (!signedIn) {
    return (
      <>
        {notice && <div style={{ ...s.banner('info'), margin: 0, borderRadius: 0, textAlign: 'center' }}>{notice}</div>}
        <SignIn onSignedIn={() => { setNotice(''); setSignedIn(true); }} />
      </>
    );
  }
  return <Home onSignOut={handleSignOut} />;
}
