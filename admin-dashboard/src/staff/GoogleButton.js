import React, { useEffect, useRef, useState } from 'react';
import { GOOGLE_CLIENT_ID } from './staffApi';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let gisPromise = null;

function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => { gisPromise = null; reject(new Error('Google sign-in could not load')); };
      document.head.appendChild(script);
    });
  }
  return gisPromise;
}

/**
 * Google's official "Continue with Google" button (Google Identity Services).
 * Calls onCredential with the Google ID token; the server verifies it.
 */
export default function GoogleButton({ onCredential, disabled, text = 'continue_with' }) {
  const containerRef = useRef(null);
  const callbackRef = useRef(onCredential);
  const [error, setError] = useState('');
  callbackRef.current = onCredential;

  useEffect(() => {
    let cancelled = false;
    loadGoogleIdentity()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => { if (response?.credential) callbackRef.current(response.credential); },
          ux_mode: 'popup',
          cancel_on_tap_outside: true,
        });
        const width = Math.min(400, containerRef.current.offsetWidth || 320);
        window.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard', theme: 'outline', size: 'large', text, shape: 'pill', width,
        });
      })
      .catch(() => { if (!cancelled) setError('Google sign-in is unavailable right now. Use the form below.'); });
    return () => { cancelled = true; };
  }, [text]);

  return (
    <div>
      <div
        ref={containerRef}
        style={{ display: 'flex', justifyContent: 'center', minHeight: 44, opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}
      />
      {error && <p style={{ fontSize: 13, color: '#b03a2e', textAlign: 'center', margin: '8px 0 0' }}>{error}</p>}
    </div>
  );
}
