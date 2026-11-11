// Staff IDs start with the school's initials and a number counting up per
// school: Rising Soul School -> RSS001, RSS002, ...
//
// The initials come from the school name unless an admin set their own
// (institutions.staff_id_prefix). When IDs are renamed, the old ones are kept
// in staff.legacy_staff_ids so people can still log in with them.

const SMALL_WORDS = new Set(['OF', 'THE', 'AND', 'FOR', 'AT', 'IN', 'ON', '&']);
const PREFIX_RE = /^[A-Z]{2,5}$/;
const DIGITS = 3;

/** "Rising Soul School" -> "RSS"; "Achimota" -> "ACH". 2 to 5 letters. */
function initialsFor(name) {
  const words = String(name || '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !SMALL_WORDS.has(w));
  let initials = words.map((w) => w[0]).join('');
  if (initials.length < 2) initials = (words[0] || 'STAFF').slice(0, 3);
  return initials.slice(0, 5).padEnd(2, 'X');
}

/** Cleans what an admin typed; null when it isn't 2-5 letters. */
function normalizePrefix(value) {
  const p = String(value || '').trim().toUpperCase();
  return PREFIX_RE.test(p) ? p : null;
}

/** The prefix this school uses for staff IDs. */
async function prefixFor(db, institutionId) {
  const r = await db.query('SELECT name, staff_id_prefix FROM institutions WHERE id = $1', [institutionId]);
  const row = r.rows[0] || {};
  return normalizePrefix(row.staff_id_prefix) || initialsFor(row.name);
}

const pad = (n) => String(n).padStart(DIGITS, '0');

/** True when an ID already follows this school's pattern. */
function hasPrefix(staffId, prefix) {
  return new RegExp(`^${prefix}\\d+$`).test(String(staffId || ''));
}

/** Highest number already used with this prefix at this school. */
async function highestNumber(db, institutionId, prefix) {
  const r = await db.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(staff_id FROM $2) AS INTEGER)), 0) AS n
     FROM staff WHERE institution_id = $1 AND staff_id ~ $3`,
    [institutionId, `^${prefix}(\\d+)$`, `^${prefix}\\d+$`]
  );
  return Number(r.rows[0]?.n || 0);
}

/** The next free ID at this school, e.g. "RSS032". */
async function nextStaffId(db, institutionId) {
  const prefix = await prefixFor(db, institutionId);
  let n = (await highestNumber(db, institutionId, prefix)) + 1;
  // Belt and braces: skip any number someone typed by hand in the meantime
  for (let tries = 0; tries < 50; tries += 1, n += 1) {
    const candidate = `${prefix}${pad(n)}`;
    const taken = await db.query(
      'SELECT 1 FROM staff WHERE institution_id = $1 AND (staff_id = $2 OR $2 = ANY(legacy_staff_ids))',
      [institutionId, candidate]
    );
    if (taken.rowCount === 0) return candidate;
  }
  throw new Error('Could not find a free staff ID');
}

/**
 * Gives staff new IDs with the school's prefix, in the order they joined.
 * mode 'missing': only staff whose ID doesn't follow the pattern yet (numbers
 *   continue after the highest one in use).
 * mode 'all': everyone gets a fresh sequence (PREFIX001, PREFIX002, ...).
 * Old IDs are kept for login. Admin accounts keep their IDs (their login
 * details are shown to the super admin). Run inside a transaction.
 * Returns [{ id, name, from, to }].
 */
async function renumberStaff(db, institutionId, { mode = 'missing', prefix } = {}) {
  const usePrefix = normalizePrefix(prefix) || (await prefixFor(db, institutionId));
  const staff = await db.query(
    `SELECT id, staff_id, first_name, last_name FROM staff
     WHERE institution_id = $1 AND member_type = 'staff' AND role = 'staff'
     ORDER BY created_at, staff_id`,
    [institutionId]
  );
  const targets = mode === 'all' ? staff.rows : staff.rows.filter((s) => !hasPrefix(s.staff_id, usePrefix));
  if (!targets.length) return [];

  // Numbers taken by people who keep their ID (admins, or already-correct staff)
  const keepIds = new Set(
    (await db.query('SELECT staff_id FROM staff WHERE institution_id = $1', [institutionId])).rows
      .map((r) => r.staff_id)
      .filter((id) => !targets.some((t) => t.staff_id === id))
  );
  let n = mode === 'all' ? 0 : await highestNumber(db, institutionId, usePrefix);

  const plan = targets.map((s) => {
    let to;
    do { n += 1; to = `${usePrefix}${pad(n)}`; } while (keepIds.has(to));
    return { id: s.id, name: `${s.first_name || ''} ${s.last_name || ''}`.trim(), from: s.staff_id, to };
  });

  // Two steps so swapping IDs between people never hits the unique rule
  for (const p of plan) {
    await db.query(
      `UPDATE staff SET staff_id = $2,
         legacy_staff_ids = CASE WHEN $3 = ANY(COALESCE(legacy_staff_ids, '{}')) THEN legacy_staff_ids
                                 ELSE array_append(COALESCE(legacy_staff_ids, '{}'), $3) END,
         updated_at = NOW()
       WHERE id = $1`,
      [p.id, `~${p.id}`.slice(0, 50), p.from]
    );
  }
  for (const p of plan) {
    await db.query('UPDATE staff SET staff_id = $2 WHERE id = $1', [p.id, p.to]);
  }
  return plan.filter((p) => p.from !== p.to);
}

module.exports = { initialsFor, normalizePrefix, prefixFor, nextStaffId, renumberStaff, hasPrefix, PREFIX_RE };
