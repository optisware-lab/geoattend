import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { FiSave, FiMapPin, FiCrosshair, FiPrinter, FiDownload, FiShare2, FiRefreshCw } from 'react-icons/fi';
import { getInstitution, updateInstitution, getAttendanceRules, updateAttendanceRules, getInstitutionQR, rotateInstitutionQR } from '../services/api';

const styles = {
  title: { fontSize: '24px', fontWeight: '700', marginBottom: '24px' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', maxWidth: '900px', alignItems: 'flex-start' },
  card: { background: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardTitle: { fontSize: '16px', fontWeight: '600', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' },
  label: { fontSize: '12px', fontWeight: '600', color: '#7f8c8d', textTransform: 'uppercase' },
  input: { padding: '10px 14px', border: '1px solid #e0e0e0', borderRadius: '8px', fontSize: '14px' },
  hint: { fontSize: '11px', color: '#bdc3c7' },
  saveBtn: {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '10px 24px', background: '#1a5276', color: '#fff',
    borderRadius: '8px', fontSize: '14px', fontWeight: '500', marginTop: '8px',
    border: 'none', cursor: 'pointer',
  },
  locationBtn: {
    display: 'flex', alignItems: 'center', gap: '6px',
    padding: '10px 20px', background: '#27ae60', color: '#fff',
    borderRadius: '8px', fontSize: '13px', fontWeight: '600',
    border: 'none', cursor: 'pointer', marginBottom: '16px',
    transition: 'all 0.2s ease',
  },
  locationBtnActive: {
    background: '#219a52', transform: 'scale(0.96)',
    boxShadow: '0 0 0 3px rgba(39, 174, 96, 0.3)',
  },
  dayGrid: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  dayBtn: (active) => ({
    padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '500',
    background: active ? '#1a5276' : '#f0f0f0', color: active ? '#fff' : '#7f8c8d',
    border: 'none',
  }),
};

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Settings() {
  const [inst, setInst] = useState({ name: '', address: '', city: '', region: '', latitude: '', longitude: '', geofence_radius: 200, payment_mode: 'monthly', currency: 'GHS' });
  const [rules, setRules] = useState({ work_start_time: '08:00', work_end_time: '17:00', late_threshold_minutes: 15, early_departure_minutes: 30, working_days: [1,2,3,4,5], overtime_multiplier: 1.5 });
  const [gettingLocation, setGettingLocation] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 900);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }
    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        setInst(p => ({
          ...p,
          latitude: lat.toFixed(8),
          longitude: lon.toFixed(8),
        }));

        // Reverse geocode to get address
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, {
            headers: { 'Accept-Language': 'en' },
          });
          const data = await res.json();
          if (data.address) {
            const addr = data.address;
            setInst(p => ({
              ...p,
              address: data.display_name?.split(',').slice(0, 3).join(',').trim() || '',
              city: addr.city || addr.town || addr.village || addr.county || '',
              region: addr.state || addr.region || '',
            }));
          }
        } catch (e) {
          // Silently fail — coordinates are already set
        }

        toast.success(`Location detected: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
        setGettingLocation(false);
      },
      (error) => {
        toast.error('Failed to get location. Please allow location access.');
        setGettingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  useEffect(() => {
    getInstitution().then(r => setInst(r.data)).catch(() => {});
    getAttendanceRules().then(r => { if (r.data && r.data.id) setRules(r.data); }).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const saveInstitution = async () => {
    try {
      await updateInstitution({
        name: inst.name, address: inst.address, city: inst.city, region: inst.region,
        latitude: parseFloat(inst.latitude), longitude: parseFloat(inst.longitude),
        geofenceRadius: parseInt(inst.geofence_radius, 10),
        paymentMode: inst.payment_mode || 'monthly',
        currency: inst.currency || 'GHS',
      });
      toast.success('Institution settings saved');
    } catch { toast.error('Failed to save'); }
  };

  const saveRules = async () => {
    try {
      await updateAttendanceRules({
        workStartTime: rules.work_start_time,
        workEndTime: rules.work_end_time,
        lateThresholdMinutes: parseInt(rules.late_threshold_minutes, 10),
        earlyDepartureMinutes: parseInt(rules.early_departure_minutes, 10),
        workingDays: rules.working_days,
        overtimeMultiplier: rules.overtime_multiplier ? parseFloat(rules.overtime_multiplier) : 1.5,
      });
      toast.success('Attendance rules saved');
    } catch { toast.error('Failed to save'); }
  };

  const toggleDay = (day) => {
    setRules(prev => ({
      ...prev,
      working_days: prev.working_days.includes(day)
        ? prev.working_days.filter(d => d !== day)
        : [...prev.working_days, day].sort(),
    }));
  };

  return (
    <div>
      <h1 style={styles.title}>Settings</h1>

      <div style={{ ...styles.grid, gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr' }}>
        <div style={styles.card}>
          <h3 style={styles.cardTitle}><FiMapPin size={18} /> Institution & Geofence</h3>
          <div style={styles.field}>
            <label style={styles.label}>Institution Name</label>
            <input style={styles.input} value={inst.name || ''} onChange={e => setInst(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Address</label>
            <input style={styles.input} value={inst.address || ''} onChange={e => setInst(p => ({ ...p, address: e.target.value }))} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={styles.field}>
              <label style={styles.label}>City</label>
              <input style={styles.input} value={inst.city || ''} onChange={e => setInst(p => ({ ...p, city: e.target.value }))} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Region</label>
              <input style={styles.input} value={inst.region || ''} onChange={e => setInst(p => ({ ...p, region: e.target.value }))} />
            </div>
          </div>
          <button
            style={{
              ...styles.locationBtn,
              ...(gettingLocation ? styles.locationBtnActive : {}),
              opacity: gettingLocation ? 0.85 : 1,
            }}
            onClick={useCurrentLocation}
            disabled={gettingLocation}
            onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.96)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(39, 174, 96, 0.3)'; }}
            onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}
          >
            <FiCrosshair size={14} style={gettingLocation ? { animation: 'spin 1s linear infinite' } : {}} />
            {gettingLocation ? 'Detecting location...' : 'Use My Current Location'}
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={styles.field}>
              <label style={styles.label}>Latitude</label>
              <input style={styles.input} type="number" step="any" value={inst.latitude || ''} onChange={e => setInst(p => ({ ...p, latitude: e.target.value }))} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Longitude</label>
              <input style={styles.input} type="number" step="any" value={inst.longitude || ''} onChange={e => setInst(p => ({ ...p, longitude: e.target.value }))} />
            </div>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Geofence Radius (meters)</label>
            <input style={styles.input} type="number" value={inst.geofence_radius || ''} onChange={e => setInst(p => ({ ...p, geofence_radius: e.target.value }))} />
            <span style={styles.hint}>Area within which staff can check in (recommended: 100-500m)</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={styles.field}>
              <label style={styles.label}>Payment Mode</label>
              <select
                style={styles.input}
                value={inst.payment_mode || 'monthly'}
                onChange={e => setInst(p => ({ ...p, payment_mode: e.target.value }))}
              >
                <option value="monthly">Monthly Salary</option>
                <option value="hourly">Hourly Rate (payroll auto-calc)</option>
              </select>
              <span style={styles.hint}>Hourly mode enables per-staff earnings on the Payroll page</span>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Currency</label>
              <input style={styles.input} placeholder="GHS" maxLength={10} value={inst.currency || ''} onChange={e => setInst(p => ({ ...p, currency: e.target.value.toUpperCase() }))} />
            </div>
          </div>
          <button
            style={styles.saveBtn}
            onClick={saveInstitution}
            onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.96)'; }}
            onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
          ><FiSave size={14} /> Save Institution</button>
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Staff Attendance Rules</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={styles.field}>
              <label style={styles.label}>Work Start Time</label>
              <input style={styles.input} type="time" value={rules.work_start_time || ''} onChange={e => setRules(p => ({ ...p, work_start_time: e.target.value }))} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Work End Time</label>
              <input style={styles.input} type="time" value={rules.work_end_time || ''} onChange={e => setRules(p => ({ ...p, work_end_time: e.target.value }))} />
            </div>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Late Threshold (minutes after start)</label>
            <input style={styles.input} type="number" value={rules.late_threshold_minutes || ''} onChange={e => setRules(p => ({ ...p, late_threshold_minutes: e.target.value }))} />
            <span style={styles.hint}>Staff arriving this many minutes after start time are marked late</span>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Early Departure (minutes before end)</label>
            <input style={styles.input} type="number" value={rules.early_departure_minutes || ''} onChange={e => setRules(p => ({ ...p, early_departure_minutes: e.target.value }))} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Overtime Multiplier</label>
            <input style={styles.input} type="number" step="0.25" min="1" max="3" value={rules.overtime_multiplier || ''} onChange={e => setRules(p => ({ ...p, overtime_multiplier: e.target.value }))} />
            <span style={styles.hint}>Hourly pay multiplier for overtime (e.g. 1.5 = time and a half)</span>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Working Days</label>
            <div style={styles.dayGrid}>
              {dayNames.map((name, i) => (
                <button key={i} style={styles.dayBtn(rules.working_days?.includes(i))} onClick={() => toggleDay(i)}>
                  {name}
                </button>
              ))}
            </div>
          </div>
          <button
            style={styles.saveBtn}
            onClick={saveRules}
            onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.96)'; }}
            onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
          ><FiSave size={14} /> Save Rules</button>
        </div>
      </div>

      {/* Institution Check-In QR Code */}
      <div style={{ ...styles.card, marginTop: '24px', maxWidth: '900px', textAlign: 'center' }}>
        <h3 style={styles.cardTitle}><FiPrinter size={16} /> Institution Check-In QR Code</h3>
        <p style={{ fontSize: '13px', color: '#7f8c8d', marginBottom: '16px' }}>
          Generate a single QR code for your institution. Print and post it at entrances — staff scan it to check in.
        </p>
        <InstitutionQR />
      </div>
    </div>
  );
}

function InstitutionQR() {
  const [qrCode, setQrCode] = React.useState(null);
  const [institutionName, setInstitutionName] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [rotating, setRotating] = React.useState(false);

  const generateQR = async () => {
    setLoading(true);
    try {
      const { data } = await getInstitutionQR();
      setQrCode(data.qrCode);
      setInstitutionName(data.institutionName);
    } catch {
      toast.error('Failed to generate QR code');
    } finally {
      setLoading(false);
    }
  };

  const rotateQR = async () => {
    if (!window.confirm('Rotate the QR token? Old printed posters will STOP working — reprint and replace them at your entrances.')) return;
    setRotating(true);
    try {
      const { data } = await rotateInstitutionQR();
      if (data && data.qrCode) {
        setQrCode(data.qrCode);
        setInstitutionName(data.institutionName);
      }
      toast.success(data?.message || 'QR token rotated — print the new code');
    } catch {
      toast.error('Failed to rotate QR token');
    } finally {
      setRotating(false);
    }
  };

  const printQR = () => {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html><head><title>Check-In QR - ${institutionName}</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 40px; }
        .card { border: 3px solid #1a5276; border-radius: 16px; padding: 32px; display: inline-block; max-width: 400px; }
        .logo { font-size: 24px; font-weight: bold; color: #1a5276; margin-bottom: 4px; }
        .subtitle { font-size: 12px; color: #7f8c8d; margin-bottom: 16px; }
        .name { font-size: 18px; font-weight: bold; color: #2c3e50; margin-top: 16px; }
        img { width: 300px; height: 300px; }
        .instruction { font-size: 14px; color: #555; margin-top: 12px; padding: 8px 16px; background: #f0f2f5; border-radius: 8px; }
        .footer { font-size: 11px; color: #999; margin-top: 16px; }
        @media print { body { padding: 0; } }
      </style></head><body>
      <div class="card">
        <div class="logo">GeoAttend</div>
        <div class="subtitle">Attendance Check-In</div>
        <img src="${qrCode}" />
        <div class="name">${institutionName}</div>
        <div class="instruction">Open GeoAttend app → QR Scan → Scan this code</div>
        <div class="footer">Powered by Optisware</div>
      </div>
      <script>window.print();</script>
      </body></html>
    `);
  };

  const qrFileName = () =>
    `${(institutionName || 'institution').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}-checkin-qr.png`;

  const downloadQR = () => {
    if (!qrCode) return;
    const a = document.createElement('a');
    a.href = qrCode;
    a.download = qrFileName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success('QR code downloaded');
  };

  const shareQR = async () => {
    if (!qrCode) return;
    try {
      // Convert the data URI into a shareable File
      const blob = await (await fetch(qrCode)).blob();
      const file = new File([blob], qrFileName(), { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `${institutionName} Check-In QR Code`,
          text: `Scan this QR code with the GeoAttend app to check in at ${institutionName}.`,
        });
        return;
      }

      // Fallback: copy the image itself to the clipboard
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast.success('QR image copied — paste it anywhere to share');
        return;
      }

      // Final fallback: download it
      downloadQR();
      toast.info('Sharing not supported in this browser — QR code downloaded instead');
    } catch (err) {
      if (err && err.name === 'AbortError') return; // user dismissed the share sheet
      toast.error('Failed to share QR code');
    }
  };

  return (
    <div>
      {!qrCode ? (
        <button
          onClick={generateQR}
          disabled={loading}
          style={{
            padding: '12px 32px', background: '#1a5276', color: '#fff',
            borderRadius: '8px', fontSize: '14px', fontWeight: '600',
            border: 'none', cursor: 'pointer', opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? 'Generating...' : 'Generate Check-In QR Code'}
        </button>
      ) : (
        <div>
          <img src={qrCode} alt="Institution QR" style={{ width: '250px', border: '2px solid #e0e0e0', borderRadius: '12px', padding: '8px' }} />
          <p style={{ fontSize: '16px', fontWeight: '600', color: '#2c3e50', marginTop: '12px' }}>{institutionName}</p>
          <p style={{ fontSize: '12px', color: '#95a5a6' }}>Staff scan this QR code to check in</p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px', flexWrap: 'wrap' }}>
            <button
              onClick={printQR}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '10px 24px', background: '#8e44ad', color: '#fff',
                borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                border: 'none', cursor: 'pointer',
              }}
            >
              <FiPrinter size={14} /> Print QR Code
            </button>
            <button
              onClick={downloadQR}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '10px 24px', background: '#27ae60', color: '#fff',
                borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                border: 'none', cursor: 'pointer',
              }}
            >
              <FiDownload size={14} /> Download
            </button>
            <button
              onClick={shareQR}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '10px 24px', background: '#2980b9', color: '#fff',
                borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                border: 'none', cursor: 'pointer',
              }}
            >
              <FiShare2 size={14} /> Share
            </button>
            <button
              onClick={generateQR}
              style={{
                padding: '10px 24px', background: '#fff', color: '#1a5276',
                borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                border: '1px solid #e0e0e0', cursor: 'pointer',
              }}
            >
              Regenerate
            </button>
            <button
              onClick={rotateQR}
              disabled={rotating}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '10px 24px', background: '#e74c3c', color: '#fff',
                borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                border: 'none', cursor: 'pointer', opacity: rotating ? 0.7 : 1,
              }}
            >
              <FiRefreshCw size={14} /> {rotating ? 'Rotating...' : 'Invalidate Old Posters'}
            </button>
          </div>
          <p style={{ fontSize: '11px', color: '#e74c3c', marginTop: '10px' }}>
            Use "Invalidate Old Posters" if a code was leaked or copied — it issues a new token so any previously printed QR stops working.
          </p>
        </div>
      )}
    </div>
  );
}
