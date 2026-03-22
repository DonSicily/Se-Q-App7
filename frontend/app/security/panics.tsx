/**
 * security/panics.tsx — Active Panics
 *
 * Phase 2.1: Shows all recorded GPS coordinates for each active panic
 * inline in the card (no modal needed), updating every 10 seconds.
 * Layout mirrors the Security Escort GPS track view.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, Alert, Linking, Platform, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import { LocationMapModal } from '../../components/LocationMapModal';
import BACKEND_URL from '../../../utils/config';


// Poll every 10 seconds for live GPS
const POLL_INTERVAL = 10000;

const EMERGENCY_CATEGORIES: Record<string, { label: string; icon: string; color: string }> = {
  violence:   { label: 'Violence/Assault',       icon: 'alert-circle', color: '#EF4444' },
  robbery:    { label: 'Armed Robbery',           icon: 'warning',      color: '#F97316' },
  kidnapping: { label: 'Kidnapping',              icon: 'body',         color: '#DC2626' },
  breakin:    { label: 'Break-in/Burglary',       icon: 'home',         color: '#8B5CF6' },
  harassment: { label: 'Harassment/Stalking',     icon: 'eye',          color: '#EC4899' },
  medical:    { label: 'Medical Emergency',       icon: 'medkit',       color: '#10B981' },
  fire:       { label: 'Fire Outbreak',           icon: 'flame',        color: '#F59E0B' },
  other:      { label: 'Other Emergency',         icon: 'help-circle',  color: '#64748B' },
};

interface GpsPt {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp: string;
}

export default function SecurityPanics() {
  const router = useRouter();
  const [panics, setPanics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [locationModal, setLocationModal] = useState<{
    visible: boolean; lat: number; lng: number; title: string
  } | null>(null);
  const [respondModal, setRespondModal] = useState<any>(null);
  const [countdown, setCountdown] = useState(10);
  const pollRef = useRef<any>(null);
  const countRef = useRef<any>(null);

  // ── Focus: start polling ──────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      loadPanics();
      startPolling();
      return () => stopPolling();
    }, [])
  );

  const startPolling = () => {
    stopPolling();
    pollRef.current = setInterval(() => {
      loadPanics();
      setCountdown(10);
    }, POLL_INTERVAL);
    countRef.current = setInterval(() => {
      setCountdown(p => (p <= 1 ? 10 : p - 1));
    }, 1000);
  };

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (countRef.current) clearInterval(countRef.current);
  };

  const loadPanics = async () => {
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/auth/login'); return; }
      const res = await axios.get(
        `${BACKEND_URL}/api/security/nearby-panics?t=${Date.now()}`,
        { headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' }, timeout: 15000 }
      );
      setPanics(res.data || []);
    } catch (err: any) {
      if (err?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const catInfo = (cat: string) => EMERGENCY_CATEGORIES[cat] || EMERGENCY_CATEGORIES.other;

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        month: 'short', day: 'numeric',
      });
    } catch { return ts; }
  };

  const formatDateTime = (ts: string) => {
    const d = new Date(ts);
    return {
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    };
  };

  const getSenderName = (item: any) =>
    (item.full_name || '').trim() || item.user_email || item.email || 'Unknown User';

  const callUser = (phone: string) =>
    phone ? Linking.openURL(`tel:${phone}`) : Alert.alert('No Phone', 'Phone number not available');

  const openInMaps = (lat: number, lng: number, label: string) => {
    const url = Platform.select({
      ios: `maps:?q=${encodeURIComponent(label)}&ll=${lat},${lng}`,
      android: `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`,
    });
    if (url) Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open maps'));
  };

  // ── GPS timeline row ──────────────────────────────────────────────────────
  const renderGpsRow = (pt: GpsPt, index: number, total: number) => (
    <TouchableOpacity
      key={`${index}-${pt.timestamp}`}
      style={[gpsStyles.row, index === 0 && gpsStyles.rowLatest]}
      onPress={() =>
        setLocationModal({
          visible: true,
          lat: pt.latitude,
          lng: pt.longitude,
          title: `Location @ ${formatTime(pt.timestamp)}`,
        })
      }
      activeOpacity={0.7}
    >
      <View style={gpsStyles.trail}>
        <View style={[gpsStyles.dot, index === 0 && gpsStyles.dotLatest]} />
        {index < total - 1 && <View style={gpsStyles.line} />}
      </View>
      <View style={gpsStyles.content}>
        <View style={gpsStyles.topRow}>
          {index === 0 && (
            <View style={gpsStyles.latestBadge}>
              <Text style={gpsStyles.latestBadgeText}>LATEST</Text>
            </View>
          )}
          <Text style={gpsStyles.coords} numberOfLines={1}>
            {pt.latitude.toFixed(6)}, {pt.longitude.toFixed(6)}
          </Text>
        </View>
        <Text style={gpsStyles.time}>{formatTime(pt.timestamp)}</Text>
        {pt.accuracy != null && (
          <Text style={gpsStyles.accuracy}>±{Math.round(pt.accuracy)}m accuracy</Text>
        )}
      </View>
      <Ionicons name="map-outline" size={16} color="#3B82F6" style={{ marginLeft: 6 }} />
    </TouchableOpacity>
  );

  // ── Panic card ────────────────────────────────────────────────────────────
  const renderPanic = ({ item }: any) => {
    const cat = catInfo(item.emergency_category);
    const dt = formatDateTime(item.activated_at);
    const name = getSenderName(item);
    const history: GpsPt[] = item.location_history || [];
    // Show most-recent first
    const chronoHistory = [...history].reverse();

    return (
      <View style={styles.card}>
        {/* Top badges */}
        <View style={styles.topRow}>
          <View style={styles.activeBadge}>
            <Ionicons name="alert-circle" size={14} color="#EF4444" />
            <Text style={styles.activeBadgeText}>ACTIVE PANIC</Text>
          </View>
          <View style={[styles.catBadge, { backgroundColor: `${cat.color}20` }]}>
            <Ionicons name={cat.icon as any} size={14} color={cat.color} />
            <Text style={[styles.catText, { color: cat.color }]}>{cat.label}</Text>
          </View>
        </View>

        {/* User info */}
        <View style={styles.userRow}>
          <View style={styles.avatar}>
            <Ionicons name="person-circle" size={44} color="#3B82F6" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{name}</Text>
            <Text style={styles.userEmail}>{item.user_email || 'No email'}</Text>
            {item.user_phone ? (
              <Text style={styles.userPhone}>{item.user_phone}</Text>
            ) : (
              <Text style={styles.userPhoneEmpty}>No phone on file</Text>
            )}
          </View>
        </View>

        {/* Details */}
        <View style={styles.details}>
          {[
            { icon: 'calendar', text: dt.date },
            { icon: 'time', text: dt.time },
            { icon: 'location', text: `${item.latitude?.toFixed(4)}, ${item.longitude?.toFixed(4)}` },
            { icon: 'pulse', text: `${item.location_count || 0} location updates`, color: '#10B981' },
          ].map((r, i) => (
            <View key={i} style={styles.detailRow}>
              <Ionicons name={r.icon as any} size={15} color={r.color || '#94A3B8'} />
              <Text style={[styles.detailText, r.color ? { color: r.color } : {}]}>{r.text}</Text>
            </View>
          ))}
        </View>

        {/* ── LIVE GPS TRACK ── */}
        <View style={gpsStyles.container}>
          <View style={gpsStyles.header}>
            <Ionicons name="trail-sign" size={16} color="#F59E0B" />
            <Text style={gpsStyles.title}>Live GPS Track</Text>
            {history.length > 0 && (
              <View style={gpsStyles.countBadge}>
                <Text style={gpsStyles.countText}>{history.length}</Text>
              </View>
            )}
            <View style={gpsStyles.liveBadge}>
              <View style={gpsStyles.liveDot} />
              <Text style={gpsStyles.liveText}>LIVE · {countdown}s</Text>
            </View>
          </View>

          {chronoHistory.length === 0 ? (
            <View style={gpsStyles.empty}>
              <Ionicons name="time-outline" size={28} color="#334155" />
              <Text style={gpsStyles.emptyText}>No GPS coordinates yet</Text>
              <Text style={gpsStyles.emptySubtext}>Points will appear as user moves</Text>
            </View>
          ) : (
            <View>
              {chronoHistory.map((pt, i) => renderGpsRow(pt, i, chronoHistory.length))}
            </View>
          )}
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.respondBtn}
            onPress={() => {
              if (!item.latitude || !item.longitude) {
                Alert.alert('Location Error', 'User location not available');
                return;
              }
              setRespondModal(item);
            }}
          >
            <Ionicons name="navigate" size={20} color="#fff" />
            <Text style={styles.respondBtnText}>Respond</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/security/home')} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Active Panics ({panics.length})</Text>
        <TouchableOpacity onPress={() => { loadPanics(); setCountdown(10); }}>
          <Ionicons name="refresh" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#EF4444" />
        </View>
      ) : (
        <FlatList
          data={panics}
          renderItem={renderPanic}
          keyExtractor={item => item.id || item._id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="shield-checkmark" size={80} color="#64748B" />
              <Text style={styles.emptyText}>No active panics</Text>
              <Text style={styles.emptySubtext}>All clear in your area</Text>
            </View>
          }
        />
      )}

      {/* Refresh bar */}
      <View style={styles.refreshBar}>
        <Ionicons name="sync-outline" size={11} color="#475569" style={{ marginRight: 5 }} />
        <Text style={styles.refreshBarText}>Live GPS — next update in {countdown}s</Text>
      </View>

      {locationModal && (
        <LocationMapModal
          visible={locationModal.visible}
          onClose={() => setLocationModal(null)}
          latitude={locationModal.lat}
          longitude={locationModal.lng}
          title={locationModal.title}
        />
      )}

      {/* Respond modal */}
      {respondModal && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setRespondModal(null)}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setRespondModal(null)}>
            <View style={styles.respondModal}>
              <Text style={styles.respondTitle}>🚨 Respond to Panic</Text>
              <Text style={styles.respondName}>{getSenderName(respondModal)}</Text>
              {(respondModal.user_phone || respondModal.phone) && (
                <Text style={styles.respondPhone}>📞 {respondModal.user_phone || respondModal.phone}</Text>
              )}
              <Text style={styles.respondCoords}>
                📍 {respondModal.latitude?.toFixed(4)}, {respondModal.longitude?.toFixed(4)}
              </Text>

              {/* Message */}
              <TouchableOpacity
                style={[styles.respondBtn2, { backgroundColor: '#8B5CF6' }]}
                onPress={() => { setRespondModal(null); Linking.openURL(`sms:${respondModal.user_phone || respondModal.phone}`); }}
              >
                <Ionicons name="chatbubble" size={18} color="#fff" />
                <Text style={styles.respondBtn2Text}>Message</Text>
              </TouchableOpacity>

              {/* View on Map */}
              <TouchableOpacity
                style={styles.respondBtn2}
                onPress={() => {
                  setRespondModal(null);
                  setLocationModal({ visible: true, lat: respondModal.latitude, lng: respondModal.longitude, title: `${getSenderName(respondModal)}'s Location` });
                }}
              >
                <Ionicons name="map" size={18} color="#fff" />
                <Text style={styles.respondBtn2Text}>View on Map</Text>
              </TouchableOpacity>

              {/* Call */}
              <TouchableOpacity
                style={[styles.respondBtn2, { backgroundColor: '#10B981' }]}
                onPress={() => { setRespondModal(null); callUser(respondModal.user_phone || respondModal.phone); }}
              >
                <Ionicons name="call" size={18} color="#fff" />
                <Text style={styles.respondBtn2Text}>Call</Text>
              </TouchableOpacity>

              {/* Cancel */}
              <TouchableOpacity
                style={[styles.respondBtn2, { backgroundColor: '#334155' }]}
                onPress={() => setRespondModal(null)}
              >
                <Ionicons name="close-circle" size={18} color="#fff" />
                <Text style={styles.respondBtn2Text}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#0F172A' },
  header:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  backBtn:          { padding: 4 },
  headerTitle:      { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  loadingBox:       { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list:             { padding: 16, paddingBottom: 40 },
  card:             { backgroundColor: '#1E293B', borderRadius: 16, padding: 16, marginBottom: 16, borderLeftWidth: 4, borderLeftColor: '#EF4444' },
  topRow:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  activeBadge:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EF444420', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, gap: 5 },
  activeBadgeText:  { fontSize: 11, fontWeight: '800', color: '#EF4444' },
  catBadge:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, gap: 5 },
  catText:          { fontSize: 11, fontWeight: '600' },
  userRow:          { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  avatar:           { width: 52, height: 52, borderRadius: 26, backgroundColor: '#3B82F620', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  userName:         { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 3 },
  userEmail:        { fontSize: 12, color: '#94A3B8', marginBottom: 2 },
  userPhone:        { fontSize: 13, color: '#10B981', fontWeight: '600' },
  userPhoneEmpty:   { fontSize: 12, color: '#475569', fontStyle: 'italic' },
  details:          { backgroundColor: '#0F172A', borderRadius: 12, padding: 12, marginBottom: 12 },
  detailRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  detailText:       { fontSize: 13, color: '#94A3B8' },
  actions:          { flexDirection: 'row', marginTop: 12 },
  respondBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 12, backgroundColor: '#F59E0B' },
  respondBtnText:   { fontSize: 15, fontWeight: '700', color: '#fff' },
  empty:            { alignItems: 'center', paddingVertical: 80 },
  emptyText:        { fontSize: 20, color: '#64748B', marginTop: 16, fontWeight: '600' },
  emptySubtext:     { fontSize: 14, color: '#475569', marginTop: 4 },
  refreshBar:       { height: 28, backgroundColor: '#0F172A', borderTopWidth: 1, borderTopColor: '#1E293B', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  refreshBarText:   { fontSize: 11, color: '#475569' },
  // Respond modal
  modalOverlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  respondModal:     { backgroundColor: '#1E293B', borderRadius: 20, padding: 24, width: '100%', maxWidth: 360 },
  respondTitle:     { fontSize: 17, fontWeight: 'bold', color: '#EF4444', marginBottom: 8, textAlign: 'center' },
  respondName:      { fontSize: 19, fontWeight: '700', color: '#fff', marginBottom: 4, textAlign: 'center' },
  respondPhone:     { fontSize: 14, color: '#10B981', marginBottom: 4, textAlign: 'center' },
  respondCoords:    { fontSize: 12, color: '#94A3B8', marginBottom: 20, textAlign: 'center' },
  respondBtn2:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#3B82F6', paddingVertical: 13, borderRadius: 12, marginBottom: 10 },
  respondBtn2Text:  { fontSize: 15, fontWeight: '600', color: '#fff' },
});

const gpsStyles = StyleSheet.create({
  container:    { marginBottom: 4, backgroundColor: '#0F172A', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#F59E0B30' },
  header:       { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  title:        { flex: 1, fontSize: 13, fontWeight: '600', color: '#F59E0B' },
  countBadge:   { backgroundColor: '#F59E0B', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  countText:    { fontSize: 11, fontWeight: '700', color: '#fff' },
  liveBadge:    { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#10B98120', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  liveDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981' },
  liveText:     { fontSize: 10, fontWeight: '700', color: '#10B981' },
  row:          { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1E293B40', paddingHorizontal: 4 },
  rowLatest:    { backgroundColor: '#3B82F608', borderRadius: 8, paddingHorizontal: 8 },
  trail:        { width: 20, alignItems: 'center', marginRight: 10, paddingTop: 2 },
  dot:          { width: 9, height: 9, borderRadius: 5, backgroundColor: '#334155' },
  dotLatest:    { width: 11, height: 11, borderRadius: 6, backgroundColor: '#10B981' },
  line:         { width: 2, height: 26, backgroundColor: '#1E293B', marginTop: 2 },
  content:      { flex: 1 },
  topRow:       { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  latestBadge:  { backgroundColor: '#10B98130', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 },
  latestBadgeText: { color: '#10B981', fontSize: 9, fontWeight: '700' },
  coords:       { fontSize: 12, color: '#E2E8F0', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  time:         { fontSize: 11, color: '#64748B', marginTop: 2 },
  accuracy:     { fontSize: 10, color: '#475569', marginTop: 1 },
  empty:        { alignItems: 'center', paddingVertical: 24 },
  emptyText:    { color: '#475569', fontSize: 13, marginTop: 8 },
  emptySubtext: { color: '#334155', fontSize: 11, marginTop: 3 },
});
