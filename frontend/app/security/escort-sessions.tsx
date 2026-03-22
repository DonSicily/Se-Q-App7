import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Alert, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getAuthToken, clearAuthData, getUserMetadata } from '../../utils/auth';
import { LocationMapModal } from '../../components/LocationMapModal';
import BACKEND_URL from '../../../utils/config';


export default function EscortSessions() {
  const router = useRouter();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapModal, setMapModal] = useState<{ visible: boolean; lat: number; lng: number; title: string } | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      // Detect role so back button routes to the correct dashboard
      getUserMetadata().then(m => setUserRole(m.role));
      loadSessions();
      const interval = setInterval(loadSessions, 20000);
      return () => clearInterval(interval);
    }, [])
  );

  const [etaAlerts, setEtaAlerts] = useState<any[]>([]);

  const loadSessions = async () => {
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/auth/login'); return; }
      const [sessRes, etaRes] = await Promise.allSettled([
        axios.get(`${BACKEND_URL}/api/security/escort-sessions?t=${Date.now()}`, {
          headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' },
          timeout: 15000,
        }),
        axios.get(`${BACKEND_URL}/api/security/escort-eta-alerts?t=${Date.now()}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10000,
        }),
      ]);
      if (sessRes.status === 'fulfilled') setSessions(sessRes.value.data || []);
      if (etaRes.status === 'fulfilled') {
        const alerts = etaRes.value.data || [];
        setEtaAlerts(alerts);
        if (alerts.length > 0) {
          Alert.alert(
            '⚠️ ETA Overdue',
            `${alerts.length} escort session(s) have exceeded their ETA. Tap "Escort Sessions" to check on users.`,
            [{ text: 'OK' }]
          );
        }
      }
    } catch (error: any) {
      if (error?.response?.status === 401) { await clearAuthData(); router.replace('/auth/login'); }
    } finally {
      setLoading(false);
    }
  };

  const openMaps = (lat: number, lng: number, name: string) => {
    const url = Platform.select({
      ios: `maps:?q=${encodeURIComponent(name)}&ll=${lat},${lng}`,
      android: `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(name)})`,
    });
    if (url) Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open maps'));
  };

  const callUser = (phone: string) => {
    if (phone) Linking.openURL(`tel:${phone}`);
    else Alert.alert('No phone', 'Phone number not available');
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return 'Unknown';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const renderSession = ({ item }: any) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.iconContainer}>
          <Ionicons name="navigate" size={28} color="#10B981" />
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{item.user_name || 'Unknown User'}</Text>
          <Text style={styles.userEmail}>{item.user_email || 'No email'}</Text>
          {item.user_phone ? (
            <Text style={styles.userPhone}>📞 {item.user_phone}</Text>
          ) : null}
        </View>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Ionicons name="time" size={16} color="#94A3B8" />
          <Text style={styles.statText}>Started: {formatTime(item.started_at)}</Text>
        </View>
        <View style={styles.stat}>
          <Ionicons name="pulse" size={16} color="#10B981" />
          <Text style={styles.statText}>{item.location_count} GPS updates</Text>
        </View>
      </View>

      {item.latitude && item.longitude ? (
        <View style={styles.coordsBox}>
          <Ionicons name="location" size={16} color="#3B82F6" />
          <Text style={styles.coordsText}>
            Last known: {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}
          </Text>
        </View>
      ) : (
        <View style={styles.coordsBox}>
          <Ionicons name="location-outline" size={16} color="#64748B" />
          <Text style={[styles.coordsText, { color: '#64748B' }]}>Awaiting first GPS update...</Text>
        </View>
      )}

      <View style={styles.actions}>
        {item.latitude && item.longitude ? (
          <>
            <TouchableOpacity
              style={styles.mapButton}
              onPress={() => setMapModal({ visible: true, lat: item.latitude, lng: item.longitude, title: `${item.user_name}'s Escort Route` })}
            >
              <Ionicons name="map" size={18} color="#fff" />
              <Text style={styles.actionText}>View on Map</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.mapButton, { backgroundColor: '#3B82F6' }]}
              onPress={() => openMaps(item.latitude, item.longitude, item.user_name)}
            >
              <Ionicons name="navigate" size={18} color="#fff" />
              <Text style={styles.actionText}>Navigate</Text>
            </TouchableOpacity>
          </>
        ) : null}
        {item.user_phone ? (
          <TouchableOpacity
            style={[styles.mapButton, { backgroundColor: '#10B981' }]}
            onPress={() => callUser(item.user_phone)}
          >
            <Ionicons name="call" size={18} color="#fff" />
            <Text style={styles.actionText}>Call</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* GPS Route Trail */}
      {item.route && item.route.length > 1 && (
        <View style={styles.routeSection}>
          <Text style={styles.routeTitle}>📍 Recent GPS Trail ({item.route.length} points)</Text>
          {item.route.slice(-5).reverse().map((loc: any, idx: number) => (
            <View key={idx} style={styles.routePoint}>
              <View style={[styles.routeDot, { backgroundColor: idx === 0 ? '#10B981' : '#334155' }]} />
              <Text style={styles.routeText}>
                {loc.latitude?.toFixed(5)}, {loc.longitude?.toFixed(5)}
                {loc.timestamp ? `  ·  ${new Date(loc.timestamp).toLocaleTimeString()}` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.replace(userRole === 'admin' ? '/admin/dashboard' : '/security/home')}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Active Escort Sessions ({sessions.length})</Text>
        <TouchableOpacity onPress={loadSessions}>
          <Ionicons name="refresh" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* ETA Overdue Alerts */}
      {etaAlerts.length > 0 && (
        <View style={styles.etaAlertBanner}>
          <Ionicons name="warning" size={20} color="#F59E0B" />
          <Text style={styles.etaAlertText}>
            {etaAlerts.length} user(s) overdue — please check on them
          </Text>
        </View>
      )}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#10B981" />
        </View>
      ) : (
        <FlatList
          data={sessions}
          renderItem={renderSession}
          keyExtractor={(item) => item.session_id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="navigate-outline" size={80} color="#334155" />
              <Text style={styles.emptyTitle}>No Active Escort Sessions</Text>
              <Text style={styles.emptySubtext}>When civil users activate Security Escort, their live GPS route will appear here.</Text>
            </View>
          }
        />
      )}

      {mapModal && (
        <LocationMapModal
          visible={mapModal.visible}
          onClose={() => setMapModal(null)}
          latitude={mapModal.lat}
          longitude={mapModal.lng}
          title={mapModal.title}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  backBtn: { padding: 4 },
  title: { fontSize: 17, fontWeight: 'bold', color: '#fff', flex: 1, textAlign: 'center' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 16 },
  card: { backgroundColor: '#1E293B', borderRadius: 16, padding: 16, marginBottom: 16, borderLeftWidth: 4, borderLeftColor: '#10B981' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  iconContainer: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#10B98120', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  userInfo: { flex: 1 },
  userName: { fontSize: 17, fontWeight: '700', color: '#fff', marginBottom: 2 },
  userEmail: { fontSize: 13, color: '#94A3B8', marginBottom: 2 },
  userPhone: { fontSize: 13, color: '#10B981' },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EF444420', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#EF4444' },
  liveText: { fontSize: 11, fontWeight: '700', color: '#EF4444' },
  statsRow: { flexDirection: 'row', gap: 16, marginBottom: 10 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statText: { fontSize: 13, color: '#94A3B8' },
  coordsBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0F172A', borderRadius: 10, padding: 10, marginBottom: 12 },
  coordsText: { fontSize: 13, color: '#94A3B8', flex: 1 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  mapButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#F59E0B', paddingVertical: 10, borderRadius: 10, minWidth: 90 },
  actionText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  routeSection: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#334155' },
  routeTitle: { fontSize: 13, fontWeight: '600', color: '#64748B', marginBottom: 8 },
  routePoint: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  routeDot: { width: 8, height: 8, borderRadius: 4 },
  routeText: { fontSize: 12, color: '#94A3B8', flex: 1 },
  emptyContainer: { alignItems: 'center', paddingVertical: 80, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#64748B', marginTop: 16, marginBottom: 8 },
  emptySubtext: { fontSize: 14, color: '#475569', textAlign: 'center', lineHeight: 20 },
  etaAlertBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F59E0B20', marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: 12, borderLeftWidth: 4, borderLeftColor: '#F59E0B' },
  etaAlertText: { fontSize: 14, color: '#F59E0B', fontWeight: '600', flex: 1 },
});
