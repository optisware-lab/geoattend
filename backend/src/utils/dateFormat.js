// Dates in exports and messages read like "Thu, 10-Sept, 2026"
// (same format as the dashboard).

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

function toDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "10-Sept, 2026" */
function formatDay(value, fallback = '') {
  const d = toDate(value);
  if (!d) return fallback;
  return `${d.getDate()}-${MONTHS[d.getMonth()]}, ${d.getFullYear()}`;
}

/** "Thu, 10-Sept, 2026" */
function formatDate(value, fallback = '') {
  const d = toDate(value);
  if (!d) return fallback;
  return `${DAYS[d.getDay()]}, ${formatDay(d)}`;
}

/** "10-Sept, 2026 to 16-Sept, 2026" (one date when both are the same day) */
function formatDateRange(start, end) {
  const a = formatDay(start);
  const b = formatDay(end);
  return !b || a === b ? a : `${a} to ${b}`;
}

/** "8:14 AM", read from the stored wall-clock time */
function formatTime(value, fallback = '') {
  const d = toDate(value);
  if (!d) return fallback;
  const h = d.getHours();
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "YYYY-MM-DD" in local time */
function dayKey(value) {
  const d = toDate(value);
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

module.exports = { DAYS, MONTHS, toDate, formatDay, formatDate, formatDateRange, formatTime, dayKey };
