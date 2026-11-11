import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Alert, TouchableOpacity, SafeAreaView, ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions, scanFromURLAsync } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { checkIn, checkInFromImage } from '../services/api';
import { getCurrentLocation } from '../services/location';
import { addToQueue, getQueueLength, isOnline } from '../services/offlineQueue';
import { confirmPresence } from '../services/presence';

const LOCATION_REQUIRED = 'GPS location is required for QR sign-in. Please enable location services and try again.';

function getDeviceId() {
  try { return Device.osBuildId || Device.modelId || Device.modelName || 'unknown'; } catch { return 'unknown'; }
}

async function getRequiredLocation() {
  let location = null;
  try { location = await getCurrentLocation(); } catch { location = null; }
  if (location?.latitude == null || location?.longitude == null) {
    Alert.alert('Location Required', LOCATION_REQUIRED);
    return null;
  }
  return location;
}

/** The sign-in photo; null (after telling the person) if it stopped. */
async function getPresenceFields() {
  let presence;
  try {
    presence = await confirmPresence();
  } catch {
    presence = { cancelled: true, message: 'Could not confirm it is you. Please try again.' };
  }
  if (presence.cancelled) {
    Alert.alert('Sign-In Stopped', presence.message);
    return null;
  }
  return presence.fields;
}

// Set by the screen: takes staff back to Home after a successful sign-in
let goHomeAfterCheckIn = null;

function showCheckInResult(result) {
  Alert.alert(
    'Sign-In Successful',
    result.isLate
      ? 'Signed in via QR code. You are marked as LATE.'
      : 'Signed in via QR code successfully!',
    [{ text: 'OK', onPress: () => goHomeAfterCheckIn?.() }]
  );
}

/**
 * Validates scanned QR text (institution entrance code or staff ID card) and
 * checks in. Shared by the live camera and photos picked from the gallery.
 */
async function checkInWithQrData(data) {
  let qrData;
  try {
    qrData = JSON.parse(data);
  } catch {
    Alert.alert('Invalid QR Code', 'This is not a valid GeoAttend QR code.');
    return;
  }

  const user = JSON.parse(await AsyncStorage.getItem('user'));
  const institution = JSON.parse(await AsyncStorage.getItem('institution'));

  let qrCode = null;
  let qrToken = null;

  if (qrData.type === 'institution_checkin') {
    // Institution-wide QR code (posted at entrance)
    if (institution && qrData.institutionId !== institution.institutionId && qrData.institutionId !== user?.institutionId) {
      Alert.alert('Wrong Institution', 'This QR code is for a different institution.');
      return;
    }
    qrCode = qrData.code;
    qrToken = qrData.token || null;
  } else if (qrData.staffId) {
    // Individual staff ID card QR code. The server checks it is this person's
    // own card; the ID printed on it can be an old one (IDs were renamed).
    qrCode = qrData.code;
  } else {
    Alert.alert('Invalid QR Code', 'This is not a valid GeoAttend QR code.');
    return;
  }

  const location = await getRequiredLocation();
  if (!location) return;

  const presenceFields = await getPresenceFields();
  if (!presenceFields) return;

  const payload = {
    latitude: location.latitude,
    longitude: location.longitude,
    method: 'qr_code',
    qrCode,
    qrToken: qrToken || undefined,
    deviceId: getDeviceId(),
    ...presenceFields,
  };

  const saveForLater = async () => {
    await addToQueue('check-in', payload);
    const qLen = await getQueueLength();
    Alert.alert(
      'Saved Offline',
      `Sign-in saved on this phone. It is sent by itself when you have internet. Waiting: ${qLen}`,
      [{ text: 'OK', onPress: () => goHomeAfterCheckIn?.() }]
    );
  };

  if (!(await isOnline())) {
    await saveForLater();
    return;
  }

  let result;
  try {
    ({ data: result } = await checkIn(payload));
  } catch (err) {
    // No answer from the server (weak or no internet): keep it for later
    if (!err.response) {
      await saveForLater();
      return;
    }
    throw err;
  }
  showCheckInResult(result);
}

/** Reads a QR code from an image on the device; null if none was found. */
async function readQrFromImage(uri) {
  try {
    const results = await scanFromURLAsync(uri, ['qr']);
    return results?.find((r) => r?.data)?.data || null;
  } catch {
    // Older native builds may not support on-device image scanning
    return null;
  }
}

/** Fallback when the phone can't read the photo: upload it for the server to decode. */
async function checkInWithServerDecode(asset) {
  if (!(await isOnline())) {
    Alert.alert(
      'QR Code Not Found',
      'We could not read a QR code in that photo. Pick a clearer, straight-on photo of the code, or use the live camera scanner.'
    );
    return;
  }

  const location = await getRequiredLocation();
  if (!location) return;

  const presenceFields = await getPresenceFields();
  if (!presenceFields) return;

  const formData = new FormData();
  formData.append('image', {
    uri: asset.uri,
    name: asset.mimeType?.includes('png') ? 'qr.png' : 'qr.jpg',
    type: asset.mimeType || 'image/jpeg',
  });
  formData.append('latitude', String(location.latitude));
  formData.append('longitude', String(location.longitude));
  formData.append('deviceId', getDeviceId());
  formData.append('selfieCapable', 'true');
  if (presenceFields.selfie) formData.append('selfie', presenceFields.selfie);

  const { data: result } = await checkInFromImage(formData);
  showCheckInResult(result);
}

export default function QRScanScreen({ navigation }) {
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    goHomeAfterCheckIn = () => navigation?.navigate?.('Home');
    return () => { goHomeAfterCheckIn = null; };
  }, [navigation]);
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);

  const showError = (err) => {
    const message = err.response?.data?.error || 'Sign-in failed. Please try again.';
    Alert.alert('Error', message);
  };

  const pickFromGallery = async () => {
    if (loading) return;
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        exif: false,
      });
      const asset = picked.assets?.[0];
      if (picked.canceled || !asset?.uri) return;

      setLoading(true);
      const data = await readQrFromImage(asset.uri);
      if (data) {
        await checkInWithQrData(data);
      } else {
        await checkInWithServerDecode(asset);
      }
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  const uploadButton = (
    <TouchableOpacity style={[styles.galleryBtn, loading && styles.btnDisabled]} onPress={pickFromGallery} disabled={loading}>
      <Ionicons name="image-outline" size={20} color="#1a5276" />
      <Text style={styles.galleryBtnText}>Upload QR Code Image</Text>
    </TouchableOpacity>
  );

  if (!permission) {
    return <View style={styles.container}><ActivityIndicator size="large" color="#1a5276" /></View>;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionBox}>
          <Text style={styles.permissionTitle}>Camera Permission Required</Text>
          <Text style={styles.permissionText}>
            We need camera access to scan QR codes for sign-in. You can also upload a photo of the QR code instead.
          </Text>
          <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
            <Text style={styles.permissionBtnText}>Grant Permission</Text>
          </TouchableOpacity>
          {uploadButton}
          {loading && <ActivityIndicator style={{ marginTop: 16 }} size="large" color="#1a5276" />}
        </View>
      </SafeAreaView>
    );
  }

  const handleBarCodeScanned = async ({ data }) => {
    if (scanned || loading) return;
    setScanned(true);
    setLoading(true);
    try {
      await checkInWithQrData(data);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
      setTimeout(() => setScanned(false), 3000);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>QR Code Sign-In</Text>
        <Text style={styles.subtitle}>Scan the institution QR code or your staff ID card</Text>
      </View>

      <View style={styles.cameraContainer}>
        {loading ? (
          // Released while signing in, so the sign-in photo can use the front camera
          <View style={[styles.camera, { backgroundColor: '#000' }]} />
        ) : (
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          />
        )}
        <View style={styles.overlay}>
          <View style={styles.scanFrame} />
        </View>
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.loadingText}>Signing in...</Text>
          </View>
        )}
      </View>

      <View style={styles.instructions}>
        {uploadButton}
        <Text style={styles.instructionText}>
          Point your camera at the QR code posted at the entrance or on your staff ID card, or upload a photo of it.
          {'\n'}GPS must be enabled — sign-in is rejected outside your institution's geofence.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  header: { padding: 20, paddingTop: 30 },
  title: { fontSize: 24, fontWeight: '700', color: '#2c3e50' },
  subtitle: { fontSize: 14, color: '#7f8c8d', marginTop: 4 },
  cameraContainer: { flex: 1, margin: 20, marginBottom: 12, borderRadius: 16, overflow: 'hidden', position: 'relative' },
  camera: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  scanFrame: {
    width: 250, height: 250, borderWidth: 3, borderColor: '#fff',
    borderRadius: 16, backgroundColor: 'transparent',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  loadingText: { color: '#fff', marginTop: 12, fontSize: 16, fontWeight: '500' },
  instructions: { paddingHorizontal: 20, paddingBottom: 20, alignItems: 'center' },
  instructionText: { fontSize: 13, color: '#7f8c8d', textAlign: 'center', marginTop: 12 },
  permissionBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  permissionTitle: { fontSize: 20, fontWeight: '700', color: '#2c3e50', marginBottom: 12 },
  permissionText: { fontSize: 14, color: '#7f8c8d', textAlign: 'center', marginBottom: 24 },
  permissionBtn: { backgroundColor: '#1a5276', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 10, marginBottom: 12 },
  permissionBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  galleryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 13, paddingHorizontal: 20, borderRadius: 10, alignSelf: 'stretch',
    borderWidth: 2, borderColor: '#1a5276', backgroundColor: '#fff',
  },
  btnDisabled: { opacity: 0.6 },
  galleryBtnText: { color: '#1a5276', fontSize: 15, fontWeight: '700' },
});
