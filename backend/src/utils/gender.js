// Staff gender is stored as 'male', 'female' or NULL (not set yet).
const GENDERS = ['male', 'female'];

/**
 * Accepts the many ways people write it ("M", "Male", "FEMALE", " f ") and
 * returns 'male' | 'female', null when empty, or undefined when the value is
 * not recognised (callers treat undefined as invalid input).
 */
function normalizeGender(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim().toLowerCase();
  if (!v) return null;
  if (v === 'm' || v === 'male') return 'male';
  if (v === 'f' || v === 'female') return 'female';
  return undefined;
}

module.exports = { GENDERS, normalizeGender };
