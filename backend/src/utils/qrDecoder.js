const Jimp = require('jimp');
const jsQR = require('jsqr');

const MAX_DECODE_WIDTH = 1280;

/** Decode the first QR code found in a JPEG/PNG buffer. Returns the raw string or null
 *  (null also covers unreadable/corrupt images so callers treat it as "no QR found"). */
async function decodeQrFromBuffer(buffer) {
  if (!buffer || buffer.length === 0) return null;

  let image;
  try {
    image = await Jimp.read(buffer);
  } catch {
    return null;
  }
  if (image.bitmap.width > MAX_DECODE_WIDTH) {
    image.resize(MAX_DECODE_WIDTH, Jimp.AUTO);
  }

  const { data, width, height } = image.bitmap;
  const rgba = new Uint8ClampedArray(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  );
  const result = jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' });
  return result && result.data ? result.data : null;
}

module.exports = { decodeQrFromBuffer };
