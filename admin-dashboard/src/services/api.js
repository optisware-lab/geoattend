import axios from 'axios';

function resolveApiBaseUrl() {
  const envUrl = process.env.REACT_APP_API_URL;
  // Hard safety: when running locally, always prefer local backend unless explicitly overridden.
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return envUrl || 'http://localhost:5000/api';
  }
  return envUrl || 'https://geoattend-api-pc49.onrender.com/api';
}

const API_BASE_URL = resolveApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// Attach token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || '';
    const isAuthAttempt =
      url.includes('/auth/login') ||
      url.includes('/auth/register') ||
      url.includes('/auth/forgot-password');

    if (error.response?.status === 401 && !isAuthAttempt) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth — omit institutionCode when empty so backend can resolve super_admin (e.g. ADMIN001) across institutions
export const login = (staffId, password, institutionCode) => {
  const body = { staffId, password };
  const code = institutionCode && String(institutionCode).trim();
  if (code) body.institutionCode = code.toUpperCase();
  return api.post('/auth/login', body);
};
export const getProfile = () => api.get('/auth/profile');
export const createInitialAdmin = (data) => api.post('/auth/create-initial-admin', data);

// Staff
export const getStaff = (params) => api.get('/staff', { params });
export const getStaffById = (id) => api.get(`/staff/${id}`);
export const createStaff = (data) => api.post('/staff', data);
export const register = (data) => api.post('/auth/register', data);
export const updateStaff = (id, data) => api.put(`/staff/${id}`, data);
export const resetStaffPassword = (id, newPassword) => api.put(`/staff/${id}/reset-password`, { newPassword });
export const getStaffQRCode = (id) => api.get(`/staff/${id}/qr-code`);
export const getDepartments = () => api.get('/staff/departments');
export const deleteStaff = (id) => api.delete(`/staff/${id}`);

// Institution
export const getInstitution = () => api.get('/institutions/current');
export const updateInstitution = (data) => api.put('/institutions/current', data);
export const getInstitutionQR = () => api.get('/institutions/qr-code');
export const rotateInstitutionQR = () => api.post('/institutions/qr-code/rotate');
export const getAttendanceRules = (params) => api.get('/institutions/rules', { params });
export const updateAttendanceRules = (data, params) => api.put('/institutions/rules', data, { params });
// Long timeout: the free Render instance can take ~50s to wake up
export const createInstitution = (data) => api.post('/institutions', data, { timeout: 90000 });
export const getAllInstitutions = () => api.get('/institutions');
export const deleteInstitution = (id) => api.delete(`/institutions/${id}`);
export const repairInstitutionCode =(id) => api.post(`/institutions/${id}/repair-code`);
export const getInstitutionAdminCredentials = (id) => api.get(`/institutions/${id}/admin-credentials`);
export const createInstitutionAdminCredentials = (id) => api.post(`/institutions/${id}/admin-credentials`);
// Subscriptions / Billing
export const getSubscriptionStatus = () => api.get('/institutions/subscription');
export const getSubscriptionPlans = () => api.get('/institutions/subscription/plans');
export const activateSubscription = (data) => api.post('/institutions/subscription/activate', data);

// Reports
export const getDashboardStats = (params) => api.get('/reports/dashboard', { params });
export const getTodaySummary = (params) => api.get('/reports/today-summary', { params });
export const getAttendanceReport = (params) => api.get('/reports/attendance', { params });
export const getRealTimeAttendance = (params) => api.get('/reports/realtime', { params });
export const getWeeklySummary = (params) => api.get('/reports/weekly-summary', { params });
export const getFraudReport = (params) => api.get('/reports/fraud', { params });
export const getGeofenceEvents = (params) => api.get('/reports/geofence-events', { params });

// Export URLs (download directly)
export const getExcelExportUrl = (params) => {
  const query = new URLSearchParams(params).toString();
  return `${API_BASE_URL}/reports/export/excel?${query}`;
};
export const getPdfExportUrl = (params) => {
  const query = new URLSearchParams(params).toString();
  return `${API_BASE_URL}/reports/export/pdf?${query}`;
};

// Leave Management
export const getAllLeaves = (params) => api.get('/leave', { params });
export const getLeaveStats = () => api.get('/leave/stats');
export const reviewLeave = (id, data) => api.put(`/leave/${id}/review`, data);
// Staff leave (request/cancel/my leaves)
export const requestLeave = (data) => api.post('/leave', data);
export const getMyLeaves = () => api.get('/leave/my');
export const cancelLeave = (id) => api.put(`/leave/${id}/cancel`);

// Analytics
export const getAttendanceTrends = (params) => api.get('/analytics/trends', { params });
export const getTopAbsentees = (params) => api.get('/analytics/top-absentees', { params });
export const getDepartmentAnalytics = (params) => api.get('/analytics/departments', { params });
export const getOvertimeSummary = (params) => api.get('/analytics/overtime', { params });
export const getAuditLogs = (params) => api.get('/analytics/audit-logs', { params });
export const getSchedulerStatus = () => api.get('/analytics/scheduler');

// Payroll
export const getPayrollSummary = (params) => api.get('/payroll/summary', { params });
export const getPayrollDaily = (params) => api.get('/payroll/daily', { params });
export const getPayrollCsvUrl = (params) => {
  const query = new URLSearchParams(params).toString();
  return `${API_BASE_URL}/payroll/summary.csv?${query}`;
};
// Staff own earnings (used on account pages for non-admin roles)
export const getMyEarnings = (params) => api.get('/payroll/my-earnings', { params });

export default api;
