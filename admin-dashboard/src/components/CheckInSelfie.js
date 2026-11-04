import React, { useEffect, useState } from 'react';
import { FiX } from 'react-icons/fi';
import { getCheckInSelfie } from '../services/api';
import { Avatar } from './ui';

// Photos are fetched with the admin's token (an <img src> can't send it), then
// kept for the session so auto-refresh doesn't download them again.
const photoCache = new Map();

function useSelfieUrl(recordId, enabled) {
  const [url, setUrl] = useState(() => photoCache.get(recordId) || null);

  useEffect(() => {
    if (!enabled || !recordId) return undefined;
    if (photoCache.has(recordId)) { setUrl(photoCache.get(recordId)); return undefined; }
    let cancelled = false;
    getCheckInSelfie(recordId)
      .then(({ data }) => {
        const objectUrl = URL.createObjectURL(data);
        photoCache.set(recordId, objectUrl);
        if (!cancelled) setUrl(objectUrl);
      })
      .catch(() => {
        // Deleted after the retention period, or not saved
        photoCache.set(recordId, null);
      });
    return () => { cancelled = true; };
  }, [recordId, enabled]);

  return url;
}

/**
 * The person's avatar on an attendance record: the photo taken at sign-in when
 * there is one (tap to compare it with their profile photo), else the avatar.
 */
export default function CheckInSelfie({ record, size = 44 }) {
  const hasSelfie = record.check_in_selfie === 'taken';
  const url = useSelfieUrl(record.id, hasSelfie);
  const [open, setOpen] = useState(false);

  if (!hasSelfie || !url) {
    return <Avatar first={record.first_name} last={record.last_name} photo={record.profile_photo_url} size={size} />;
  }

  const name = `${record.first_name || ''} ${record.last_name || ''}`.trim();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Sign-in photo: tap to compare"
        style={{ padding: 0, border: '2px solid #27ae60', borderRadius: '50%', background: 'none', cursor: 'pointer', flexShrink: 0, lineHeight: 0 }}
      >
        <img src={url} alt={`${name} at sign-in`} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Sign-in photo of ${name}`}
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div onClick={(e) => e.stopPropagation()} className="ga-card" style={{ padding: 20, width: 560, maxWidth: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#2c3e50' }}>{name}</div>
                <div style={{ fontSize: 12.5, color: '#7f8c8d' }}>{record.staff_id} · does the sign-in photo match?</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7f8c8d', padding: 4 }}>
                <FiX size={20} />
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <figure style={{ margin: 0 }}>
                <img src={url} alt="At sign-in" style={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 10, background: '#f0f3f6' }} />
                <figcaption style={{ fontSize: 12, color: '#5d6d7e', marginTop: 6, textAlign: 'center' }}>At sign-in</figcaption>
              </figure>
              <figure style={{ margin: 0 }}>
                {record.profile_photo_url ? (
                  <img src={record.profile_photo_url} alt="Profile" style={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 10, background: '#f0f3f6' }} />
                ) : (
                  <div style={{ width: '100%', aspectRatio: '3 / 4', borderRadius: 10, background: '#f0f3f6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#95a5a6', fontSize: 13, textAlign: 'center', padding: 12 }}>
                    No profile photo yet
                  </div>
                )}
                <figcaption style={{ fontSize: 12, color: '#5d6d7e', marginTop: 6, textAlign: 'center' }}>Profile photo</figcaption>
              </figure>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
