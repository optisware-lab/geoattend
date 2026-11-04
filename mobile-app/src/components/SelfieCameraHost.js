import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { registerSelfieCamera } from '../services/presence';

// The server stores sign-in photos at 480 px wide, so ask the camera for the
// smallest size that still covers that: a quicker upload on slow data.
const STORED_WIDTH = 480;

function pickPictureSize(sizes) {
  const candidates = (sizes || [])
    .filter((s) => /^\d+x\d+$/.test(s))
    .map((s) => {
      const [w, h] = s.split('x').map(Number);
      return { s, short: Math.min(w, h) };
    })
    .filter((c) => c.short >= STORED_WIDTH)
    .sort((a, b) => a.short - b.short);
  return candidates[0]?.s;
}

/**
 * Full-screen front camera for the sign-in photo. Mounted once in App.js;
 * screens open it through confirmPresence() in services/presence.js.
 */
export default function SelfieCameraHost() {
  const [permission, requestPermission] = useCameraPermissions();
  const [request, setRequest] = useState(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pictureSize, setPictureSize] = useState(undefined);
  const cameraRef = useRef(null);

  useEffect(() => registerSelfieCamera(() => new Promise((resolve) => {
    setReady(false);
    setBusy(false);
    setRequest({ resolve });
  })), []);

  const finish = (photoBase64) => {
    request?.resolve(photoBase64 || null);
    setRequest(null);
  };

  const onCameraReady = async () => {
    setReady(true);
    try {
      const size = pickPictureSize(await cameraRef.current?.getAvailablePictureSizesAsync());
      if (size) setPictureSize(size);
    } catch {}
  };

  const capture = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, base64: true, exif: false, shutterSound: false });
      finish(photo?.base64);
    } catch {
      setBusy(false);
    }
  };

  if (!request) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={() => finish(null)}>
      <View style={styles.container}>
        {!permission?.granted ? (
          <View style={styles.permissionBox}>
            <Ionicons name="camera-outline" size={48} color="#fff" />
            <Text style={styles.title}>Camera needed to sign in</Text>
            <Text style={styles.text}>
              GeoAttend takes a quick photo of your face at sign-in so your admin knows it was really you.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
              <Text style={styles.primaryBtnText}>Allow Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => finish(null)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing="front"
              pictureSize={pictureSize}
              onCameraReady={onCameraReady}
              animateShutter
            />
            <View style={styles.overlay} pointerEvents="box-none">
              <View style={styles.header}>
                <Text style={styles.title}>Sign-in photo</Text>
                <Text style={styles.text}>Put your face in the circle and tap the button.</Text>
              </View>
              <View style={styles.faceGuide} pointerEvents="none" />
              <View style={styles.footer}>
                <TouchableOpacity
                  style={[styles.shutter, (!ready || busy) && styles.shutterDisabled]}
                  onPress={capture}
                  disabled={!ready || busy}
                  accessibilityLabel="Take sign-in photo"
                >
                  {busy ? <ActivityIndicator color="#1a5276" /> : <Ionicons name="camera" size={34} color="#1a5276" />}
                </TouchableOpacity>
                <Text style={styles.privacy}>
                  Saved with this sign-in for your admin only. Deleted after 90 days.
                </Text>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => finish(null)} disabled={busy}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between', alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  header: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 16 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  text: { color: 'rgba(255,255,255,0.85)', fontSize: 14, textAlign: 'center', marginTop: 6 },
  faceGuide: { width: 240, height: 300, borderRadius: 150, borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)' },
  footer: { alignItems: 'center', width: '100%' },
  shutter: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: 'rgba(255,255,255,0.5)',
  },
  shutterDisabled: { opacity: 0.5 },
  privacy: { color: 'rgba(255,255,255,0.75)', fontSize: 12, textAlign: 'center', marginTop: 14 },
  cancelBtn: { marginTop: 10, padding: 10 },
  cancelText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  permissionBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: '#1a5276' },
  primaryBtn: { backgroundColor: '#fff', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 28, marginTop: 24 },
  primaryBtnText: { color: '#1a5276', fontSize: 16, fontWeight: '700' },
});
