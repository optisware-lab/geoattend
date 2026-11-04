const Jimp = require('jimp');

// Sign-in photos ("selfies") prove who was holding the phone at sign-in.
// Every photo is re-encoded here, so whatever the phone sends is stored as a
// small, plain JPEG (no EXIF/location data, ~20-40 KB).

const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MIN_SIDE = 120;
const STORED_WIDTH = 480;

// How long photos are kept before the scheduler deletes them
const SELFIE_RETENTION_DAYS = parseInt(process.env.SELFIE_RETENTION_DAYS || '90', 10);

const BIOMETRIC_RESULTS = ['passed', 'unavailable', 'unsupported', 'not_required'];

function badPhoto(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/**
 * Turns a base64 photo (optionally a data: URL) into a stored-size JPEG buffer.
 * Returns null when no photo was sent; throws a 400 error for unusable photos.
 */
async function normalizeSelfie(input) {
  if (!input || typeof input !== 'string') return null;
  const buffer = Buffer.from(input.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ''), 'base64');
  if (buffer.length === 0) return null;
  if (buffer.length > MAX_INPUT_BYTES) throw badPhoto('The sign-in photo is too large. Please take it again.');

  let image;
  try {
    image = await Jimp.read(buffer);
  } catch {
    throw badPhoto('The sign-in photo could not be read. Please take it again.');
  }
  if (image.bitmap.width < MIN_SIDE || image.bitmap.height < MIN_SIDE) {
    throw badPhoto('The sign-in photo is too small. Please take it again.');
  }
  if (image.bitmap.width > STORED_WIDTH) image.resize(STORED_WIDTH, Jimp.AUTO);
  return image.quality(70).getBufferAsync(Jimp.MIME_JPEG);
}

/** The fingerprint/Face ID result the app reports, or null if it sent none (older app). */
function normalizeBiometric(value) {
  return BIOMETRIC_RESULTS.includes(value) ? value : null;
}

module.exports = { normalizeSelfie, normalizeBiometric, SELFIE_RETENTION_DAYS };
