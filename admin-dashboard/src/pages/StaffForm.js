import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { createStaff, getStaffById, updateStaff, getStaffQRCode } from '../services/api';
import { FiArrowLeft, FiSave, FiPrinter } from 'react-icons/fi';
import { printStaffQRCode } from '../utils/printQR';

const styles = {
  header: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' },
  backBtn: { background: 'none', color: '#7f8c8d', display: 'flex', alignItems: 'center' },
  title: { fontSize: '24px', fontWeight: '700' },
  card: { background: '#fff', borderRadius: '12px', padding: '32px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', maxWidth: '700px' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: '13px', fontWeight: '600', color: '#7f8c8d' },
  input: { padding: '10px 14px', border: '1px solid #e0e0e0', borderRadius: '8px', fontSize: '14px' },
  select: { padding: '10px 14px', border: '1px solid #e0e0e0', borderRadius: '8px', fontSize: '14px', background: '#fff' },
  saveBtn: {
    display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 28px',
    background: '#1a5276', color: '#fff', borderRadius: '8px', fontSize: '14px',
    fontWeight: '600', marginTop: '24px',
  },
  qrSection: { marginTop: '24px', textAlign: 'center' },
  qrImg: { maxWidth: '200px', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '8px' },
  printBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '12px',
    padding: '10px 20px', background: '#1a5276', color: '#fff', borderRadius: '8px',
    fontSize: '14px', fontWeight: '600',
  },
};

export default function StaffForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;

  const [form, setForm] = useState({
    staffId: '', firstName: '', lastName: '', email: '', phone: '',
    department: '', position: '', role: 'staff', password: '', isActive: true,
    hourlyRate: '',
  });
  const [qrCode, setQrCode] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isEdit) {
      getStaffById(id).then(r => {
        const s = r.data;
        setForm({
          staffId: s.staff_id, firstName: s.first_name, lastName: s.last_name,
          email: s.email || '', phone: s.phone || '', department: s.department || '',
          position: s.position || '', role: s.role, password: '', isActive: s.is_active,
          hourlyRate: s.hourly_rate !== null && s.hourly_rate !== undefined ? s.hourly_rate : '',
        });
      }).catch(() => toast.error('Failed to load staff'));

      getStaffQRCode(id).then(r => setQrCode(r.data.qrCode)).catch(() => {});
    }
  }, [id, isEdit]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const rate = form.hourlyRate === '' ? null : form.hourlyRate;
    try {
      if (isEdit) {
        await updateStaff(id, { ...form, hourlyRate: rate });
        toast.success('Staff updated successfully');
      } else {
        if (!form.password) {
          toast.error('Password is required');
          setLoading(false);
          return;
        }
        await createStaff({ ...form, hourlyRate: rate });
        toast.success('Staff created successfully');
      }
      navigate('/staff');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Operation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => navigate('/staff')}><FiArrowLeft size={20} /></button>
        <h1 style={styles.title}>{isEdit ? 'Edit Staff' : 'Add New Staff'}</h1>
      </div>

      <div style={styles.card}>
        <form onSubmit={handleSubmit}>
          <div style={styles.grid}>
            <div style={styles.field}>
              <label style={styles.label}>Staff ID *</label>
              <input style={styles.input} name="staffId" value={form.staffId} onChange={handleChange} required disabled={isEdit} placeholder="e.g. STF001" />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Role</label>
              <select style={styles.select} name="role" value={form.role} onChange={handleChange}>
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>First Name *</label>
              <input style={styles.input} name="firstName" value={form.firstName} onChange={handleChange} required />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Last Name *</label>
              <input style={styles.input} name="lastName" value={form.lastName} onChange={handleChange} required />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Email</label>
              <input style={styles.input} name="email" type="email" value={form.email} onChange={handleChange} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Phone</label>
              <input style={styles.input} name="phone" value={form.phone} onChange={handleChange} placeholder="+233..." />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Department</label>
              <input style={styles.input} name="department" value={form.department} onChange={handleChange} placeholder="e.g. Finance" />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Position</label>
              <input style={styles.input} name="position" value={form.position} onChange={handleChange} placeholder="e.g. Accountant" />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Hourly Rate</label>
              <input style={styles.input} name="hourlyRate" type="number" step="0.01" min="0" value={form.hourlyRate} onChange={handleChange} placeholder="Used when institution pays hourly" />
              <span style={{ fontSize: '11px', color: '#bdc3c7' }}>Leave empty for monthly-salary institutions</span>
            </div>
            {!isEdit && (
              <div style={styles.field}>
                <label style={styles.label}>Password *</label>
                <input style={styles.input} name="password" type="password" value={form.password} onChange={handleChange} required minLength={6} />
              </div>
            )}
            {isEdit && (
              <div style={{ ...styles.field, justifyContent: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="checkbox" name="isActive" checked={form.isActive} onChange={handleChange} />
                  <span style={{ fontSize: '14px' }}>Active</span>
                </label>
              </div>
            )}
          </div>

          <button style={{ ...styles.saveBtn, opacity: loading ? 0.7 : 1 }} disabled={loading} type="submit">
            <FiSave size={16} /> {loading ? 'Saving...' : (isEdit ? 'Update Staff' : 'Create Staff')}
          </button>
        </form>

        {qrCode && (
          <div style={styles.qrSection}>
            <h3 style={{ marginBottom: '12px', fontSize: '16px', fontWeight: '600' }}>QR Code ID Card</h3>
            <img src={qrCode} alt="QR Code" style={styles.qrImg} />
            <div>
              <button
                type="button"
                style={styles.printBtn}
                onClick={() => printStaffQRCode({
                  qrCode,
                  staffId: form.staffId,
                  firstName: form.firstName,
                  lastName: form.lastName,
                  department: form.department,
                  position: form.position,
                  institutionName: (JSON.parse(localStorage.getItem('user') || '{}')).institutionName,
                })}
              >
                <FiPrinter size={16} /> Print QR Code
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
