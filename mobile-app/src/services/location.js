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

/** An Error whose `code` says what to show: 'denied' | 'blocked' | 'off' | 'timeout'. */
function locationError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * Makes sure the app may use location, asking if Android still allows asking.
 * Throws 'blocked' when the person chose "Don't allow" for good (only phone
 * Settings can undo it), 'denied' when they can still be asked, and 'off'
 * when the phone's Location switch is off.
 */
export async function ensureLocationAccess() {
  let perm = await Location.getForegroundPermissionsAsync();
  if (perm.status !== 'granted' && perm.canAskAgain !== false) {
    perm = await Location.requestForegroundPermissionsAsync();
  }
  if (perm.status !== 'granted') {
    throw perm.canAskAgain === false
      ? locationError('blocked', 'Location is not allowed for GeoAttend')
      : locationError('denied', 'Location permission not granted');
  }
  const on = await Location.hasServicesEnabledAsync().catch(() => true);
  if (!on) throw locationError('off', 'Location is turned off');
}

/**
 * Asks Android to switch Location on (the system "Turn on location" box).
 * Resolves true when it is on afterwards.
 */
export async function turnOnLocation() {
  try {
    await Location.enableNetworkProviderAsync();
  } catch {
    // Person said no, or the phone has no such box
  }
  return Location.hasServicesEnabledAsync().catch(() => false);
}

/**
 * A new fix: precise GPS first, then normal accuracy. On many Android phones
 * precise GPS fails straight away when "Google Location Accuracy" is off, even
 * with Location on; normal accuracy still works there.
 */
async function freshFix() {
  try {
    return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  } catch {
    try {
      return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    } catch {
      // Last resort: whatever fix the phone has, however old
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last) return last;
      throw locationError('timeout', 'Location unavailable');
    }
  }
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
  await ensureLocationAccess();

  const recent = await getRecentFix();
  if (recent) return recent;

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(locationError('timeout', 'Location timed out')), timeoutMs);
  });
  try {
    const pos = await Promise.race([freshFix(), timeout]);
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
  // Throws like getCurrentLocation, so the screen can say what is wrong
  await ensureLocationAccess();
  let stopped = false;
  let gotLiveFix = false;
  getRecentFix().then((fix) => { if (fix && !stopped && !gotLiveFix) onChange(fix); });
  const onPos = (pos) => {
    gotLiveFix = true;
    if (!stopped) onChange(toPlain(pos));
  };
  let sub;
  try {
    sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 10 }, onPos
    );
  } catch {
    // Precise GPS refused (e.g. "Google Location Accuracy" off): follow at normal accuracy
    sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 10 }, onPos
    );
  }
  return () => { stopped = true; sub.remove(); };
}
