const Jimp = require('jimp');

// Institution logos are re-encoded here as a PNG no bigger than 512 px on its
// longest side (transparency kept), so any upload is small, safe to show and
// usable in the PDF reports (PDFKit reads PNG and JPEG).

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 512;
const MIN_SIDE = 64;

function badLogo(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/** base64 image (or data: URL) -> PNG buffer. Throws a 400 error if unusable. */
async function normalizeLogo(input) {
  if (!input || typeof input !== 'string') throw badLogo('Choose an image for the logo.');
  const buffer = Buffer.from(input.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ''), 'base64');
  if (!buffer.length) throw badLogo('Choose an image for the logo.');
  if (buffer.length > MAX_INPUT_BYTES) throw badLogo('The logo is too large. Use an image under 5 MB.');

  let image;
  try {
    image = await Jimp.read(buffer);
  } catch {
    throw badLogo('That file is not a picture we can read. Use a PNG or JPG image.');
  }
  const { width, height } = image.bitmap;
  if (width < MIN_SIDE || height < MIN_SIDE) throw badLogo('The logo is too small. Use an image at least 64 pixels wide.');
  if (Math.max(width, height) > MAX_SIDE) {
    if (width >= height) image.resize(MAX_SIDE, Jimp.AUTO);
    else image.resize(Jimp.AUTO, MAX_SIDE);
  }
  return image.getBufferAsync(Jimp.MIME_PNG);
}

module.exports = { normalizeLogo };
