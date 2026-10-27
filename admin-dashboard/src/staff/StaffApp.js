import React, { useCallback, useEffect, useState } from 'react';
import {
  session, staffLogin, googleAuth, completeGoogleSignup, registerStaff, forgotPassword, forgotStaffId, errorMessage,
} from './staffApi';
import GoogleButton from './GoogleButton';
import StaffHome from './StaffHome';

const NAVY = '#1a5276';

const s = {
  page: { minHeight: '100vh', background: NAVY, fontFamily: 'Inter, -apple-system, Segoe UI, Roboto, sans-serif', color: '#2c3e50' },
  header: { background: NAVY, color: '#fff', padding: '18px 16px 22px' },
  wrap: { maxWidth: 480, margin: '0 auto', padding: '0 16px' },
  brand: { fontSize: 28, fontWeight: 700, margin: 0, color: '#fff' },
  sub: { fontSize: 14, color: 'rgba(255,255,255,0.7)', margin: '4px 0 0' },
  card: { background: '#fff', borderRadius: 16, padding: 24, marginTop: 14, boxShadow: '0 10px 20px rgba(0,0,0,0.15)' },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#7f8c8d', margin: '0 0 6px' },
  input: { width: '100%', boxSizing: 'border-box', padding: '13px 14px', fontSize: 16, border: '1.5px solid #e0e0e0', borderRadius: 10, marginBottom: 14, outline: 'none' },
  primary: { width: '100%', padding: 16, fontSize: 17, fontWeight: 700, color: '#fff', background: NAVY, border: 'none', borderRadius: 12, cursor: 'pointer' },
  green: { background: '#27ae60' },
  red: { background: '#c0392b' },
  outline: { width: '100%', padding: 14, fontSize: 15, fontWeight: 700, color: NAVY, background: '#fff', border: `2px solid ${NAVY}`, borderRadius: 12, cursor: 'pointer', marginTop: 10 },
  // White on the navy page: as visible as Sign In, without competing inside the card
  signUpBtn: { width: '100%', padding: 16, fontSize: 17, fontWeight: 700, color: NAVY, background: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', fontFamily: 'inherit' },
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

/** "Sign In | Sign Up" switch under the logo, so new staff see Sign Up straight away. */
function AuthSwitch({ view, onChange }) {
  const option = (key, label) => {
    const active = view === key;
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onChange(key)}
        style={{
          flex: 1, padding: '12px 8px', borderRadius: 10, border: 'none', cursor: 'pointer',
          fontSize: 16, fontWeight: 700, fontFamily: 'inherit',
          background: active ? '#fff' : 'transparent', color: active ? NAVY : '#fff',
          boxShadow: active ? '0 2px 8px rgba(0,0,0,0.15)' : 'none',
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div role="group" aria-label="Sign in or sign up" style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 14, background: 'rgba(255,255,255,0.15)', marginBottom: 4 }}>
      {option('signin', 'Sign In')}
      {option('signup', 'Sign Up')}
    </div>
  );
}

const textLink = { background: 'none', border: 'none', color: NAVY, fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: '6px 0' };

/** New staff account: Google (one tap) or a short form. */
function SignUpForm({ initialCode, onGoogle, googleBusy, onSignedIn, onBack }) {
  const [form, setForm] = useState({
    code: initialCode, firstName: '', lastName: '', staffId: '', phone: '', email: '', password: '', confirm: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: key === 'code' || key === 'staffId' ? e.target.value.toUpperCase() : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const institutionCode = form.code.trim();
    const staffId = form.staffId.trim();
    if (!institutionCode || !form.firstName.trim() || !form.lastName.trim() || !staffId || !form.phone.trim() || !form.email.trim()) {
      setError('Fill in every field.');
      return;
    }
    if (form.password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return; }

    setBusy(true);
    setError('');
    try {
      await registerStaff({
        institutionCode, staffId,
        firstName: form.firstName.trim(), lastName: form.lastName.trim(),
        phone: form.phone.trim(), email: form.email.trim().toLowerCase(), password: form.password,
      });
      // Sign straight in with the new account
      const { data } = await staffLogin(institutionCode, staffId, form.password);
      session.save(data, institutionCode);
      onSignedIn();
    } catch (err) {
      setError(errorMessage(err, 'Could not create your account. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form style={s.card} onSubmit={submit}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Create your account</div>
      <GoogleButton text="signup_with" onCredential={onGoogle} disabled={googleBusy || busy} />
      <p style={{ ...s.muted, textAlign: 'center', margin: '10px 0 0' }}>
        {googleBusy ? 'Signing up with Google... (up to a minute if the server is waking up)' : 'Fastest: sign up with Google, then add your phone and institution code.'}
      </p>

      <Divider text="OR FILL IN THE FORM" />

      <label style={s.label} htmlFor="r-code">Institution Code</label>
      <input id="r-code" style={s.input} value={form.code} onChange={set('code')} placeholder="Ask your administrator, e.g. INST-123456" autoCapitalize="characters" />
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={s.label} htmlFor="r-first">First name</label>
          <input id="r-first" style={s.input} value={form.firstName} onChange={set('firstName')} autoComplete="given-name" />
        </div>
        <div style={{ flex: 1 }}>
          <label style={s.label} htmlFor="r-last">Last name</label>
          <input id="r-last" style={s.input} value={form.lastName} onChange={set('lastName')} autoComplete="family-name" />
        </div>
      </div>
      <label style={s.label} htmlFor="r-staffid">Staff ID</label>
      <input id="r-staffid" style={s.input} value={form.staffId} onChange={set('staffId')} placeholder="Your staff number, e.g. STF001" autoCapitalize="characters" autoComplete="username" />
      <label style={s.label} htmlFor="r-phone">Phone number</label>
      <input id="r-phone" style={s.input} type="tel" value={form.phone} onChange={set('phone')} placeholder="e.g. 024 123 4567" autoComplete="tel" />
      <label style={s.label} htmlFor="r-email">Email</label>
      <input id="r-email" style={s.input} type="email" value={form.email} onChange={set('email')} placeholder="Used to reset your password" autoComplete="email" />
      <label style={s.label} htmlFor="r-pass">Password</label>
      <input id="r-pass" style={s.input} type="password" value={form.password} onChange={set('password')} placeholder="At least 6 characters" autoComplete="new-password" />
      <label style={s.label} htmlFor="r-confirm">Confirm password</label>
      <input id="r-confirm" style={s.input} type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
      <button type="submit" style={{ ...s.primary, opacity: busy ? 0.7 : 1 }} disabled={busy || googleBusy}>
        {busy ? 'Creating account...' : 'Create Account'}
      </button>
      {error && <div style={s.banner('error')}>{error}</div>}
      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <button type="button" style={textLink} onClick={onBack}>Already have an account? Sign in</button>
      </div>
    </form>
  );
}

function ForgotPasswordForm({ initialCode, initialStaffId, onDone, onBack }) {
  const [code, setCode] = useState(initialCode);
  const [staffId, setStaffId] = useState(initialStaffId);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim() || !staffId.trim() || !email.trim()) { setError('Enter your institution code, Staff ID and email.'); return; }
    if (password.length < 6) { setError('New password must be at least 6 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    setError('');
    try {
      await forgotPassword(code.trim().toUpperCase(), staffId.trim().toUpperCase(), email.trim(), password);
      onDone(staffId.trim().toUpperCase(), 'Password changed. Sign in with your new password.');
    } catch (err) {
      setError(errorMessage(err, 'Could not reset your password. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form style={s.card} onSubmit={submit}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>Reset your password</div>
      <p style={{ ...s.muted, margin: '6px 0 16px' }}>Enter the email on your GeoAttend account. Signed up with Google? Just use Continue with Google instead.</p>
      <label style={s.label} htmlFor="f-code">Institution Code</label>
      <input id="f-code" style={s.input} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" />
      <label style={s.label} htmlFor="f-staffid">Staff ID</label>
      <input id="f-staffid" style={s.input} value={staffId} onChange={(e) => setStaffId(e.target.value)} autoCapitalize="characters" autoComplete="username" />
      <label style={s.label} htmlFor="f-email">Email</label>
      <input id="f-email" style={s.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      <label style={s.label} htmlFor="f-pass">New password</label>
      <input id="f-pass" style={s.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" autoComplete="new-password" />
      <label style={s.label} htmlFor="f-confirm">Confirm new password</label>
      <input id="f-confirm" style={s.input} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      <button type="submit" style={{ ...s.primary, opacity: busy ? 0.7 : 1 }} disabled={busy}>
        {busy ? 'Saving...' : 'Reset Password'}
      </button>
      {error && <div style={s.banner('error')}>{error}</div>}
      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <button type="button" style={textLink} onClick={onBack}>Back to sign in</button>
      </div>
    </form>
  );
}

function ForgotStaffIdForm({ initialCode, onUse, onBack }) {
  const [code, setCode] = useState(initialCode);
  const [email, setEmail] = useState('');
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim() || !email.trim()) { setError('Enter your institution code and email.'); return; }
    setBusy(true);
    setError('');
    setFound(null);
    try {
      const { data } = await forgotStaffId(code.trim().toUpperCase(), email.trim());
      setFound(data);
    } catch (err) {
      setError(errorMessage(err, 'Could not find your Staff ID. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form style={s.card} onSubmit={submit}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>Find your Staff ID</div>
      <p style={{ ...s.muted, margin: '6px 0 16px' }}>Enter the email on your GeoAttend account.</p>
      <label style={s.label} htmlFor="s-code">Institution Code</label>
      <input id="s-code" style={s.input} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" />
      <label style={s.label} htmlFor="s-email">Email</label>
      <input id="s-email" style={s.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      <button type="submit" style={{ ...s.primary, opacity: busy ? 0.7 : 1 }} disabled={busy}>
        {busy ? 'Searching...' : 'Find My Staff ID'}
      </button>
      {error && <div style={s.banner('error')}>{error}</div>}
      {found && (
        <div style={s.banner('success')}>
          {found.firstName ? `${found.firstName}, your` : 'Your'} Staff ID is <strong>{found.staffId}</strong>
          <div style={{ marginTop: 8 }}>
            <button type="button" style={{ ...textLink, color: '#1e8449' }} onClick={() => onUse(found.staffId, code.trim().toUpperCase())}>
              Use it to sign in →
            </button>
          </div>
        </div>
      )}
      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <button type="button" style={textLink} onClick={onBack}>Back to sign in</button>
      </div>
    </form>
  );
}

function SignIn({ onSignedIn }) {
  const [view, setView] = useState(() => (window.location.hash === '#signup' ? 'signup' : 'signin'));
  const [info, setInfo] = useState('');
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
      <div style={{ ...s.wrap, paddingTop: 40, paddingBottom: 32 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ width: 80, height: 80, borderRadius: 40, background: 'rgba(255,255,255,0.15)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <span style={{ fontSize: 36, fontWeight: 700, color: '#fff' }}>G</span>
          </div>
          <h1 style={s.brand}>GeoAttend</h1>
          <p style={s.sub}>Staff Attendance System</p>
        </div>
        {!profileStep && (view === 'signin' || view === 'signup') && (
          <AuthSwitch view={view} onChange={(v) => { setError(''); setInfo(''); setView(v); }} />
        )}
        {info && !profileStep && view === 'signin' && <div style={s.banner('success')}>{info}</div>}
        {profileStep ? (
          <CompleteGoogleProfile step={profileStep} onDone={onSignedIn} onCancel={() => setProfileStep(null)} />
        ) : view === 'signup' ? (
          <>
            <SignUpForm initialCode={code} onGoogle={handleGoogle} googleBusy={googleBusy} onSignedIn={onSignedIn} onBack={() => setView('signin')} />
            {error && <div style={s.banner('error')}>{error}</div>}
          </>
        ) : view === 'forgotPassword' ? (
          <ForgotPasswordForm
            initialCode={code}
            initialStaffId={staffId}
            onBack={() => setView('signin')}
            onDone={(id, msg) => { setStaffId(id); setPassword(''); setInfo(msg); setView('signin'); }}
          />
        ) : view === 'forgotStaffId' ? (
          <ForgotStaffIdForm
            initialCode={code}
            onBack={() => setView('signin')}
            onUse={(id, inst) => { setStaffId(id); if (inst) setCode(inst); setInfo(`Staff ID filled in: ${id}`); setView('signin'); }}
          />
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
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap', gap: 4 }}>
              <button type="button" style={textLink} onClick={() => { setError(''); setInfo(''); setView('forgotPassword'); }}>Forgot password?</button>
              <button type="button" style={textLink} onClick={() => { setError(''); setInfo(''); setView('forgotStaffId'); }}>Forgot Staff ID?</button>
            </div>
          </form>
        )}
        {view === 'signin' && !profileStep && (
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, marginBottom: 10 }}>New to GeoAttend?</div>
            <button type="button" style={s.signUpBtn} onClick={() => { setError(''); setInfo(''); setView('signup'); window.scrollTo(0, 0); }}>
              Create an Account
            </button>
          </div>
        )}
        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 28 }}>
          Geofenced Staff Attendance System
          <br />
          Powered by Optisware
        </p>
      </div>
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
  return <StaffHome onSignOut={handleSignOut} />;
}
