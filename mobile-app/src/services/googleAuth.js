import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';

// The native module is missing in Expo Go — keep the rest of the app usable there.
let GoogleSignin = null;
let statusCodes = {};
try {
  ({ GoogleSignin, statusCodes } = require('@react-native-google-signin/google-signin'));
} catch {
  GoogleSignin = null;
}

const extra = Constants.expoConfig?.extra || {};
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || extra.GOOGLE_WEB_CLIENT_ID;
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || extra.GOOGLE_IOS_CLIENT_ID;

let configured = false;

export function isGoogleSignInAvailable() {
  return !!GoogleSignin && !!GOOGLE_WEB_CLIENT_ID;
}

/**
 * Opens the Google account picker and returns the ID token, or null if the
 * user cancelled. The backend verifies the token, so we never send raw
 * profile data it has to trust.
 */
export async function getGoogleIdToken() {
  if (!GoogleSignin) {
    throw new Error('Google sign-in needs the installed GeoAttend app (it is not available in Expo Go).');
  }
  if (!GOOGLE_WEB_CLIENT_ID) {
    throw new Error('Google sign-in is not configured for this build.');
  }
  if (!configured) {
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
      scopes: ['profile', 'email'],
    });
    configured = true;
  }

  try {
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }
    // Clear the previous session so the account picker always shows
    await GoogleSignin.signOut().catch(() => {});

    const result = await GoogleSignin.signIn();
    if (result?.type === 'cancelled') return null;

    const idToken = result?.data?.idToken || result?.idToken;
    if (!idToken) throw new Error('Google did not return a sign-in token. Please try again.');
    return idToken;
  } catch (err) {
    if (err?.code === statusCodes.SIGN_IN_CANCELLED) return null;
    if (err?.code === statusCodes.IN_PROGRESS) return null;
    if (err?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      throw new Error('Google Play Services is not available on this device.');
    }
    throw err;
  }
}

export function getDeviceInfo() {
  try {
    return {
      deviceId: (Device.osBuildId || Device.modelId || Device.modelName || 'unknown').substring(0, 100),
      deviceModel: (Device.modelName || 'unknown').substring(0, 100),
      osVersion: `${Device.osName || Platform.OS} ${Device.osVersion || ''}`.trim().substring(0, 100),
    };
  } catch {
    return { deviceId: 'unknown', deviceModel: 'unknown', osVersion: 'unknown' };
  }
}

/** Stores the session returned by any sign-in endpoint. */
export async function saveSession(data) {
  await AsyncStorage.setItem('token', data.token);
  await AsyncStorage.setItem('user', JSON.stringify(data.user));
  await AsyncStorage.setItem('institution', JSON.stringify(data.institution));
  if (data.institution?.code) {
    await AsyncStorage.setItem('institutionCode', data.institution.code);
  }
}
