import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, Modal, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import { NativeMap } from '../../components/NativeMap';
import BACKEND_URL from '../../../utils/config';


const STATUS_COLORS: Record<string, string> = {
  responding: '#EF4444', available: '#10B981', busy: '#F59E0B', offline: '#64748B',
};

export default function AdminSecurityMap() {
  const router = useRouter();
  const [securityUsers, setSecurityUsers] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [mapRegion, setMapRegion] = useState({
    latitude: 9.082, longitude: 8.6753, latitudeDelta: 0.5, longitudeDelta: 0.5,
  });

  useFocusEffect(
    useCallback(() => {
      loadData();
      const interval = setInterval(loadData, 20000);
      return () => clearInterval(interval);
    }, [])
  );

  const loadData = async () => {
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/admin/login'); return; }
      
      const response = await axios.get(`${BACKEND_URL}/api/admin/security-map`, { 
        headers: { Authorization: `Bearer ${token}` }, 
        timeout: 15000 
      });
      
      const users = response.data.security_users || [];
      setSecurityUsers(users);
      
      // Center map on first user with location
      const withLoc = users.find((u: any) => u.location?.coordinates);
      if (withLoc) {
        setMapRegion({ 
          latitude: withLoc.location.coordinates[1], 
          longitude: withLoc.location.coordinates[0], 
          latitudeDelta: 0.3, 
          longitudeDelta: 0.3 
        });
      }
    } catch (e: any) {
      if (e?.response?.status === 401) { 
        await clearAuthData(); 
        router.replace('/admin/login'); 
      }
    }
  };

  const onRefresh = async () => { 
    setRefreshing(true); 
    await loadData(); 
    setRefreshing(false); 
  };

  // Map markers - ONLY security users (blue dots), no panics
  const mapMarkers = securityUsers
    .filter(u => u.location?.coordinates)
    .map(u => ({
      id: `sec_${u.id}`, 
      latitude: u.location.coordinates[1], 
      longitude: u.location.coordinates[0],
      title: u.full_name || u.email || 'Security', 
      description: u.status || '', 
      pinColor: STATUS_COLORS[u.status] || '#3B82F6', // Blue by default for security
    }));

  const grouped = {
    responding: securityUsers.filter(u => u.status === 'responding'),
    available: securityUsers.filter(u => u.status === 'available'),
    busy: securityUsers.filter(u => u.status === 'busy'),
    offline: securityUsers.filter(u => !u.status || u.status === 'offline'),
  };

  const handleUserPress = (user: any) => {
    setSelectedUser(user);
    if (user.location?.coordinates) {
      setMapRegion({ 
        latitude: user.location.coordinates[1], 
        longitude: user.location.coordinates[0], 
        latitudeDelta: 0.05, 
        longitudeDelta: 0.05 
      });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/admin/dashboard')} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Security Map</Text>
        <TouchableOpacity onPress={onRefresh}>
          <Ionicons name="refresh" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <NativeMap region={mapRegion} markers={mapMarkers} style={styles.map} />

      <View style={styles.legend}>
        {[
          { c: '#3B82F6', l: `Security Online (${securityUsers.filter(u => u.location?.coordinates).length})` }, 
          { c: '#10B981', l: `Available (${grouped.available.length})` }, 
          { c: '#F59E0B', l: `Busy (${grouped.busy.length})` }, 
          { c: '#64748B', l: `Offline (${grouped.offline.length})` }
        ].map(i => (
          <View key={i.l} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: i.c }]} />
            <Text style={styles.legendText}>{i.l}</Text>
          </View>
        ))}
      </View>

      {/* Security Personnel List - Clickable to show full details */}
      <Text style={styles.sectionTitle}>Security Personnel ({securityUsers.length})</Text>
      
      <ScrollView style={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3B82F6" />}>
        {securityUsers.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={48} color="#64748B" />
            <Text style={styles.emptyText}>No security users with location data</Text>
          </View>
        ) : (
          securityUsers.map(u => (
            <TouchableOpacity 
              key={u.id} 
              style={[styles.card, { borderLeftColor: STATUS_COLORS[u.status] || '#3B82F6' }]}
              onPress={() => handleUserPress(u)}
            >
              <View style={styles.cardHeader}>
                <View style={[styles.avatar, { backgroundColor: `${STATUS_COLORS[u.status] || '#3B82F6'}20` }]}>
                  <Ionicons name="shield" size={20} color={STATUS_COLORS[u.status] || '#3B82F6'} />
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardName}>{u.full_name || u.email || 'Unknown'}</Text>
                  <Text style={styles.cardSub}>
                    {u.security_sub_role === 'supervisor' ? '⭐ Supervisor' : 'Team Member'}
                    {u.team_name ? ` · ${u.team_name}` : ''}
                  </Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: `${STATUS_COLORS[u.status] || '#3B82F6'}20` }]}>
                  <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[u.status] || '#3B82F6' }]} />
                  <Text style={[styles.statusText, { color: STATUS_COLORS[u.status] || '#3B82F6' }]}>
                    {u.status || 'offline'}
                  </Text>
                </View>
              </View>
              {u.location?.coordinates && (
                <Text style={styles.cardCoords}>
                  📍 {u.location.coordinates[1]?.toFixed(4)}, {u.location.coordinates[0]?.toFixed(4)}
                </Text>
              )}
            </TouchableOpacity>
          ))
        )}
        <View style={{ height: 24 }} />
      </ScrollView>

      {/* User Detail Modal */}
      {selectedUser && (
        <Modal visible={true} transparent animationType="slide" onRequestClose={() => setSelectedUser(null)}>
          <View style={styles.modalOverlay}>
            <View style={styles.detailModal}>
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle}>Security Personnel Details</Text>
                <TouchableOpacity onPress={() => setSelectedUser(null)}>
                  <Ionicons name="close" size={28} color="#fff" />
                </TouchableOpacity>
              </View>
              
              <View style={styles.detailContent}>
                <View style={[styles.detailAvatar, { backgroundColor: `${STATUS_COLORS[selectedUser.status] || '#3B82F6'}20` }]}>
                  <Ionicons name="shield-checkmark" size={48} color={STATUS_COLORS[selectedUser.status] || '#3B82F6'} />
                </View>
                
                <Text style={styles.detailName}>{selectedUser.full_name || 'Unknown'}</Text>
                
                <View style={[styles.detailStatusBadge, { backgroundColor: `${STATUS_COLORS[selectedUser.status] || '#3B82F6'}20` }]}>
                  <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[selectedUser.status] || '#3B82F6' }]} />
                  <Text style={[styles.detailStatusText, { color: STATUS_COLORS[selectedUser.status] || '#3B82F6' }]}>
                    {selectedUser.status?.toUpperCase() || 'OFFLINE'}
                  </Text>
                </View>
                
                <View style={styles.detailSection}>
                  {selectedUser.email && (
                    <View style={styles.detailRow}>
                      <Ionicons name="mail" size={18} color="#3B82F6" />
                      <Text style={styles.detailRowText}>{selectedUser.email}</Text>
                    </View>
                  )}
                  {selectedUser.phone && (
                    <View style={styles.detailRow}>
                      <Ionicons name="call" size={18} color="#10B981" />
                      <Text style={styles.detailRowText}>{selectedUser.phone}</Text>
                    </View>
                  )}
                  <View style={styles.detailRow}>
                    <Ionicons name="person" size={18} color="#F59E0B" />
                    <Text style={styles.detailRowText}>
                      {selectedUser.security_sub_role === 'supervisor' ? 'Supervisor' : 'Team Member'}
                    </Text>
                  </View>
                  {selectedUser.team_name && (
                    <View style={styles.detailRow}>
                      <Ionicons name="people" size={18} color="#8B5CF6" />
                      <Text style={styles.detailRowText}>{selectedUser.team_name}</Text>
                    </View>
                  )}
                  {selectedUser.location?.coordinates && (
                    <View style={styles.detailRow}>
                      <Ionicons name="location" size={18} color="#EF4444" />
                      <Text style={styles.detailRowText}>
                        {selectedUser.location.coordinates[1]?.toFixed(6)}, {selectedUser.location.coordinates[0]?.toFixed(6)}
                      </Text>
                    </View>
                  )}
                  {selectedUser.last_location_update && (
                    <View style={styles.detailRow}>
                      <Ionicons name="time" size={18} color="#64748B" />
                      <Text style={styles.detailRowText}>
                        Last seen: {new Date(selectedUser.last_location_update).toLocaleString()}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              
              <TouchableOpacity style={styles.closeBtn} onPress={() => setSelectedUser(null)}>
                <Text style={styles.closeBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  backBtn: { padding: 4 },
  title: { fontSize: 18, fontWeight: '600', color: '#fff' },
  map: { height: 260 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#1E293B' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, color: '#94A3B8' },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#94A3B8', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  list: { flex: 1, paddingHorizontal: 16 },
  card: { backgroundColor: '#1E293B', borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 4 },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '600', color: '#fff' },
  cardSub: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  cardCoords: { fontSize: 11, color: '#3B82F6', marginTop: 8 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: '500', textTransform: 'capitalize' },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 15, color: '#64748B', marginTop: 8 },
  
  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  detailModal: { backgroundColor: '#1E293B', borderRadius: 20, width: '100%', maxWidth: 380, overflow: 'hidden' },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, backgroundColor: '#0F172A' },
  detailTitle: { fontSize: 18, fontWeight: '600', color: '#fff' },
  detailContent: { padding: 24, alignItems: 'center' },
  detailAvatar: { width: 100, height: 100, borderRadius: 50, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  detailName: { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 8 },
  detailStatusBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginBottom: 20 },
  detailStatusText: { fontSize: 14, fontWeight: '700' },
  detailSection: { width: '100%' },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#334155' },
  detailRowText: { flex: 1, fontSize: 14, color: '#E2E8F0' },
  closeBtn: { backgroundColor: '#3B82F6', margin: 20, marginTop: 0, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  closeBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
