import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const translations = {
  en: {
    // Login
    staffId: 'Staff ID',
    password: 'Password',
    signIn: 'Sign In',
    forgotPassword: 'Forgot Password?',
    enterStaffId: 'Enter your Staff ID',
    enterPassword: 'Enter your password',
    loginFailed: 'Login Failed',
    // Home
    goodMorning: 'Good Morning',
    goodAfternoon: 'Good Afternoon',
    goodEvening: 'Good Evening',
    locationStatus: 'LOCATION STATUS',
    withinGeofence: 'Within Geofence',
    outsideGeofence: 'Outside Geofence',
    gettingLocation: 'Getting location...',
    todayStatus: "TODAY'S STATUS",
    checkedIn: 'Checked In',
    checkedOut: 'Checked Out',
    notCheckedIn: 'Not Checked In',
    checkIn: 'Check In',
    checkOut: 'Check Out',
    gpsVerification: 'GPS Verification',
    allDone: 'All Done!',
    seeYouTomorrow: 'See you tomorrow',
    thisMonth: 'THIS MONTH',
    present: 'Present',
    late: 'Late',
    absent: 'Absent',
    avgHours: 'Avg Hours',
    showMap: 'Show Geofence Map',
    hideMap: 'Hide Map',
    // Profile
    profile: 'Profile',
    changePassword: 'Change Password',
    signOut: 'Sign Out',
    darkMode: 'Dark Mode',
    lightMode: 'Light Mode',
    enableFingerprint: 'Enable Fingerprint Login',
    disableFingerprint: 'Disable Fingerprint Login',
    // History
    attendanceHistory: 'Attendance History',
    records: 'records',
    // QR
    qrCheckIn: 'QR Code Check-In',
    scanQR: 'Scan your staff ID card QR code',
    // General
    or: 'OR',
    poweredBy: 'Powered by Optisware',
    geofencedSystem: 'Geofenced Staff Attendance System',
    language: 'Language',
  },
  tw: {
    // Login
    staffId: 'Adwumayɛfo ID',
    password: 'Nhyehyɛe kɔkɔ',
    signIn: 'Bra mu',
    forgotPassword: 'Woawerɛ wo password?',
    enterStaffId: 'Hyɛ wo Adwumayɛfo ID',
    enterPassword: 'Hyɛ wo nhyehyɛe kɔkɔ',
    loginFailed: 'Abra mu no annyɛ yie',
    // Home
    goodMorning: 'Maakye',
    goodAfternoon: 'Maaha',
    goodEvening: 'Maadwo',
    locationStatus: 'BEAEƐ TEƐ',
    withinGeofence: 'Wɔ beaeɛ no mu',
    outsideGeofence: 'Wɔ beaeɛ no abɔnten',
    gettingLocation: 'Yɛrehwehwɛ beaeɛ...',
    todayStatus: 'ƐNNƐ TEƐ',
    checkedIn: 'Woabra mu',
    checkedOut: 'Woafiri mu',
    notCheckedIn: 'Wommraa mu',
    checkIn: 'Bra Mu',
    checkOut: 'Firi Mu',
    gpsVerification: 'GPS Nhwehwɛmu',
    allDone: 'Awie!',
    seeYouTomorrow: 'Yɛbɛhyia ɔkyena',
    thisMonth: 'BOSOME YI',
    present: 'Ɛbaeɛ',
    late: 'Kyɛe',
    absent: 'Ammaeɛ',
    avgHours: 'Dɔnhwerew',
    showMap: 'Kyerɛ Map',
    hideMap: 'Sie Map',
    // Profile
    profile: 'Ho Nsɛm',
    changePassword: 'Sesa Password',
    signOut: 'Firi mu',
    darkMode: 'Tumi Sum',
    lightMode: 'Hann Tumi',
    enableFingerprint: 'Ma Nsateaa Login nyɛ adwuma',
    disableFingerprint: 'Gyae Nsateaa Login',
    // History
    attendanceHistory: 'Abrabɔ Nhoma',
    records: 'nsɛm',
    // QR
    qrCheckIn: 'QR Code de Bra Mu',
    scanQR: 'Scan wo ID card QR code',
    // General
    or: 'ANAASƐ',
    poweredBy: 'Optisware na ɛyɛɛ',
    geofencedSystem: 'Geofence Abrabɔ Nhyehyɛe',
    language: 'Kasa',
  },
};

const I18nContext = createContext();

export function I18nProvider({ children }) {
  const [lang, setLang] = useState('en');

  useEffect(() => {
    AsyncStorage.getItem('language').then(v => {
      if (v) setLang(v);
    });
  }, []);

  const switchLanguage = async (newLang) => {
    setLang(newLang);
    await AsyncStorage.setItem('language', newLang);
  };

  const t = (key) => translations[lang]?.[key] || translations.en[key] || key;

  return (
    <I18nContext.Provider value={{ t, lang, switchLanguage }}>
      {children}
    </I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);
