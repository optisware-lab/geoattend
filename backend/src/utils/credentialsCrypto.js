const crypto = require('crypto');

/**
 * Encrypts stored institution-admin passwords at rest (AES-256-GCM).
 *
 * Keys derive from server-side secrets only. The preferred key is
 * ADMIN_CREDENTIALS_KEY (a dedicated, long-lived secret; set it identically on
 * every deployment). JWT_SECRET is the fallback for deployments that never
 * configured the dedicated key.
 *
 * Ciphertext format: `enc1:<iv>:<tag>:<data>` — legacy plaintext rows are
 * detected with isEncrypted and migrated in place by the boot task. When the
 * encryption key changes (or differs between deployments), older rows fail
 * GCM authentication; decryptSafe then walks the previous candidate keys so
 * the boot task can re-encrypt them under the current one.
 */

const PREFIX = 'enc1';
const FALLBACK_SECRET = 'geoattend-local-development-secret';

function keyFrom(secret) {
  return crypto.createHash('sha256').update(`admin-credentials-v1:${secret}`).digest();
}

function currentKey() {
  return keyFrom(process.env.ADMIN_CREDENTIALS_KEY || process.env.JWT_SECRET || FALLBACK_SECRET);
}

// Keys that may have been used in the past — used only to recover rows for
// re-encryption under the current key (key rotation).
function legacyKeys() {
  const keys = [];
  if (process.env.ADMIN_CREDENTIALS_KEY && process.env.JWT_SECRET) {
    keys.push(keyFrom(process.env.JWT_SECRET));
  }
  keys.push(keyFrom(FALLBACK_SECRET));
  return keys;
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(`${PREFIX}:`);
}

function encrypt(plainText) {
  const key = currentKey();
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
  const decipher = crypto.createDecipheriv('aes-256-gcm', currentKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Decrypt trying the current key first, then any legacy key the
 * configuration may have used previously. Resolves to the plaintext, or
 * null when the row is unreadable (e.g. the key originally used is gone).
 * Non-encrypted legacy plaintext rows return as-is.
 */
function decryptSafe(value) {
  if (!value) return null;
  if (!isEncrypted(value)) return String(value);
  for (const key of [currentKey(), ...legacyKeys()]) {
    try {
      const [, ivB64, tagB64, dataB64] = String(value).split(':');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
      return decrypted.toString('utf8');
    } catch (err) {
      // Wrong key — try the next candidate
    }
  }
  return null;
}

module.exports = { encrypt, decrypt, decryptSafe, isEncrypted };
