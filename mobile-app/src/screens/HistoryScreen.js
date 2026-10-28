import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMyAttendance } from '../services/api';
import { useTheme } from '../services/theme';
import { formatDate, formatTime, formatDuration, relativeDay, toDate } from '../services/format';

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function HistoryScreen() {
  const { theme } = useTheme();
  const [records, setRecords] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchRecords = async (pageNum = 1, append = false) => {
    try {
      const { data } = await getMyAttendance({ page: pageNum, limit: 20 });
      setRecords(prev => append ? [...prev, ...(data.records || [])] : (data.records || []));
      setTotal(data.total || 0);
      setPage(pageNum);
      setError('');
    } catch (err) {
      setError(err?.response ? 'Could not load your history.' : 'No internet connection. Pull down to try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchRecords(); }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchRecords(1, false);
  };

  const onEndReached = () => {
    if (!loading && records.length < total) {
      fetchRecords(page + 1, true);
    }
  };

  // Quick summary of what is loaded: days, late days, and total time at work
  const summary = useMemo(() => {
    let late = 0;
    let workedMs = 0;
    records.forEach((r) => {
      if (r.is_late) late += 1;
      if (r.check_in_time && r.check_out_time) workedMs += new Date(r.check_out_time) - new Date(r.check_in_time);
    });
    return { late, workedMs };
  }, [records]);

  const renderItem = ({ item }) => {
    const date = toDate(item.date) || new Date();
    const out = item.check_out_time;
    const worked = item.check_in_time && out ? formatDuration(new Date(out) - new Date(item.check_in_time)) : null;
    const rel = relativeDay(item.date);
    const method = (item.check_in_method || 'gps').replace('_', ' ').toUpperCase();

    return (
      <View style={[styles.card, { backgroundColor: theme.card }]}>
        <View style={[styles.dateSection, { borderRightColor: theme.border }]}>
          <Text style={[styles.dayName, { color: rel ? theme.primary : theme.textMuted }]}>{rel === 'Today' ? 'TODAY' : DAYS_SHORT[date.getDay()]}</Text>
          <Text style={[styles.dayNum, { color: theme.text }]}>{date.getDate()}</Text>
          <Text style={[styles.month, { color: theme.textMuted }]}>{MONTHS_SHORT[date.getMonth()]}</Text>
        </View>
        <View style={styles.detailSection}>
          <View style={styles.timeRow}>
            <View>
              <Text style={[styles.timeLabel, { color: theme.textMuted }]}>IN</Text>
              <Text style={[styles.timeValue, { color: theme.text }]}>{formatTime(item.check_in_time, '--:--')}</Text>
            </View>
            <View>
              <Text style={[styles.timeLabel, { color: theme.textMuted }]}>OUT</Text>
              <Text style={[styles.timeValue, { color: theme.text }]}>{formatTime(out, '--:--')}</Text>
            </View>
            <View>
              <Text style={[styles.timeLabel, { color: theme.textMuted }]}>WORKED</Text>
              <Text style={[styles.timeValue, { color: theme.text }]}>{worked || '-'}</Text>
            </View>
          </View>
          <Text style={[styles.fullDate, { color: theme.textSecondary }]}>
            {rel && rel !== 'Today' ? `${rel} · ` : ''}{formatDate(item.date)} · {method}
          </Text>
          <View style={styles.badges}>
            {item.is_late && <View style={styles.lateBadge}><Text style={styles.lateText}>LATE</Text></View>}
            {item.is_late === false && <View style={styles.onTimeBadge}><Text style={styles.onTimeText}>ON TIME</Text></View>}
            {item.is_within_geofence === false && <View style={styles.outsideBadge}><Text style={styles.outsideText}>OUTSIDE</Text></View>}
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Attendance History</Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>
          {total} days recorded
          {records.length > 0 ? ` · ${summary.late} late · ${formatDuration(summary.workedMs)} worked (shown)` : ''}
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <FlatList
        data={records}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          !loading && !error ? <Text style={[styles.emptyText, { color: theme.textMuted }]}>No attendance records yet. Your check-ins will appear here.</Text> : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  header: { padding: 20, paddingTop: 30 },
  title: { fontSize: 24, fontWeight: '700', color: '#2c3e50' },
  subtitle: { fontSize: 13, color: '#95a5a6', marginTop: 4 },
  error: { fontSize: 13, color: '#c0392b', marginTop: 8 },
  list: { padding: 20, paddingTop: 0 },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10,
    flexDirection: 'row', shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 3,
  },
  dateSection: {
    width: 56, alignItems: 'center', justifyContent: 'center',
    borderRightWidth: 1, borderRightColor: '#f0f0f0', paddingRight: 12, marginRight: 14,
  },
  dayName: { fontSize: 11, fontWeight: '700' },
  dayNum: { fontSize: 22, fontWeight: '700' },
  month: { fontSize: 11 },
  detailSection: { flex: 1 },
  timeRow: { flexDirection: 'row', gap: 18 },
  timeLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  timeValue: { fontSize: 15, fontWeight: '600', marginTop: 2 },
  fullDate: { fontSize: 12, marginTop: 8 },
  badges: { flexDirection: 'row', gap: 6, marginTop: 6 },
  lateBadge: { backgroundColor: '#fff3e0', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  lateText: { fontSize: 10, fontWeight: '700', color: '#f39c12' },
  onTimeBadge: { backgroundColor: '#e8f6ee', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  onTimeText: { fontSize: 10, fontWeight: '700', color: '#1e8449' },
  outsideBadge: { backgroundColor: '#ffebee', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  outsideText: { fontSize: 10, fontWeight: '700', color: '#e74c3c' },
  emptyText: { textAlign: 'center', fontSize: 15, marginTop: 40, paddingHorizontal: 20 },
});
