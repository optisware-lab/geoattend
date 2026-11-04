import AsyncStorage from '@react-native-async-storage/async-storage';

// Remembers today's sign-in status on this phone, so reopening the app shows
// the right button straight away (Sign Out after signing in), even before the
// server answers or when it can't be reached. Tied to the logged-in staff
// member and to today's date; cleared on log out.
export const TODAY_STATUS_KEY = 'todayStatus';
const STATUSES = ['not_checked_in', 'checked_in', 'checked_out'];

async function currentUserId() {
  try {
    return JSON.parse(await AsyncStorage.getItem('user'))?.id || null;
  } catch {
    return null;
  }
}

export async function saveTodayStatus(status, record) {
  try {
    const userId = await currentUserId();
    if (!userId || !STATUSES.includes(status)) return;
    await AsyncStorage.setItem(TODAY_STATUS_KEY, JSON.stringify({
      userId,
      day: new Date().toDateString(),
      status,
      // Only what the home screen shows; no location or device details
      record: record ? {
        check_in_time: record.check_in_time || null,
        check_out_time: record.check_out_time || null,
        is_late: !!record.is_late,
      } : null,
    }));
  } catch {
    // Only a convenience: the server stays the source of truth
  }
}

/** Today's saved status for the logged-in staff member, or null. */
export async function readTodayStatus() {
  try {
    const saved = JSON.parse(await AsyncStorage.getItem(TODAY_STATUS_KEY));
    const userId = await currentUserId();
    if (!saved || !userId || saved.userId !== userId) return null;
    if (saved.day !== new Date().toDateString() || !STATUSES.includes(saved.status)) return null;
    return saved;
  } catch {
    return null;
  }
}
