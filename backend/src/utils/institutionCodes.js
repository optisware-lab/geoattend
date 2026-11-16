// School codes and admin IDs start with the school's initials, so they are
// easy to remember: Rising Soul School -> school code "RSS", admin "RSSADMIN".
// A second school with the same initials gets "RSS2" / "RSS2ADMIN".
//
// When a code or admin ID is renamed, the old one is kept
// (institutions.legacy_institution_codes, staff.legacy_staff_ids), so phones
// and browsers that saved the old one still sign in without anyone retyping.

const { initialsFor, normalizePrefix } = require('./staffIds');

/** The letters a school's codes start with: its staff ID prefix, else its initials. */
function baseCodeFor(name, staffIdPrefix) {
  return normalizePrefix(staffIdPrefix) || initialsFor(name);
}

async function codeTaken(db, code, exceptInstitutionId) {
  const r = await db.query(
    `SELECT 1 FROM institutions
     WHERE (institution_code = $1 OR $1 = ANY(COALESCE(legacy_institution_codes, '{}')))
       AND ($2::uuid IS NULL OR id <> $2::uuid)
     LIMIT 1`,
    [code, exceptInstitutionId || null]
  );
  return r.rowCount > 0;
}

/** First free school code for this name: "RSS", then "RSS2", "RSS3", ... */
async function freeInstitutionCode(db, name, { staffIdPrefix, exceptInstitutionId } = {}) {
  const base = baseCodeFor(name, staffIdPrefix);
  for (let n = 1; n < 100; n += 1) {
    const code = n === 1 ? base : `${base}${n}`;
    if (!(await codeTaken(db, code, exceptInstitutionId))) return code;
  }
  return `${base}${Date.now().toString().slice(-4)}`;
}

/** First free admin ID for a school code: "RSSADMIN", then "RSSADMIN2", ... */
async function freeAdminId(db, institutionCode) {
  const base = `${String(institutionCode || 'SCHOOL').replace(/[^A-Z0-9]/gi, '').toUpperCase()}ADMIN`;
  for (let n = 1; n < 100; n += 1) {
    const id = n === 1 ? base : `${base}${n}`;
    const r = await db.query(
      `SELECT 1 FROM staff WHERE staff_id = $1 OR $1 = ANY(COALESCE(legacy_staff_ids, '{}')) LIMIT 1`,
      [id]
    );
    if (r.rowCount === 0) return id;
  }
  return `${base}${Date.now().toString().slice(-4)}`;
}

/** Old generated IDs that should be renamed: "INST-123456" and "ADMIN3FA9C2". */
const OLD_INSTITUTION_CODE = /^INST-[0-9A-F]{6}$/i;
const OLD_ADMIN_ID = /^ADMIN[0-9A-F]{6}$/i;

module.exports = { baseCodeFor, freeInstitutionCode, freeAdminId, OLD_INSTITUTION_CODE, OLD_ADMIN_ID };
