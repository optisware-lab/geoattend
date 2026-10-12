import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const isBiometricAvailable = async () => {
  const compatible = await LocalAuthentication.hasHardwareAsync();
  if (!compatible) return false;
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return enrolled;
};

export const authenticateWithBiometric = async () => {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Login to GeoAttend',
    cancelLabel: 'Use Password',
    disableDeviceFallback: true,
  });
  return result.success;
};

export const setBiometricEnabled = async (enabled) => {
  await AsyncStorage.setItem('biometricEnabled', String(enabled));
};

export const isBiometricEnabled = async () => {
  const val = await AsyncStorage.getItem('biometricEnabled');
  return val === 'true';
};
