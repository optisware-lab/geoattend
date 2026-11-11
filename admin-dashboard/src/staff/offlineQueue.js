// Staff web page without internet (no mobile data, weak school Wi-Fi).
//
// Sign-ins and sign-outs made offline are saved in this browser and sent when
// a connection is back, the same way the phone app does it: each one says
// when it really happened (recordedAt) and the browser's clock at sending time
// (sentAt), and the server accepts records up to 7 days old.
//
// Each entry has its own localStorage key, so one entry with a sign-in photo
// can never make the whole list unreadable. Entries remember who made them, so
// after a log out the next person never sends someone else's sign-ins.

const INDEX_KEY = 'staffOfflineQueue';
const ITEM_PREFIX = 'staffOfflineItem:';
const STATUS_KEY = 'staffTodayStatus';
const RULES_KEY = 'staffRules';
const STATS_KEY = 'staffMonthStats';

// The server refuses offline records older than 7 days
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Worth trying again later; any other 4xx means the server said no for good
// (outside the geofence, duplicate, too old), so the entry is dropped.
const RETRYABLE = [401, 402, 408, 429];

const ATTENDANCE = ['check-in', 'check-out'];

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/** True when a failed request never got an answer (offline, timeout). */
export function isNetworkError(err) {
  return !err?.response;
}

/** Offline, or the server can't be reached / is failing right now. */
export function isUnreachable(err) {
  return !err?.response || err.response.status >= 500;
}

export function browserOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function index() {
  const ids = readJson(INDEX_KEY);
  return Array.isArray(ids) ? ids : [];
}

/** Saved entries of this user, oldest first. */
export function readQueue(userId) {
  return index()
    .map((id) => readJson(ITEM_PREFIX + id))
    .filter((item) => item && (!userId || !item.userId || item.userId === userId));
}

export function queueLength(userId) {
  return readQueue(userId).filter((i) => ATTENDANCE.includes(i.action)).length;
}

/**
 * Saves a sign-in or sign-out to send later. Throws if the browser has no
 * room left (very full storage), so the caller can tell the person.
 */
export function addToQueue(action, data, userId) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const item = { id, action, data, timestamp: new Date().toISOString(), userId: userId || null };
  try {
    writeJson(ITEM_PREFIX + id, item);
  } catch (err) {
    // Out of room: keep the record without its photo rather than lose it
    if (data?.selfie) {
      const { selfie, ...rest } = data;
      writeJson(ITEM_PREFIX + id, { ...item, data: rest });
    } else {
      throw err;
    }
  }
  writeJson(INDEX_KEY, [...index(), id]);
  return item;
}

function removeItems(ids) {
  if (!ids.length) return;
  ids.forEach((id) => localStorage.removeItem(ITEM_PREFIX + id));
  writeJson(INDEX_KEY, index().filter((id) => !ids.includes(id)));
}

/** Today's status implied by saved, unsent sign-ins/outs; null if none today. */
export function pendingStatus(userId) {
  const today = new Date().toDateString();
  const last = [...readQueue(userId)].reverse().find(
    (i) => ATTENDANCE.includes(i.action) && new Date(i.timestamp).toDateString() === today
  );
  if (!last) return null;
  return last.action === 'check-in' ? 'checked_in' : 'checked_out';
}

/** The saved sign-in time for today, so the "at work for" clock works offline. */
export function pendingRecord(userId) {
  const today = new Date().toDateString();
  const items = readQueue(userId).filter((i) => new Date(i.timestamp).toDateString() === today);
  const inItem = items.find((i) => i.action === 'check-in');
  const outItem = [...items].reverse().find((i) => i.action === 'check-out');
  if (!inItem && !outItem) return null;
  return { check_in_time: inItem?.timestamp || null, check_out_time: outItem?.timestamp || null, is_late: null, offline: true };
}

let syncPromise = null;

/**
 * Sends saved entries in order with `send(action, data)`. Only one sync runs
 * at a time. Resolves to { synced, rejected: [{ action, error }], left }.
 */
export function syncQueue(userId, send) {
  if (!syncPromise) {
    syncPromise = runSync(userId, send).finally(() => { syncPromise = null; });
  }
  return syncPromise;
}

async function runSync(userId, send) {
  const result = { synced: 0, rejected: [], left: 0 };
  const items = readQueue(userId);
  if (!items.length || !browserOnline()) {
    result.left = items.length;
    return result;
  }
  const done = [];
  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (Date.now() - new Date(item.timestamp).getTime() > MAX_AGE_MS) {
        done.push(item.id);
        result.rejected.push({ action: item.action, error: 'A saved record more than 7 days old could not be sent. Please tell your admin.' });
        continue;
      }
      try {
        await send(item.action, { ...item.data, offline: true, recordedAt: item.timestamp, sentAt: new Date().toISOString() });
        done.push(item.id);
        result.synced += 1;
      } catch (err) {
        const status = err?.response?.status;
        if (status >= 400 && status < 500 && !RETRYABLE.includes(status)) {
          done.push(item.id);
          result.rejected.push({ action: item.action, error: err.response?.data?.error || 'Not accepted by the server' });
        } else {
          // No connection or server trouble: keep this one and everything
          // after it, so a sign-out is never sent before its sign-in
          result.left = items.length - i;
          break;
        }
      }
    }
  } finally {
    removeItems(done);
  }
  return result;
}

// ---- What the page last knew, for showing while offline ----

export function saveTodayStatus(status, record) {
  try { writeJson(STATUS_KEY, { day: new Date().toDateString(), status, record: record || null }); } catch { /* full */ }
}

/** Today's last known status from the server, or null (other day / none). */
export function readTodayStatus() {
  const saved = readJson(STATUS_KEY);
  return saved && saved.day === new Date().toDateString() ? saved : null;
}

export function saveRules(rules) {
  try { writeJson(RULES_KEY, rules); } catch { /* full */ }
}
export function readRules() {
  return readJson(RULES_KEY);
}
export function saveStats(stats) {
  try { writeJson(STATS_KEY, stats); } catch { /* full */ }
}
export function readStats() {
  return readJson(STATS_KEY);
}

/** On log out: forget this browser's cached status (saved sign-ins stay with their owner). */
export function clearCachedStatus() {
  [STATUS_KEY, RULES_KEY, STATS_KEY].forEach((k) => localStorage.removeItem(k));
}
