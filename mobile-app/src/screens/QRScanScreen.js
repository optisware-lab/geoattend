import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Alert, TouchableOpacity, SafeAreaView, ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { checkIn, checkInFromImage } from '../services/api';
import { getCurrentLocation } from '../services/location';
import { addToQueue, getQueueLength, isOnline } from '../services/offlineQueue';

export default function QRScanScreen() {
  const pickFromGallery = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        exif: false,
      });
      const asset = picked.assets?.[0];
      if (picked.canceled || !asset?.uri) return;

      const connected = await isOnline();
      if (!connected) {
        Alert.alert(
          'Internet Required',
          'Reading a QR code from a photo needs internet. Use the live camera scanner instead.'
        );
        return;
      }

      // GPS is enforced the same way as camera check-in
      let location = null;
      try { location = await getCurrentLocation(); } catch { location = null; }
      if (!location?.latitude || !location?.longitude) {
        Alert.alert('Location Required', 'GPS location is required for QR check-in. Please enable location services and try again.');
        return;
      }

      let deviceId = 'unknown';
      try { deviceId = Device.osBuildId || Device.modelId || Device.modelName || 'unknown'; } catch {}

      const formData = new FormData();
      formData.append('image', {
        uri: asset.uri,
        name: asset.mimeType?.includes('png') ? 'qr.png' : 'qr.jpg',
        type: asset.mimeType || 'image/jpeg',
      });
      formData.append('latitude', String(location.latitude));
      formData.append('longitude', String(location.longitude));
      formData.append('deviceId', deviceId);

      const { data: checkResult } = await checkInFromImage(formData);
      Alert.alert(
        'Check-In Successful',
        checkResult.isLate
          ? 'Checked in via QR code. You are marked as LATE.'
          : 'Checked in via QR code successfully!'
      );
    } catch (err) {
      const message = err.response?.data?.error || 'Check-in failed. Please try again.';
      Alert.alert('QR Code', message);
    } finally {
      setLoading(false);
    }
  };

  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!permission) {
    return <View style={styles.container}><ActivityIndicator size="large" color="#1a5276" /></View>;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionBox}>
          <Text style={styles.permissionTitle}>Camera Permission Required</Text>
          <Text style={styles.permissionText}>
            We need camera access to scan QR codes for check-in.
          </Text>
          <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
            <Text style={styles.permissionBtnText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.galleryBtn} onPress={pickFromGallery}>
            <Text style={styles.galleryBtnText}>Pick QR Photo from Gallery</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const handleBarCodeScanned = async ({ data }) => {
    if (scanned || loading) return;
    setScanned(true);
    setLoading(true);

    try {
      const qrData = JSON.parse(data);
      const user = JSON.parse(await AsyncStorage.getItem('user'));
      const institution = JSON.parse(await AsyncStorage.getItem('institution'));

      let qrCode = null;
      let qrToken = null;
      let method = 'qr_code';

      if (qrData.type === 'institution_checkin') {
        // Institution-wide QR code (posted at entrance)
        if (institution && qrData.institutionId !== institution.institutionId && qrData.institutionId !== user?.institutionId) {
          Alert.alert('Wrong Institution', 'This QR code is for a different institution.');
          setScanned(false);
          setLoading(false);
          return;
        }
        qrCode = qrData.code;
        qrToken = qrData.token || null;
        method = 'qr_code';
      } else if (qrData.staffId) {
        // Individual staff ID card QR code
        if (qrData.staffId !== user?.staffId) {
          Alert.alert('Invalid QR Code', 'This QR code does not match your Staff ID.');
          setScanned(false);
          setLoading(false);
          return;
        }
        qrCode = qrData.code;
      } else {
        Alert.alert('Invalid QR Code', 'This is not a valid GeoAttend QR code.');
        setScanned(false);
        setLoading(false);
        return;
      }

      let location = null;
      try { location = await getCurrentLocation(); } catch {
        Alert.alert('Location Required', 'GPS location is required for QR check-in. Please enable location services and try again.');
        setScanned(false);
        setLoading(false);
        return;
      }

      if (location?.latitude == null || location?.longitude == null) {
        Alert.alert('Location Required', 'GPS location is required for QR check-in. Please enable location services and try again.');
        setScanned(false);
        setLoading(false);
        return;
      }

      let deviceId = 'unknown';
      try { deviceId = Device.osBuildId || Device.modelId || Device.modelName || 'unknown'; } catch {}

      const payload = {
        latitude: location?.latitude,
        longitude: location?.longitude,
        method,
        qrCode,
        qrToken: qrToken || undefined,
        deviceId,
      };

      const connected = await isOnline();
      if (!connected) {
        await addToQueue('check-in', payload);
        const qLen = await getQueueLength();
        Alert.alert('Saved Offline', `Check-in queued. Will sync when internet is back. Pending: ${qLen}`);
        return;
      }

      const { data: result } = await checkIn(payload);

      Alert.alert(
        'Check-In Successful',
        result.isLate
          ? 'Checked in via QR code. You are marked as LATE.'
          : 'Checked in via QR code successfully!'
      );
    } catch (err) {
      if (err instanceof SyntaxError) {
        Alert.alert('Invalid QR Code', 'This is not a valid GeoAttend QR code.');
      } else {
        const message = err.response?.data?.error || 'Check-in failed. Please try again.';
        Alert.alert('Error', message);
      }
    } finally {
      setLoading(false);
      setTimeout(() => setScanned(false), 3000);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>QR Code Check-In</Text>
        <Text style={styles.subtitle}>Scan the institution QR code or your staff ID card</Text>
      </View>

      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        />
        <View style={styles.overlay}>
          <View style={styles.scanFrame} />
        </View>
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.loadingText}>Checking in...</Text>
          </View>
        )}
      </View>

      <View style={styles.instructions}>
        <TouchableOpacity style={styles.galleryBtn} onPress={pickFromGallery} disabled={loading}>
          <Text style={styles.galleryBtnText}>If you have a photo of the QR code, pick it from gallery</Text>
        </TouchableOpacity>
        <Text style={styles.instructionText}>
          Point your camera at the QR code posted at the entrance or on your staff ID card.
          {'\n'}GPS must be enabled — check-in is rejected outside your institution's geofence.
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
  cameraContainer: { flex: 1, margin: 20, borderRadius: 16, overflow: 'hidden', position: 'relative' },
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
  instructions: { padding: 20, alignItems: 'center' },
  instructionText: { fontSize: 14, color: '#7f8c8d', textAlign: 'center' },
  permissionBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  permissionTitle: { fontSize: 20, fontWeight: '700', color: '#2c3e50', marginBottom: 12 },
  permissionText: { fontSize: 14, color: '#7f8c8d', textAlign: 'center', marginBottom: 24 },
  permissionBtn: { backgroundColor: '#1a5276', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 10 },
  permissionBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  galleryBtn: {
    marginTop: 12, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 10,
    borderWidth: 2, borderColor: '#1a5276', backgroundColor: '#fff', alignSelf: 'center',
  },
  galleryBtnText: { color: '#1a5276', fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
