import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator, SafeAreaView, Clipboard,
} from 'react-native';
import { findStaffByEmail } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function ForgotStaffIdScreen({ navigation }) {
  const [institutionCode, setInstitutionCode] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  React.useEffect(() => {
    AsyncStorage.getItem('institutionCode').then((code) => {
      if (code) setInstitutionCode(String(code).toUpperCase());
    }).catch(() => {});
  }, []);

  const handleFind = async () => {
    if (!institutionCode.trim() || !email.trim()) {
      Alert.alert('Error', 'Please enter your institution code and email');
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const { data } = await findStaffByEmail(
        institutionCode.trim().toUpperCase(),
        email.trim().toLowerCase()
      );
      setResult(data);
    } catch (err) {
      Alert.alert('Not Found', err.response?.data?.error || 'Please try again');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    Clipboard.setString(result.staffId);
    Alert.alert('Copied', 'Your ID has been copied to clipboard');
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.inner}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backBtn}>← Back to Login</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Forgot Your Staff ID?</Text>
          <Text style={styles.subtitle}>
            Enter your institution code and registered email to retrieve your Staff ID
          </Text>
        </View>

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

          {result && (
            <View style={styles.resultBox}>
              <Text style={styles.resultLabel}>Your Staff ID</Text>
              <Text style={styles.resultId}>{result.staffId}</Text>
              <Text style={styles.resultName}>
                {result.firstName} {result.lastName}
              </Text>
              <TouchableOpacity style={styles.copyButton} onPress={copyToClipboard}>
                <Text style={styles.copyButtonText}>Copy ID</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleFind}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Find My ID</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a5276' },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  header: { marginBottom: 24 },
  backBtn: { color: 'rgba(255,255,255,0.7)', fontSize: 14, marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '700', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  form: {
    backgroundColor: '#fff', borderRadius: 16, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 10,
  },
  inputContainer: { marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '600', color: '#7f8c8d', marginBottom: 5 },
  input: {
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 10,
    padding: 12, fontSize: 14, color: '#2c3e50',
  },
  resultBox: {
    backgroundColor: '#eaf2f8', borderRadius: 10, padding: 16, marginBottom: 16,
  },
  resultLabel: { fontSize: 12, fontWeight: '600', color: '#7f8c8d', marginBottom: 4 },
  resultId: { fontSize: 22, fontWeight: '700', color: '#1a5276', marginBottom: 2 },
  resultName: { fontSize: 13, color: '#7f8c8d', marginBottom: 10 },
  copyButton: {
    backgroundColor: '#1a5276', borderRadius: 8, padding: 10, alignItems: 'center',
  },
  copyButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  button: {
    backgroundColor: '#1a5276', borderRadius: 10, padding: 16,
    alignItems: 'center', marginTop: 8,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});