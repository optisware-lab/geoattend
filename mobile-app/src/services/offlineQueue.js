import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { checkIn, checkOut, postGeofenceEvent } from './api';

const QUEUE_KEY = 'offline_queue';

// Errors worth retrying later; any other 4xx means the server rejected the
// entry for good (outside geofence, duplicate, too old...), so drop it.
const RETRYABLE_STATUSES = [401, 408, 429];

export const addToQueue = async (action, data) => {
  const queue = JSON.parse(await AsyncStorage.getItem(QUEUE_KEY) || '[]');
  queue.push({ action, data, timestamp: new Date().toISOString() });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
};

export const getQueueLength = async () => {
  const queue = JSON.parse(await AsyncStorage.getItem(QUEUE_KEY) || '[]');
  return queue.length;
};

/**
 * Today's status implied by queued (not yet synced) check-ins/outs, so the
 * Home screen shows the right button while offline. Null when nothing is queued today.
 */
export const getPendingStatus = async () => {
  const queue = JSON.parse(await AsyncStorage.getItem(QUEUE_KEY) || '[]');
  const today = new Date().toDateString();
  const last = [...queue].reverse().find(
    (item) => (item.action === 'check-in' || item.action === 'check-out')
      && new Date(item.timestamp).toDateString() === today
  );
  if (!last) return null;
  return last.action === 'check-in' ? 'checked_in' : 'checked_out';
};

export const syncQueue = async () => {
  const state = await NetInfo.fetch();
  if (!state.isConnected) return { synced: 0, failed: 0, rejected: [] };

  const queue = JSON.parse(await AsyncStorage.getItem(QUEUE_KEY) || '[]');
  if (queue.length === 0) return { synced: 0, failed: 0, rejected: [] };

  let synced = 0;
  let failed = 0;
  const rejected = [];
  const remaining = [];

  for (const item of queue) {
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
      synced++;
    } catch (err) {
      const status = err.response?.status;
      if (status >= 400 && status < 500 && !RETRYABLE_STATUSES.includes(status)) {
        if (item.action !== 'geofence-event') {
          rejected.push({ action: item.action, error: err.response?.data?.error || 'Rejected by the server' });
        }
      } else {
        remaining.push(item);
        failed++;
      }
    }
  }

  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return { synced, failed, rejected };
};

export const isOnline = async () => {
  const state = await NetInfo.fetch();
  return state.isConnected;
};
