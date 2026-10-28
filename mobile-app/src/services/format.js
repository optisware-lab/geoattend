// How dates and times look in the app (same rules as admin-dashboard/src/utils/format.js).
// Dates always carry the weekday, e.g. "Thu, 23/04/2026".

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');

/**
 * Turns API values into a Date. Calendar dates ("2026-04-23", or the same at
 * midnight UTC) are read as that local day, so they never shift by a day.
 */
export function toDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Thu, 23/04/2026" */
export function formatDate(value, fallback = '-') {
  const d = toDate(value);
  if (!d) return fallback;
  return `${DAYS_SHORT[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "Thursday, 23 April 2026" */
export function formatDateLong(value, fallback = '-') {
  const d = toDate(value);
  if (!d) return fallback;
  return `${DAYS_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

/** "8:14 AM" */
export function formatTime(value, fallback = '-') {
  const d = toDate(value);
  if (!d) return fallback;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "Thu, 23/04/2026 · 8:14 AM" */
export function formatDateTime(value, fallback = '-') {
  const d = toDate(value);
  if (!d) return fallback;
  return `${formatDate(d)} · ${formatTime(d)}`;
}

/** "Thu, 23/04/2026 – Mon, 27/04/2026" (or one date when both are the same day) */
export function formatDateRange(start, end, fallback = '-') {
  const a = toDate(start);
  const b = toDate(end);
  if (!a && !b) return fallback;
  if (!a || !b || sameDay(a, b)) return formatDate(a || b);
  return `${formatDate(a)} – ${formatDate(b)}`;
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Number of calendar days from start to end, counting both. */
export function daysInclusive(start, end) {
  const a = toDate(start);
  const b = toDate(end);
  if (!a || !b) return 0;
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS) + 1;
}

/** "Today", "Yesterday", "Tomorrow", or null. */
export function relativeDay(value) {
  const d = toDate(value);
  if (!d) return null;
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / DAY_MS);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return null;
}

/** "just now", "5 min ago", "3 h ago", then the full date. */
export function timeAgo(value) {
  const d = toDate(value);
  if (!d) return '-';
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 45) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  if (secs < 86400 && sameDay(d, new Date())) return `${Math.round(secs / 3600)} h ago`;
  return formatDateTime(d);
}

/** 11520000 -> "3h 12m" */
export function formatDuration(ms) {
  if (!ms || ms < 0) return '0m';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h}h ${pad(m)}m` : `${m}m`;
}

/** "YYYY-MM-DD" in local time, for date inputs and API filters. */
export function toInputDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "08:00:00" (a work-hours TIME column) -> "8:00 AM" */
export function formatClock(hhmmss, fallback = '-') {
  if (!hhmmss) return fallback;
  const [h, m] = String(hhmmss).split(':').map(Number);
  if (Number.isNaN(h)) return fallback;
  const d = new Date();
  d.setHours(h, m || 0, 0, 0);
  return formatTime(d);
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
