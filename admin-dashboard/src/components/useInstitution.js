import { useEffect, useState } from 'react';
import { getInstitution } from '../services/api';

// The signed-in admin's institution type. Schools don't use leave requests,
// so every Leave menu item, button and column asks `leaveEnabled` first.
// Remembered in the browser, so pages don't flicker on the next visit.

const CACHE_KEY = 'institutionType';
let pending = null;

function cachedType() {
  try { return localStorage.getItem(CACHE_KEY); } catch { return null; }
}

function fetchType() {
  if (!pending) {
    pending = getInstitution()
      .then(({ data }) => {
        const type = data?.institution_type === 'business' ? 'business' : 'school';
        try { localStorage.setItem(CACHE_KEY, type); } catch { /* storage blocked */ }
        return type;
      })
      .catch(() => cachedType() || 'school')
      .finally(() => { setTimeout(() => { pending = null; }, 60000); });
  }
  return pending;
}

/**
 * { type: 'school' | 'business', leaveEnabled, known } for the admin's
 * institution. known is false only on a first visit, until the server answers.
 */
export function useInstitutionType() {
  const [type, setType] = useState(() => cachedType());
  useEffect(() => {
    let alive = true;
    fetchType().then((t) => { if (alive) setType(t); });
    return () => { alive = false; };
  }, []);
  return { type: type || 'school', leaveEnabled: type === 'business', known: Boolean(type) };
}

/** Forget the saved type (e.g. on log out, before another admin logs in). */
export function clearInstitutionType() {
  pending = null;
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}
