import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, SafeAreaView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { login } from '../services/api';
import { useToast } from '../services/Toast';
import AuthSwitch from '../components/AuthSwitch';
import { authenticateWithBiometric, isBiometricAvailable, isBiometricEnabled, setBiometricEnabled } from '../services/biometric';
import { getCredentials, saveCredentials } from '../services/credentials';
import GoogleSignInButton from '../components/GoogleSignInButton';

export default function LoginScreen({ onLogin, onForgotPassword, onForgotStaffId, onRegister, onGoogleProfile }) {
  const toast = useToast();
  const [institutionCode, setInstitutionCode] = useState('');
  const [staffId, setStaffId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recentAccounts, setRecentAccounts] = useState([]);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [hasSavedCreds, setHasSavedCreds] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('recentAccounts').then(stored => {
      if (stored) setRecentAccounts(JSON.parse(stored));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('institutionCode').then((code) => {
      if (code) setInstitutionCode(String(code).toUpperCase());
    }).catch(() => {});
  }, []);

  useEffect(() => {
    isBiometricAvailable().then(setBioAvailable).catch(() => setBioAvailable(false));
    isBiometricEnabled().then(setBioEnabled).catch(() => setBioEnabled(false));
  }, []);

  // Autofill saved staff credentials
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const creds = await getCredentials();
        if (cancelled) return;
        if (creds?.identifier) setStaffId(creds.identifier);
        if (creds?.password) setPassword(creds.password);
        setHasSavedCreds(!!creds);
      } catch {
        if (!cancelled) setHasSavedCreds(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleLogin = async () => {
    const normalizedInstitutionCode = institutionCode.trim().toUpperCase();
    if (!staffId.trim() || !password) {
      toast.error('Please enter your Staff ID and password');
      return;
    }

    setLoading(true);
    try {
      let deviceInfo = {};
      try {
        deviceInfo = {
          deviceId: (Device.osBuildId || Device.modelId || Device.modelName || 'unknown').substring(0, 100),
          deviceModel: (Device.modelName || 'unknown').substring(0, 100),
          osVersion: `${Device.osName || Platform.OS} ${Device.osVersion || ''}`.trim().substring(0, 100),
        };
      } catch (e) {
        deviceInfo = { deviceId: 'unknown', deviceModel: 'unknown', osVersion: 'unknown' };
      }

      const { data } = await login(staffId.trim().toUpperCase(), password, normalizedInstitutionCode, deviceInfo);

      await AsyncStorage.setItem('token', data.token);
      await AsyncStorage.setItem('user', JSON.stringify(data.user));
      await AsyncStorage.setItem('institution', JSON.stringify(data.institution));
      await AsyncStorage.setItem('institutionCode', normalizedInstitutionCode);

      // Save credentials securely for next login autofill / biometric login
      await saveCredentials({
        identifier: staffId.trim().toUpperCase(),
        password,
      });
      setHasSavedCreds(true);

      // Offer to enable biometric (non-blocking)
      try {
        if (bioAvailable && !bioEnabled) {
          await setBiometricEnabled(true);
          setBioEnabled(true);
        }
      } catch {}

      onLogin();
    } catch (err) {
      const serverMsg = err.response?.data?.error;
      const debug = err.response?.data?.debug;
      const msg = serverMsg || err.message || 'Unable to connect to server';
      toast.error(debug ? `${msg} (${debug})` : msg, 'Login Failed');
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    if (loading) return;
    try {
      if (!bioAvailable) {
        toast.error('Biometric is not available on this device.');
        return;
      }
      if (!bioEnabled) {
        toast.error('Enable biometric in Profile first.');
        return;
      }

      const creds = await getCredentials();
      if (!creds) {
        toast.error('No saved credentials found. Sign in once with password first.');
        return;
      }

      const ok = await authenticateWithBiometric();
      if (!ok) return;

      setLoading(true);

      let deviceInfo = {};
      try {
        deviceInfo = {
          deviceId: (Device.osBuildId || Device.modelId || Device.modelName || 'unknown').substring(0, 100),
          deviceModel: (Device.modelName || 'unknown').substring(0, 100),
          osVersion: `${Device.osName || Platform.OS} ${Device.osVersion || ''}`.trim().substring(0, 100),
        };
      } catch (e) {
        deviceInfo = { deviceId: 'unknown', deviceModel: 'unknown', osVersion: 'unknown' };
      }

      const normalizedInstitutionCode = institutionCode.trim().toUpperCase();
      const { data } = await login(creds.identifier.trim().toUpperCase(), creds.password, normalizedInstitutionCode, deviceInfo);

      await AsyncStorage.setItem('token', data.token);
      await AsyncStorage.setItem('user', JSON.stringify(data.user));
      await AsyncStorage.setItem('institution', JSON.stringify(data.institution));
      await AsyncStorage.setItem('institutionCode', normalizedInstitutionCode);

      onLogin();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Biometric login failed';
      toast.error(msg, 'Login Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.inner}>
        <View style={styles.logoSection}>
          <View style={styles.iconCircle}>
            <Text style={styles.iconText}>G</Text>
          </View>
          <Text style={styles.appName}>GeoAttend</Text>
          <Text style={styles.subtitle}>Staff Attendance System</Text>
        </View>

        <AuthSwitch active="signin" onSignUp={() => onRegister && onRegister()} />

        {recentAccounts.length > 0 && (
          <View style={styles.recentSection}>
            <Text style={styles.recentTitle}>Recent Accounts</Text>
            <View style={styles.recentList}>
              {recentAccounts.map((acc) => (
                <TouchableOpacity
                  key={acc.staffId}
                  style={[styles.recentItem, staffId === acc.staffId && styles.recentItemActive]}
                  onPress={() => setStaffId(acc.staffId)}
                >
                  <View style={styles.recentAvatar}>
                    <Text style={styles.recentAvatarText}>
                      {(acc.firstName?.[0] || '') + (acc.lastName?.[0] || '')}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recentName} numberOfLines={1}>{acc.firstName} {acc.lastName}</Text>
                    <Text style={styles.recentId}>{acc.staffId}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Institution Code</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. INST-123456"
              value={institutionCode}
              onChangeText={(v) => setInstitutionCode(v.toUpperCase())}
              autoCapitalize="characters"
              placeholderTextColor="#bdc3c7"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Staff ID</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your Staff ID"
              value={staffId}
              onChangeText={setStaffId}
              autoCapitalize="characters"
              placeholderTextColor="#bdc3c7"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Enter your password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholderTextColor="#bdc3c7"
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword(!showPassword)}
              >
                <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleLogin} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => onForgotPassword && onForgotPassword()}>
            <Text style={styles.forgotText}>Forgot Password?</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => onForgotStaffId && onForgotStaffId()}>
            <Text style={styles.forgotText}>Forgot Staff ID?</Text>
          </TouchableOpacity>

          {bioAvailable && bioEnabled && hasSavedCreds && (
            <TouchableOpacity style={styles.biometricLink} onPress={handleBiometricLogin} disabled={loading}>
              <Text style={styles.biometricLinkText}>Use Biometric Instead?</Text>
            </TouchableOpacity>
          )}

          <GoogleSignInButton
            institutionCode={institutionCode}
            disabled={loading}
            onSignedIn={onLogin}
            onNeedsProfile={(params) => onGoogleProfile && onGoogleProfile(params)}
          />
        </View>

        <TouchableOpacity style={styles.signUpBtn} onPress={() => onRegister && onRegister()} activeOpacity={0.85}>
          <Text style={styles.signUpBtnText}>New here? Create an Account</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>Geofenced Staff Attendance System</Text>
        <Text style={styles.powered}>Powered by Optisware</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a5276' },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  logoSection: { alignItems: 'center', marginBottom: 20 },
  iconCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  iconText: { fontSize: 36, fontWeight: '700', color: '#fff' },
  appName: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.7)' },
  form: {
    backgroundColor: '#fff', borderRadius: 16, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 10,
  },
  inputContainer: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#7f8c8d', marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 10,
    padding: 14, fontSize: 15, color: '#2c3e50',
  },
  passwordContainer: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 10,
  },
  passwordInput: {
    flex: 1, padding: 14, fontSize: 15, color: '#2c3e50',
  },
  eyeButton: { padding: 14 },
  eyeIcon: { fontSize: 20 },
  button: {
    backgroundColor: '#1a5276', borderRadius: 10, padding: 16,
    alignItems: 'center', marginTop: 8,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  biometricLink: { marginTop: 14, alignItems: 'center' },
  biometricLinkText: { color: '#1a5276', fontSize: 14, fontWeight: '700' },
  recentSection: { marginBottom: 16 },
  recentTitle: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.6)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  recentList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recentItem: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 10, padding: 10,
    minWidth: '45%', flex: 1,
  },
  recentItemActive: { backgroundColor: 'rgba(255,255,255,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  recentAvatar: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  recentAvatarText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  recentName: { fontSize: 12, fontWeight: '600', color: '#fff' },
  recentId: { fontSize: 10, color: 'rgba(255,255,255,0.6)' },
  forgotText: { textAlign: 'right', color: '#1a5276', fontSize: 13, fontWeight: '500', marginTop: 8 },
  footer: { textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 20 },
  signUpBtn: {
    backgroundColor: '#fff', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4,
  },
  signUpBtnText: { color: '#1a5276', fontSize: 16, fontWeight: '700' },
  powered: { textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 8, marginBottom: Platform.OS === 'android' ? 48 : 8 },
});
