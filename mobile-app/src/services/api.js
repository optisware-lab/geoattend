import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import NetInfo from '@react-native-community/netinfo';
import { TODAY_STATUS_KEY } from './todayStatus';

// Work hours and days set by the admin, kept so they show while offline
export const RULES_KEY = 'attendanceRules';

// Resolve API base URL: .env override, then app.json extra, then the live backend.
// For a local backend set EXPO_PUBLIC_API_BASE_URL=http://<your-LAN-IP>:5000/api in mobile-app/.env.
const API_BASE_URL =
  // Prefer explicit environment variable (works with eas build / runtime env)
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  // Then check expo config extra (app.config.js / app.json)
  Constants.expoConfig?.extra?.API_BASE_URL ||
  Constants.manifest?.extra?.API_BASE_URL ||
  'https://geoattend-api-pc49.onrender.com/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 120000,
});

const PUBLIC_AUTH_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/google',
];

api.interceptors.request.use(async (config) => {
  const url = config.url || '';
  const isPublicAuth = PUBLIC_AUTH_PATHS.some((p) => url.includes(p));
  if (!isPublicAuth) {
    const token = await AsyncStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } else {
    delete config.headers.Authorization;
  }
  return config;
});

// ---- Staying logged in ----------------------------------------------------
// Staff stay logged in until they tap Log Out. When the server says the
// token ran out, we swap it for a fresh one and repeat the request. Several
// requests failing at once share one renewal, and a network problem during
// renewal never signs anyone out; only the server refusing the account does.

// Everything removed from the phone on log out
export const SESSION_KEYS = ['token', 'user', 'institution', TODAY_STATUS_KEY, RULES_KEY];
let refreshPromise = null;
const sessionEndedListeners = new Set();

/** Called when the server ends the session (account removed or deactivated). */
export function onSessionEnded(listener) {
  sessionEndedListeners.add(listener);
  return () => sessionEndedListeners.delete(listener);
}

async function endSession() {
  await AsyncStorage.multiRemove(SESSION_KEYS);
  sessionEndedListeners.forEach((fn) => { try { fn(); } catch {} });
}

/**
 * Gets a fresh token from the server and saves it. Resolves to the new token,
 * or null when the server refused (session ended). Rejects on network errors.
 */
export function renewSession() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const current = await AsyncStorage.getItem('token');
      if (!current) return null;
      try {
        const { data } = await api.post('/auth/refresh-token', {}, {
          headers: { Authorization: `Bearer ${current}` },
          _isRefresh: true,
        });
        await AsyncStorage.setItem('token', data.token);
        return data.token;
      } catch (err) {
        if (err.response?.status === 401) {
          await endSession();
          return null;
        }
        throw err;
      }
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    // Surface useful network diagnostics in logs
    // Suppress noise for non-critical background calls (push token registration)
    const silentUrls = ['/auth/push-token'];
    if (!error.response && !silentUrls.some((u) => originalRequest?.url?.includes(u))) {
      console.error('[API] Network error:', {
        baseURL: api.defaults.baseURL,
        url: originalRequest?.url,
        method: originalRequest?.method,
        code: error.code,
        message: error.message,
      });
    }

    // Render/Neon instances can "sleep" and wake slowly (up to 30s on free tier).
    // If we get a true network error (no response), ping /health, wait for the server
    // to finish waking, then retry the original request once.
    // A gateway error (502/503/504) means the server is restarting, e.g. during
    // a deploy. Retry reads the same way; never repeat a sign-in or sign-out.
    const gatewayError = [502, 503, 504].includes(error.response?.status)
      && (originalRequest?.method || 'get').toLowerCase() === 'get';
    if (
      (!error.response || gatewayError) &&
      originalRequest &&
      !originalRequest._wakeAndRetry &&
      originalRequest.url !== '/health' &&
      typeof originalRequest.url === 'string'
    ) {
      originalRequest._wakeAndRetry = true;
      // No internet on the phone: fail now (no wake-up wait) so screens can
      // save sign-ins for later straight away
      if (!error.response) {
        const net = await NetInfo.fetch().catch(() => null);
        if (net && (!net.isConnected || net.isInternetReachable === false)) {
          return Promise.reject(error);
        }
      }
      try {
        await api.get('/health', { timeout: 30000 });
      } catch {
        // Server still waking — wait a bit before retrying anyway
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      return api(originalRequest);
    }

    const url = originalRequest?.url || '';
    const isPublicAuth = PUBLIC_AUTH_PATHS.some((p) => url.includes(p));

    // Token ran out: renew it once, then repeat the request
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._isRefresh &&
      !url.includes('/refresh-token') &&
      !originalRequest._retry &&
      !isPublicAuth
    ) {
      originalRequest._retry = true;
      let fresh;
      try {
        fresh = await renewSession();
      } catch (renewError) {
        // Offline or server waking up: keep the saved login and fail this
        // request with the connection error (not "Token expired"), so screens
        // treat it as a connection problem and can save sign-ins for later.
        return Promise.reject(renewError);
      }
      if (!fresh) return Promise.reject(error);
      originalRequest.headers = { ...(originalRequest.headers || {}), Authorization: `Bearer ${fresh}` };
      return api(originalRequest);
    }

    // Even a freshly renewed token was refused: the account is no longer allowed in
    if (error.response?.status === 401 && originalRequest?._retry && !isPublicAuth) {
      await endSession();
    }
    return Promise.reject(error);
  }
);

// Auth
export const login = (staffId, password, institutionCode, deviceInfo) =>
  api.post('/auth/login', { staffId, password, institutionCode, ...deviceInfo });
export const googleAuth = (idToken, institutionCode, deviceInfo) =>
  api.post('/auth/google', { idToken, institutionCode, ...deviceInfo });
export const completeGoogleSignup = (data) => api.post('/auth/google/complete', data);
export const forgotPassword = (staffId, email, newPassword, institutionCode) =>
  api.post('/auth/forgot-password', { staffId, email, newPassword, institutionCode });
export const refreshToken = () => api.post('/auth/refresh-token');
export const getProfile = () => api.get('/auth/profile');
export const changePassword = (currentPassword, newPassword) =>
  api.put('/auth/change-password', { currentPassword, newPassword });

// Attendance
export const checkIn = (data) => api.post('/attendance/check-in', data);
export const checkInFromImage = (formData) =>
  api.post('/attendance/check-in-from-image', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
export const checkOut = (data) => api.post('/attendance/check-out', data);
export const getTodayStatus = (config) => api.get('/attendance/today', config);
export const getMyAttendance = (params) => api.get('/attendance/my-attendance', { params });
export const getWeeklyStats = () => api.get('/attendance/weekly-stats');
// Work hours and working days set by the admin
export const getAttendanceRules = () => api.get('/institutions/rules');

// Geofence
export const postGeofenceEvent = (data) => api.post('/geofence/event', data);

// Leave Management
export const requestLeave = (data) => api.post('/leave', data);
export const getMyLeaves = () => api.get('/leave/my');
export const cancelLeave = (id) => api.put(`/leave/${id}/cancel`);

export const findStaffByEmail = (institutionCode, email) =>
  api.post('/auth/forgot-staff-id', { institutionCode, email });

export default api;
