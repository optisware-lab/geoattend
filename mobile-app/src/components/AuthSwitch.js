import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

/**
 * "Sign In | Sign Up" switch shown under the logo, so new staff see Sign Up
 * as soon as the app opens instead of a small link under the form.
 */
export default function AuthSwitch({ active, onSignIn, onSignUp }) {
  const option = (key, label, onPress) => {
    const selected = active === key;
    return (
      <TouchableOpacity
        style={[styles.option, selected && styles.optionActive]}
        onPress={selected ? undefined : onPress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ selected }}
      >
        <Text style={[styles.label, selected && styles.labelActive]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {option('signin', 'Sign In', onSignIn)}
      {option('signup', 'Sign Up', onSignUp)}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 14, padding: 4, marginBottom: 16,
  },
  option: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  optionActive: {
    backgroundColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6, elevation: 3,
  },
  label: { fontSize: 16, fontWeight: '700', color: '#fff' },
  labelActive: { color: '#1a5276' },
});
