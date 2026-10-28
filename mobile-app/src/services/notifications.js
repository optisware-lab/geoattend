import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications() {
  if (!Device.isDevice) return null;

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowSound: true,
          allowBadge: true,
        },
      });
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'GeoAttend',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    // getExpoPushTokenAsync requires a development build in SDK 53+
    // It will fail in Expo Go — catch and return null gracefully
    const token = (await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig?.extra?.eas?.projectId,
    })).data;

    try {
      await api.post('/auth/push-token', { pushToken: token });
    } catch {}

    return token;
  } catch (err) {
    // Push token registration not available in Expo Go (SDK 53+)
    // Local notifications still work, only remote push is affected
    console.log('[Notifications] Push token unavailable (Expo Go):', err.message);
    return null;
  }
}


const REMINDER_KEY = 'workReminderSchedule';
const DEFAULT_RULES = { start: '08:00:00', end: '17:00:00', days: [1, 2, 3, 4, 5] };

/** "08:00:00" moved by `deltaMin` minutes -> { hour, minute } */
function shiftClock(hhmmss, deltaMin) {
  const [h, m] = String(hhmmss).split(':').map(Number);
  const total = (((h || 0) * 60 + (m || 0) + deltaMin) % 1440 + 1440) % 1440;
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

function clockLabel({ hour, minute }) {
  const h12 = hour % 12 || 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * Weekly reminders on the institution's working days: one 15 minutes before
 * work starts and one 10 minutes before it ends. `days` uses the server's
 * numbering (0 = Sunday).
 */
export async function scheduleCheckInReminder({ start = DEFAULT_RULES.start, end = DEFAULT_RULES.end, days = DEFAULT_RULES.days } = {}) {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    const morning = shiftClock(start, -15);
    const evening = shiftClock(end, -10);
    const startLabel = clockLabel(shiftClock(start, 0));
    const endLabel = clockLabel(shiftClock(end, 0));

    for (const day of days) {
      const weekday = Number(day) + 1; // Expo: 1 = Sunday ... 7 = Saturday
      if (weekday < 1 || weekday > 7) continue;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Time to check in',
          body: `Work starts at ${startLabel}. Open GeoAttend when you arrive. It unlocks as soon as you're on site.`,
          sound: true,
        },
        trigger: { type: 'weekly', weekday, hour: morning.hour, minute: morning.minute, repeats: true },
      });
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Don't forget to check out",
          body: `Work ends at ${endLabel}. Check out before you leave.`,
          sound: true,
        },
        trigger: { type: 'weekly', weekday, hour: evening.hour, minute: evening.minute, repeats: true },
      });
    }
  } catch (err) {
    console.log('[Notifications] Schedule error:', err.message);
  }
}

/**
 * Fetches the admin's work hours and (re)schedules reminders only when they
 * changed, so a new start time reaches every phone automatically.
 */
export async function syncWorkReminders() {
  let rules = null;
  try {
    rules = (await api.get('/institutions/rules')).data;
  } catch {
    // Offline: keep whatever is already scheduled
  }
  const schedule = {
    start: rules?.work_start_time || DEFAULT_RULES.start,
    end: rules?.work_end_time || DEFAULT_RULES.end,
    days: Array.isArray(rules?.working_days) && rules.working_days.length
      ? rules.working_days.map(Number)
      : DEFAULT_RULES.days,
  };
  try {
    const signature = JSON.stringify(schedule);
    const previous = await AsyncStorage.getItem(REMINDER_KEY);
    const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
    if (previous === signature && scheduled.length > 0) return;
    await scheduleCheckInReminder(schedule);
    await AsyncStorage.setItem(REMINDER_KEY, signature);
  } catch (err) {
    console.log('[Notifications] Sync error:', err.message);
  }
}

/** Stops reminders, e.g. when signing out. */
export async function clearWorkReminders() {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    await AsyncStorage.removeItem(REMINDER_KEY);
  } catch {}
}
