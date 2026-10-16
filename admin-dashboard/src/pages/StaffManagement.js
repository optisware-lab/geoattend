import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FiPlus, FiSearch, FiEdit2, FiKey, FiFilter, FiUpload, FiTrash2, FiPrinter } from 'react-icons/fi';
import { getStaff, getDepartments, resetStaffPassword, deleteStaff, getStaffQRCode } from '../services/api';
import api from '../services/api';
import { printStaffQRCode } from '../utils/printQR';

const styles = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' },
  title: { fontSize: '24px', fontWeight: '700' },
  addBtn: {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '10px 20px', background: '#1a5276', color: '#fff',
    borderRadius: '8px', fontSize: '14px', fontWeight: '500',
  },
  filters: {
    display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap',
  },
  searchBox: {
    display: 'flex', alignItems: 'center', gap: '8px',
    background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px',
    padding: '8px 14px', flex: 1, minWidth: '240px',
  },
  searchInput: { border: 'none', flex: 1, fontSize: '14px' },
  select: {
    padding: '8px 14px', border: '1px solid #e0e0e0', borderRadius: '8px',
    background: '#fff', fontSize: '14px', minWidth: '160px',
  },
  table: { width: '100%', background: '#fff', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  th: { padding: '14px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#7f8c8d', textTransform: 'uppercase', borderBottom: '2px solid #f0f0f0' },
  td: { padding: '14px 16px', fontSize: '14px', borderBottom: '1px solid #f5f5f5' },
  badge: (active) => ({
    padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: '600',
    background: active ? '#e8f5e9' : '#ffebee',
    color: active ? '#27ae60' : '#e74c3c',
  }),
  googleBadge: {
    marginLeft: '8px', padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: '600',
    background: '#e8f0fe', color: '#1a73e8', verticalAlign: 'middle',
  },
  actionBtn: { background: 'none', padding: '6px', borderRadius: '6px', color: '#7f8c8d', marginRight: '4px' },
  pagination: { display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' },
  pageBtn: (active) => ({
    padding: '8px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: '500',
    background: active ? '#1a5276' : '#fff', color: active ? '#fff' : '#2c3e50',
    border: '1px solid #e0e0e0',
  }),
  modalOverlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: '#fff', borderRadius: '12px', padding: '24px',
    width: '400px', maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  cancelBtn: {
    padding: '8px 20px', borderRadius: '6px', fontSize: '14px',
    background: '#f0f0f0', color: '#333', border: 'none', cursor: 'pointer',
  },
  deleteBtn: {
    padding: '8px 20px', borderRadius: '6px', fontSize: '14px',
    background: '#e74c3c', color: '#fff', border: 'none', cursor: 'pointer',
  },
};

export default function StaffManagement() {
  const navigate = useNavigate();
  const [staff, setStaff] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [departments, setDepartments] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const fileInputRef = React.useRef(null);

  const handleCSVUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const text = await file.text();
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

    const staffList = lines.slice(1).filter(l => l.trim()).map(line => {
      const values = line.split(',').map(v => v.trim());
      const row = {};
      headers.forEach((h, i) => { row[h] = values[i]; });
      return {
        staffId: row['staffid'] || row['staff_id'] || row['id'],
        firstName: row['firstname'] || row['first_name'] || row['first name'],
        lastName: row['lastname'] || row['last_name'] || row['last name'],
        email: row['email'] || '',
        phone: row['phone'] || '',
        department: row['department'] || '',
        position: row['position'] || '',
        password: row['password'] || 'Pass@123',
      };
    });

    if (staffList.length === 0) {
      toast.error('No valid rows found in CSV');
      return;
    }

    try {
      const { data } = await api.post('/staff/bulk-import', { staff: staffList });
      toast.success(data.message);
      fetchStaff();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Import failed');
    }

    e.target.value = '';
  };

  const fetchStaff = () => {
    getStaff({ page, limit: 20, search, department, status: statusFilter })
      .then(r => { setStaff(r.data.staff); setTotal(r.data.total); })
      .catch(() => toast.error('Failed to load staff'));
  };

  useEffect(() => { fetchStaff(); }, [page, department, statusFilter]);
  useEffect(() => { getDepartments().then(r => setDepartments(r.data)).catch(() => {}); }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    fetchStaff();
  };

  const [deleteModal, setDeleteModal] = useState(null);

  const handleResetPassword = async (id, name) => {
    const newPassword = window.prompt(`Enter new password for ${name}:`);
    if (!newPassword) return;
    try {
      await resetStaffPassword(id, newPassword);
      toast.success('Password reset successfully');
    } catch {
      toast.error('Failed to reset password');
    }
  };

  const [printingId, setPrintingId] = useState(null);

  const handlePrintQR = async (s) => {
    setPrintingId(s.id);
    try {
      const { data } = await getStaffQRCode(s.id);
      printStaffQRCode({
        qrCode: data.qrCode,
        staffId: s.staff_id,
        firstName: s.first_name,
        lastName: s.last_name,
        department: s.department,
        position: s.position,
        institutionName: (JSON.parse(localStorage.getItem('user') || '{}')).institutionName,
      });
    } catch {
      toast.error('Failed to load QR code');
    } finally {
      setPrintingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteModal) return;
    try {
      const { data } = await deleteStaff(deleteModal.id);
      toast.success(data.message);
      setDeleteModal(null);
      fetchStaff();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete staff');
    }
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Staff Management</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={{ ...styles.addBtn, background: '#27ae60' }} onClick={() => fileInputRef.current?.click()}>
            <FiUpload size={16} /> Import CSV
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCSVUpload} style={{ display: 'none' }} />
          <button style={styles.addBtn} onClick={() => navigate('/staff/new')}>
            <FiPlus size={16} /> Add Staff
          </button>
        </div>
      </div>

      <div style={styles.filters}>
        <form onSubmit={handleSearch} style={styles.searchBox}>
          <FiSearch size={16} color="#95a5a6" />
          <input style={styles.searchInput} placeholder="Search by name, ID, email or phone..." value={search} onChange={e => setSearch(e.target.value)} />
        </form>
        <select style={styles.select} value={department} onChange={e => { setDepartment(e.target.value); setPage(1); }}>
          <option value="">All Departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select style={styles.select} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Staff ID</th>
            <th style={styles.th}>Name</th>
            <th style={styles.th}>Department</th>
            <th style={styles.th}>Position</th>
            <th style={styles.th}>Email</th>
            <th style={styles.th}>Phone</th>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {staff.map(s => (
            <tr key={s.id}>
              <td style={styles.td}><strong>{s.staff_id}</strong></td>
              <td style={styles.td}>
                {s.first_name} {s.last_name}
                {s.google_linked && <span style={styles.googleBadge} title="Signs in with Google">Google</span>}
              </td>
              <td style={styles.td}>{s.department || '-'}</td>
              <td style={styles.td}>{s.position || '-'}</td>
              <td style={styles.td}>{s.email || '-'}</td>
              <td style={styles.td}>{s.phone || '-'}</td>
              <td style={styles.td}><span style={styles.badge(s.is_active)}>{s.is_active ? 'Active' : 'Inactive'}</span></td>
              <td style={styles.td}>
                <button style={styles.actionBtn} title="Edit" onClick={() => navigate(`/staff/${s.id}/edit`)}><FiEdit2 size={15} /></button>
                <button
                  style={{ ...styles.actionBtn, opacity: printingId === s.id ? 0.5 : 1 }}
                  title="Print QR Code"
                  disabled={printingId === s.id}
                  onClick={() => handlePrintQR(s)}
                >
                  <FiPrinter size={15} />
                </button>
                <button style={styles.actionBtn} title="Reset Password" onClick={() => handleResetPassword(s.id, `${s.first_name} ${s.last_name}`)}><FiKey size={15} /></button>
                <button style={{ ...styles.actionBtn, color: '#e74c3c' }} title="Delete" onClick={() => setDeleteModal({ id: s.id, name: `${s.first_name} ${s.last_name}`, staffId: s.staff_id })}><FiTrash2 size={15} /></button>
              </td>
            </tr>
          ))}
          {staff.length === 0 && (
            <tr><td colSpan={8} style={{ ...styles.td, textAlign: 'center', padding: '40px', color: '#95a5a6' }}>No staff members found</td></tr>
          )}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div style={styles.pagination}>
          {Array.from({ length: totalPages }, (_, i) => (
            <button key={i} style={styles.pageBtn(page === i + 1)} onClick={() => setPage(i + 1)}>{i + 1}</button>
          ))}
        </div>
      )}

      {deleteModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3 style={{ margin: '0 0 12px', fontSize: '18px', color: '#2c3e50' }}>Delete Staff Member</h3>
            <p style={{ margin: '0 0 8px', color: '#555', fontSize: '14px' }}>
              Are you sure you want to delete <strong>{deleteModal.name}</strong> ({deleteModal.staffId})?
            </p>
            <p style={{ margin: '0 0 20px', color: '#e74c3c', fontSize: '13px' }}>
              This will permanently remove all their attendance records and cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setDeleteModal(null)} style={styles.cancelBtn}>Cancel</button>
              <button onClick={handleDelete} style={styles.deleteBtn}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
