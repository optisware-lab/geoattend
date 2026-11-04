import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';

// Proves the person signing in is the account owner, not a colleague holding
// their phone: a fingerprint/Face ID check, then a sign-in photo. What is
// required comes from the institution's settings (sent with today's status).

const REQUIREMENTS_KEY = 'checkInRequirements';
// Until the server has told us otherwise, ask for both
const DEFAULT_REQUIREMENTS = { selfie: true, biometric: true };

let openSelfieCamera = null;

/** Called by <SelfieCameraHost/>: lets any screen open the sign-in camera. */
export function registerSelfieCamera(open) {
  openSelfieCamera = open;
  return () => { if (openSelfieCamera === open) openSelfieCamera = null; };
}

export async function saveCheckInRequirements(requirements) {
  if (!requirements) return;
  try { await AsyncStorage.setItem(REQUIREMENTS_KEY, JSON.stringify(requirements)); } catch {}
}

async function getCheckInRequirements() {
  try {
    const saved = JSON.parse(await AsyncStorage.getItem(REQUIREMENTS_KEY));
    return saved ? { ...DEFAULT_REQUIREMENTS, ...saved } : DEFAULT_REQUIREMENTS;
  } catch {
    return DEFAULT_REQUIREMENTS;
  }
}

/**
 * Runs the identity checks before a sign-in.
 * Returns { fields } to add to the sign-in request, or { cancelled, message }
 * when the person stopped or failed a check.
 */
export async function confirmPresence() {
  const required = await getCheckInRequirements();

  let biometric = 'not_required';
  if (required.biometric) {
    const hasHardware = await LocalAuthentication.hasHardwareAsync().catch(() => false);
    const enrolled = hasHardware && await LocalAuthentication.isEnrolledAsync().catch(() => false);
    if (!enrolled) {
      // Phones without a fingerprint/Face ID set up can still sign in; the
      // admin sees this on the record
      biometric = 'unavailable';
    } else {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Confirm it is you to sign in',
        cancelLabel: 'Cancel',
        // No PIN fallback: a colleague who knows the PIN must not pass
        disableDeviceFallback: true,
      });
      if (!result.success) {
        return { cancelled: true, message: 'Fingerprint / Face ID did not match. Only the account owner can sign in.' };
      }
      biometric = 'passed';
    }
  }

  let selfie;
  if (required.selfie) {
    if (!openSelfieCamera) return { cancelled: true, message: 'The camera is not ready. Please try again.' };
    selfie = await openSelfieCamera();
    if (!selfie) return { cancelled: true, message: 'A sign-in photo is needed to sign in.' };
  }

  return { fields: { biometric, selfie, selfieCapable: true } };
}
