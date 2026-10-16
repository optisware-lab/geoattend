import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { createInstitution, getAllInstitutions, repairInstitutionCode, createInitialAdmin } from '../services/api';
import LocationPicker from '../components/LocationPicker';

// "5.70765, -0.00335" as copied from Google Maps (right-click on the map)
function newRequestId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r % 4) + 8).toString(16);
  });
}

const COORD_PAIR = /^\s*\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?\s*$/;

const styles = {
  container: { maxWidth: 760, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 700 },
  form: { background: '#fff', padding: 20, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  row: { display: 'flex', gap: 12, marginBottom: 12 },
  field: { flex: 1, display: 'flex', flexDirection: 'column' },
  label: { fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 },
  input: { padding: '10px 12px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 14, width: '100%' },
  btn: (bg) => ({ padding: '8px 16px', borderRadius: 8, background: bg, color: '#fff', border: 'none', cursor: 'pointer' }),
  codeBox: { marginTop: 16, padding: 12, background: '#f6f8fa', borderRadius: 8, fontFamily: 'monospace' },
  apiHint: { marginTop: 8, fontSize: 12, color: '#7f8c8d' },
  errorBox: { marginTop: 16, padding: 12, background: '#f8d7da', borderRadius: 8, border: '2px solid #dc3545', color: '#721c24' },
};

export default function CreateInstitution() {
  const DRAFT_KEY = 'createInstitutionDraft';
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [geofenceRadius, setGeofenceRadius] = useState(200);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);
  const [adminCredentials, setAdminCredentials] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  // One id per institution being created; resent on retries so the server never makes duplicates
  const [requestId, setRequestId] = useState(newRequestId);

  // load draft from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && typeof d === 'object') {
          const restored = {
            name: String(d.name ?? '').trim(),
            address: String(d.address ?? '').trim(),
            city: String(d.city ?? '').trim(),
            region: String(d.region ?? '').trim(),
            latitude: d.latitude === null || d.latitude === undefined ? '' : String(d.latitude),
            longitude: d.longitude === null || d.longitude === undefined ? '' : String(d.longitude),
            geofenceRadius: Number.isFinite(Number(d.geofenceRadius)) ? Number(d.geofenceRadius) : 200,
            requestId: typeof d.requestId === 'string' && d.requestId ? d.requestId : null,
          };

          const hasAny =
            !!(restored.name || restored.address || restored.city || restored.region || restored.latitude || restored.longitude);

          if (hasAny) {
            setName(restored.name);
            setAddress(restored.address);
            setCity(restored.city);
            setRegion(restored.region);
            setLatitude(restored.latitude);
            setLongitude(restored.longitude);
            setGeofenceRadius(restored.geofenceRadius);
            if (restored.requestId) setRequestId(restored.requestId);
            toast.info('Draft restored for Create Institution');
            setHasDraft(true);
          } else {
            // If the stored draft is empty, don't show "restored" messaging.
            setHasDraft(false);
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }, []);

  // persist draft to localStorage when fields change
  useEffect(() => {
    try {
      const draft = { name, address, city, region, latitude, longitude, geofenceRadius, requestId };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      setHasDraft(!!(name || address || city || region || latitude || longitude));
    } catch (e) {}
  }, [name, address, city, region, latitude, longitude, geofenceRadius, requestId]);

  // Pasting a "lat, lng" pair into either box fills both
  const handleCoordPaste = (e) => {
    const match = COORD_PAIR.exec(e.clipboardData.getData('text'));
    if (!match) return;
    e.preventDefault();
    setLatitude(match[1]);
    setLongitude(match[2]);
  };

  const submit = async (e) => {
    e && e.preventDefault();
    if (!name || !latitude || !longitude) return toast.error('Name, latitude and longitude are required');
    setCreating(true);
    try {
      const payload = { name, address, city, region, latitude: parseFloat(latitude), longitude: parseFloat(longitude), geofenceRadius: parseInt(geofenceRadius, 10), requestId };
      // Retry timeouts/network errors with the same requestId — the server returns
      // the institution it already made instead of creating another one
      let res;
      for (let attempt = 1; ; attempt++) {
        try {
          res = await createInstitution(payload);
          break;
        } catch (reqErr) {
          if (reqErr.response || attempt >= 3) throw reqErr;
          toast.info('Server is waking up — still creating, please wait...');
        }
      }
      let inst = res.data;

      // If backend did not return an institution code, try fetching the created institution
      if (!inst.institution_code && inst.id) {
        try {
          const listRes = await getAllInstitutions();
          const found = Array.isArray(listRes.data) ? listRes.data.find(i => i.id === inst.id) : null;
          if (found) inst = found;
        } catch (e) {
          // ignore fetch errors
        }
      }

      // Still missing code? Try repairing it (super_admin only).
      if (!inst.institution_code && inst.id) {
        try {
          const repaired = await repairInstitutionCode(inst.id);
          const repairedInst = repaired?.data?.institution;
          if (repairedInst) inst = repairedInst;
        } catch (e) {
          // ignore repair errors; raw response will still show for debugging
        }
      }

      setCreated(inst);

      // Backend auto-creates the initial admin and returns its credentials.
      // Fall back to createInitialAdmin for older backends that don't.
      const institutionCode = inst.institution_code || inst.institutionCode || inst.code;
      if (inst.adminCredentials) {
        setAdminCredentials(inst.adminCredentials);
        toast.success('Institution and admin account created successfully');
      } else if (institutionCode) {
        try {
          const adminRes = await createInitialAdmin({
            institutionCode,
            firstName: 'Admin',
            lastName: 'User',
          });
          setAdminCredentials(adminRes.data.credentials);
          toast.success('Institution and admin account created successfully');
        } catch (adminErr) {
          console.error('Failed to create admin:', adminErr);
          toast.warning('Institution created but admin account creation failed. You can create one manually.');
        }
      } else {
        toast.success('Institution created (no admin account - missing institution code)');
      }

      // Clear the form so the saved draft can't resubmit the same institution
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
      setName(''); setAddress(''); setCity(''); setRegion(''); setLatitude(''); setLongitude(''); setGeofenceRadius(200);
      setRequestId(newRequestId());
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not reach the server. Click Create again — it will not create a duplicate.');
    } finally { setCreating(false); }
  };

  const copyCode = async () => {
    const code = created?.institution_code || created?.institutionCode || created?.code || created?.data?.institution_code || created?.data?.code;
    if (!code) return toast.info('Institution code not available');
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Institution code copied');
    } catch {
      toast.info('Copy this code: ' + code);
    }
  };

  const copyAdminCredentials = async () => {
    if (!adminCredentials) return toast.info('Admin credentials not available');
    const code = created?.institution_code || created?.institutionCode || created?.code;
    const text = `Institution Code: ${code}\nAdmin ID: ${adminCredentials.staffId}\nPassword: ${adminCredentials.password}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Admin credentials copied');
    } catch {
      toast.info('Copy these credentials:\n' + text);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Create Institution</h2>
      </div>

      <form style={styles.form} onSubmit={submit}>
        <div style={styles.apiHint}>
          API base URL: <span style={{ fontFamily: 'monospace' }}>{process.env.REACT_APP_API_URL || '(default: Render)'}</span>
        </div>
        {hasDraft && (
          <div style={{ marginBottom: 12, padding: 10, background: '#fff8e1', borderRadius: 8 }}>
            <strong>Draft saved:</strong> your entered values were restored from a draft. <button type="button" onClick={() => { try { localStorage.removeItem(DRAFT_KEY); setHasDraft(false); setName(''); setAddress(''); setCity(''); setRegion(''); setLatitude(''); setLongitude(''); setGeofenceRadius(200); setRequestId(newRequestId()); } catch(e){} }} style={{ marginLeft: 8 }}>Clear draft</button>
          </div>
        )}
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="inst-name">Institution Name *</label>
            <input id="inst-name" style={styles.input} placeholder="e.g. Rising Soul Academy" value={name} onChange={e => setName(e.target.value)} />
          </div>
        </div>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="inst-address">Address</label>
            <input id="inst-address" style={styles.input} placeholder="Street address" value={address} onChange={e => setAddress(e.target.value)} />
          </div>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="inst-city">City</label>
            <input id="inst-city" style={styles.input} placeholder="e.g. Tema" value={city} onChange={e => setCity(e.target.value)} />
          </div>
        </div>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="inst-region">Region</label>
            <input id="inst-region" style={styles.input} placeholder="e.g. Greater Accra" value={region} onChange={e => setRegion(e.target.value)} />
          </div>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="inst-radius">Geofence Radius (meters)</label>
            <input id="inst-radius" style={styles.input} type="number" min="50" max="5000" placeholder="200" value={geofenceRadius} onChange={e => setGeofenceRadius(e.target.value)} />
          </div>
        </div>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="inst-lat">Latitude *</label>
            <input id="inst-lat" style={styles.input} placeholder="e.g. 5.7076" value={latitude} onChange={e => setLatitude(e.target.value)} onPaste={handleCoordPaste} />
          </div>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="inst-lng">Longitude *</label>
            <input id="inst-lng" style={styles.input} placeholder="e.g. -0.0033" value={longitude} onChange={e => setLongitude(e.target.value)} onPaste={handleCoordPaste} />
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#7f8c8d', margin: '-4px 0 12px' }}>
          Tip: paste coordinates copied from Google Maps (e.g. <code>5.70765, -0.00335</code>) into either box to fill both.
        </div>

        <LocationPicker
          latitude={latitude}
          longitude={longitude}
          radius={geofenceRadius}
          onChange={(lat, lng) => { setLatitude(lat); setLongitude(lng); }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={() => { setName(''); setAddress(''); setCity(''); setRegion(''); setLatitude(''); setLongitude(''); setGeofenceRadius(200); setCreated(null); setAdminCredentials(null); setRequestId(newRequestId()); try { localStorage.removeItem(DRAFT_KEY); } catch(e) {} }} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e0e0e0', background: '#fff' }}>Reset</button>
          <button type="submit" disabled={creating} style={styles.btn('#1a5276')}>{creating ? 'Creating...' : 'Create Institution'}</button>
        </div>

        {created && (
          <div style={styles.codeBox}>
            <div><strong>Institution created:</strong> {created.name || created.data?.name || '—'}</div>
            <div style={{ marginTop: 8 }}>
              <strong>Institution code:</strong>{' '}
              <span style={{ fontFamily: 'monospace', fontSize: 16, background: created.institution_code ? '#d4edda' : '#fff3cd', padding: '4px 8px', borderRadius: 4 }}>
                {created.institution_code || created.institutionCode || created.code || created.data?.institution_code || 'Not returned'}
              </span>
            </div>

            {adminCredentials && (
              <div style={{ marginTop: 16, padding: 12, background: '#d4edda', borderRadius: 8, border: '2px solid #28a745' }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: '#155724' }}>Admin Account Created</div>
                <div style={{ marginBottom: 4 }}>
                  <strong>Admin ID:</strong>{' '}
                  <span style={{ fontFamily: 'monospace', fontSize: 15 }}>{adminCredentials.staffId}</span>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <strong>Password:</strong>{' '}
                  <span style={{ fontFamily: 'monospace', fontSize: 15 }}>{adminCredentials.password}</span>
                </div>
                <button onClick={copyAdminCredentials} style={{ ...styles.btn('#28a745'), marginTop: 4 }}>
                  Copy All Credentials
                </button>
                <div style={{ marginTop: 8, fontSize: 13, color: '#155724' }}>
                  <strong>Important:</strong> Share these credentials with the institution admin. They should change the password after first login.
                </div>
              </div>
            )}

            {!adminCredentials && created.institution_code && (
              <div style={{ marginTop: 16, padding: 12, background: '#fff3cd', borderRadius: 8, border: '2px solid #ffc107' }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#856404' }}>⚠️ Admin Account Not Created</div>
                <div style={{ fontSize: 13, color: '#856404', marginBottom: 8 }}>
                  Institution was created but no admin credentials were generated. You can manually create them below.
                </div>
                <button onClick={() => createInitialAdmin({ institutionCode: created.institution_code, firstName: 'Admin', lastName: 'User' }).then(res => { setAdminCredentials(res.data.credentials); toast.success('Admin account created'); }).catch(err => toast.error('Failed to create admin: ' + (err.response?.data?.error || err.message)))} style={{ ...styles.btn('#ffc107'), color: '#000' }}>
                  Create Admin Account Now
                </button>
              </div>
            )}

            {!created.institution_code && (
              <div style={styles.errorBox}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>❌ Institution Code Missing</div>
                <div style={{ fontSize: 13, marginBottom: 8 }}>
                  The institution was created but no code was returned. This usually means the backend is running an older version. Please contact support or check the API health endpoint.
                </div>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <button onClick={copyCode} style={{ ...styles.btn('#27ae60'), marginRight: 8 }}>Copy Institution Code</button>
              <label style={{ marginLeft: 8 }}><input type="checkbox" checked={showRaw} onChange={e => setShowRaw(e.target.checked)} /> Show raw response</label>
              {showRaw && (
                <pre style={{ marginTop: 8, maxHeight: 200, overflow: 'auto', background: '#fff', padding: 8 }}>{JSON.stringify(created, null, 2)}</pre>
              )}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
