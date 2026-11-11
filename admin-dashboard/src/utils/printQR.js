import { currentInstitutionId, logoUrl } from '../components/InstitutionLogo';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Opens a print-friendly ID card window for a staff QR code.
export function printStaffQRCode({ qrCode, staffId, firstName, lastName, department, position, institutionName }) {
  if (!qrCode) return;
  if (!/^data:image\/(png|jpeg);base64,/.test(qrCode)) return;

  const win = window.open('', '_blank', 'width=420,height=560');
  if (!win) {
    window.alert('Please allow pop-ups to print the QR code.');
    return;
  }

  const fullName = escapeHtml([firstName, lastName].filter(Boolean).join(' '));
  const subtitle = escapeHtml([department, position].filter(Boolean).join(' • '));
  const safeStaffId = escapeHtml(staffId);
  const safeInstitutionName = escapeHtml(institutionName);
  const logoSrc = escapeHtml(logoUrl(currentInstitutionId()) || '');

  win.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>QR Code - ${safeStaffId}</title>
        <style>
          @page { size: auto; margin: 10mm; }
          body {
            font-family: -apple-system, Segoe UI, Arial, sans-serif;
            display: flex; justify-content: center; align-items: center;
            min-height: 100vh; margin: 0; background: #f0f2f5;
          }
          .card {
            width: 280px; padding: 24px; border: 1px solid #e0e0e0; border-radius: 12px;
            background: #fff; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
          }
          .institution { font-size: 12px; font-weight: 700; letter-spacing: 0.5px; color: #1a5276; text-transform: uppercase; margin-bottom: 12px; }
          img { width: 200px; height: 200px; }
          img.school-logo { width: auto; height: 56px; max-width: 160px; object-fit: contain; margin-bottom: 8px; }
          .name { font-size: 16px; font-weight: 700; color: #2c3e50; margin-top: 12px; }
          .id { font-size: 13px; color: #7f8c8d; margin-top: 2px; }
          .subtitle { font-size: 12px; color: #95a5a6; margin-top: 4px; }
          @media print { body { background: #fff; } .card { box-shadow: none; border: none; } }
        </style>
      </head>
      <body>
        <div class="card">
          ${logoSrc ? `<img class="school-logo" src="${logoSrc}" alt="" onerror="this.remove()" />` : ''}
          ${safeInstitutionName ? `<div class="institution">${safeInstitutionName}</div>` : ''}
          <img src="${qrCode}" alt="QR Code" />
          <div class="name">${fullName}</div>
          <div class="id">${safeStaffId}</div>
          ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}
        </div>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();

  // Data URI images are already in memory, but guard against onload firing
  // twice (once natively, once via the fallback timer) triggering two dialogs.
  let printed = false;
  const triggerPrint = () => {
    if (printed) return;
    printed = true;
    win.print();
  };
  win.onload = triggerPrint;
  // Give the logo a moment to load if onload doesn't fire
  setTimeout(triggerPrint, logoSrc ? 2500 : 300);
}
