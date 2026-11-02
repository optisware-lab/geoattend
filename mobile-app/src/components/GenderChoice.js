import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

/** Male / Female as two big buttons (one tap, no dropdown). */
export default function GenderChoice({ value, onChange }) {
  const option = (key, label) => {
    const selected = value === key;
    return (
      <TouchableOpacity
        style={[styles.option, selected && styles.optionSelected]}
        onPress={() => onChange(key)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ selected }}
      >
        <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.row}>
      {option('male', 'Male')}
      {option('female', 'Female')}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  option: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    borderWidth: 1.5, borderColor: '#e0e0e0', backgroundColor: '#fff',
  },
  optionSelected: { backgroundColor: '#1a5276', borderColor: '#1a5276' },
  label: { fontSize: 15, fontWeight: '700', color: '#2c3e50' },
  labelSelected: { color: '#fff' },
});
