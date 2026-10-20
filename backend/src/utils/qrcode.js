const QRCode = require('qrcode');

/**
 * Generate a QR code as a data URL for a staff member's ID card.
 */
async function generateQRCode(staffData) {
  const qrData = JSON.stringify({
    staffId: staffData.staff_id,
    institutionId: staffData.institution_id,
    uuid: staffData.id,
    code: staffData.qr_code_data,
  });

  const qrDataUrl = await QRCode.toDataURL(qrData, {
    width: 300,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
  });

  return qrDataUrl;
}

/**
 * Generate a QR code as a buffer (for PDF embedding).
 */
async function generateQRCodeBuffer(staffData) {
  const qrData = JSON.stringify({
    staffId: staffData.staff_id,
    institutionId: staffData.institution_id,
    uuid: staffData.id,
    code: staffData.qr_code_data,
  });

  return QRCode.toBuffer(qrData, {
    width: 300,
    margin: 2,
  });
}

/**
 * Generate a single institution-wide check-in QR code.
 * Staff scan this at the entrance to check in.
 * When the institution has a rotation token it is embedded so the server can
 * verify the scan is on the CURRENT poster (old prints/photos become invalid).
 */
async function generateInstitutionQR(institution) {
  const payload = {
    type: 'institution_checkin',
    institutionId: institution.id,
    name: institution.name,
    code: `INST-${institution.id}`,
  };
  if (institution.qr_rotation_token) {
    payload.token = institution.qr_rotation_token;
    payload.rotatedAt = institution.qr_rotated_at || null;
  }

  const qrDataUrl = await QRCode.toDataURL(JSON.stringify(payload), {
    width: 400,
    margin: 2,
    color: { dark: '#1a5276', light: '#ffffff' },
  });

  return qrDataUrl;
}

module.exports = { generateQRCode, generateQRCodeBuffer, generateInstitutionQR };
