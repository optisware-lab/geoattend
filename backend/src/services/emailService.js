const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  // Use configured SMTP or fallback to Ethereal (test) in dev
  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  return transporter;
}

async function sendEmail({ to, subject, html }) {
  const t = getTransporter();
  if (!t) {
    console.log(`[Email] No SMTP configured. Would send to ${to}: ${subject}`);
    return null;
  }

  try {
    const info = await t.sendMail({
      from: process.env.SMTP_FROM || '"GeoAttend" <noreply@geoattend.app>',
      to,
      subject,
      html,
    });
    console.log(`[Email] Sent to ${to}: ${subject} (${info.messageId})`);
    return info;
  } catch (err) {
    console.error(`[Email] Failed to send to ${to}:`, err.message);
    return null;
  }
}

async function sendAbsenceAlert({ adminEmails, absentMembers, date, institutionName }) {
  const rows = absentMembers.map(m =>
    `<tr><td style="padding:8px;border:1px solid #ddd">${m.staff_id}</td>
     <td style="padding:8px;border:1px solid #ddd">${m.first_name} ${m.last_name}</td>
     <td style="padding:8px;border:1px solid #ddd">${m.department || '-'}</td></tr>`
  ).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1a5276;color:#fff;padding:20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">Absence Alert - ${institutionName}</h2>
        <p style="margin:4px 0 0;opacity:0.8">${date}</p>
      </div>
      <div style="padding:20px;background:#fff;border:1px solid #e0e0e0">
        <p><strong>${absentMembers.length}</strong> member(s) did not check in today:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <thead><tr style="background:#f5f5f5">
            <th style="padding:8px;border:1px solid #ddd;text-align:left">ID</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Name</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Department</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="padding:12px 20px;background:#f8f8f8;border-radius:0 0 8px 8px;font-size:12px;color:#999">
        Automated report from GeoAttend
      </div>
    </div>`;

  for (const email of adminEmails) {
    await sendEmail({ to: email, subject: `Absence Alert: ${absentMembers.length} absent - ${date}`, html });
  }
}

async function sendDailySummary({ adminEmails, stats, date, institutionName }) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1a5276;color:#fff;padding:20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">Daily Attendance Summary</h2>
        <p style="margin:4px 0 0;opacity:0.8">${institutionName} - ${date}</p>
      </div>
      <div style="padding:20px;background:#fff;border:1px solid #e0e0e0">
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
          <div style="flex:1;min-width:120px;padding:16px;background:#eafaf1;border-radius:8px;text-align:center">
            <div style="font-size:28px;font-weight:700;color:#27ae60">${stats.present}</div>
            <div style="font-size:12px;color:#666">Present</div>
          </div>
          <div style="flex:1;min-width:120px;padding:16px;background:#fef9e7;border-radius:8px;text-align:center">
            <div style="font-size:28px;font-weight:700;color:#f39c12">${stats.late}</div>
            <div style="font-size:12px;color:#666">Late</div>
          </div>
          <div style="flex:1;min-width:120px;padding:16px;background:#fdedec;border-radius:8px;text-align:center">
            <div style="font-size:28px;font-weight:700;color:#e74c3c">${stats.absent}</div>
            <div style="font-size:12px;color:#666">Absent</div>
          </div>
          <div style="flex:1;min-width:120px;padding:16px;background:#ebf5fb;border-radius:8px;text-align:center">
            <div style="font-size:28px;font-weight:700;color:#3498db">${stats.total}</div>
            <div style="font-size:12px;color:#666">Total Staff</div>
          </div>
        </div>
        <p style="color:#666;font-size:13px">
          Attendance Rate: <strong>${stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0}%</strong>
          ${stats.autoCheckedOut > 0 ? ` | Auto-checked out: <strong>${stats.autoCheckedOut}</strong>` : ''}
          ${stats.overtime > 0 ? ` | Overtime: <strong>${stats.overtime}</strong>` : ''}
        </p>
      </div>
      <div style="padding:12px 20px;background:#f8f8f8;border-radius:0 0 8px 8px;font-size:12px;color:#999">
        Automated daily report from GeoAttend
      </div>
    </div>`;

  for (const email of adminEmails) {
    await sendEmail({ to: email, subject: `Daily Summary: ${stats.present}/${stats.total} present - ${date}`, html });
  }
}

async function sendWeeklySummary({ adminEmails, weekData, institutionName, weekRange }) {
  const dayRows = weekData.map(d =>
    `<tr>
      <td style="padding:8px;border:1px solid #ddd">${d.date}</td>
      <td style="padding:8px;border:1px solid #ddd;color:#27ae60">${d.present}</td>
      <td style="padding:8px;border:1px solid #ddd;color:#f39c12">${d.late}</td>
      <td style="padding:8px;border:1px solid #ddd;color:#e74c3c">${d.absent}</td>
      <td style="padding:8px;border:1px solid #ddd">${d.rate}%</td>
    </tr>`
  ).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1a5276;color:#fff;padding:20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">Weekly Attendance Report</h2>
        <p style="margin:4px 0 0;opacity:0.8">${institutionName} - ${weekRange}</p>
      </div>
      <div style="padding:20px;background:#fff;border:1px solid #e0e0e0">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f5f5f5">
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Date</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Present</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Late</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Absent</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Rate</th>
          </tr></thead>
          <tbody>${dayRows}</tbody>
        </table>
      </div>
      <div style="padding:12px 20px;background:#f8f8f8;border-radius:0 0 8px 8px;font-size:12px;color:#999">
        Automated weekly report from GeoAttend
      </div>
    </div>`;

  for (const email of adminEmails) {
    await sendEmail({ to: email, subject: `Weekly Report: ${institutionName} - ${weekRange}`, html });
  }
}

async function sendAutoSuspendNotice({ email, name, staffId, reason }) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#e74c3c;color:#fff;padding:20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">Account Suspended</h2>
      </div>
      <div style="padding:20px;background:#fff;border:1px solid #e0e0e0">
        <p>Hello ${name},</p>
        <p>Your GeoAttend account (<strong>${staffId}</strong>) has been automatically suspended due to:</p>
        <p style="background:#fff3cd;padding:12px;border-radius:6px;border-left:4px solid #f39c12">
          ${reason}
        </p>
        <p>Please contact your administrator to reactivate your account.</p>
      </div>
    </div>`;

  await sendEmail({ to: email, subject: 'GeoAttend: Account Suspended', html });
}

module.exports = {
  sendEmail,
  sendAbsenceAlert,
  sendDailySummary,
  sendWeeklySummary,
  sendAutoSuspendNotice,
};
