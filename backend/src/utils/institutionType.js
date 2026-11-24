// Schools don't use leave requests (staff aren't "on leave" in term time);
// businesses do. Each institution is one or the other, set by the super
// admin. Existing ones were first guessed from their name.

const TYPES = ['school', 'business'];
const SCHOOL_WORDS = /\b(school|schools|academy|college|institute|university|polytechnic|montessori|kindergarten|nursery|creche|basic|jhs|shs|seminary|preparatory|prep|lyceum|educational|education complex)\b/i;

function normalizeInstitutionType(value) {
  const v = String(value || '').trim().toLowerCase();
  return TYPES.includes(v) ? v : null;
}

/** Best guess from the name: "Rising Soul School" -> school, "Optisware Ltd" -> business. */
function guessInstitutionType(name) {
  return SCHOOL_WORDS.test(String(name || '')) ? 'school' : 'business';
}

const leaveEnabledFor = (type) => type !== 'school';

module.exports = { TYPES, normalizeInstitutionType, guessInstitutionType, leaveEnabledFor };
