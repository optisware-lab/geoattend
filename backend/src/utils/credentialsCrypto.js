const crypto = require('crypto');

/**
 * Encrypts stored institution-admin passwords at rest (AES-256-GCM).
 *
 * Keys are derived from server-side secrets only (ADMIN_CREDENTIALS_KEY, or
 * JWT_SECRET as fallback) — the ciphertext in the database is useless without
 * the running server's key. Ciphertext format: `enc1:<iv>:<tag>:<data>` so
 * legacy plaintext rows can be detected and migrated.
 */

const PREFIX = 'enc1';

function getKey() {
  const secret = process.env.ADMIN_CREDENTIALS_KEY || process.env.JWT_SECRET || 'geoattend-local-development-secret';
  return crypto.createHash('sha256').update(`admin-credentials-v1:${secret}`).digest();
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(`${PREFIX}:`);
}

function encrypt(plainText) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

function decrypt(value) {
  if (!value) return null;
  const parts = String(value).split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    // Legacy plaintext row (pre-migration) — return as stored value.
    return String(value);
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt, isEncrypted };
