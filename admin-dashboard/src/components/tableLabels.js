import { useEffect } from 'react';

// On phones, tables are shown as one card per row (see index.css, "Phone
// layout"). Each value then needs its column name next to it. Rather than
// labelling every <td> by hand on every page, this copies each column's
// header text onto its cells as data-label, for every table on the page,
// and keeps doing so as pages load or change.

function headerLabels(table) {
  const headRow = table.tHead?.rows?.[table.tHead.rows.length - 1];
  if (!headRow) return null;
  const labels = [];
  Array.from(headRow.cells).forEach((th) => {
    const text = th.textContent.replace(/\s+/g, ' ').trim();
    const span = Number(th.colSpan) || 1;
    for (let i = 0; i < span; i += 1) labels.push(text);
  });
  return labels;
}

function labelTable(table) {
  const labels = headerLabels(table);
  if (!labels) return;
  Array.from(table.tBodies).forEach((body) => {
    Array.from(body.rows).forEach((row) => {
      let col = 0;
      Array.from(row.cells).forEach((cell) => {
        const span = Number(cell.colSpan) || 1;
        // A cell spanning the whole row (e.g. "No records found") gets no label
        const label = span >= labels.length ? '' : (labels[col] || '');
        if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label);
        col += span;
      });
    });
  });
}

function labelAll(root = document) {
  root.querySelectorAll('table').forEach(labelTable);
}

/** Keeps data-label on table cells current. Use once, near the top of the app. */
export function useTableLabels() {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; labelAll(); });
    };
    labelAll();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, []);
}
