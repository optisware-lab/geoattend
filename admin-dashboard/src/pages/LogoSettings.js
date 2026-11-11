import React, { useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { FiImage, FiUpload, FiTrash2 } from 'react-icons/fi';
import { uploadInstitutionLogo, deleteInstitutionLogo } from '../services/api';
import InstitutionLogo, { currentInstitutionId, notifyLogoChanged } from '../components/InstitutionLogo';

const MAX_SIDE = 512;

/** Reads an image file and returns it as a PNG data URL, at most 512 px on its longest side. */
function toPngDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth || MAX_SIDE, img.naturalHeight || MAX_SIDE));
      const w = Math.max(1, Math.round((img.naturalWidth || MAX_SIDE) * scale));
      const h = Math.max(1, Math.round((img.naturalHeight || MAX_SIDE) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture we can read. Use a PNG, JPG or SVG image.')); };
    img.src = url;
  });
}

/**
 * Admin Settings: the institution logo. It is shown in the dashboard, on the
 * staff web page and phone app, on printed QR codes and on PDF/Excel reports.
 */
export default function LogoSettings() {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState('');
  const [hasLogo, setHasLogo] = useState(true);
  const institutionId = currentInstitutionId();

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('The logo is too large. Use an image under 5 MB.'); return; }
    setBusy('upload');
    try {
      const dataUrl = await toPngDataUrl(file);
      await uploadInstitutionLogo(dataUrl);
      notifyLogoChanged();
      setHasLogo(true);
      toast.success('Logo updated. It now shows on the dashboard, staff pages, apps and reports.');
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Could not upload the logo');
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    if (!window.confirm('Remove the institution logo?')) return;
    setBusy('remove');
    try {
      await deleteInstitutionLogo();
      notifyLogoChanged();
      setHasLogo(false);
      toast.success('Logo removed');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not remove the logo');
    } finally {
      setBusy('');
    }
  };

  const empty = (
    <div style={{ width: 120, height: 120, borderRadius: 12, border: '2px dashed #d5dae1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#95a5a6', fontSize: 12, gap: 6 }}>
      <FiImage size={26} />
      No logo yet
    </div>
  );

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 24, maxWidth: 900 }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <FiImage size={16} /> Institution logo
      </h3>
      <p style={{ fontSize: 13, color: '#7f8c8d', marginBottom: 16, lineHeight: 1.5 }}>
        Shown on the dashboard, the staff sign-in page and phone app, printed QR codes, and PDF and Excel reports.
        Use a square PNG with a clear or white background for the best result.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ width: 120, height: 120, borderRadius: 12, background: '#f6f8fa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {hasLogo ? (
            <InstitutionLogo institutionId={institutionId} size={108} fallback={empty} />
          ) : empty}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            type="button"
            className="ga-btn ga-btn-primary"
            disabled={!!busy}
            onClick={() => fileRef.current?.click()}
          >
            <FiUpload size={14} /> {busy === 'upload' ? 'Uploading...' : 'Upload logo'}
          </button>
          <button type="button" className="ga-btn ga-btn-red" disabled={!!busy} onClick={remove}>
            <FiTrash2 size={14} /> {busy === 'remove' ? 'Removing...' : 'Remove logo'}
          </button>
          <span style={{ fontSize: 11, color: '#95a5a6' }}>PNG, JPG or SVG, up to 5 MB</span>
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" style={{ display: 'none' }} onChange={onFile} />
      </div>
    </div>
  );
}
