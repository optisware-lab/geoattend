import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
  RefreshControl, ScrollView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { getCurrentLocation, calculateDistance, watchLocation } from '../services/location';
import { checkIn, checkOut, getTodayStatus, getWeeklyStats, postGeofenceEvent, getAttendanceRules } from '../services/api';
import { formatDateLong, formatTime, formatDuration } from '../services/format';
import { addToQueue, syncQueue, getQueueLength, getPendingStatus, isOnline } from '../services/offlineQueue';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { WebView } from 'react-native-webview';
import NetInfo from '@react-native-community/netinfo';
import { useTheme } from '../services/theme';
import { useI18n } from '../services/i18n';
import { useToast } from '../services/Toast';

/** "17:00:00" -> a Date today at 5:00 PM */
function clockToday(hhmmss, base) {
  if (!hhmmss) return null;
  const [h, m] = String(hhmmss).split(':').map(Number);
  if (Number.isNaN(h)) return null;
  const d = new Date(base);
  d.setHours(h, m || 0, 0, 0);
  return d;
}

export default function HomeScreen() {
  const { theme } = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [institution, setInstitution] = useState(null);
  const [todayStatus, setTodayStatus] = useState('not_checked_in');
  const [record, setRecord] = useState(null);
  const [location, setLocation] = useState(null);
  const [distance, setDistance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState(null);
  const [pendingSync, setPendingSync] = useState(0);
  const [online, setOnline] = useState(true);
  const [showMap, setShowMap] = useState(false);
  const [rules, setRules] = useState(null);
  const [now, setNow] = useState(() => new Date());

  // Keeps the greeting and the "at work for" clock current
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  // Distance follows every location update
  useEffect(() => {
    if (!location || !institution) return;
    setDistance(calculateDistance(location.latitude, location.longitude, institution.latitude, institution.longitude));
  }, [location, institution]);

  // While this screen is open, follow the phone's position so the Check In
  // button unlocks by itself the moment staff reach work. Stops when they leave
  // the screen to save battery.
  useFocusEffect(
    useCallback(() => {
      let stop = () => {};
      let cancelled = false;
      setNow(new Date());
      // Coming back to this tab (e.g. after a QR check-in) shows the latest status
      getTodayStatus()
        .then(async ({ data }) => {
          if (cancelled) return;
          const pending = await getPendingStatus();
          setTodayStatus(pending || data.status);
          setRecord(data.record);
        })
        .catch(() => {});
      watchLocation((loc) => { if (!cancelled) setLocation(loc); })
        .then((fn) => { if (cancelled) fn(); else stop = fn; })
        .catch(() => {});
      return () => { cancelled = true; stop(); };
    }, [])
  );

  const reportSync = useCallback((result) => {
    if (result.synced > 0) {
      toast.success(`${result.synced} offline record(s) synced successfully.`, 'Synced');
    }
    result.rejected?.forEach(({ action, error }) => {
      toast.error(error, action === 'check-out' ? 'Offline Check-Out Not Accepted' : 'Offline Check-In Not Accepted');
    });
  }, [toast]);

  const loadData = useCallback(async () => {
    const userData = JSON.parse(await AsyncStorage.getItem('user'));
    const instData = JSON.parse(await AsyncStorage.getItem('institution'));
    setUser(userData);
    setInstitution(instData);

    try {
      const loc = await getCurrentLocation();
      setLocation(loc);
      if (instData) {
        const dist = calculateDistance(loc.latitude, loc.longitude, instData.latitude, instData.longitude);
        setDistance(dist);
      }
    } catch {
      // Location might not be available
    }

    getAttendanceRules().then(({ data }) => { if (data && typeof data === 'object') setRules(data); }).catch(() => {});

    // Sync queued offline check-ins/outs first so today's status is up to date
    const connected = await isOnline();
    setOnline(connected);
    if (connected) {
      reportSync(await syncQueue());
    }

    try {
      const { data } = await getTodayStatus();
      setTodayStatus(data.status);
      setRecord(data.record);
    } catch {}

    // Anything still queued (offline) decides which button to show
    const pending = await getPendingStatus();
    if (pending) setTodayStatus(pending);

    try {
      const { data } = await getWeeklyStats();
      setStats(data.month);
    } catch {}

    const qLen = await getQueueLength();
    setPendingSync(qLen);
  }, [reportSync]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-sync queued check-ins once internet is back
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(async (state) => {
      const connected = !!state.isConnected;
      setOnline(connected);
      if (connected) {
        const result = await syncQueue();
        reportSync(result);
        if (result.synced > 0 || result.rejected.length > 0) await loadData();
      }
      const qLen = await getQueueLength();
      setPendingSync(qLen);
    });
    return () => unsubscribe();
  }, [loadData, reportSync]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleCheckIn = async () => {
    if (!location) {
      toast.error('Unable to get your location. Please enable GPS.', 'Location Required');
      return;
    }

    if (institution && distance > institution.geofenceRadius) {
      toast.warning(`You are ${distance}m away. Must be within ${institution.geofenceRadius}m.`, 'Outside Geofence');
      return;
    }

    setLoading(true);
    const checkInData = {
      latitude: location.latitude,
      longitude: location.longitude,
      method: 'gps',
      deviceId: Device.osBuildId || Device.modelId || Device.modelName || 'unknown',
    };

    try {
      const connected = await isOnline();
      if (!connected) {
        await addToQueue('check-in', checkInData);
        setPendingSync(await getQueueLength());
        setTodayStatus('checked_in');
        toast.warning('Check-in saved. Will sync when back online.', 'Saved Offline');
        setLoading(false);
        return;
      }

      const { data } = await checkIn(checkInData);
      setTodayStatus('checked_in');
      setRecord(data.record);

      const lateMsg = data.isLate ? 'You have been marked as LATE.' : 'Checked in on time!';
      toast.success(lateMsg, 'Check-In Successful');
      Notifications.scheduleNotificationAsync({
        content: { title: 'Check-In Confirmed', body: lateMsg, sound: true },
        trigger: null,
      });
    } catch (err) {
      // If network error, queue offline
      if (!err.response) {
        await addToQueue('check-in', checkInData);
        setPendingSync(await getQueueLength());
        setTodayStatus('checked_in');
        toast.warning('Check-in saved. Will sync when back online.', 'Saved Offline');
      } else {
        toast.error(err.response?.data?.error || 'Please try again', 'Check-In Failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCheckOut = async () => {
    setLoading(true);
    let checkOutData = null;
    try {
      let loc = location;
      try { loc = await getCurrentLocation(); } catch {}
      if (loc?.latitude == null || loc?.longitude == null) {
        toast.error('Unable to get your location. Please enable GPS.', 'Location Required');
        return;
      }

      checkOutData = {
        latitude: loc.latitude,
        longitude: loc.longitude,
        method: 'gps',
        deviceId: Device.osBuildId || Device.modelId || Device.modelName || 'unknown',
      };

      if (!(await isOnline())) {
        await queueCheckOut(checkOutData);
        return;
      }

      const { data: outData } = await checkOut(checkOutData);

      setTodayStatus('checked_out');
      if (outData?.record) setRecord(outData.record);
      toast.success('You have been checked out. See you tomorrow!', 'Check-Out Successful');
      Notifications.scheduleNotificationAsync({
        content: { title: 'Check-Out Confirmed', body: 'See you tomorrow!', sound: true },
        trigger: null,
      });
    } catch (err) {
      // No response = network problem: keep the check-out and sync it later
      if (!err.response && checkOutData) {
        await queueCheckOut(checkOutData);
      } else {
        toast.error(err.response?.data?.error || 'Please try again', 'Check-Out Failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const queueCheckOut = async (checkOutData) => {
    await addToQueue('check-out', checkOutData);
    setPendingSync(await getQueueLength());
    setTodayStatus('checked_out');
    toast.warning('Check-out saved. Will sync when back online.', 'Saved Offline');
  };

  // When we detect user is outside geofence while app is open, record a geofence event.
  // Location now updates live, so only report the moment they step outside
  // (and then at most every 10 minutes), not on every GPS update.
  const lastExitReport = useRef({ outside: false, at: 0 });
  useEffect(() => {
    const postExitIfNeeded = async () => {
      if (!institution || distance === null) return;
      const outside = distance > institution.geofenceRadius;
      const prev = lastExitReport.current;
      if (!outside) { prev.outside = false; return; }
      if (prev.outside && Date.now() - prev.at < 10 * 60 * 1000) return;
      lastExitReport.current = { outside: true, at: Date.now() };

      const payload = {
        latitude: location?.latitude,
        longitude: location?.longitude,
        source: 'foreground_status',
      };

      try {
        const connected = await isOnline();
        if (!connected) {
          await addToQueue('geofence-event', payload);
          setPendingSync(await getQueueLength());
          return;
        }
        await postGeofenceEvent(payload);
      } catch {
        // Best-effort; ignore failures here
      }
    };

    postExitIfNeeded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distance, institution?.geofenceRadius]);

  const radius = institution?.geofenceRadius;
  const isWithin = institution && distance !== null && distance <= radius;
  const greeting = now.getHours() < 12 ? t('goodMorning') : now.getHours() < 17 ? t('goodAfternoon') : t('goodEvening');
  const workStart = clockToday(rules?.work_start_time, now);
  const workEnd = clockToday(rules?.work_end_time, now);
  const checkedInAt = record?.check_in_time ? new Date(record.check_in_time) : null;
  const checkedOutAt = record?.check_out_time ? new Date(record.check_out_time) : null;
  const workedMs = checkedInAt ? (checkedOutAt || now) - checkedInAt : 0;

  // Ask once more before ending the day, so a stray tap can't check you out
  const confirmCheckOut = () => {
    const endAt = clockToday(rules?.work_end_time, new Date());
    const early = endAt && new Date() < endAt;
    if (Platform.OS === 'web') {
      // Alert buttons do not work in the browser build
      if (window.confirm(early ? `Work ends at ${formatTime(endAt)}. Check out anyway?` : 'Check out now? This ends your day.')) handleCheckOut();
      return;
    }
    Alert.alert(
      early ? 'Leaving early?' : 'Check out now?',
      early
        ? `Work ends at ${formatTime(endAt)}. Check out anyway?`
        : `You've been at work for ${formatDuration(workedMs)}. This ends your day.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Check Out', style: 'destructive', onPress: handleCheckOut },
      ]
    );
  };

  let checkInHint = t('gpsVerification');
  if (!location) checkInHint = 'Finding your location... (turn on GPS)';
  else if (institution && distance !== null && !isWithin) checkInHint = `${distance - radius}m too far. Unlocks when you arrive.`;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
      >
        <View style={styles.header}>
          <Text style={[styles.greeting, { color: theme.textSecondary }]}>{greeting},</Text>
          <Text style={[styles.name, { color: theme.text }]}>{user?.firstName || 'Staff'}</Text>
          <Text style={[styles.date, { color: theme.textMuted }]}>{formatDateLong(now)}</Text>
        </View>

        {/* Offline / Pending Sync Banner */}
        {(!online || pendingSync > 0) && (
          <View style={[styles.card, { borderLeftColor: '#f39c12', backgroundColor: theme.dark ? '#3a3420' : '#fef9e7' }]}>
            <Text style={[styles.cardValue, { color: '#f39c12', fontSize: 14 }]}>
              {!online ? '⚠ You are offline. Check-ins are saved and sent later.' : `⏳ ${pendingSync} check-in(s) waiting to sync`}
            </Text>
          </View>
        )}

        {/* Main action first: no scrolling to check in or out */}
        <View style={styles.actionSection}>
          {todayStatus === 'not_checked_in' && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.checkInBtn, (!isWithin || loading) && styles.disabledBtn]}
              onPress={handleCheckIn}
              disabled={!isWithin || loading}
              accessibilityRole="button"
              accessibilityLabel={`${t('checkIn')}. ${checkInHint}`}
            >
              {loading ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Text style={styles.actionBtnText}>{t('checkIn')}</Text>
                  <Text style={styles.actionBtnSub}>{checkInHint}</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {todayStatus === 'checked_in' && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.checkOutBtn, loading && styles.disabledBtn]}
              onPress={confirmCheckOut}
              disabled={loading}
              accessibilityRole="button"
            >
              {loading ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Text style={styles.actionBtnText}>{t('checkOut')}</Text>
                  <Text style={styles.actionBtnSub}>
                    {checkedInAt ? `At work for ${formatDuration(workedMs)}` : (t('endShift') || 'End your shift')}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {todayStatus === 'checked_out' && (
            <View style={[styles.actionBtn, styles.doneBtn]}>
              <Text style={styles.actionBtnText}>{t('allDone')}</Text>
              <Text style={styles.actionBtnSub}>
                {checkedInAt && checkedOutAt ? `You worked ${formatDuration(workedMs)}. ` : ''}{t('seeYouTomorrow')}
              </Text>
            </View>
          )}
        </View>

        {/* Geofence Status (updates live while this screen is open) */}
        <View style={[styles.card, { borderLeftColor: distance === null ? theme.textMuted : isWithin ? '#27ae60' : '#e74c3c', backgroundColor: theme.card }]}>
          <View style={styles.rowBetween}>
            <Text style={[styles.cardLabel, { color: theme.textMuted }]}>{t('locationStatus')}</Text>
            {distance !== null && (
              <View style={styles.liveRow}>
                <View style={styles.liveDot} />
                <Text style={[styles.liveText, { color: theme.textMuted }]}>Live</Text>
              </View>
            )}
          </View>
          {distance !== null ? (
            <>
              <Text style={[styles.cardValue, { color: isWithin ? '#27ae60' : '#e74c3c' }]}>
                {isWithin ? t('withinGeofence') : t('outsideGeofence')}
              </Text>
              <Text style={[styles.cardDetail, { color: theme.textSecondary }]}>
                {distance}m from {institution?.name || 'institution'} (allowed: {radius}m)
                {location?.accuracy ? ` · GPS ±${Math.round(location.accuracy)}m` : ''}
              </Text>
            </>
          ) : (
            <Text style={[styles.cardDetail, { color: theme.textSecondary }]}>{t('gettingLocation')}</Text>
          )}
        </View>

        {/* Today's Status */}
        <View style={[styles.card, { borderLeftColor: '#3498db', backgroundColor: theme.card }]}>
          <Text style={[styles.cardLabel, { color: theme.textMuted }]}>{t('todayStatus')}</Text>
          <View style={styles.rowStart}>
            <Text style={[styles.cardValue, { color: theme.text }]}>
              {todayStatus === 'checked_in' ? t('checkedIn') :
               todayStatus === 'checked_out' ? t('checkedOut') : t('notCheckedIn')}
            </Text>
            {checkedInAt && (
              <View style={[styles.pill, { backgroundColor: record?.is_late ? '#fef5e7' : '#e8f6ee' }]}>
                <Text style={[styles.pillText, { color: record?.is_late ? '#b9770e' : '#1e8449' }]}>
                  {record?.is_late ? 'LATE' : 'ON TIME'}
                </Text>
              </View>
            )}
          </View>
          {checkedInAt && (
            <Text style={[styles.cardDetail, { color: theme.textSecondary }]}>
              In {formatTime(checkedInAt)}{checkedOutAt ? ` · Out ${formatTime(checkedOutAt)}` : ''} · {formatDuration(workedMs)}
            </Text>
          )}
          {workStart && workEnd && (
            <Text style={[styles.cardDetail, { color: theme.textMuted }]}>
              Work hours {formatTime(workStart)} – {formatTime(workEnd)}
            </Text>
          )}
        </View>

        {/* Institution Info */}
        {institution?.name && (
          <View style={[styles.card, { borderLeftColor: theme.primary, backgroundColor: theme.card }]}>
            <Text style={[styles.cardLabel, { color: theme.textMuted }]}>INSTITUTION</Text>
            <Text style={[styles.cardValue, { color: theme.text }]}>{institution.name}</Text>
            {(institution.address || institution.city) && (
              <Text style={[styles.cardDetail, { color: theme.textSecondary }]}>
                {[institution.address, institution.city, institution.region].filter(Boolean).join(', ')}
              </Text>
            )}
          </View>
        )}

        {/* Map Toggle */}
        {institution && location && (
          <>
            <TouchableOpacity
              style={[styles.card, { borderLeftColor: '#8e44ad', alignItems: 'center', paddingVertical: 12, backgroundColor: theme.card }]}
              onPress={() => setShowMap(!showMap)}
            >
              <Text style={{ color: '#8e44ad', fontWeight: '600', fontSize: 14 }}>
                {showMap ? `🗺 ${t('hideMap')}` : `🗺 ${t('showMap')}`}
              </Text>
            </TouchableOpacity>

            {showMap && (
              <View style={{ height: 280, borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
                <WebView
                  style={{ flex: 1 }}
                  originWhitelist={['*']}
                  source={{ html: `
                    <!DOCTYPE html>
                    <html><head>
                    <meta name="viewport" content="width=device-width,initial-scale=1">
                    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
                    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                    <style>body{margin:0}#map{width:100%;height:100vh}</style>
                    </head><body>
                    <div id="map"></div>
                    <script>
                      var map=L.map('map').setView([${institution.latitude},${institution.longitude}],16);
                      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
                      L.circle([${institution.latitude},${institution.longitude}],{
                        radius:${institution.geofenceRadius},color:'#1a5276',fillColor:'#1a5276',fillOpacity:0.15
                      }).addTo(map).bindPopup('${(institution.name || 'Institution').replace(/'/g, "\\'")} - ${institution.geofenceRadius}m radius');
                      L.marker([${institution.latitude},${institution.longitude}]).addTo(map)
                        .bindPopup('<b>${(institution.name || 'Institution').replace(/'/g, "\\'")}</b>').openPopup();
                      ${location ? `L.marker([${location.latitude},${location.longitude}],{
                        icon:L.divIcon({html:'<div style="background:${isWithin ? '#27ae60' : '#e74c3c'};width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,0,0.3)"></div>',iconSize:[20,20],iconAnchor:[10,10]})
                      }).addTo(map).bindPopup('Your Location');` : ''}
                    </script>
                    </body></html>
                  ` }}
                />
              </View>
            )}
          </>
        )}

        {/* Monthly Summary */}
        {stats && (
          <View style={[styles.statsContainer, { backgroundColor: theme.card }]}>
            <Text style={[styles.statsTitle, { color: theme.textMuted }]}>{t('thisMonth')}</Text>
            <View style={styles.statsGrid}>
              <View style={[styles.statBox, { backgroundColor: theme.dark ? '#1a3a2a' : '#eafaf1' }]}>
                <Text style={[styles.statNumber, { color: '#27ae60' }]}>{stats.present}</Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{t('present')}</Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: theme.dark ? '#3a3420' : '#fef9e7' }]}>
                <Text style={[styles.statNumber, { color: '#f39c12' }]}>{stats.late}</Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{t('late')}</Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: theme.dark ? '#3a2020' : '#fdedec' }]}>
                <Text style={[styles.statNumber, { color: '#e74c3c' }]}>{stats.absent}</Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{t('absent')}</Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: theme.dark ? '#1a2a3a' : '#ebf5fb' }]}>
                <Text style={[styles.statNumber, { color: '#3498db' }]}>{stats.avgHours || '0'}h</Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{t('avgHours')}</Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  scroll: { padding: 20 },
  header: { marginBottom: 24, paddingTop: 20 },
  greeting: { fontSize: 16, color: '#7f8c8d' },
  name: { fontSize: 28, fontWeight: '700', color: '#2c3e50', marginTop: 2 },
  date: { fontSize: 13, color: '#95a5a6', marginTop: 4 },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 18, marginBottom: 12,
    borderLeftWidth: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 3,
  },
  cardLabel: { fontSize: 11, fontWeight: '700', color: '#95a5a6', letterSpacing: 0.5, marginBottom: 6 },
  cardValue: { fontSize: 18, fontWeight: '700', color: '#2c3e50' },
  cardDetail: { fontSize: 13, color: '#7f8c8d', marginTop: 4 },
  statsContainer: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 3,
  },
  statsTitle: { fontSize: 11, fontWeight: '700', color: '#95a5a6', letterSpacing: 0.5, marginBottom: 12 },
  statsGrid: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  statBox: {
    flex: 1, borderRadius: 10, padding: 12, alignItems: 'center',
  },
  statNumber: { fontSize: 22, fontWeight: '700' },
  statLabel: { fontSize: 10, fontWeight: '600', color: '#7f8c8d', marginTop: 2 },
  actionSection: { marginBottom: 16, alignItems: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowStart: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#27ae60' },
  liveText: { fontSize: 11, fontWeight: '600' },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: '700' },
  actionBtn: {
    width: '100%', paddingVertical: 20, borderRadius: 16, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 6,
  },
  checkInBtn: { backgroundColor: '#27ae60' },
  checkOutBtn: { backgroundColor: '#e74c3c' },
  doneBtn: { backgroundColor: '#95a5a6' },
  disabledBtn: { opacity: 0.5 },
  actionBtnText: { fontSize: 20, fontWeight: '700', color: '#fff' },
  actionBtnSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 4, textAlign: 'center', paddingHorizontal: 12 },
});
