import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator, SafeAreaView, ScrollView,
} from 'react-native';
import api from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GoogleSignInButton from '../components/GoogleSignInButton';

export default function RegisterScreen({ navigation, onLogin }) {
  const [form, setForm] = useState({
    staffId: '', firstName: '', lastName: '', email: '', phone: '',
    password: '', confirmPassword: '', department: '', position: '', institutionCode: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    AsyncStorage.getItem('institutionCode').then((code) => {
      if (code) update('institutionCode', String(code).toUpperCase());
    }).catch(() => {});
  }, []);

  const update = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const handleRegister = async () => {
    const { institutionCode, staffId, firstName, lastName, password, confirmPassword } = form;

    if (!institutionCode.trim() || !staffId.trim() || !firstName.trim() || !lastName.trim() || !password) {
      Alert.alert('Error', 'Please fill in Institution Code, Staff ID, First Name, Last Name, and Password');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', {
        staffId: staffId.trim().toUpperCase(),
        institutionCode: institutionCode.trim().toUpperCase(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        password,
        department: form.department.trim() || undefined,
        position: form.position.trim() || undefined,
      });

      Alert.alert('Success', data.message, [
        { text: 'Go to Login', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Registration Failed', err.response?.data?.error || 'Please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Register as a new staff member</Text>

          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Institution Code *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. INST-123456"
                value={form.institutionCode}
                onChangeText={v => update('institutionCode', v.toUpperCase())}
                autoCapitalize="characters"
                placeholderTextColor="#bdc3c7"
              />
            </View>

            <View style={styles.row}>
              <View style={[styles.inputContainer, { flex: 1 }]}>
                <Text style={styles.label}>Staff ID *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. STF001"
                  value={form.staffId}
                  onChangeText={v => update('staffId', v)}
                  autoCapitalize="characters"
                  placeholderTextColor="#bdc3c7"
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={[styles.inputContainer, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.label}>First Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="First name"
                  value={form.firstName}
                  onChangeText={v => update('firstName', v)}
                  placeholderTextColor="#bdc3c7"
                />
              </View>
              <View style={[styles.inputContainer, { flex: 1 }]}>
                <Text style={styles.label}>Last Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Last name"
                  value={form.lastName}
                  onChangeText={v => update('lastName', v)}
                  placeholderTextColor="#bdc3c7"
                />
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="your.email@example.com"
                value={form.email}
                onChangeText={v => update('email', v)}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholderTextColor="#bdc3c7"
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Phone</Text>
              <TextInput
                style={styles.input}
                placeholder="0XX XXX XXXX"
                value={form.phone}
                onChangeText={v => update('phone', v)}
                keyboardType="phone-pad"
                placeholderTextColor="#bdc3c7"
              />
            </View>

            <View style={styles.row}>
              <View style={[styles.inputContainer, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.label}>Department</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. IT"
                  value={form.department}
                  onChangeText={v => update('department', v)}
                  placeholderTextColor="#bdc3c7"
                />
              </View>
              <View style={[styles.inputContainer, { flex: 1 }]}>
                <Text style={styles.label}>Position</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Accountant"
                  value={form.position}
                  onChangeText={v => update('position', v)}
                  placeholderTextColor="#bdc3c7"
                />
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Password *</Text>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="Min 6 characters"
                  value={form.password}
                  onChangeText={v => update('password', v)}
                  secureTextEntry={!showPassword}
                  placeholderTextColor="#bdc3c7"
                />
                <TouchableOpacity style={styles.eyeButton} onPress={() => setShowPassword(!showPassword)}>
                  <Text style={{ fontSize: 20 }}>{showPassword ? '🙈' : '👁'}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Confirm Password *</Text>
              <TextInput
                style={styles.input}
                placeholder="Re-enter password"
                value={form.confirmPassword}
                onChangeText={v => update('confirmPassword', v)}
                secureTextEntry={!showPassword}
                placeholderTextColor="#bdc3c7"
              />
            </View>

            <TouchableOpacity
              style={[styles.button, loading && { opacity: 0.7 }]}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Register</Text>}
            </TouchableOpacity>

            <GoogleSignInButton
              label="Sign up with Google"
              institutionCode={form.institutionCode}
              disabled={loading}
              onSignedIn={onLogin}
              onNeedsProfile={(params) => navigation.navigate('GoogleProfile', params)}
            />

            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Text style={styles.loginLink}>Already have an account? Sign In</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.footer}>Powered by Optisware</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a5276' },
  scroll: { padding: 24, paddingTop: 40 },
  title: { fontSize: 28, fontWeight: '700', color: '#fff', textAlign: 'center' },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginBottom: 24 },
  form: {
    backgroundColor: '#fff', borderRadius: 16, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 10,
  },
  row: { flexDirection: 'row' },
  inputContainer: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: '#7f8c8d', marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 10,
    padding: 12, fontSize: 15, color: '#2c3e50',
  },
  passwordContainer: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 10,
  },
  passwordInput: { flex: 1, padding: 12, fontSize: 15, color: '#2c3e50' },
  eyeButton: { padding: 12 },
  button: {
    backgroundColor: '#1a5276', borderRadius: 10, padding: 16,
    alignItems: 'center', marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  loginLink: {
    textAlign: 'center', color: '#1a5276', fontSize: 14,
    fontWeight: '500', marginTop: 16,
  },
  footer: {
    textAlign: 'center', color: 'rgba(255,255,255,0.3)',
    fontSize: 11, marginTop: 24,
  },
});
