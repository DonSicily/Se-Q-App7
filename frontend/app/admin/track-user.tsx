import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, FlatList, Platform, Image, Linking, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import { LocationMapModal } from '../../components/LocationMapModal';
import BACKEND_URL from '../../../utils/config';


interface LocationEntry {
  latitude: number;
  longitude: number;
  timestamp: string;
  accuracy?: number;
  source?: string;
}

export default function AdminTrackUser() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [trackData, setTrackData] = useState<any>(null);
  const [locationHistory, setLocationHistory] = useState<LocationEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [mapModal, setMapModal] = useState<{ lat: number; lng: number; title: string } | null>(null);
  const intervalRef = useRef<any>(null);
  const countdownRef = useRef<any>(null);
  const userIdRef = useRef<string | null>(null);

  // Search state
  const [searchTerm, setSearchTerm] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    let uid: string | null = null;
    if (params.userData) {
      try {
        const parsed = JSON.parse(params.userData as string);
        uid = parsed.user_id || parsed.id || null;
        setUserId(uid);
        userIdRef.current = uid;
      } catch (e) {
        console.error('[AdminTrackUser] Failed to parse user data:', e);
      }
    } else if (params.userId) {
      uid = params.userId as string;
      setUserId(uid);
      userIdRef.current = uid;
    }

    if (uid) loadTrackData(uid);
    // No uid = stay on search screen (loading is already false)

    // Auto-refresh every 30 seconds
    intervalRef.current = setInterval(() => {
      if (userIdRef.current) loadTrackData(userIdRef.current);
      setCountdown(30);
    }, 30000);

    // Countdown ticker
    countdownRef.current = setInterval(() => {
      setCountdown(prev => (prev <= 1 ? 30 : prev - 1));
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const handleSearch = async () => {
    if (!searchTerm.trim()) { Alert.alert('Enter a search term', 'Type a name, email or phone number to search.'); return; }
    setSearchLoading(true);
    setShowResults(false);
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/admin/login'); return; }
      const response = await axios.get(
        `${BACKEND_URL}/api/admin/search?query=${encodeURIComponent(searchTerm.trim())}&data_type=users`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
      );
      const users = (response.data?.results || []).filter((r: any) => r.type === 'user' || r.role);
      if (users.length === 0) {
        Alert.alert('No users found', `No users match "${searchTerm}". Try a different email, name or phone number.`);
      } else {
        setSearchResults(users);
        setShowResults(true);
      }
    } catch (error: any) {
      if (error?.response?.status === 401) { await clearAuthData(); router.replace('/admin/login'); }
      else { Alert.alert('Search Failed', error?.response?.data?.detail || 'Could not search. Please try again.'); }
    } finally {
      setSearchLoading(false);
    }
  };

  const selectUser = (user: any) => {
    const uid = user.id || user._id || user.user_id;
    if (!uid) { Alert.alert('Error', 'Could not identify this user.'); return; }
    setShowResults(false);
    setSearchTerm(user.full_name || user.email || searchTerm);
    setUserId(uid);
    userIdRef.current = uid;
    setLoading(true);
    loadTrackData(uid);
  };

  const loadTrackData = async (uid: string) => {
    if (!uid) return;
    setRefreshing(true);
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/admin/login'); return; }
      // Use admin endpoint for tracking
      const response = await axios.get(
        `${BACKEND_URL}/api/admin/track-user/${uid}`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
      );
      setTrackData(response.data);
      if (response.data.location_history && response.data.location_history.length > 0) {
        setLocationHistory(prev => {
          const existingTimestamps = new Set(prev.map((l: LocationEntry) => l.timestamp));
          const newEntries = (response.data.location_history as LocationEntry[]).filter(
            l => !existingTimestamps.has(l.timestamp)
          );
          if (newEntries.length === 0) return prev;
          const merged = [...prev, ...newEntries];
          merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          return merged;
        });
      }
    } catch (error: any) {
      console.error('[AdminTrackUser] Failed to load:', error?.response?.status);
      if (error?.response?.status === 401) { await clearAuthData(); router.replace('/admin/login'); }
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    if (userIdRef.current) { setCountdown(30); loadTrackData(userIdRef.current); }
  };

  const callUser = () => {
    const phone = trackData?.phone;
    if (phone) Linking.openURL(`tel:${phone}`);
    else Alert.alert('No Phone', 'Phone number not available');
  };

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        month: 'short', day: 'numeric',
      });
    } catch { return iso; }
  };

  const renderLocationEntry = ({ item, index }: { item: LocationEntry; index: number }) => (
    <TouchableOpacity
      style={[styles.locationEntry, index === 0 && styles.latestEntry]}
      onPress={() => setMapModal({ lat: item.latitude, lng: item.longitude, title: `${trackData?.full_name || 'User'} @ ${formatTime(item.timestamp)}` })}
      activeOpacity={0.7}
    >
      <View style={styles.entryLeft}>
        <View style={[styles.locationDot, index === 0 && styles.latestDot]} />
        {index < locationHistory.length - 1 && <View style={styles.locationLine} />}
      </View>
      <View style={styles.entryContent}>
        <View style={styles.entryTopRow}>
          {index === 0 && <View style={styles.latestBadge}><Text style={styles.latestBadgeText}>LATEST</Text></View>}
          <Text style={styles.coordsText}>{item.latitude.toFixed(6)}, {item.longitude.toFixed(6)}</Text>
        </View>
        <Text style={styles.timeText}>{formatTime(item.timestamp)}</Text>
        {item.accuracy != null && <Text style={styles.accuracyText}>±{Math.round(item.accuracy)}m accuracy</Text>}
      </View>
      <Ionicons name="map-outline" size={18} color="#3B82F6" style={{ marginLeft: 8 }} />
    </TouchableOpacity>
  );

  if (!userId) {
    // No user selected yet — show search screen
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.replace('/admin/dashboard')}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Track Users</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* ── Search module ─────────────────────────────────────────── */}
        <View style={styles.searchCard}>
          <Text style={styles.searchLabel}>Search & Track User</Text>
          <Text style={styles.searchSub}>Enter a name, email address or phone number</Text>
          <View style={styles.searchRow}>
            <View style={styles.searchInputWrap}>
              <Ionicons name="search" size={20} color="#64748B" />
              <TextInput
                style={styles.searchInput}
                placeholder="Name, email or phone..."
                placeholderTextColor="#64748B"
                value={searchTerm}
                onChangeText={setSearchTerm}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={handleSearch}
              />
              {searchTerm.length > 0 && (
                <TouchableOpacity onPress={() => { setSearchTerm(''); setShowResults(false); }}>
                  <Ionicons name="close-circle" size={18} color="#64748B" />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity
              style={[styles.searchBtn, searchLoading && styles.searchBtnLoading]}
              onPress={handleSearch}
              disabled={searchLoading}
            >
              {searchLoading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="arrow-forward" size={20} color="#fff" />}
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Search results ────────────────────────────────────────── */}
        {showResults && (
          <FlatList
            data={searchResults}
            keyExtractor={(item, i) => item.id || item._id || String(i)}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
            ListHeaderComponent={
              <Text style={styles.resultsHeader}>{searchResults.length} user{searchResults.length !== 1 ? 's' : ''} found</Text>
            }
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.resultCard} onPress={() => selectUser(item)}>
                <View style={[styles.resultAvatar, {
                  backgroundColor: item.role === 'security' ? '#F59E0B20' : item.role === 'admin' ? '#8B5CF620' : '#10B98120'
                }]}>
                  <Ionicons
                    name={item.role === 'security' ? 'shield' : item.role === 'admin' ? 'key' : 'person'}
                    size={22}
                    color={item.role === 'security' ? '#F59E0B' : item.role === 'admin' ? '#8B5CF6' : '#10B981'}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.resultName}>{item.full_name || 'No name'}</Text>
                  <Text style={styles.resultEmail}>{item.email}</Text>
                  {item.phone ? <Text style={styles.resultPhone}>📞 {item.phone}</Text> : null}
                  <View style={styles.resultRoleBadge}>
                    <Text style={styles.resultRoleText}>
                      {item.role === 'security' ? '🛡 Security' : item.role === 'admin' ? '👤 Admin' : '🙋 Civilian'}
                    </Text>
                  </View>
                </View>
                <Ionicons name="location" size={22} color="#8B5CF6" />
              </TouchableOpacity>
            )}
          />
        )}

        {/* Empty hint when nothing searched yet */}
        {!showResults && !searchLoading && (
          <View style={styles.centerContent}>
            <Ionicons name="locate-outline" size={64} color="#1E293B" />
            <Text style={styles.hintText}>Search for a user above</Text>
            <Text style={styles.hintText}>to view their live GPS track</Text>
          </View>
        )}
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { setUserId(null); setTrackData(null); setLocationHistory([]); setLoading(false); }}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Track User</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#8B5CF6" />
          <Text style={styles.loadingText}>Loading user data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const statusLabel = trackData?.has_panic ? '🚨 PANIC' : trackData?.has_escort ? '🛡 ESCORT' : trackData?.is_active ? '📡 ACTIVE' : '⚫ OFFLINE';
  const statusColor = trackData?.has_panic ? '#EF4444' : trackData?.has_escort ? '#3B82F6' : trackData?.is_active ? '#10B981' : '#64748B';
  
  // Role badge
  const roleLabel = trackData?.role === 'security' ? '🛡 Security' : trackData?.role === 'admin' ? '👤 Admin' : '🙋 Civilian';
  const roleColor = trackData?.role === 'security' ? '#3B82F6' : trackData?.role === 'admin' ? '#8B5CF6' : '#F59E0B';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          setUserId(null);
          setTrackData(null);
          setLocationHistory([]);
          setLoading(false);
          setShowResults(false);
        }}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Track User</Text>
        <TouchableOpacity onPress={handleRefresh}>
          {refreshing ? <ActivityIndicator size="small" color="#8B5CF6" /> : (
            <View style={{ alignItems: 'center' }}>
              <Ionicons name="refresh" size={22} color="#8B5CF6" />
              <Text style={{ color: '#8B5CF6', fontSize: 10 }}>{countdown}s</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <FlatList
        data={locationHistory}
        keyExtractor={(_, i) => i.toString()}
        renderItem={renderLocationEntry}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 60 }}
        ListHeaderComponent={
          <View>
            {/* User Info */}
            <View style={styles.userCard}>
              <View style={styles.avatarWrap}>
                {trackData?.profile_photo_url
                  ? <Image source={{ uri: trackData.profile_photo_url }} style={styles.avatarImage} />
                  : <View style={styles.avatarPlaceholder}><Ionicons name="person" size={36} color="#8B5CF6" /></View>
                }
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>{trackData?.full_name || trackData?.email || 'Unknown User'}</Text>
                {trackData?.email && <Text style={styles.userSub}>✉️ {trackData.email}</Text>}
                {trackData?.phone && <Text style={styles.userSub}>📞 {trackData.phone}</Text>}
              </View>
            </View>

            {/* Role Badge */}
            {trackData?.role && (
              <View style={styles.roleRow}>
                <View style={[styles.roleBadge, { backgroundColor: roleColor + '20' }]}>
                  <Text style={[styles.roleBadgeText, { color: roleColor }]}>{roleLabel}</Text>
                </View>
              </View>
            )}

            {/* Status + Call */}
            <View style={styles.statusRow}>
              <View style={[styles.statusPill, { backgroundColor: statusColor + '20' }]}>
                <Text style={[styles.statusPillText, { color: statusColor }]}>{statusLabel}</Text>
              </View>
              <TouchableOpacity style={styles.callBtn} onPress={callUser}>
                <Ionicons name="call" size={16} color="#fff" />
                <Text style={styles.callBtnText}>Call User</Text>
              </TouchableOpacity>
            </View>

            {/* Current location */}
            {trackData?.latitude && trackData?.longitude ? (
              <TouchableOpacity
                style={styles.currentLocCard}
                onPress={() => setMapModal({ lat: trackData.latitude, lng: trackData.longitude, title: `${trackData.full_name || 'User'} - Current` })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Ionicons name="location" size={20} color="#10B981" />
                  <Text style={{ color: '#fff', fontWeight: '600', flex: 1 }}>Current Location</Text>
                  <Ionicons name="open-outline" size={16} color="#3B82F6" />
                </View>
                <Text style={styles.mainCoords}>{trackData.latitude.toFixed(6)}, {trackData.longitude.toFixed(6)}</Text>
                {trackData.last_update && <Text style={styles.updateTime}>Updated: {formatTime(trackData.last_update)}</Text>}
              </TouchableOpacity>
            ) : (
              <View style={styles.noLocCard}>
                <Ionicons name="location-outline" size={28} color="#64748B" />
                <Text style={{ color: '#64748B', marginTop: 8, fontSize: 14 }}>No location data available</Text>
              </View>
            )}

            {/* History section title */}
            <View style={styles.historyHeader}>
              <Ionicons name="trail-sign-outline" size={16} color="#94A3B8" />
              <Text style={styles.historyTitle}>Location History — {locationHistory.length} recorded point{locationHistory.length !== 1 ? 's' : ''}</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Ionicons name="time-outline" size={44} color="#334155" />
            <Text style={{ color: '#475569', fontSize: 14, marginTop: 12 }}>No location history yet</Text>
            <Text style={{ color: '#334155', fontSize: 12, marginTop: 4 }}>Points will accumulate as the user moves</Text>
          </View>
        }
      />

      {/* Bottom refresh bar */}
      <View style={styles.refreshBar}>
        <View style={[styles.refreshFill, { width: `${(countdown / 30) * 100}%` as any }]} />
        <Ionicons name="sync-outline" size={12} color="#475569" style={{ marginRight: 6 }} />
        <Text style={styles.refreshBarText}>Auto-refreshes every 30s · Next in {countdown}s</Text>
      </View>

      {mapModal && (
        <LocationMapModal
          visible={true}
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  title: { fontSize: 20, fontWeight: '600', color: '#fff' },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#94A3B8', marginTop: 12 },
  userCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 16, padding: 16, marginBottom: 12 },
  avatarWrap: { marginRight: 14 },
  avatarPlaceholder: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#8B5CF61A', justifyContent: 'center', alignItems: 'center' },
  avatarImage: { width: 62, height: 62, borderRadius: 31 },
  userName: { fontSize: 18, fontWeight: '700', color: '#fff' },
  userSub: { fontSize: 13, color: '#94A3B8', marginTop: 3 },
  roleRow: { marginBottom: 12 },
  roleBadge: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 },
  roleBadgeText: { fontSize: 13, fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  statusPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  statusPillText: { fontSize: 13, fontWeight: '700' },
  callBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#10B981', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20 },
  callBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  currentLocCard: { backgroundColor: '#1E293B', borderRadius: 14, padding: 16, marginBottom: 12, borderLeftWidth: 3, borderLeftColor: '#10B981' },
  mainCoords: { fontSize: 15, color: '#10B981', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 4 },
  updateTime: { fontSize: 12, color: '#64748B' },
  noLocCard: { backgroundColor: '#1E293B', borderRadius: 14, padding: 20, alignItems: 'center', marginBottom: 12 },
  historyHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1E293B', marginBottom: 4 },
  historyTitle: { fontSize: 13, fontWeight: '600', color: '#94A3B8' },
  locationEntry: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E293B20', paddingHorizontal: 4 },
  latestEntry: { backgroundColor: '#3B82F60A', borderRadius: 10, paddingHorizontal: 10 },
  entryLeft: { width: 22, alignItems: 'center', marginRight: 12, paddingTop: 2 },
  locationDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#334155' },
  latestDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#10B981' },
  locationLine: { width: 2, height: 30, backgroundColor: '#1E293B', marginTop: 3 },
  entryContent: { flex: 1 },
  entryTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  latestBadge: { backgroundColor: '#10B98130', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  latestBadgeText: { color: '#10B981', fontSize: 10, fontWeight: '700' },
  coordsText: { fontSize: 13, color: '#E2E8F0', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  timeText: { fontSize: 12, color: '#64748B', marginTop: 3 },
  accuracyText: { fontSize: 11, color: '#475569', marginTop: 1 },
  refreshBar: { height: 30, backgroundColor: '#0F172A', borderTopWidth: 1, borderTopColor: '#1E293B', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' },
  refreshFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#8B5CF610' },
  refreshBarText: { fontSize: 11, color: '#475569' },

  // Search module
  searchCard:       { margin: 16, backgroundColor: '#1E293B', borderRadius: 16, padding: 20 },
  searchLabel:      { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 4 },
  searchSub:        { fontSize: 13, color: '#64748B', marginBottom: 16 },
  searchRow:        { flexDirection: 'row', gap: 10 },
  searchInputWrap:  { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderRadius: 12, paddingHorizontal: 14, gap: 8, borderWidth: 1, borderColor: '#334155' },
  searchInput:      { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 14 },
  searchBtn:        { width: 50, height: 50, borderRadius: 12, backgroundColor: '#8B5CF6', justifyContent: 'center', alignItems: 'center' },
  searchBtnLoading: { backgroundColor: '#6D28D9' },
  resultsHeader:    { fontSize: 13, color: '#64748B', marginBottom: 10, marginTop: 4 },
  resultCard:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 14, padding: 14, marginBottom: 10 },
  resultAvatar:     { width: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center' },
  resultName:       { fontSize: 15, fontWeight: '700', color: '#fff' },
  resultEmail:      { fontSize: 13, color: '#94A3B8', marginTop: 2 },
  resultPhone:      { fontSize: 12, color: '#10B981', marginTop: 1 },
  resultRoleBadge:  { marginTop: 4 },
  resultRoleText:   { fontSize: 11, color: '#64748B' },
  hintText:         { fontSize: 15, color: '#334155', textAlign: 'center', marginTop: 16, lineHeight: 24 },
});
