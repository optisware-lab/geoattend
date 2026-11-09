import AsyncStorage from '@react-native-async-storage/async-storage';

// Proves the person signing in is the account owner, not a colleague holding
// their phone: a sign-in photo taken with the front camera. Whether it is
// required comes from the institution's settings (sent with today's status).

const REQUIREMENTS_KEY = 'checkInRequirements';
// Until the server has told us otherwise, ask for the photo
const DEFAULT_REQUIREMENTS = { selfie: true };

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
 * Takes the sign-in photo before a sign-in.
 * Returns { fields } to add to the sign-in request, or { cancelled, message }
 * when the person stopped.
 */
export async function confirmPresence() {
  const required = await getCheckInRequirements();

  let selfie;
  if (required.selfie) {
    if (!openSelfieCamera) return { cancelled: true, message: 'The camera is not ready. Please try again.' };
    selfie = await openSelfieCamera();
    if (!selfie) return { cancelled: true, message: 'A sign-in photo is needed to sign in.' };
  }

  return { fields: { selfie, selfieCapable: true } };
}
