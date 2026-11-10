const jwt = require('jsonwebtoken');

// How long a login lasts.
// Staff stay logged in on their phone or browser until they log out: their
// token lasts a year and the apps renew it every time they open, so it never
// runs out for anyone who uses the app. Deactivating an account in the admin
// dashboard still ends it immediately (checked on every request).
// Admin dashboard sessions keep the shorter JWT_EXPIRES_IN.
const DEFAULT_STAFF_TTL = '365d';
const DEFAULT_ADMIN_TTL = '24h';

/**
 * Uses the configured lifetime only if the token library accepts it and it
 * lasts at least an hour. A bad setting (e.g. "forever", "" or "365", which
 * means 365 ms) would otherwise break every login and renewal with a 500.
 */
function safeTtl(value, fallback, name) {
  if (value == null || String(value).trim() === '') return fallback;
  const v = /^\d+$/.test(String(value).trim()) ? Number(value) : String(value).trim();
  try {
    const probe = jwt.decode(jwt.sign({}, 'probe', { expiresIn: v }));
    if (probe.exp - probe.iat >= 3600) return v;
  } catch { /* fall through */ }
  console.warn(`${name}="${value}" is not a usable token lifetime; using ${fallback}`);
  return fallback;
}

const STAFF_TOKEN_TTL = safeTtl(process.env.STAFF_TOKEN_EXPIRES_IN, DEFAULT_STAFF_TTL, 'STAFF_TOKEN_EXPIRES_IN');
const ADMIN_TOKEN_TTL = safeTtl(process.env.JWT_EXPIRES_IN, DEFAULT_ADMIN_TTL, 'JWT_EXPIRES_IN');

// A token that ran out this recently can still be swapped for a fresh one,
// e.g. an admin who also checks in on their phone, or a phone left off for weeks.
const graceDays = Number(process.env.TOKEN_REFRESH_GRACE_DAYS);
const REFRESH_GRACE_MS = (Number.isFinite(graceDays) && graceDays > 0 ? graceDays : 30) * 24 * 60 * 60 * 1000;

function tokenTtlFor(role) {
  return role === 'admin' || role === 'super_admin' ? ADMIN_TOKEN_TTL : STAFF_TOKEN_TTL;
}

/** Signs a session token for a staff row ({ id, role, institution_id }). */
function signSessionToken(staff) {
  return jwt.sign(
    { userId: staff.id, role: staff.role, institutionId: staff.institution_id },
    process.env.JWT_SECRET,
    { expiresIn: tokenTtlFor(staff.role) }
  );
}

module.exports = { signSessionToken, tokenTtlFor, REFRESH_GRACE_MS };
