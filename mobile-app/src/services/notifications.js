import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
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

export async function scheduleCheckInReminder(hour = 7, minute = 45) {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();

    // Morning check-in reminder (Mon-Fri)
    for (let day = 2; day <= 6; day++) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Time to Check In!',
          body: 'Good morning! Remember to check in when you arrive at work.',
          sound: true,
        },
        trigger: {
          type: 'weekly',
          weekday: day,
          hour,
          minute,
          repeats: true,
        },
      });
    }

    // Evening check-out reminder
    for (let day = 2; day <= 6; day++) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Time to Check Out!',
          body: 'Don\'t forget to check out before leaving.',
          sound: true,
        },
        trigger: {
          type: 'weekly',
          weekday: day,
          hour: 16,
          minute: 45,
          repeats: true,
        },
      });
    }
  } catch (err) {
    console.log('[Notifications] Schedule error:', err.message);
  }
}
