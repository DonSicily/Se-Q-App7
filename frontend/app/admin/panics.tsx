import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, RefreshControl, Modal, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import { NativeMap } from '../../components/NativeMap';
import BACKEND_URL from '../../../utils/config';


type DateFilter = 'all' | 'today' | 'last_week' | 'last_month' | 'last_3_months' | 'custom';

export default function AdminPanics() {
  const router = useRouter();
  const [panics, setPanics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [selectedPanic, setSelectedPanic] = useState<any>(null);
  const [locationModal, setLocationModal] = useState<{visible: boolean; lat: number; lng: number; title: string} | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadPanics();
  }, [showActiveOnly, dateFilter]);

  // Auto-refresh every 15 seconds while screen is focused
  useFocusEffect(
    useCallback(() => {
      loadPanics();
      const interval = setInterval(loadPanics, 15000);
      return () => clearInterval(interval);
    }, [showActiveOnly, dateFilter])
  );

  const getDateRange = () => {
    const now = new Date();
    let startDate: Date | null = null;
    
    switch (dateFilter) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'last_week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'last_month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'last_3_months':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        return '';
    }
    
    return startDate ? `&start_date=${startDate.toISOString()}` : '';
  };

  const loadPanics = async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/admin/login');
        return;
      }

      const dateParams = getDateRange();
      const url = `${BACKEND_URL}/api/admin/all-panics?active_only=${showActiveOnly}&limit=100${dateParams}`;
      console.log('[AdminPanics] Fetching:', url);

      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      });

      console.log('[AdminPanics] Response panics count:', response.data?.panics?.length);
      setPanics(response.data.panics || []);
      setLoadError(null);
    } catch (error: any) {
      const status = error?.response?.status;
      const detail = error?.response?.data?.detail || error?.message || 'Network error';
      console.error('[AdminPanics] Failed to load panics:', status, detail);

      if (status === 401) {
        await clearAuthData();
        router.replace('/admin/login');
      } else if (status === 403) {
        setLoadError('Admin access required. Please log in as admin.');
      } else {
        setLoadError(`Failed to load panics: ${detail}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPanics();
    setRefreshing(false);
  };

  const getCategoryInfo = (category: string) => {
    const info: any = {
      violence: { color: '#EF4444', icon: 'hand-left', label: 'Violence' },
      robbery: { color: '#F59E0B', icon: 'cash', label: 'Robbery' },
      kidnapping: { color: '#DC2626', icon: 'car', label: 'Kidnapping' },
      medical: { color: '#3B82F6', icon: 'medkit', label: 'Medical' },
      fire: { color: '#F97316', icon: 'flame', label: 'Fire' },
      harassment: { color: '#8B5CF6', icon: 'warning', label: 'Harassment' },
      other: { color: '#64748B', icon: 'alert', label: 'Other' }
    };
    return info[category] || info.other;
  };

  const getDateFilterLabel = () => {
    const labels: any = {
      'all': 'All Time',
      'today': 'Today',
      'last_week': 'Last Week',
      'last_month': 'Last Month',
      'last_3_months': 'Last 3 Months',
      'custom': 'Custom Period'
    };
    return labels[dateFilter] || 'All Time';
  };

  const handlePanicPress = (item: any) => {
    if (item.is_active) {
      setSelectedPanic(item);
    }
    // Resolved panics are not clickable
  };

  const renderPanic = ({ item }: any) => {
    const category = getCategoryInfo(item.emergency_category);
    const isActive = item.is_active;
    
    return (
      <TouchableOpacity 
        style={[styles.panicCard, isActive && styles.activeCard]}
        onPress={() => handlePanicPress(item)}
        disabled={!isActive}
        activeOpacity={isActive ? 0.7 : 1}
      >
        {/* Top row - Status and Category */}
        <View style={styles.panicTopRow}>
          <View style={[styles.statusBadge, { backgroundColor: isActive ? '#EF444420' : '#10B98120' }]}>
            <Ionicons name={isActive ? 'alert-circle' : 'checkmark-circle'} size={14} color={isActive ? '#EF4444' : '#10B981'} />
            <Text style={[styles.statusText, { color: isActive ? '#EF4444' : '#10B981' }]}>
              {isActive ? 'ACTIVE' : 'RESOLVED'}
            </Text>
          </View>
          <View style={[styles.categoryBadge, { backgroundColor: category.color + '20' }]}>
            <Ionicons name={category.icon} size={14} color={category.color} />
            <Text style={[styles.categoryText, { color: category.color }]}>{category.label}</Text>
          </View>
        </View>
        
        {/* User info */}
        <Text style={styles.userName}>{item.user_name || item.full_name || 'Unknown User'}</Text>
        <Text style={styles.userEmail}>{item.user_email || `User ID: ${item.user_id?.substring(0, 12)}...`}</Text>
        
        {/* Timestamps */}
        <View style={styles.timeInfo}>
          <Text style={styles.timestamp}>
            🕐 Started: {new Date(item.activated_at).toLocaleString()}
          </Text>
          {item.deactivated_at && (
            <Text style={styles.timestamp}>
              ✅ Ended: {new Date(item.deactivated_at).toLocaleString()}
            </Text>
          )}
        </View>
        
        {/* Location */}
        {item.location?.coordinates && (
          <Text style={styles.location}>
            📍 {item.location.coordinates[1]?.toFixed(4)}, {item.location.coordinates[0]?.toFixed(4)}
          </Text>
        )}
        
        {/* Clickable indicator for active */}
        {isActive && (
          <View style={styles.tapIndicator}>
            <Ionicons name="chevron-forward" size={16} color="#EF4444" />
            <Text style={styles.tapText}>Tap to respond</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace("/admin/dashboard")} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>All Panics</Text>
        <View style={styles.headerRight}>
          {/* Toggle Active Only */}
          <TouchableOpacity onPress={() => setShowActiveOnly(!showActiveOnly)} style={styles.headerIconBtn}>
            <Ionicons 
              name={showActiveOnly ? 'filter' : 'filter-outline'} 
              size={22} 
              color={showActiveOnly ? '#EF4444' : '#fff'} 
            />
          </TouchableOpacity>
          {/* Calendar Filter */}
          <TouchableOpacity onPress={() => setShowDateDropdown(true)} style={styles.headerIconBtn}>
            <Ionicons name="calendar-outline" size={22} color={dateFilter !== 'all' ? '#3B82F6' : '#fff'} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Filter indicators */}
      {(showActiveOnly || dateFilter !== 'all') && (
        <View style={styles.filterBanner}>
          {showActiveOnly && <Text style={styles.filterChip}>🔴 Active Only</Text>}
          {dateFilter !== 'all' && <Text style={styles.filterChip}>📅 {getDateFilterLabel()}</Text>}
        </View>
      )}

      <FlatList
        data={panics}
        renderItem={renderPanic}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            {loadError ? (
              <>
                <Ionicons name="warning" size={48} color="#EF4444" />
                <Text style={[styles.emptyText, { color: '#EF4444' }]}>Failed to Load</Text>
                <Text style={styles.emptySubtext}>{loadError}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={loadPanics}>
                  <Ionicons name="refresh" size={18} color="#fff" />
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={48} color="#10B981" />
                <Text style={styles.emptyText}>
                  {showActiveOnly ? 'No active panics' : 'No panic events recorded'}
                </Text>
              </>
            )}
          </View>
        }
      />

      {/* Date Filter Dropdown Modal */}
      <Modal visible={showDateDropdown} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowDateDropdown(false)}>
          <View style={styles.dropdownContainer}>
            <Text style={styles.dropdownTitle}>Filter by Period</Text>
            {[
              { key: 'all', label: 'All Time', icon: 'infinite' },
              { key: 'today', label: 'Today', icon: 'today' },
              { key: 'last_week', label: 'Last Week', icon: 'calendar' },
              { key: 'last_month', label: 'Last Month', icon: 'calendar-outline' },
              { key: 'last_3_months', label: 'Last 3 Months', icon: 'time' },
            ].map((option) => (
              <TouchableOpacity 
                key={option.key}
                style={[styles.dropdownItem, dateFilter === option.key && styles.dropdownItemActive]}
                onPress={() => { setDateFilter(option.key as DateFilter); setShowDateDropdown(false); }}
              >
                <Ionicons name={option.icon as any} size={20} color={dateFilter === option.key ? '#3B82F6' : '#94A3B8'} />
                <Text style={[styles.dropdownItemText, dateFilter === option.key && styles.dropdownItemTextActive]}>
                  {option.label}
                </Text>
                {dateFilter === option.key && <Ionicons name="checkmark" size={20} color="#3B82F6" />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Active Panic Detail Modal - Same as Security Dashboard */}
      {selectedPanic && (
        <Modal visible={!!selectedPanic} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.panicDetailModal}>
              <View style={styles.panicDetailHeader}>
                <Text style={styles.panicDetailTitle}>🚨 ACTIVE PANIC</Text>
                <TouchableOpacity onPress={() => setSelectedPanic(null)}>
                  <Ionicons name="close" size={28} color="#fff" />
                </TouchableOpacity>
              </View>
              
              <View style={styles.panicDetailContent}>
                <Text style={styles.detailName}>{selectedPanic.user_name || selectedPanic.full_name || 'Unknown User'}</Text>
                <Text style={styles.detailEmail}>{selectedPanic.user_email || 'No email'}</Text>
                {selectedPanic.user_phone && <Text style={styles.detailPhone}>📞 {selectedPanic.user_phone}</Text>}
                
                <View style={styles.detailCategory}>
                  <Ionicons name={getCategoryInfo(selectedPanic.emergency_category).icon} size={20} color={getCategoryInfo(selectedPanic.emergency_category).color} />
                  <Text style={[styles.detailCategoryText, { color: getCategoryInfo(selectedPanic.emergency_category).color }]}>
                    {getCategoryInfo(selectedPanic.emergency_category).label}
                  </Text>
                </View>
                
                <Text style={styles.detailTime}>
                  Started: {new Date(selectedPanic.activated_at).toLocaleString()}
                </Text>
                
                {selectedPanic.location?.coordinates && (
                  <Text style={styles.detailCoords}>
                    📍 {selectedPanic.location.coordinates[1]?.toFixed(6)}, {selectedPanic.location.coordinates[0]?.toFixed(6)}
                  </Text>
                )}
              </View>
              
              <View style={styles.panicDetailActions}>
                {selectedPanic.location?.coordinates && (
                  <TouchableOpacity 
                    style={[styles.actionBtn, { backgroundColor: '#3B82F6' }]}
                    onPress={() => {
                      setSelectedPanic(null);
                      setLocationModal({
                        visible: true,
                        lat: selectedPanic.location.coordinates[1],
                        lng: selectedPanic.location.coordinates[0],
                        title: `${selectedPanic.user_name || 'User'}'s Location`
                      });
                    }}
                  >
                    <Ionicons name="map" size={20} color="#fff" />
                    <Text style={styles.actionBtnText}>View on Map</Text>
                  </TouchableOpacity>
                )}
                
                {selectedPanic.user_phone && (
                  <>
                    <TouchableOpacity 
                      style={[styles.actionBtn, { backgroundColor: '#10B981' }]}
                      onPress={() => {
                        if (Platform.OS === 'web') {
                          window.open(`tel:${selectedPanic.user_phone}`, '_blank');
                        }
                      }}
                    >
                      <Ionicons name="call" size={20} color="#fff" />
                      <Text style={styles.actionBtnText}>Call User</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.actionBtn, { backgroundColor: '#8B5CF6' }]}
                      onPress={() => {
                        if (Platform.OS === 'web') {
                          window.open(`sms:${selectedPanic.user_phone}`, '_blank');
                        }
                        setSelectedPanic(null);
                      }}
                    >
                      <Ionicons name="chatbubble" size={20} color="#fff" />
                      <Text style={styles.actionBtnText}>Message User</Text>
                    </TouchableOpacity>
                  </>
                )}
                
                <TouchableOpacity 
                  style={[styles.actionBtn, { backgroundColor: '#334155' }]}
                  onPress={() => setSelectedPanic(null)}
                >
                  <Text style={styles.actionBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Location Map Modal */}
      {locationModal && (
        <Modal visible={locationModal.visible} animationType="slide">
          <SafeAreaView style={styles.mapModal}>
            <View style={styles.mapHeader}>
              <TouchableOpacity onPress={() => setLocationModal(null)}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.mapTitle}>{locationModal.title}</Text>
              <View style={{ width: 28 }} />
            </View>
            <NativeMap
              region={{
                latitude: locationModal.lat,
                longitude: locationModal.lng,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01
              }}
              markerCoords={{ latitude: locationModal.lat, longitude: locationModal.lng }}
              style={{ flex: 1 }}
            />
          </SafeAreaView>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: '600', color: '#fff' },
  headerRight: { flexDirection: 'row', gap: 12 },
  headerIconBtn: { padding: 4 },
  filterBanner: { flexDirection: 'row', backgroundColor: '#1E293B', paddingVertical: 10, paddingHorizontal: 20, gap: 10 },
  filterChip: { fontSize: 13, color: '#94A3B8', backgroundColor: '#0F172A', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  list: { padding: 16, gap: 12 },
  panicCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 16 },
  activeCard: { borderWidth: 2, borderColor: '#EF4444' },
  panicTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  statusText: { fontSize: 11, fontWeight: '700' },
  categoryBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  categoryText: { fontSize: 11, fontWeight: '600' },
  userName: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 2 },
  userEmail: { fontSize: 13, color: '#94A3B8', marginBottom: 8 },
  timeInfo: { marginBottom: 4 },
  timestamp: { fontSize: 12, color: '#64748B', marginBottom: 2 },
  location: { fontSize: 12, color: '#3B82F6', marginTop: 4 },
  tapIndicator: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12, justifyContent: 'flex-end' },
  tapText: { fontSize: 12, color: '#EF4444', fontWeight: '500' },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptySubtext: { fontSize: 13, color: '#94A3B8', marginTop: 6, textAlign: 'center', paddingHorizontal: 32 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EF4444', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10, marginTop: 20 },
  retryText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  emptyText: { fontSize: 16, color: '#64748B', marginTop: 12 },
  // Dropdown Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  dropdownContainer: { backgroundColor: '#1E293B', borderRadius: 20, padding: 20, width: '100%', maxWidth: 320 },
  dropdownTitle: { fontSize: 18, fontWeight: '600', color: '#fff', marginBottom: 16, textAlign: 'center' },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12, marginBottom: 4 },
  dropdownItemActive: { backgroundColor: '#3B82F620' },
  dropdownItemText: { flex: 1, fontSize: 15, color: '#94A3B8' },
  dropdownItemTextActive: { color: '#fff', fontWeight: '500' },
  // Panic Detail Modal
  panicDetailModal: { backgroundColor: '#1E293B', borderRadius: 24, width: '100%', maxWidth: 400, overflow: 'hidden' },
  panicDetailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, backgroundColor: '#EF4444' },
  panicDetailTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  panicDetailContent: { padding: 20 },
  detailName: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 4 },
  detailEmail: { fontSize: 14, color: '#94A3B8', marginBottom: 4 },
  detailPhone: { fontSize: 15, color: '#10B981', fontWeight: '600', marginBottom: 12 },
  detailCategory: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  detailCategoryText: { fontSize: 14, fontWeight: '600' },
  detailTime: { fontSize: 13, color: '#64748B', marginBottom: 4 },
  detailCoords: { fontSize: 13, color: '#3B82F6', marginTop: 8 },
  panicDetailActions: { padding: 20, gap: 10, borderTopWidth: 1, borderTopColor: '#334155' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14, borderRadius: 12 },
  actionBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  // Map Modal
  mapModal: { flex: 1, backgroundColor: '#0F172A' },
  mapHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  mapTitle: { fontSize: 18, fontWeight: '600', color: '#fff' },
});
