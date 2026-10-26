import React, { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ToastProvider } from './src/services/Toast';

import LoginScreen from './src/screens/LoginScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import ForgotStaffIdScreen from './src/screens/ForgotStaffIdScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import GoogleProfileScreen from './src/screens/GoogleProfileScreen';
import { registerForPushNotifications, scheduleCheckInReminder } from './src/services/notifications';
import { ThemeProvider } from './src/services/theme';
import { I18nProvider } from './src/services/i18n';
import { isBiometricAvailable, authenticateWithBiometric, isBiometricEnabled } from './src/services/biometric';
import HomeScreen from './src/screens/HomeScreen';
import QRScanScreen from './src/screens/QRScanScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import LeaveRequestScreen from './src/screens/LeaveRequestScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs({ onLogout }) {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 10);
  const { theme } = require('./src/services/theme').useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: {
          paddingBottom: bottomPadding,
          paddingTop: 8,
          height: 60 + bottomPadding,
          borderTopWidth: 1,
          borderTopColor: theme.border,
          backgroundColor: theme.tabBar,
          elevation: 10,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{
        tabBarLabel: 'Staff Check-In',
        tabBarIcon: ({ color, size }) => <Ionicons name="location" size={size} color={color} />,
      }} />
      <Tab.Screen name="QRScan" component={QRScanScreen} options={{
        tabBarLabel: 'QR Scan',
        tabBarIcon: ({ color, size }) => <Ionicons name="qr-code" size={size} color={color} />,
      }} />
      <Tab.Screen name="History" component={HistoryScreen} options={{
        tabBarLabel: 'History',
        tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
      }} />
      <Tab.Screen name="Profile" options={{
        tabBarLabel: 'Profile',
        tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
      }}>
        {(props) => <ProfileScreen {...props} onLogout={onLogout} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

// Without this, a published update only takes effect on the launch after the
// one that downloaded it. If it downloads quickly, restart into it right away;
// otherwise leave it for the next launch so a slow connection never interrupts.
const UPDATE_RELOAD_WINDOW_MS = 10000;
async function applyUpdateOnLaunch() {
  if (__DEV__ || !Updates.isEnabled) return;
  const startedAt = Date.now();
  try {
    const { isAvailable } = await Updates.checkForUpdateAsync();
    if (!isAvailable) return;
    await Updates.fetchUpdateAsync();
    if (Date.now() - startedAt < UPDATE_RELOAD_WINDOW_MS) await Updates.reloadAsync();
  } catch {
    // Offline or update server unreachable: keep running the current version
  }
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { applyUpdateOnLaunch(); }, []);

  useEffect(() => {
    AsyncStorage.getItem('token').then(async (token) => {
      // Staff-only app: drop the account-type preference left by older builds
      AsyncStorage.removeItem('memberType').catch(() => {});

      if (token) {
        // Check biometric — but always keep user logged in
        try {
          const bioEnabled = await isBiometricEnabled();
          const bioAvailable = await isBiometricAvailable();
          if (bioEnabled && bioAvailable) {
            const success = await authenticateWithBiometric();
            if (!success) {
              // Biometric failed — still logged in but show login screen for security
              // Don't clear token — they can retry or use password
              setLoading(false);
              return;
            }
          }
        } catch {}

        setIsLoggedIn(true);
        // These may fail in Expo Go (SDK 53+) but are non-blocking
        registerForPushNotifications().catch(() => {});
        scheduleCheckInReminder().catch(() => {});
      }
      setLoading(false);
    });
  }, []);

  if (loading) return null;

  return (
    <I18nProvider>
    <ThemeProvider>
    <SafeAreaProvider>
      <ToastProvider>
      <StatusBar style="light" />
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {isLoggedIn ? (
            <Stack.Screen name="Main">
              {() => <MainTabs onLogout={() => setIsLoggedIn(false)} />}
            </Stack.Screen>
          ) : (
            <>
              <Stack.Screen name="Login">
                {(props) => (
                  <LoginScreen
                    {...props}
                    onLogin={() => setIsLoggedIn(true)}
                    onForgotPassword={() => props.navigation.navigate('ForgotPassword')}
                    onForgotStaffId={() => props.navigation.navigate('ForgotStaffId')}
                    onRegister={() => props.navigation.navigate('Register')}
                    onGoogleProfile={(params) => props.navigation.navigate('GoogleProfile', params)}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
              <Stack.Screen name="ForgotStaffId" component={ForgotStaffIdScreen} />
              <Stack.Screen name="Register">
                {(props) => <RegisterScreen {...props} onLogin={() => setIsLoggedIn(true)} />}
              </Stack.Screen>
              <Stack.Screen name="GoogleProfile">
                {(props) => <GoogleProfileScreen {...props} onLogin={() => setIsLoggedIn(true)} />}
              </Stack.Screen>
            </>
          )}
          {isLoggedIn && <Stack.Screen name="LeaveRequest" component={LeaveRequestScreen} />}
        </Stack.Navigator>
      </NavigationContainer>
      </ToastProvider>
    </SafeAreaProvider>
    </ThemeProvider>
    </I18nProvider>
  );
}
