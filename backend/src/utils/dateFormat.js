// Dates in exports and messages carry the weekday, e.g. "Thu, 23/04/2026"
// (same format as the dashboard and the mobile app).

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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

function formatDate(value, fallback = '') {
  const d = toDate(value);
  if (!d) return fallback;
  return `${DAYS[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatDateRange(start, end) {
  const a = formatDate(start);
  const b = formatDate(end);
  return !b || a === b ? a : `${a} - ${b}`;
}

module.exports = { formatDate, formatDateRange };
