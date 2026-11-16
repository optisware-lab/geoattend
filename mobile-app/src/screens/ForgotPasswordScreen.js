import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, SafeAreaView,
} from 'react-native';
import { forgotPassword, sendResetCode } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Two steps: 1) school code + Staff ID + email -> a 6-digit code is emailed,
// 2) the code + a new password. Only someone with the email inbox can reset.
export default function ForgotPasswordScreen({ navigation }) {
  const [institutionCode, setInstitutionCode] = useState('');
  const [staffId, setStaffId] = useState('');
  const [email, setEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [notice, setNotice] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    AsyncStorage.getItem('institutionCode').then((code) => {
      if (code) setInstitutionCode(String(code).toUpperCase());
    }).catch(() => {});
  }, []);

  const handleSendCode = async () => {
    if (!institutionCode.trim() || !staffId.trim() || !email.trim()) {
      Alert.alert('Error', 'Enter your institution code, Staff ID and email');
      return;
    }
    setLoading(true);
    try {
      const { data } = await sendResetCode(
        staffId.trim().toUpperCase(),
        email.trim().toLowerCase(),
        institutionCode.trim().toUpperCase()
      );
      setNotice(data?.message || 'We emailed you a 6-digit code.');
      setCodeSent(true);
    } catch (err) {
      Alert.alert('Could not send the code', err.response?.data?.error || 'Please check your internet and try again');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!/^\d{6}$/.test(resetCode.trim())) {
      Alert.alert('Error', 'Enter the 6-digit code from the email');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const { data } = await forgotPassword(
        staffId.trim().toUpperCase(),
        email.trim().toLowerCase(),
        newPassword,
        institutionCode.trim().toUpperCase(),
        resetCode.trim()
      );
      Alert.alert('Success', data.message, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Reset Failed', err.response?.data?.error || 'Please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Text style={styles.backBtn}>← Back to Login</Text>
            </TouchableOpacity>
            <Text style={styles.title}>{codeSent ? 'Enter the code' : 'Reset Password'}</Text>
            <Text style={styles.subtitle}>
              {codeSent
                ? 'Type the 6-digit code from the email and choose a new password'
                : 'We will email a 6-digit code to the email on your account'}
            </Text>
          </View>

          {!codeSent ? (
            <View style={styles.form}>
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Institution Code</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. RSS"
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
                <Text style={styles.label}>Email Address</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your registered email"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholderTextColor="#bdc3c7"
                />
              </View>

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleSendCode}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Email me a code</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.form}>
              {!!notice && <Text style={styles.notice}>{notice}</Text>}

              <View style={styles.inputContainer}>
                <Text style={styles.label}>6-digit code</Text>
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  placeholder="000000"
                  value={resetCode}
                  onChangeText={(v) => setResetCode(v.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="sms-otp"
                  maxLength={6}
                  placeholderTextColor="#bdc3c7"
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>New Password</Text>
                <View style={styles.passwordContainer}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Min. 6 characters"
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry={!showPassword}
                    placeholderTextColor="#bdc3c7"
                  />
                  <TouchableOpacity style={styles.eyeButton} onPress={() => setShowPassword(!showPassword)}>
                    <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁'}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Confirm Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Re-enter your new password"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showPassword}
                  placeholderTextColor="#bdc3c7"
                />
              </View>

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleReset}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Reset Password</Text>}
              </TouchableOpacity>

              <TouchableOpacity onPress={handleSendCode} disabled={loading}>
                <Text style={styles.linkText}>Send a new code</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a5276' },
  inner: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { marginBottom: 24 },
  backBtn: { color: 'rgba(255,255,255,0.7)', fontSize: 14, marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '700', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  form: {
    backgroundColor: '#fff', borderRadius: 16, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 10,
  },
  notice: {
    backgroundColor: '#e8f5e9', color: '#1e8449', borderRadius: 10,
    padding: 12, fontSize: 13, lineHeight: 18, marginBottom: 14,
  },
  inputContainer: { marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '600', color: '#7f8c8d', marginBottom: 5 },
  input: {
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 10,
    padding: 12, fontSize: 14, color: '#2c3e50',
  },
  codeInput: { fontSize: 22, fontWeight: '700', letterSpacing: 8, textAlign: 'center' },
  passwordContainer: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 10,
  },
  passwordInput: { flex: 1, padding: 12, fontSize: 14, color: '#2c3e50' },
  eyeButton: { padding: 12 },
  eyeIcon: { fontSize: 18 },
  button: {
    backgroundColor: '#1a5276', borderRadius: 10, padding: 16,
    alignItems: 'center', marginTop: 8,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkText: { color: '#1a5276', fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 16 },
});
