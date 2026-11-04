import React, { useEffect, useRef, useState } from 'react';

// The server stores sign-in photos at 480 px wide; capture at that size
const PHOTO_WIDTH = 480;

/**
 * Full-screen front camera for the sign-in photo. Live capture only (no photo
 * upload), so an old picture can't be reused. Calls onDone(base64Jpeg) or
 * onDone(null) when cancelled.
 */
export default function SelfieCapture({ onDone }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        setReady(true);
      } catch (err) {
        setError(err?.name === 'NotAllowedError'
          ? 'Camera access is blocked. Allow the camera for this site (iPhone: Settings > Safari > Camera > Allow), then try again.'
          : 'Could not open the front camera on this device.');
      }
    })();
    return () => {
      cancelled = true;
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const scale = Math.min(1, PHOTO_WIDTH / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    onDone(dataUrl.split(',')[1] || null);
  };

  return (
    <div style={st.backdrop} role="dialog" aria-modal="true" aria-label="Sign-in photo">
      <div style={st.header}>
        <div style={st.title}>Sign-in photo</div>
        <div style={st.text}>Put your face in the circle and tap the button.</div>
      </div>

      <div style={st.frame}>
        {/* Mirrored like a mirror; the saved photo is not */}
        <video ref={videoRef} playsInline muted style={st.video} />
        <div style={st.faceGuide} />
        {error && <div style={st.error}>{error}</div>}
      </div>

      <div style={st.footer}>
        <button type="button" style={st.shutter(ready)} onClick={capture} disabled={!ready} aria-label="Take sign-in photo">
          <span style={st.shutterDot} />
        </button>
        <div style={st.privacy}>Saved with this sign-in for your admin only. Deleted after 90 days.</div>
        <button type="button" style={st.cancel} onClick={() => onDone(null)}>Cancel</button>
      </div>
    </div>
  );
}

const st = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 1000, background: '#000', color: '#fff',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
    padding: '28px 16px', fontFamily: 'inherit',
  },
  header: { textAlign: 'center' },
  title: { fontSize: 20, fontWeight: 700 },
  text: { fontSize: 14, opacity: 0.85, marginTop: 6 },
  frame: {
    position: 'relative', width: '100%', maxWidth: 420, aspectRatio: '3 / 4', maxHeight: '58vh',
    borderRadius: 18, overflow: 'hidden', background: '#111',
  },
  video: { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: 'block' },
  faceGuide: {
    position: 'absolute', left: '50%', top: '50%', width: '62%', aspectRatio: '4 / 5',
    transform: 'translate(-50%, -50%)', borderRadius: '50%', border: '3px solid rgba(255,255,255,0.85)',
    pointerEvents: 'none',
  },
  error: {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 24, textAlign: 'center', fontSize: 15, background: 'rgba(0,0,0,0.75)',
  },
  footer: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' },
  shutter: (ready) => ({
    width: 76, height: 76, borderRadius: '50%', border: '4px solid rgba(255,255,255,0.5)',
    background: '#fff', opacity: ready ? 1 : 0.5, cursor: ready ? 'pointer' : 'default',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }),
  shutterDot: { width: 54, height: 54, borderRadius: '50%', background: '#1a5276' },
  privacy: { fontSize: 12, opacity: 0.75, textAlign: 'center', marginTop: 14 },
  cancel: { marginTop: 10, padding: 10, background: 'none', border: 'none', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' },
};
