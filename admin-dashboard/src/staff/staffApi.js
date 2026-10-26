import axios from 'axios';

// Staff web check-in keeps its own session (separate from the admin dashboard's
// `token`/`user`), so signing in here never affects an admin session and vice versa.
const KEYS = { token: 'staffToken', user: 'staffUser', institution: 'staffInstitution', code: 'staffInstitutionCode' };

const API_BASE_URL = process.env.REACT_APP_API_URL
  || (window.location.hostname === 'localhost' ? 'http://localhost:5000/api' : 'https://geoattend-api-pc49.onrender.com/api');

const api = axios.create({
  baseURL: API_BASE_URL,
  // Generous: the free Render server can take ~50s to wake up
  timeout: 90000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(KEYS.token);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

export const session = {
  get: () => ({
    token: localStorage.getItem(KEYS.token),
    user: read(KEYS.user),
    institution: read(KEYS.institution),
  }),
  save: ({ token, user, institution }, institutionCode) => {
    localStorage.setItem(KEYS.token, token);
    localStorage.setItem(KEYS.user, JSON.stringify(user));
    localStorage.setItem(KEYS.institution, JSON.stringify(institution));
    if (institutionCode) localStorage.setItem(KEYS.code, institutionCode);
  },
  clear: () => {
    [KEYS.token, KEYS.user, KEYS.institution].forEach((k) => localStorage.removeItem(k));
  },
  lastInstitutionCode: () => localStorage.getItem(KEYS.code) || '',
};

export const staffLogin = (institutionCode, staffId, password) =>
  api.post('/auth/login', { institutionCode, staffId, password, deviceId: webDeviceId(), deviceModel: 'Web browser', osVersion: navigator.userAgent.slice(0, 100) });
export const getTodayStatus = () => api.get('/attendance/today');
export const checkIn = (data) => api.post('/attendance/check-in', data);
export const checkOut = (data) => api.post('/attendance/check-out', data);
export const checkInFromImage = (formData) => api.post('/attendance/check-in-from-image', formData);

/** A stable per-browser id, so admins can tell devices apart in device logs. */
export function webDeviceId() {
  let id = localStorage.getItem('staffDeviceId');
  if (!id) {
    id = `web-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    localStorage.setItem('staffDeviceId', id);
  }
  return id;
}

export function errorMessage(err, fallback) {
  if (err?.response?.data?.error) return err.response.data.error;
  if (err?.code === 'ECONNABORTED') return 'The server is taking too long (it may be waking up). Please try again.';
  if (!err?.response) return 'No connection to the server. Check your internet and try again.';
  return fallback;
}
