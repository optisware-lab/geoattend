import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { googleAuth } from '../services/api';
import { useToast } from '../services/Toast';
import { getGoogleIdToken, getDeviceInfo, saveSession } from '../services/googleAuth';

/**
 * "Continue with Google" button. Signs straight in when the Google account is
 * linked and has a phone number; otherwise hands off to the profile step via
 * onNeedsProfile({ idToken, profile, existingAccount }).
 */
export default function GoogleSignInButton({ label = 'Continue with Google', institutionCode, onSignedIn, onNeedsProfile, disabled }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const handlePress = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const idToken = await getGoogleIdToken();
      if (!idToken) return; // cancelled

      const code = (institutionCode || '').trim().toUpperCase() || undefined;
      const { data } = await googleAuth(idToken, code, getDeviceInfo());

      if (data.needsProfile) {
        onNeedsProfile && onNeedsProfile({ idToken, profile: data.profile, existingAccount: data.existingAccount });
        return;
      }

      await saveSession(data);
      onSignedIn && onSignedIn();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Google sign-in failed';
      toast.error(msg, 'Google Sign-In');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>OR</Text>
        <View style={styles.dividerLine} />
      </View>
      <TouchableOpacity
        style={[styles.button, (busy || disabled) && styles.buttonDisabled]}
        onPress={handlePress}
        disabled={busy || disabled}
      >
        {busy ? (
          <ActivityIndicator color="#3c4043" />
        ) : (
          <>
            <Text style={styles.icon}>G</Text>
            <Text style={styles.text}>{label}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e0e0e0' },
  dividerText: { marginHorizontal: 12, color: '#95a5a6', fontSize: 12, fontWeight: '600' },
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#dadce0', borderRadius: 10, padding: 14, backgroundColor: '#fff',
  },
  buttonDisabled: { opacity: 0.7 },
  icon: { fontSize: 18, fontWeight: '700', color: '#4285F4', marginRight: 10 },
  text: { fontSize: 15, fontWeight: '600', color: '#3c4043' },
});
