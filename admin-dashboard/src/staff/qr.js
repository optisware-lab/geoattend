import jsQR from 'jsqr';

/** Draws an image/video frame onto a canvas no wider than maxWidth and returns its pixels. */
function getPixels(source, sourceWidth, sourceHeight, maxWidth) {
  const scale = Math.min(1, maxWidth / sourceWidth);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export function decodeFrame(video) {
  if (!video.videoWidth) return null;
  const { data, width, height } = getPixels(video, video.videoWidth, video.videoHeight, 720);
  return jsQR(data, width, height, { inversionAttempts: 'dontInvert' })?.data || null;
}

/** Reads a QR code from a photo file; tries a few sizes because phone photos vary a lot. */
export function decodeImageFile(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let found = null;
      for (const maxWidth of [1280, 900, 1800, 600]) {
        const { data, width, height } = getPixels(img, img.naturalWidth, img.naturalHeight, maxWidth);
        found = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })?.data || null;
        if (found) break;
      }
      URL.revokeObjectURL(url);
      resolve(found);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/**
 * Turns scanned QR text into check-in fields, mirroring the mobile app:
 * the institution entrance code or the staff member's own ID card.
 * Returns { qrCode, qrToken } or { error }.
 */
export function parseQrPayload(text, user) {
  let qr;
  try { qr = JSON.parse(text); } catch { return { error: 'This is not a valid GeoAttend QR code.' }; }

  if (qr.type === 'institution_checkin') {
    if (user?.institutionId && qr.institutionId && qr.institutionId !== user.institutionId) {
      return { error: 'This QR code is for a different institution.' };
    }
    return { qrCode: qr.code, qrToken: qr.token || undefined };
  }
  if (qr.staffId) {
    if (qr.staffId !== user?.staffId) return { error: 'This QR code does not match your Staff ID.' };
    return { qrCode: qr.code };
  }
  return { error: 'This is not a valid GeoAttend QR code.' };
}
