import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { requestLeave, getMyLeaves, cancelLeave } from '../services/api';
import { formatDate, formatDateRange, daysInclusive, toInputDate } from '../services/format';

export default function LeaveRequestScreen() {
  const [leaveType, setLeaveType] = useState('personal');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [reason, setReason] = useState('');
  const [myLeaves, setMyLeaves] = useState([]);
  const [loading, setLoading] = useState(false);

  // Date picker state
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerTarget, setPickerTarget] = useState(null); // 'start' | 'end'

  useEffect(() => { fetchLeaves(); }, []);

  const fetchLeaves = () => {
    getMyLeaves().then(r => setMyLeaves(r.data)).catch(() => {});
  };

  const openPicker = (target) => {
    setPickerTarget(target);
    setPickerVisible(true);
  };

  const onDateChange = (event, selectedDate) => {
    if (Platform.OS === 'android') setPickerVisible(false);
    if (event.type === 'dismissed') { setPickerVisible(false); return; }
    if (!selectedDate) return;
    if (pickerTarget === 'start') setStartDate(selectedDate);
    else setEndDate(selectedDate);
    if (Platform.OS === 'ios') setPickerVisible(false);
  };

  const pickerValue = pickerTarget === 'start'
    ? (startDate || new Date())
    : (endDate || startDate || new Date());

  const onSubmit = async () => {
    if (!startDate || !endDate) return Alert.alert('Validation', 'Please pick start and end date');
    if (startDate > endDate) return Alert.alert('Validation', 'Start date must be before end date');
    setLoading(true);
    try {
      await requestLeave({
        leaveType,
        // Local calendar day, so the date never shifts because of time zones
        startDate: toInputDate(startDate),
        endDate: toInputDate(endDate),
        reason,
      });
      Alert.alert('Success', 'Leave request submitted. Your admin will be notified.');
      setLeaveType('personal'); setStartDate(null); setEndDate(null); setReason('');
      fetchLeaves();
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.error || 'Failed to submit');
    } finally { setLoading(false); }
  };

  const onCancel = (id) => {
    Alert.alert('Cancel Leave', 'Are you sure?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes', onPress: async () => {
          try { await cancelLeave(id); fetchLeaves(); Alert.alert('Cancelled'); }
          catch { Alert.alert('Failed to cancel'); }
        }
      }
    ]);
  };

  const statusColor = { pending: '#f39c12', approved: '#27ae60', rejected: '#e74c3c', cancelled: '#95a5a6' };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Request Leave</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Type</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {['personal', 'sick', 'vacation', 'maternity', 'paternity', 'bereavement'].map((type) => (
            <TouchableOpacity
              key={type}
              style={[styles.typeBtn, leaveType === type && styles.typeBtnActive]}
              onPress={() => setLeaveType(type)}
            >
              <Text style={leaveType === type ? styles.typeTxtActive : styles.typeTxt}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Start Date</Text>
        <TouchableOpacity style={styles.dateBtn} onPress={() => openPicker('start')}>
          <Text style={startDate ? styles.dateTxt : styles.datePlaceholder}>
            {startDate ? formatDate(startDate) : 'Pick start date'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.label}>End Date</Text>
        <TouchableOpacity style={styles.dateBtn} onPress={() => openPicker('end')}>
          <Text style={endDate ? styles.dateTxt : styles.datePlaceholder}>
            {endDate ? `${formatDate(endDate)}${startDate ? ` (${daysInclusive(startDate, endDate)} day${daysInclusive(startDate, endDate) === 1 ? '' : 's'})` : ''}` : 'Pick end date'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.label}>Reason (optional)</Text>
        <TextInput
          style={styles.textarea}
          multiline
          value={reason}
          onChangeText={setReason}
          placeholder="Describe the reason for your leave..."
          placeholderTextColor="#aaa"
        />

        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 }}>
          <TouchableOpacity style={[styles.btn, loading && { opacity: 0.6 }]} onPress={onSubmit} disabled={loading}>
            <Text style={styles.btnText}>{loading ? 'Submitting...' : 'Submit Request'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {pickerVisible && (
        <DateTimePicker
          value={pickerValue}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          minimumDate={pickerTarget === 'end' && startDate ? startDate : new Date()}
          onChange={onDateChange}
        />
      )}

      <Text style={[styles.title, { marginTop: 18 }]}>My Requests</Text>
      <View style={styles.card}>
        {myLeaves.map(l => (
          <View key={l.id} style={styles.leaveRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', fontSize: 14 }}>
                {formatDateRange(l.start_date, l.end_date)}
              </Text>
              <Text style={{ color: '#666', fontSize: 12, marginTop: 2 }}>
                {l.leave_type.charAt(0).toUpperCase() + l.leave_type.slice(1)}
              </Text>
              {l.review_note ? (
                <Text style={{ color: '#888', fontSize: 11, marginTop: 2 }}>Note: {l.review_note}</Text>
              ) : null}
            </View>
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <View style={[styles.statusBadge, { backgroundColor: (statusColor[l.status] || '#999') + '20' }]}>
                <Text style={[styles.statusText, { color: statusColor[l.status] || '#999' }]}>{l.status}</Text>
              </View>
              {l.status === 'pending' && (
                <TouchableOpacity style={styles.cancelBtn} onPress={() => onCancel(l.id)}>
                  <Text style={{ color: '#fff', fontSize: 12 }}>Cancel</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
        {myLeaves.length === 0 && <Text style={{ color: '#999', textAlign: 'center', paddingVertical: 16 }}>No leave requests yet</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12, color: '#2c3e50' },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  label: { fontSize: 13, color: '#666', marginTop: 12, marginBottom: 6 },
  typeBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f0f2f5', marginBottom: 4 },
  typeBtnActive: { backgroundColor: '#1a5276' },
  typeTxt: { color: '#333', fontSize: 13 },
  typeTxtActive: { color: '#fff', fontSize: 13 },
  dateBtn: { padding: 14, borderRadius: 8, backgroundColor: '#f5f7fa', borderWidth: 1, borderColor: '#e0e0e0' },
  dateTxt: { color: '#2c3e50', fontSize: 14 },
  datePlaceholder: { color: '#aaa', fontSize: 14 },
  textarea: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, padding: 10, minHeight: 80, fontSize: 14, color: '#2c3e50', textAlignVertical: 'top' },
  btn: { backgroundColor: '#1a5276', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  leaveRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  cancelBtn: { backgroundColor: '#e74c3c', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
});
