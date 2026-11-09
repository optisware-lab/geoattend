import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
  RefreshControl, ScrollView, Platform, AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { getCurrentLocation, calculateDistance, watchLocation } from '../services/location';
import { checkIn, checkOut, getTodayStatus, getWeeklyStats, postGeofenceEvent, getAttendanceRules, RULES_KEY } from '../services/api';
import { formatDateLong, formatTime, formatDuration } from '../services/format';
import { addToQueue, syncQueue, getQueueLength, getPendingStatus, isOnline, isOnlineState } from '../services/offlineQueue';
import { saveTodayStatus, readTodayStatus } from '../services/todayStatus';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { WebView } from 'react-native-webview';
import NetInfo from '@react-native-community/netinfo';
import { useTheme } from '../services/theme';
import { useI18n } from '../services/i18n';
import { useToast } from '../services/Toast';
import { confirmPresence, saveCheckInRequirements } from '../services/presence';

/** "17:00:00" -> a Date today at 5:00 PM */
function clockToday(hhmmss, base) {
  if (!hhmmss) return null;
  const [h, m] = String(hhmmss).split(':').map(Number);
  if (Number.isNaN(h)) return null;
  const d = new Date(base);
  d.setHours(h, m || 0, 0, 0);
  return d;
}

/** Turns a failed status request into words staff can act on. */
function describeStatusError(err) {
  const status = err?.response?.status;
  const code = err?.response?.data?.code;
  if (status === 402 || code === 'SUBSCRIPTION_REQUIRED') {
    return {
      title: 'Sign-in is paused for your school',
      detail: "Your school's GeoAttend plan has ended. Please ask your admin to renew it.",
      paused: true,
    };
  }
  if (status === 401) {
    return { title: 'Please log in again', detail: 'Your login could not be confirmed.' };
  }
  if (!err?.response || status >= 500) {
    return { title: 'Server is busy', detail: 'Trying again automatically. Tap to retry now.' };
  }
  return {
    title: "Couldn't load your status",
    detail: err?.response?.data?.error ? `${err.response.data.error}. Tap to try again.` : 'Trying again automatically. Tap to retry now.',
  };
}

export default function HomeScreen() {
  const { theme } = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [institution, setInstitution] = useState(null);
  // null = not known yet. Never assume "not signed in": showing Sign In to
  // someone already signed in makes the tap fail.
  const [todayStatus, setTodayStatus] = useState(null);
  // Why today's status couldn't load: null, or { title, detail, retrying }
  const [statusError, setStatusError] = useState(null);
  const retryTimer = useRef(null);
  const retryCount = useRef(0);
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

  // Which day the shown status belongs to, so an app left open overnight
  // doesn't keep yesterday's button.
  const statusDay = useRef(null);

  const showStatus = useCallback((status, rec) => {
    statusDay.current = new Date().toDateString();
    setTodayStatus(status);
    setRecord(rec || null);
    setStatusError(null);
    saveTodayStatus(status, rec);
  }, []);

  // Today's status decides the main button. Show what this phone already
  // knows first (sign-ins waiting to sync, then the last status saved today),
  // then let the server's answer replace it.
  const refreshStatus = useCallback(async () => {
    const pending = await getPendingStatus();
    const saved = await readTodayStatus();
    const known = pending || saved?.status;
    if (known) {
      statusDay.current = new Date().toDateString();
      setTodayStatus((cur) => cur || known);
      if (saved?.record) setRecord((cur) => cur || saved.record);
    }

    if (!(await isOnline())) {
      // No internet: don't wait for the server. With nothing saved, allow a
      // sign-in, which is queued and checked by the server when it syncs.
      clearTimeout(retryTimer.current);
      setStatusError(null);
      if (!known) {
        statusDay.current = new Date().toDateString();
        setTodayStatus((cur) => cur || 'not_checked_in');
      }
      return;
    }

    try {
      const { data } = await getTodayStatus();
      saveTodayStatus(data.status, data.record);
      saveCheckInRequirements(data.requirements);
      statusDay.current = new Date().toDateString();
      setTodayStatus((await getPendingStatus()) || data.status);
      setRecord(data.record || null);
      setStatusError(null);
      retryCount.current = 0;
      clearTimeout(retryTimer.current);
    } catch (err) {
      if (known) return; // keep showing what we know
      if (!(await isOnline())) {
        // Offline with nothing saved: allow a sign-in, which is queued and
        // checked by the server when it syncs.
        setTodayStatus((cur) => cur || 'not_checked_in');
        return;
      }
      setStatusError(describeStatusError(err));
      // Try again by itself: 5 s, 15 s, 30 s, then every minute
      clearTimeout(retryTimer.current);
      const delays = [5000, 15000, 30000];
      const delay = delays[retryCount.current] || 60000;
      retryCount.current += 1;
      retryTimer.current = setTimeout(() => refreshStatusRef.current?.(), delay);
    }
  }, []);

  const refreshStatusRef = useRef(refreshStatus);
  refreshStatusRef.current = refreshStatus;
  useEffect(() => () => clearTimeout(retryTimer.current), []);

  const retryStatus = () => {
    setStatusError((cur) => (cur ? { ...cur, retrying: true } : cur));
    retryCount.current = 0;
    refreshStatus();
  };

  // Opening the app again (from the background) refreshes today's status
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (statusDay.current && statusDay.current !== new Date().toDateString()) {
        setTodayStatus(null);
        setRecord(null);
      }
      setNow(new Date());
      refreshStatus();
    });
    return () => sub.remove();
  }, [refreshStatus]);

  // Distance follows every location update
  useEffect(() => {
    if (!location || !institution) return;
    setDistance(calculateDistance(location.latitude, location.longitude, institution.latitude, institution.longitude));
  }, [location, institution]);

  // While this screen is open, follow the phone's position so the Sign In
  // button unlocks by itself the moment staff reach work. Stops when they leave
  // the screen to save battery.
  useFocusEffect(
    useCallback(() => {
      let stop = () => {};
      let cancelled = false;
      setNow(new Date());
      // Coming back to this tab (e.g. after a QR sign-in) shows the latest
      // status and sends anything saved offline
      refreshStatus();
      runSyncRef.current?.();
      watchLocation((loc) => { if (!cancelled) setLocation(loc); })
        .then((fn) => { if (cancelled) fn(); else stop = fn; })
        .catch(() => {});
      return () => { cancelled = true; stop(); };
    }, [refreshStatus])
  );

  const reportSync = useCallback((result) => {
    if (result.synced > 0) {
      toast.success(`${result.synced} offline record(s) synced successfully.`, 'Synced');
    }
    result.rejected?.forEach(({ action, error }) => {
      toast.error(error, action === 'check-out' ? 'Offline Sign-Out Not Accepted' : 'Offline Sign-In Not Accepted');
    });
  }, [toast]);

  // Sends sign-ins saved offline, then updates the screen. Safe to call often:
  // a call while one is still running does nothing.
  const syncing = useRef(false);
  const runSync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const result = await syncQueue();
      reportSync(result);
      if (result.synced > 0 || result.rejected.length > 0) refreshStatus();
    } catch {
      // Tried again on the next minute, reconnect or app open
    } finally {
      syncing.current = false;
      setPendingSync(await getQueueLength().catch(() => 0));
    }
  }, [reportSync, refreshStatus]);
  const runSyncRef = useRef(runSync);
  runSyncRef.current = runSync;

  const loadData = useCallback(async () => {
    const userData = JSON.parse(await AsyncStorage.getItem('user'));
    const instData = JSON.parse(await AsyncStorage.getItem('institution'));
    setUser(userData);
    setInstitution(instData);

    // Without internet the phone finds itself by GPS only, which can take a
    // while: never hold the rest of the screen up for it
    getCurrentLocation().then(setLocation).catch(() => {});

    // Work hours: show the saved copy at once (works offline), then refresh
    AsyncStorage.getItem(RULES_KEY)
      .then((raw) => {
        const saved = raw ? JSON.parse(raw) : null;
        if (saved && typeof saved === 'object') setRules((cur) => cur || saved);
      })
      .catch(() => {});
    getAttendanceRules().then(({ data }) => {
      if (data && typeof data === 'object') {
        setRules(data);
        AsyncStorage.setItem(RULES_KEY, JSON.stringify(data)).catch(() => {});
      }
    }).catch(() => {});

    // Sync queued offline sign-ins/outs first so today's status is up to date
    const connected = await isOnline();
    setOnline(connected);
    if (connected) await runSync();

    await refreshStatus();

    if (connected) {
      try {
        const { data } = await getWeeklyStats();
        setStats(data.month);
      } catch {}
    }

    setPendingSync(await getQueueLength().catch(() => 0));
  }, [runSync, refreshStatus]);

  useEffect(() => { loadData(); }, [loadData]);

  // Sync queued sign-ins once internet is back
  const wasOnline = useRef(null);
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = isOnlineState(state);
      setOnline(connected);
      if (state.isConnected) runSync();
      if (connected && wasOnline.current === false) refreshStatus();
      wasOnline.current = connected;
    });
    return () => unsubscribe();
  }, [runSync, refreshStatus]);

  // While the app is open, keep trying to send saved sign-ins every minute
  useEffect(() => {
    const id = setInterval(() => runSync(), 60000);
    return () => clearInterval(id);
  }, [runSync]);

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
    // The sign-in photo: proves it is the owner
    let presence;
    try {
      presence = await confirmPresence();
    } catch {
      presence = { cancelled: true, message: 'Could not confirm it is you. Please try again.' };
    }
    if (presence.cancelled) {
      toast.error(presence.message, 'Sign-In Stopped');
      setLoading(false);
      return;
    }

    const checkInData = {
      latitude: location.latitude,
      longitude: location.longitude,
      method: 'gps',
      deviceId: Device.osBuildId || Device.modelId || Device.modelName || 'unknown',
      ...presence.fields,
    };

    const queueCheckIn = async () => {
      await addToQueue('check-in', checkInData);
      setPendingSync(await getQueueLength());
      setTodayStatus('checked_in');
      toast.warning('Sign-in saved. Will sync when back online.', 'Saved Offline');
      runSync(); // goes through at once if a connection is there after all
    };

    try {
      if (!(await isOnline())) {
        await queueCheckIn();
        return;
      }

      const { data } = await checkIn(checkInData);
      showStatus('checked_in', data.record);

      const lateMsg = data.isLate ? 'You have been marked as LATE.' : 'Signed in on time!';
      toast.success(lateMsg, 'Sign-In Successful');
      Notifications.scheduleNotificationAsync({
        content: { title: 'Sign-In Confirmed', body: lateMsg, sound: true },
        trigger: null,
      });
    } catch (err) {
      // If network error, queue offline
      if (!err.response) {
        await queueCheckIn().catch(() => toast.error('Could not save the sign-in on this phone. Please try again.', 'Sign-In Failed'));
      } else {
        toast.error(err.response?.data?.error || 'Please try again', 'Sign-In Failed');
        // e.g. already signed in on another device: show the right button
        refreshStatus();
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

      showStatus('checked_out', outData?.record || record);
      toast.success('You have been signed out. See you tomorrow!', 'Sign-Out Successful');
      Notifications.scheduleNotificationAsync({
        content: { title: 'Sign-Out Confirmed', body: 'See you tomorrow!', sound: true },
        trigger: null,
      });
    } catch (err) {
      // No response = network problem: keep the sign-out and sync it later
      if (!err.response && checkOutData) {
        await queueCheckOut(checkOutData);
      } else {
        toast.error(err.response?.data?.error || 'Please try again', 'Sign-Out Failed');
        refreshStatus();
      }
    } finally {
      setLoading(false);
    }
  };

  const queueCheckOut = async (checkOutData) => {
    await addToQueue('check-out', checkOutData);
    setPendingSync(await getQueueLength());
    setTodayStatus('checked_out');
    toast.warning('Sign-out saved. Will sync when back online.', 'Saved Offline');
    runSync(); // goes through at once if a connection is there after all
  };

  // Report inside/outside to the server so it can record both leaving the
  // premises and coming back. Location updates live, so only report when the
  // state changes (plus a repeat every 10 minutes while outside), not on
  // every GPS update.
  const lastGeofenceReport = useRef({ state: null, at: 0 });
  useEffect(() => {
    const postGeofenceStatus = async () => {
      if (!institution || distance === null || location?.latitude == null) return;
      const state = distance > institution.geofenceRadius ? 'outside' : 'inside';
      const prev = lastGeofenceReport.current;
      if (state === prev.state && (state === 'inside' || Date.now() - prev.at < 10 * 60 * 1000)) return;
      lastGeofenceReport.current = { state, at: Date.now() };

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

    postGeofenceStatus();
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

  // Ask once more before ending the day, so a stray tap can't sign you out
  const confirmCheckOut = () => {
    const endAt = clockToday(rules?.work_end_time, new Date());
    const early = endAt && new Date() < endAt;
    if (Platform.OS === 'web') {
      // Alert buttons do not work in the browser build
      if (window.confirm(early ? `Work ends at ${formatTime(endAt)}. Sign out anyway?` : 'Sign out now? This ends your day.')) handleCheckOut();
      return;
    }
    Alert.alert(
      early ? 'Leaving early?' : 'Sign out now?',
      early
        ? `Work ends at ${formatTime(endAt)}. Sign out anyway?`
        : `You've been at work for ${formatDuration(workedMs)}. This ends your day.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: handleCheckOut },
      ]
    );
  };

  let checkInHint = t('gpsVerification');
  if (!location) {
    checkInHint = online
      ? 'Finding your location... (turn on GPS)'
      : 'No internet, so GPS only: can take a minute. Step outside or near a window.';
  }
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
              {!online ? '⚠ You are offline. Sign-ins are saved and sent later.' : `⏳ ${pendingSync} sign-in(s) waiting to sync`}
            </Text>
          </View>
        )}

        {/* Main action first: no scrolling to sign in or out */}
        <View style={styles.actionSection}>
          {!todayStatus && (
            <TouchableOpacity
              style={[styles.actionBtn, statusError?.paused ? styles.pausedBtn : styles.doneBtn]}
              onPress={retryStatus}
              disabled={!statusError || statusError.retrying}
              accessibilityRole="button"
              accessibilityLabel={statusError ? `${statusError.title}. ${statusError.detail}` : 'Checking your status'}
            >
              {statusError?.retrying ? (
                <>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.actionBtnSub}>Trying again...</Text>
                </>
              ) : statusError ? (
                <>
                  <Text style={styles.actionBtnText}>{statusError.title}</Text>
                  <Text style={styles.actionBtnSub}>{statusError.detail}</Text>
                </>
              ) : (
                <>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.actionBtnSub}>Checking your status...</Text>
                </>
              )}
            </TouchableOpacity>
          )}

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
               todayStatus === 'checked_out' ? t('checkedOut') :
               todayStatus === 'not_checked_in' ? t('notCheckedIn') :
               statusError ? (statusError.paused ? 'Paused (plan ended)' : 'Waiting for server...') : 'Checking...'}
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
  pausedBtn: { backgroundColor: '#b9770e' },
  disabledBtn: { opacity: 0.5 },
  actionBtnText: { fontSize: 20, fontWeight: '700', color: '#fff' },
  actionBtnSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 4, textAlign: 'center', paddingHorizontal: 12 },
});
