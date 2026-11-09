import * as Location from 'expo-location';

// Without mobile data or Wi-Fi the phone can only find itself with GPS
// satellites, which can take a minute and may not work indoors. So:
// - a fix the phone already has from the last 2 minutes is used straight away
// - waiting for a new fix gives up after a while instead of hanging forever

const RECENT_FIX_MAX_AGE_MS = 2 * 60 * 1000;
const RECENT_FIX_MAX_ACCURACY_M = 100;
const CURRENT_FIX_TIMEOUT_MS = 20000;

export async function requestLocationPermission() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

function toPlain(pos) {
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
  };
}

/** The phone's own location from the last 2 minutes (accurate to 100 m), or null. */
async function getRecentFix() {
  try {
    const pos = await Location.getLastKnownPositionAsync({
      maxAge: RECENT_FIX_MAX_AGE_MS,
      requiredAccuracy: RECENT_FIX_MAX_ACCURACY_M,
    });
    return pos ? toPlain(pos) : null;
  } catch {
    return null;
  }
}

/**
 * Where the phone is now: a fix from the last 2 minutes if there is one,
 * otherwise a new GPS fix. Throws if none arrives within 20 seconds.
 */
export async function getCurrentLocation({ timeoutMs = CURRENT_FIX_TIMEOUT_MS } = {}) {
  const hasPermission = await requestLocationPermission();
  if (!hasPermission) {
    throw new Error('Location permission not granted');
  }

  const recent = await getRecentFix();
  if (recent) return recent;

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Location timed out')), timeoutMs);
  });
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      timeout,
    ]);
    return toPlain(pos);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calculate distance between user and institution using Haversine formula.
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Follows the phone's position while a screen is open. Calls onChange with
 * { latitude, longitude, accuracy } (straight away when the phone has a fix
 * from the last 2 minutes) and returns a function that stops it.
 */
export async function watchLocation(onChange) {
  const hasPermission = await requestLocationPermission();
  if (!hasPermission) return () => {};
  let stopped = false;
  let gotLiveFix = false;
  getRecentFix().then((fix) => { if (fix && !stopped && !gotLiveFix) onChange(fix); });
  const sub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 10 },
    (pos) => {
      gotLiveFix = true;
      if (!stopped) onChange(toPlain(pos));
    }
  );
  return () => { stopped = true; sub.remove(); };
}
