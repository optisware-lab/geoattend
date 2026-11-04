const jwt = require('jsonwebtoken');

// How long a login lasts.
// Staff stay logged in on their phone or browser until they log out: their
// token lasts a year and the apps renew it every time they open, so it never
// runs out for anyone who uses the app. Deactivating an account in the admin
// dashboard still ends it immediately (checked on every request).
// Admin dashboard sessions keep the shorter JWT_EXPIRES_IN.
const STAFF_TOKEN_TTL = process.env.STAFF_TOKEN_EXPIRES_IN || '365d';
const ADMIN_TOKEN_TTL = process.env.JWT_EXPIRES_IN || '24h';

// A token that ran out this recently can still be swapped for a fresh one,
// e.g. an admin who also checks in on their phone, or a phone left off for weeks.
const REFRESH_GRACE_MS = Number(process.env.TOKEN_REFRESH_GRACE_DAYS || 30) * 24 * 60 * 60 * 1000;

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
