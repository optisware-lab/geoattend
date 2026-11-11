import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../services/theme';

// A one-time "what's new" notice, same text as the staff web page
// (admin-dashboard/src/staff/UpdateNotice.js). Once someone taps OK it is
// remembered on the phone. To announce something new, change NOTICE (new key).
const NOTICE = {
  key: '2026-11-offline-signin',
  title: 'GeoAttend has been updated',
  points: [
    'No data? You can still sign in and out. It is saved on your phone and sent automatically when you are back online.',
    'Using the web page? Open it once with internet today so your phone keeps a copy. Tip: add it to your Home Screen.',
    'Saw "Error 500" or "Couldn\'t load your status"? That is fixed. Just open GeoAttend again.',
    "You stay logged in. Please don't tap Log Out.",
  ],
};

const STORAGE_KEY = `noticeSeen:${NOTICE.key}`;

export default function UpdateNotice() {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((seen) => { if (seen !== '1') setOpen(true); })
      .catch(() => {});
  }, []);

  const close = () => {
    AsyncStorage.setItem(STORAGE_KEY, '1').catch(() => {});
    setOpen(false);
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={[styles.box, { backgroundColor: theme.card }]} accessibilityViewIsModal>
          <Text style={[styles.title, { color: theme.dark ? '#5dade2' : '#1a5276' }]}>{NOTICE.title}</Text>
          {NOTICE.points.map((p) => (
            <View key={p} style={styles.row}>
              <Text style={[styles.bullet, { color: theme.textSecondary }]}>{'•'}</Text>
              <Text style={[styles.point, { color: theme.text }]}>{p}</Text>
            </View>
          ))}
          <TouchableOpacity style={styles.button} onPress={close} accessibilityRole="button">
            <Text style={styles.buttonText}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center', padding: 20 },
  box: { borderRadius: 16, padding: 20 },
  title: { fontSize: 19, fontWeight: '700', marginBottom: 12 },
  row: { flexDirection: 'row', marginBottom: 10 },
  bullet: { fontSize: 15, marginRight: 8, lineHeight: 21 },
  point: { flex: 1, fontSize: 15, lineHeight: 21 },
  button: { marginTop: 8, backgroundColor: '#1a5276', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
