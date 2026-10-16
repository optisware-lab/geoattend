import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, SafeAreaView, ScrollView,
} from 'react-native';
import { completeGoogleSignup } from '../services/api';
import { useToast } from '../services/Toast';
import { getDeviceInfo, saveSession } from '../services/googleAuth';

// Shown after Google sign-in when we still need the user's phone number
// (and, for new accounts, their institution) before letting them in.
export default function GoogleProfileScreen({ navigation, route, onLogin }) {
  const toast = useToast();
  const { idToken, profile = {}, existingAccount = false } = route.params || {};

  const [form, setForm] = useState({
    institutionCode: profile.institutionCode || '',
    firstName: profile.firstName || '',
    lastName: profile.lastName || '',
    phone: '',
    staffId: '',
    department: '',
    position: '',
  });
  const [loading, setLoading] = useState(false);

  const update = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    const { institutionCode, firstName, lastName, phone } = form;
    if (!existingAccount && !institutionCode.trim()) {
      toast.error('Please enter your institution code');
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      toast.error('Please enter your first and last name');
      return;
    }
    if (!/^\+?[0-9][0-9\s-]{6,18}[0-9]$/.test(phone.trim())) {
      toast.error('Please enter a valid phone number');
      return;
    }

    setLoading(true);
    try {
      const { data } = await completeGoogleSignup({
        idToken,
        institutionCode: existingAccount ? undefined : institutionCode.trim().toUpperCase(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        staffId: form.staffId.trim().toUpperCase() || undefined,
        department: form.department.trim() || undefined,
        position: form.position.trim() || undefined,
        ...getDeviceInfo(),
      });
      await saveSession(data);
      onLogin && onLogin();
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.error || err.message || 'Please try again';
      // Google ID tokens expire after an hour — send the user back to sign in again
      if (status === 401) {
        toast.error('Your Google session expired. Please sign in with Google again.');
        navigation.goBack();
        return;
      }
      toast.error(msg, 'Sign Up Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{existingAccount ? 'One more step' : 'Complete Sign Up'}</Text>
          <Text style={styles.subtitle}>
            {existingAccount
              ? 'Add your phone number to finish signing in with Google'
              : 'A few details so your institution can identify you'}
          </Text>

          <View style={styles.form}>
            {!!profile.email && (
              <View style={styles.googleAccount}>
                <Text style={styles.googleLabel}>Google account</Text>
                <Text style={styles.googleEmail}>{profile.email}</Text>
                {!!profile.institutionName && <Text style={styles.googleInst}>{profile.institutionName}</Text>}
              </View>
            )}

            {!existingAccount && (
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
            )}

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
              <Text style={styles.label}>Phone Number *</Text>
              <TextInput
                style={styles.input}
                placeholder="0XX XXX XXXX"
                value={form.phone}
                onChangeText={v => update('phone', v)}
                keyboardType="phone-pad"
                placeholderTextColor="#bdc3c7"
              />
            </View>

            {!existingAccount && (
              <>
                <View style={styles.inputContainer}>
                  <Text style={styles.label}>Staff ID</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Leave blank to get one assigned"
                    value={form.staffId}
                    onChangeText={v => update('staffId', v)}
                    autoCapitalize="characters"
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
              </>
            )}

            <TouchableOpacity
              style={[styles.button, loading && { opacity: 0.7 }]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Continue</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Text style={styles.backLink}>Back</Text>
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
  googleAccount: { backgroundColor: '#f4f8fb', borderRadius: 10, padding: 12, marginBottom: 16 },
  googleLabel: { fontSize: 11, fontWeight: '600', color: '#7f8c8d', textTransform: 'uppercase', marginBottom: 2 },
  googleEmail: { fontSize: 15, fontWeight: '600', color: '#2c3e50' },
  googleInst: { fontSize: 13, color: '#7f8c8d', marginTop: 2 },
  row: { flexDirection: 'row' },
  inputContainer: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: '#7f8c8d', marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 10,
    padding: 12, fontSize: 15, color: '#2c3e50',
  },
  button: {
    backgroundColor: '#1a5276', borderRadius: 10, padding: 16,
    alignItems: 'center', marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  backLink: { textAlign: 'center', color: '#1a5276', fontSize: 14, fontWeight: '500', marginTop: 16 },
  footer: { textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 24 },
});
