import React, { useEffect, useState } from 'react';
import { API_BASE_URL } from '../services/api';

// The institution's logo, shown wherever the school is named. The image comes
// from the public /institutions/:id/logo address; a version number in the
// link makes every page show a new logo right after an admin changes it.

const VERSION_KEY = 'institutionLogoVersion';
const EVENT = 'ga-logo-changed';

function readVersion() {
  try { return localStorage.getItem(VERSION_KEY) || ''; } catch { return ''; }
}

/** Link to an institution's logo image. */
export function logoUrl(institutionId, version = readVersion()) {
  if (!institutionId) return null;
  return `${API_BASE_URL}/institutions/${encodeURIComponent(institutionId)}/logo${version ? `?v=${version}` : ''}`;
}

/** Call after uploading or removing the logo, so every place refreshes it. */
export function notifyLogoChanged() {
  const v = String(Date.now());
  try { localStorage.setItem(VERSION_KEY, v); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(EVENT));
}

/** Signed-in admin's institution id (from the saved login). */
export function currentInstitutionId() {
  try { return JSON.parse(localStorage.getItem('user'))?.institutionId || null; } catch { return null; }
}

/**
 * <img> of the logo that hides itself when the institution has none.
 * `fallback` is shown instead while there is no logo.
 */
export default function InstitutionLogo({ institutionId, size = 40, style, fallback = null, alt = 'Institution logo' }) {
  const [version, setVersion] = useState(readVersion);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const onChange = () => { setMissing(false); setVersion(readVersion()); };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  useEffect(() => { setMissing(false); }, [institutionId]);

  const src = logoUrl(institutionId, version);
  if (!src || missing) return fallback;
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setMissing(true)}
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, ...style }}
    />
  );
}
