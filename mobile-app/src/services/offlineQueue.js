import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { checkIn, checkOut, postGeofenceEvent } from './api';

// Sign-ins, sign-outs and geofence reports made without internet wait here
// and are sent when the phone is back online.
//
// Each entry is stored under its own key (the list of keys is kept apart), so
// one entry with a large sign-in photo can never make the whole queue
// unreadable, and adding an entry while a sync runs never overwrites it.
// Entries remember which staff member made them: after a log out, the next
// person's login never sends someone else's sign-ins.

const INDEX_KEY = 'offline_queue_index';
const ITEM_PREFIX = 'offline_queue_item:';
const LEGACY_KEY = 'offline_queue'; // one big list, used by older versions

// The server refuses offline records older than 7 days; drop them after that
const MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;

// Errors worth retrying later; any other 4xx means the server rejected the
// entry for good (outside geofence, duplicate, too old...), so drop it.
// 402 = the school's plan has lapsed; keep the entry until it is renewed.
const RETRYABLE_STATUSES = [401, 402, 408, 429];

const ATTENDANCE_ACTIONS = ['check-in', 'check-out'];

/** True when the phone has a connection that actually reaches the internet. */
export const isOnlineState = (state) => state?.isConnected === true && state?.isInternetReachable !== false;

export const isOnline = async () => isOnlineState(await NetInfo.fetch());

// ---- storage helpers --------------------------------------------------------

// Every change to the index goes through this chain, one at a time
let indexLock = Promise.resolve();
function withIndexLock(fn) {
  const run = indexLock.then(fn, fn);
  indexLock = run.catch(() => {});
  return run;
}

async function readIndex() {
  try {
    const ids = JSON.parse(await AsyncStorage.getItem(INDEX_KEY));
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

async function currentUserId() {
  try {
    return JSON.parse(await AsyncStorage.getItem('user'))?.id || null;
  } catch {
    return null;
  }
}

let idCounter = 0;
const newId = () => `${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

let migrated = false;
/** Moves entries saved by older versions (one big list) into the new layout. */
async function migrateLegacyQueue() {
  if (migrated) return;
  migrated = true;
  let legacy;
  try {
    legacy = await AsyncStorage.getItem(LEGACY_KEY);
  } catch {
    // Too large to read (a big photo inside): it can never be sent, so clear
    // it instead of leaving the app stuck on it
    await AsyncStorage.removeItem(LEGACY_KEY).catch(() => {});
    return;
  }
  if (!legacy) return;
  let items = [];
  try { items = JSON.parse(legacy); } catch {}
  if (Array.isArray(items) && items.length > 0) {
    const userId = await currentUserId();
    await withIndexLock(async () => {
      const ids = await readIndex();
      for (const item of items) {
        if (!item?.action) continue;
        const id = newId();
        // Older entries were made by whoever was logged in at the time
        await AsyncStorage.setItem(ITEM_PREFIX + id, JSON.stringify({ id, userId, ...item }));
        ids.push(id);
      }
      await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(ids));
    });
  }
  await AsyncStorage.removeItem(LEGACY_KEY).catch(() => {});
}

async function readItem(id) {
  const raw = await AsyncStorage.getItem(ITEM_PREFIX + id); // may throw for oversized entries
  return raw ? JSON.parse(raw) : null;
}

async function removeItems(idsToRemove) {
  if (idsToRemove.length === 0) return;
  await withIndexLock(async () => {
    const drop = new Set(idsToRemove);
    const ids = (await readIndex()).filter((id) => !drop.has(id));
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(ids));
  });
  await AsyncStorage.multiRemove(idsToRemove.map((id) => ITEM_PREFIX + id)).catch(() => {});
}

/** This user's entries, oldest first. Entries that can't be read come back as { id, unreadable: true }. */
async function readQueue() {
  await migrateLegacyQueue();
  const userId = await currentUserId();
  const items = [];
  for (const id of await readIndex()) {
    let item;
    try {
      item = await readItem(id);
    } catch {
      items.push({ id, unreadable: true });
      continue;
    }
    if (!item) continue;
    if (item.userId && userId && item.userId !== userId) continue; // someone else's
    items.push(item);
  }
  return items;
}

// ---- public API ---------------------------------------------------------------

export const addToQueue = async (action, data) => {
  await migrateLegacyQueue();
  const id = newId();
  const item = { id, action, data, timestamp: new Date().toISOString(), userId: await currentUserId() };
  await AsyncStorage.setItem(ITEM_PREFIX + id, JSON.stringify(item));
  await withIndexLock(async () => {
    const ids = await readIndex();
    ids.push(id);
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(ids));
  });
};

/** Sign-ins and sign-outs of the logged-in staff member still waiting to be sent. */
export const getQueueLength = async () => {
  const items = await readQueue();
  return items.filter((item) => ATTENDANCE_ACTIONS.includes(item.action)).length;
};

/**
 * Today's status implied by queued (not yet synced) sign-ins/outs, so the
 * Home screen shows the right button while offline. Null when nothing is queued today.
 */
export const getPendingStatus = async () => {
  const items = await readQueue();
  const today = new Date().toDateString();
  const last = [...items].reverse().find(
    (item) => ATTENDANCE_ACTIONS.includes(item.action)
      && new Date(item.timestamp).toDateString() === today
  );
  if (!last) return null;
  return last.action === 'check-in' ? 'checked_in' : 'checked_out';
};

let syncPromise = null;

/**
 * Sends waiting entries in order. Only one sync runs at a time: a second call
 * while one is running gets the same result instead of sending entries twice.
 * Resolves to { synced, failed, rejected: [{ action, error }] }.
 */
export const syncQueue = () => {
  if (!syncPromise) {
    syncPromise = runSync().finally(() => { syncPromise = null; });
  }
  return syncPromise;
};

async function runSync() {
  const result = { synced: 0, failed: 0, rejected: [] };
  const state = await NetInfo.fetch();
  if (!state.isConnected) return result;

  const items = await readQueue();
  if (items.length === 0) return result;

  const done = [];
  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.unreadable) {
        done.push(item.id);
        result.rejected.push({ action: 'unknown', error: 'A saved sign-in on this phone was damaged and could not be sent. Please tell your admin.' });
        continue;
      }
      if (Date.now() - new Date(item.timestamp).getTime() > MAX_AGE_MS) {
        done.push(item.id);
        if (ATTENDANCE_ACTIONS.includes(item.action)) {
          result.rejected.push({ action: item.action, error: 'This offline record is more than 7 days old and was not sent. Please contact your administrator.' });
        }
        continue;
      }
      try {
        // Tell the server when this actually happened, plus the phone's clock now
        // so it can correct for a wrong phone clock
        const timed = { ...item.data, offline: true, recordedAt: item.timestamp, sentAt: new Date().toISOString() };
        if (item.action === 'check-in') {
          await checkIn(timed);
        } else if (item.action === 'check-out') {
          await checkOut(timed);
        } else if (item.action === 'geofence-event') {
          await postGeofenceEvent(item.data);
        }
        done.push(item.id);
        if (ATTENDANCE_ACTIONS.includes(item.action)) result.synced++;
      } catch (err) {
        const status = err.response?.status;
        if (status >= 400 && status < 500 && !RETRYABLE_STATUSES.includes(status)) {
          done.push(item.id);
          if (item.action !== 'geofence-event') {
            result.rejected.push({ action: item.action, error: err.response?.data?.error || 'Rejected by the server' });
          }
        } else {
          // No connection or server trouble: stop here and keep this entry and
          // everything after it, so a sign-out is never sent before its sign-in
          result.failed = items.length - i;
          break;
        }
      }
    }
  } finally {
    await removeItems(done);
  }
  return result;
}
