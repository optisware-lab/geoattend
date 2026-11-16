import React, { useRef } from 'react';
import { FiCalendar } from 'react-icons/fi';
import { formatDate } from '../utils/format';

/**
 * A date box that reads like "Sun, 18-Oct, 2026" instead of 10/18/2026.
 * Tapping it opens the browser's normal date picker. `value` and `onChange`
 * work with "YYYY-MM-DD" strings, like <input type="date">.
 */
export default function DateField({ id, value, onChange, placeholder = 'Pick a date', min, max, style, disabled }) {
  const inputRef = useRef(null);

  const openPicker = () => {
    const input = inputRef.current;
    if (!input || disabled) return;
    try {
      if (typeof input.showPicker === 'function') { input.showPicker(); return; }
    } catch { /* not allowed here: fall back to focusing */ }
    input.focus();
    input.click();
  };

  return (
    <div style={{ position: 'relative', ...style }}>
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        aria-label={value ? `${formatDate(value)}. Change date` : placeholder}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%',
          padding: '8px 12px', border: '1px solid #e0e0e0', borderRadius: 8, background: '#fff',
          fontSize: 13, fontFamily: 'inherit', color: value ? '#2c3e50' : '#95a5a6', cursor: disabled ? 'default' : 'pointer',
          minWidth: 150, textAlign: 'left', whiteSpace: 'nowrap',
        }}
      >
        <span>{value ? formatDate(value) : placeholder}</span>
        <FiCalendar size={14} color="#7f8c8d" aria-hidden="true" />
      </button>
      {/* The real date input, kept invisible under the button so the picker opens in place */}
      <input
        ref={inputRef}
        id={id}
        type="date"
        value={value || ''}
        min={min}
        max={max}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => onChange(e.target.value)}
        style={{ position: 'absolute', left: 0, bottom: 0, width: '100%', height: 1, opacity: 0, pointerEvents: 'none', border: 0, padding: 0 }}
      />
    </div>
  );
}
