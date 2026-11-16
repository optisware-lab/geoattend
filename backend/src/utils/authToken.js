const jwt = require('jsonwebtoken');

// How long a login lasts.
// Staff stay logged in on their phone or browser until they log out: their
// token lasts a year and the apps renew it every time they open, so it never
// runs out for anyone who uses the app.
// School admins who tick "Keep me logged in on this computer" stay logged in
// for 30 days, renewed each time they open the dashboard. Without the tick,
// and always for the super admin, a login lasts JWT_EXPIRES_IN (24 hours).
//
// Every token carries the account's token_version. Changing the password or
// pressing "Log out all other devices" raises it, which ends every older
// login at once. Deactivating an account also ends it immediately (both are
// checked on every request in middleware/auth.js).
const DEFAULT_STAFF_TTL = '365d';
const DEFAULT_ADMIN_TTL = '24h';
const DEFAULT_REMEMBERED_ADMIN_TTL = '30d';
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
const REMEMBERED_ADMIN_TTL = safeTtl(process.env.ADMIN_REMEMBER_EXPIRES_IN, DEFAULT_REMEMBERED_ADMIN_TTL, 'ADMIN_REMEMBER_EXPIRES_IN');

// A token that ran out this recently can still be swapped for a fresh one,
// e.g. an admin who also checks in on their phone, or a phone left off for weeks.
// Admin dashboard logins get no grace: once they run out, they are over.
const graceDays = Number(process.env.TOKEN_REFRESH_GRACE_DAYS);
const REFRESH_GRACE_MS = (Number.isFinite(graceDays) && graceDays > 0 ? graceDays : 30) * 24 * 60 * 60 * 1000;

/** Only school admins can be remembered for 30 days; never the super admin. */
function canBeRemembered(role) {
  return role === 'admin';
}

function tokenTtlFor(role, { remember = false } = {}) {
  if (role === 'admin' || role === 'super_admin') {
    return remember && canBeRemembered(role) ? REMEMBERED_ADMIN_TTL : ADMIN_TOKEN_TTL;
  }
  return STAFF_TOKEN_TTL;
}

/**
 * Signs a session token for a staff row ({ id, role, institution_id, token_version }).
 * options.dashboard: the login came from the admin dashboard.
 * options.remember: "Keep me logged in on this computer" was ticked.
 */
function signSessionToken(staff, { dashboard = false, remember = false } = {}) {
  const rm = Boolean(dashboard && remember && canBeRemembered(staff.role));
  return jwt.sign(
    {
      userId: staff.id,
      role: staff.role,
      institutionId: staff.institution_id,
      tv: Number(staff.token_version) || 0,
      ...(dashboard ? { dash: 1 } : {}),
      ...(rm ? { rm: 1 } : {}),
    },
    process.env.JWT_SECRET,
    { expiresIn: tokenTtlFor(staff.role, { remember: rm }) }
  );
}

/** Keeps the dashboard / remember choices of the token being renewed. */
function optionsFromClaims(claims) {
  return { dashboard: Boolean(claims?.dash), remember: Boolean(claims?.rm) };
}

module.exports = { signSessionToken, tokenTtlFor, optionsFromClaims, canBeRemembered, REFRESH_GRACE_MS };
