// Draws the attendance report PDF:
//   1. Summary for the whole period and a "week by week at a glance" table
//   2. One section per week: who signed in each day (with times), who didn't
//   3. Full sign-in log, grouped by day

const PDFDocument = require('pdfkit');
const { DAYS, MONTHS, formatDate, formatDateRange, formatTime, toDate } = require('../utils/dateFormat');

const C = {
  navy: '#1a5276',
  text: '#2c3e50',
  muted: '#7f8c8d',
  line: '#e3e7eb',
  stripe: '#f6f8fa',
  green: '#1e8449',
  orange: '#c0640f',
  red: '#c0392b',
  blue: '#2471a3',
  tint: '#eaf1f7',
};

const PAGE = { margin: 36, width: 595.28, height: 841.89 };
const LEFT = PAGE.margin;
const WIDTH = PAGE.width - PAGE.margin * 2;
const BOTTOM = PAGE.height - PAGE.margin - 18; // room for the footer

const METHODS = { gps: 'GPS', qr_code: 'QR code', nfc: 'NFC', manual: 'Manual' };

/** "12-Oct" */
function shortDay(key) {
  const d = toDate(key);
  return d ? `${d.getDate()}-${MONTHS[d.getMonth()]}` : '';
}

function hoursBetween(a, b) {
  if (!a || !b) return '';
  const mins = Math.round((new Date(b) - new Date(a)) / 60000);
  if (mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function pct(n) {
  return n == null ? '-' : `${n}%`;
}

function renderAttendancePdf(stream, { institutionName, department, staffIdFilter, summary, records, staffById }) {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin, bufferPages: true });
  doc.pipe(stream);

  // ---- small drawing helpers ----
  const fit = (str, width) => {
    let s = String(str ?? '');
    if (doc.widthOfString(s) <= width) return s;
    while (s.length > 1 && doc.widthOfString(`${s}…`) > width) s = s.slice(0, -1);
    return `${s.trimEnd()}…`;
  };

  const cell = (str, x, y, width, { align = 'left', color = C.text, bold = false, size = 8 } = {}) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
    doc.text(fit(str, width - 4), x + 2, y, { width: width - 4, align, lineBreak: false });
  };

  const newPage = () => {
    doc.addPage();
    doc.y = PAGE.margin;
  };

  const ensure = (height) => {
    if (doc.y + height > BOTTOM) {
      newPage();
      return true;
    }
    return false;
  };

  const sectionTitle = (title, subtitle) => {
    ensure(60);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(C.navy).text(title, LEFT, doc.y);
    if (subtitle) doc.font('Helvetica').fontSize(8.5).fillColor(C.muted).text(subtitle, LEFT, doc.y + 1, { width: WIDTH });
    doc.y += 6;
  };

  // Table with a header row that repeats on every page it spans
  const table = (cols, rows, { rowHeight = 15, headerHeight = 18, minRows = 3 } = {}) => {
    const drawHeader = () => {
      const y = doc.y;
      doc.rect(LEFT, y, WIDTH, headerHeight).fill(C.navy);
      let x = LEFT;
      cols.forEach((c) => {
        const lines = String(c.label).split('\n');
        if (lines.length > 1) {
          cell(lines[0], x, y + 2.5, c.width, { align: c.align, color: '#ffffff', bold: true, size: 7.5 });
          cell(lines[1], x, y + 10, c.width, { align: c.align, color: '#d6e4f0', size: 6.5 });
        } else {
          cell(c.label, x, y + (headerHeight - 8) / 2, c.width, { align: c.align, color: '#ffffff', bold: true, size: 7.5 });
        }
        x += c.width;
      });
      doc.y = y + headerHeight;
    };

    ensure(headerHeight + rowHeight * Math.min(minRows, rows.length || 1));
    drawHeader();
    rows.forEach((row, i) => {
      if (row.group) {
        if (doc.y + rowHeight * 2 + 4 > BOTTOM) { newPage(); drawHeader(); }
        const y = doc.y;
        doc.rect(LEFT, y, WIDTH, rowHeight + 2).fill(C.tint);
        cell(row.group, LEFT + 4, y + 4.5, WIDTH - 8, { bold: true, color: C.navy, size: 8 });
        doc.y = y + rowHeight + 2;
        return;
      }
      if (doc.y + rowHeight > BOTTOM) { newPage(); drawHeader(); }
      const y = doc.y;
      if (i % 2 === 1) doc.rect(LEFT, y, WIDTH, rowHeight).fill(C.stripe);
      let x = LEFT;
      cols.forEach((c) => {
        const v = row[c.key];
        const opts = typeof v === 'object' && v !== null ? v : { text: v };
        cell(opts.text ?? '', x, y + (rowHeight - 8) / 2 + 0.5, c.width, {
          align: c.align, color: opts.color || C.text, bold: opts.bold || c.bold, size: c.size || 8,
        });
        x += c.width;
      });
      doc.moveTo(LEFT, y + rowHeight).lineTo(LEFT + WIDTH, y + rowHeight).lineWidth(0.5).strokeColor(C.line).stroke();
      doc.y = y + rowHeight;
    });
    doc.y += 8;
  };

  // ---- 1. Title and overall summary ----
  const { totals, weeks } = summary;
  const periodLabel = formatDateRange(summary.start, summary.end);
  const filtersLabel = [department && `Department: ${department}`, staffIdFilter && `Staff ID: ${staffIdFilter}`].filter(Boolean).join('   ·   ');

  doc.font('Helvetica-Bold').fontSize(20).fillColor(C.navy).text(institutionName, LEFT, PAGE.margin, { width: WIDTH, align: 'center' });
  doc.font('Helvetica').fontSize(13).fillColor(C.text).text('Attendance Report', { width: WIDTH, align: 'center' });
  doc.moveDown(0.2);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.text).text(`Period: ${periodLabel}`, { width: WIDTH, align: 'center' });
  if (filtersLabel) doc.font('Helvetica').fontSize(9).fillColor(C.muted).text(filtersLabel, { width: WIDTH, align: 'center' });
  const now = new Date();
  doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(`Generated ${formatDate(now)} at ${formatTime(now)}`, { width: WIDTH, align: 'center' });
  doc.y += 14;

  // Stat tiles
  const tiles = [
    { label: 'Staff', value: String(summary.staffCount), color: C.navy },
    { label: 'Work days', value: String(summary.workDayCount), color: C.navy },
    { label: 'Attendance rate', value: pct(totals.rate), color: C.navy },
    { label: 'On-time sign-ins', value: String(totals.onTime), color: C.green },
    { label: 'Late sign-ins', value: String(totals.late), color: C.orange },
    { label: 'Missed work days', value: String(totals.missed), color: C.red },
  ];
  const gap = 8;
  const tileW = (WIDTH - gap * (tiles.length - 1)) / tiles.length;
  const tileY = doc.y;
  tiles.forEach((t, i) => {
    const x = LEFT + i * (tileW + gap);
    doc.roundedRect(x, tileY, tileW, 48, 5).lineWidth(0.8).strokeColor(C.line).stroke();
    doc.font('Helvetica-Bold').fontSize(17).fillColor(t.color).text(t.value, x, tileY + 8, { width: tileW, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(t.label, x, tileY + 31, { width: tileW, align: 'center', lineBreak: false });
  });
  doc.y = tileY + 48 + 10;

  doc.font('Helvetica').fontSize(8.5).fillColor(C.text).text(
    `${summary.activeStaff} of ${summary.staffCount} staff signed in at least once in this period. `
      + `Attendance rate = days signed in ÷ work days expected (approved leave and days before a person joined are not counted).`,
    LEFT, doc.y, { width: WIDTH }
  );
  doc.y += 12;

  // Weeks at a glance
  sectionTitle('Week by week at a glance');
  if (!weeks.length) {
    doc.font('Helvetica').fontSize(9).fillColor(C.muted).text('No work days in this period yet.', LEFT, doc.y);
    doc.y += 12;
  } else {
    table(
      [
        { key: 'week', label: 'Week', width: 48, bold: true },
        { key: 'dates', label: 'Dates', width: 160 },
        { key: 'active', label: 'Staff signed in', width: 72, align: 'center' },
        { key: 'onTime', label: 'On time', width: 46, align: 'center' },
        { key: 'late', label: 'Late', width: 40, align: 'center' },
        { key: 'missed', label: 'Missed days', width: 58, align: 'center' },
        { key: 'leave', label: 'Leave days', width: 52, align: 'center' },
        { key: 'rate', label: 'Rate', width: WIDTH - 48 - 160 - 72 - 46 - 40 - 58 - 52, align: 'center' },
      ],
      weeks.map((w) => ({
        week: `Week ${w.number}`,
        dates: formatDateRange(w.start, w.end),
        active: `${w.active.length} of ${w.staffCounted}`,
        onTime: { text: String(w.onTime), color: C.green },
        late: { text: String(w.late), color: w.late ? C.orange : C.text },
        missed: { text: String(w.missed), color: w.missed ? C.red : C.text },
        leave: String(w.leave),
        rate: { text: pct(w.rate), bold: true },
      })),
      { minRows: weeks.length }
    );
  }

  if (summary.neverSignedIn.length) {
    ensure(40);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.red)
      .text(`Did not sign in at all in this period (${summary.neverSignedIn.length})`, LEFT, doc.y);
    doc.y += 3;
    doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
      .text(summary.neverSignedIn.map((p) => `${p.name} (${p.staffId})`).join(',   '), LEFT, doc.y, { width: WIDTH, lineGap: 2 });
    doc.y += 12;
  }

  // Key
  ensure(30);
  const keyY = doc.y;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.text).text('How to read the weekly tables:', LEFT, keyY);
  const key = [
    ['7:10 AM', C.green, 'signed in on time'],
    ['7:46 AM', C.orange, 'signed in late'],
    ['Missed', C.red, 'no sign-in on a work day'],
    ['Leave', C.blue, 'approved leave'],
  ];
  let kx = LEFT;
  key.forEach(([sample, color, label]) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(color).text(sample, kx, keyY + 12, { lineBreak: false });
    const sw = doc.widthOfString(sample);
    doc.font('Helvetica').fillColor(C.muted).text(` = ${label}`, kx + sw, keyY + 12, { lineBreak: false });
    kx += sw + doc.widthOfString(` = ${label}`) + 18;
  });
  doc.y = keyY + 30;

  // ---- 2. One section per week ----
  weeks.forEach((w) => {
    newPage();

    // Week banner
    const by = doc.y;
    doc.rect(LEFT, by, WIDTH, 30).fill(C.navy);
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#ffffff').text(`Week ${w.number}`, LEFT + 10, by + 8, { lineBreak: false });
    doc.font('Helvetica').fontSize(10).fillColor('#d6e4f0').text(formatDateRange(w.start, w.end), LEFT + 80, by + 10, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff')
      .text(`Attendance ${pct(w.rate)}`, LEFT, by + 10, { width: WIDTH - 10, align: 'right', lineBreak: false });
    doc.y = by + 38;

    doc.font('Helvetica').fontSize(9).fillColor(C.text).text(
      `${w.active.length} of ${w.staffCounted} staff signed in this week.  `
        + `${w.signIns} sign-ins: ${w.onTime} on time, ${w.late} late.  `
        + `${w.missed} missed work day${w.missed === 1 ? '' : 's'}${w.leave ? `, ${w.leave} day${w.leave === 1 ? '' : 's'} on leave` : ''}.`,
      LEFT, doc.y, { width: WIDTH }
    );
    doc.y += 8;

    // Who signed in, day by day
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.green).text(`Signed in this week (${w.active.length})`, LEFT, doc.y);
    doc.y += 4;

    if (w.active.length) {
      const nameW = 138;
      const idW = 52;
      const daysW = 36;
      const lateW = 30;
      const dayW = (WIDTH - nameW - idW - daysW - lateW) / w.days.length;
      const cols = [
        { key: 'name', label: 'Name', width: nameW, bold: true },
        { key: 'id', label: 'Staff ID', width: idW, size: 7.5 },
        ...w.days.map((d) => ({ key: d.date, label: `${DAYS[d.weekday]}\n${shortDay(d.date)}`, width: dayW, align: 'center', size: 7.5 })),
        { key: 'days', label: 'Days', width: daysW, align: 'center' },
        { key: 'late', label: 'Late', width: lateW, align: 'center' },
      ];
      const rows = [...w.active]
        .sort((a, b) => b.daysIn - a.daysIn || a.name.localeCompare(b.name))
        .map((r) => {
          const row = {
            name: r.name,
            id: { text: r.staffId, color: C.muted },
            days: { text: r.expected ? `${r.daysIn}/${r.expected}` : String(r.daysIn), bold: true },
            late: { text: String(r.late), color: r.late ? C.orange : C.muted },
          };
          w.days.forEach((d) => {
            const c = r.cells[d.date];
            if (!c) row[d.date] = '';
            else if (c.status === 'ontime') row[d.date] = { text: formatTime(c.checkIn), color: C.green };
            else if (c.status === 'late') row[d.date] = { text: formatTime(c.checkIn), color: C.orange, bold: true };
            else if (c.status === 'leave') row[d.date] = { text: 'Leave', color: C.blue };
            else row[d.date] = { text: 'Missed', color: C.red };
          });
          return row;
        });
      table(cols, rows, { headerHeight: 22, rowHeight: 15 });
    } else {
      doc.font('Helvetica').fontSize(9).fillColor(C.muted).text('Nobody signed in this week.', LEFT, doc.y);
      doc.y += 10;
    }

    // Who didn't
    const listOf = (rows) => rows.map((r) => `${r.name} (${r.staffId})`).join(',   ');
    if (w.inactive.length) {
      ensure(40);
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.red).text(`Did not sign in this week (${w.inactive.length})`, LEFT, doc.y);
      doc.y += 3;
      doc.font('Helvetica').fontSize(8.5).fillColor(C.text).text(listOf(w.inactive), LEFT, doc.y, { width: WIDTH, lineGap: 2 });
      doc.y += 8;
    }
    if (w.onLeave.length) {
      ensure(40);
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.blue).text(`On leave all week (${w.onLeave.length})`, LEFT, doc.y);
      doc.y += 3;
      doc.font('Helvetica').fontSize(8.5).fillColor(C.text).text(listOf(w.onLeave), LEFT, doc.y, { width: WIDTH, lineGap: 2 });
      doc.y += 8;
    }
  });

  // ---- 3. Full sign-in log ----
  if (records.length) {
    newPage();
    sectionTitle('Full sign-in log', 'Every sign-in in the period, day by day.');

    const byDay = new Map();
    records.forEach((r) => {
      const k = formatDate(r.date);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(r);
    });

    const rows = [];
    byDay.forEach((list, label) => {
      const late = list.filter((r) => r.is_late).length;
      rows.push({ group: `${label}   ·   ${list.length} signed in${late ? `, ${late} late` : ''}` });
      list
        .map((r) => ({ r, s: staffById.get(r.staff_uuid) || {} }))
        .sort((a, b) => new Date(a.r.check_in_time) - new Date(b.r.check_in_time))
        .forEach(({ r, s }) => {
          rows.push({
            name: `${s.first_name || ''} ${s.last_name || ''}`.trim(),
            id: { text: s.staff_id || '', color: C.muted },
            dept: s.department || '-',
            in: formatTime(r.check_in_time, '-'),
            out: formatTime(r.check_out_time, '-'),
            hours: hoursBetween(r.check_in_time, r.check_out_time) || '-',
            method: METHODS[r.check_in_method] || r.check_in_method || '-',
            status: r.is_late ? { text: 'Late', color: C.orange, bold: true } : { text: 'On time', color: C.green },
          });
        });
    });

    table(
      [
        { key: 'name', label: 'Name', width: 140, bold: true },
        { key: 'id', label: 'Staff ID', width: 55 },
        { key: 'dept', label: 'Department', width: 78 },
        { key: 'in', label: 'Sign in', width: 50 },
        { key: 'out', label: 'Sign out', width: 50 },
        { key: 'hours', label: 'Hours', width: 45 },
        { key: 'method', label: 'Method', width: 50 },
        { key: 'status', label: 'Status', width: WIDTH - 140 - 55 - 78 - 50 - 50 - 45 - 50 },
      ],
      rows
    );
  }

  // ---- Footer on every page ----
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = PAGE.height - PAGE.margin + 4;
    doc.moveTo(LEFT, fy - 6).lineTo(LEFT + WIDTH, fy - 6).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted)
      .text(`${institutionName}  ·  Attendance Report  ·  ${periodLabel}`, LEFT, fy, { width: WIDTH, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, LEFT, fy, { width: WIDTH, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottomMargin;
  }

  doc.end();
}

module.exports = { renderAttendancePdf };
