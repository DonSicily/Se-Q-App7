import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  RefreshControl, Alert, ActivityIndicator, Animated, Modal, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getAuthToken, clearAuthData, getUserMetadata } from '../../utils/auth';
import DateTimePicker from '@react-native-community/datetimepicker';
import BACKEND_URL from '../../../utils/config';


// Web-compatible alert helper
const showAlert = (title: string, message: string, buttons?: Array<{text: string, onPress?: () => void, style?: string}>) => {
  if (Platform.OS === 'web') {
    const confirmed = window.confirm(`${title}\n\n${message}`);
    if (confirmed && buttons) {
      const confirmButton = buttons.find(b => b.style === 'destructive' || b.text !== 'Cancel');
      if (confirmButton?.onPress) confirmButton.onPress();
    }
  } else {
    Alert.alert(title, message, buttons);
  }
};

const CATEGORY_COLORS: Record<string, string> = {
  violence: '#EF4444', robbery: '#F97316', kidnapping: '#DC2626',
  breakin: '#8B5CF6', harassment: '#EC4899', medical: '#10B981',
  fire: '#F59E0B', other: '#64748B',
};

export default function AdminDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adminEmail, setAdminEmail] = useState('');
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Evidence Library date-range shortcut state
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [calStartDate, setCalStartDate] = useState<Date>(new Date(Date.now() - 7 * 86400000));
  const [calEndDate, setCalEndDate] = useState<Date>(new Date());
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  useEffect(() => {
    initializeDashboard();
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.04, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  const initializeDashboard = async () => {
    setLoading(true);
    const token = await getAuthToken();
    if (!token) { router.replace('/admin/login'); return; }
    const metadata = await getUserMetadata();
    if (metadata.role !== 'admin') {
      Alert.alert('Access Denied', 'Admin access required');
      router.replace('/admin/login'); return;
    }
    setAdminEmail(metadata.email || 'Admin');
    await loadData();
    setLoading(false);
  };

  const loadData = async () => {
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/admin/login'); return; }
      const res = await axios.get(`${BACKEND_URL}/api/admin/dashboard`, {
        headers: { Authorization: `Bearer ${token}` }, timeout: 15000
      });
      setStats(res.data);
    } catch (error: any) {
      if (error.response?.status === 403 || error.response?.status === 401) {
        await clearAuthData(); router.replace('/admin/login');
      }
    }
  };

  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const handleLogout = async () => {
    showAlert('Logout', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: async () => { await clearAuthData(); router.replace('/admin/login'); } }
    ]);
  };

  const openEvidenceWithDates = () => {
    const start = calStartDate.toISOString();
    const end = calEndDate.toISOString();
    setShowCalendarModal(false);
    router.push(`/admin/reports?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}` as any);
  };

  const handleClearUploads = async () => {
    showAlert('Clear All Uploads', 'This will permanently delete all audio and video report files and records. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete All',
        style: 'destructive',
        onPress: async () => {
          try {
            const token = await getAuthToken();
            const res = await axios.delete(`${BACKEND_URL}/api/admin/clear-uploads`, {
              headers: { Authorization: `Bearer ${token}` }, timeout: 30000
            });
            showAlert('✅ Cleared', res.data?.message || 'All uploads cleared.', [{ text: 'OK' }]);
            loadData();
          } catch (error: any) {
            showAlert('Error', error?.response?.data?.detail || 'Failed to clear uploads.', [{ text: 'OK' }]);
          }
        }
      }
    ]);
  };

  const handleClearPanics = async () => {
    showAlert('Clear All Panics', 'This will permanently delete ALL panic events (both active and resolved). This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete All',
        style: 'destructive',
        onPress: async () => {
          try {
            const token = await getAuthToken();
            const res = await axios.delete(`${BACKEND_URL}/api/admin/clear-panics`, {
              headers: { Authorization: `Bearer ${token}` }, timeout: 30000
            });
            showAlert('✅ Cleared', res.data?.message || 'All panics cleared.', [{ text: 'OK' }]);
            loadData();
          } catch (error: any) {
            showAlert('Error', error?.response?.data?.detail || 'Failed to clear panics.', [{ text: 'OK' }]);
          }
        }
      }
    ]);
  };

  const handleResolveTrappedPanics = async () => {
    showAlert(
      '🔓 Resolve Trapped Panics',
      'This will force-deactivate all currently active panics so they can be resolved. Panic records are preserved for audit purposes.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resolve All',
          style: 'destructive',
          onPress: async () => {
            try {
              const token = await getAuthToken();
              const res = await axios.post(`${BACKEND_URL}/api/admin/resolve-trapped-panics`, {}, {
                headers: { Authorization: `Bearer ${token}` }, timeout: 30000
              });
              showAlert('✅ Done', res.data?.message || 'All trapped panics resolved.', [{ text: 'OK' }]);
              loadData();
            } catch (error: any) {
              showAlert('Error', error?.response?.data?.detail || 'Failed to resolve panics.', [{ text: 'OK' }]);
            }
          }
        }
      ]
    );
  };

  const handleResetAllData = async () => {
    showAlert('⚠️ Reset ALL Data', 'This will permanently delete ALL panics, reports, escorts, and uploads. This is a complete data wipe and CANNOT be undone!', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'RESET ALL',
        style: 'destructive',
        onPress: async () => {
          try {
            const token = await getAuthToken();
            const res = await axios.delete(`${BACKEND_URL}/api/admin/reset-all-data`, {
              headers: { Authorization: `Bearer ${token}` }, timeout: 60000
            });
            showAlert('✅ Reset Complete', res.data?.message || 'All data has been cleared.', [{ text: 'OK' }]);
            loadData();
          } catch (error: any) {
            showAlert('Error', error?.response?.data?.detail || 'Failed to reset data.', [{ text: 'OK' }]);
          }
        }
      }
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#8B5CF6" />
          <Text style={styles.loadingText}>Loading Command Center...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const activePanics = stats?.active_panics || 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Command Center</Text>
          <Text style={styles.adminName} numberOfLines={1}>{adminEmail}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerBtn} onPress={() => router.push('/admin/audit-log')}>
            <Ionicons name="document-text-outline" size={22} color="#94A3B8" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={22} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}>

        {activePanics > 0 && (
          <Animated.View style={[styles.alertBanner, { transform: [{ scale: pulseAnim }] }]}>
            <TouchableOpacity style={styles.alertBannerInner} onPress={() => router.push('/admin/panics')}>
              <Ionicons name="alert-circle" size={22} color="#fff" />
              <Text style={styles.alertBannerText}>{activePanics} ACTIVE PANIC{activePanics > 1 ? 'S' : ''} — TAP TO RESPOND</Text>
              <Ionicons name="chevron-forward" size={20} color="#fff" />
            </TouchableOpacity>
          </Animated.View>
        )}

        <Text style={styles.sectionTitle}>Overview</Text>
        <View style={styles.statsGrid}>
          {[
            { title: 'Total Users', value: stats?.total_users || 0, icon: 'people', color: '#3B82F6', route: '/admin/users' },
            { title: 'Civil Users', value: stats?.civil_users || 0, icon: 'person', color: '#10B981', route: '/admin/users?filter=civil' },
            { title: 'Security', value: stats?.security_users || 0, icon: 'shield', color: '#F59E0B', route: '/admin/users?filter=security' },
            { title: 'Active Panics', value: activePanics, icon: 'alert-circle', color: '#EF4444', route: '/admin/panics', highlight: activePanics > 0 },
          ].map((s) => (
            <TouchableOpacity key={s.title} style={[styles.statCard, { borderLeftColor: s.color }]} onPress={() => router.push(s.route as any)}>
              <View style={[styles.statIcon, { backgroundColor: `${s.color}20` }]}>
                <Ionicons name={s.icon as any} size={22} color={s.color} />
              </View>
              <Text style={[styles.statValue, s.highlight && { color: s.color }]}>{s.value}</Text>
              <Text style={styles.statTitle}>{s.title}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.secondaryStats}>
          {[
            { label: 'Escorts', value: stats?.active_escorts || 0, icon: 'navigate', color: '#10B981' },
            { label: 'Premium', value: stats?.premium_users || 0, icon: 'star', color: '#F59E0B' },
            { label: 'Flagged', value: stats?.flagged_users || 0, icon: 'flag', color: '#EF4444' },
            { label: 'Avg Min', value: stats?.avg_response_mins || '--', icon: 'time', color: '#8B5CF6' },
          ].map((s, i, arr) => (
            <React.Fragment key={s.label}>
              <View style={styles.secStat}>
                <Ionicons name={s.icon as any} size={16} color={s.color} />
                <Text style={styles.secStatValue}>{s.value}</Text>
                <Text style={styles.secStatLabel}>{s.label}</Text>
              </View>
              {i < arr.length - 1 && <View style={styles.secDivider} />}
            </React.Fragment>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Last 24 Hours</Text>
        <View style={styles.recentStats}>
          {[
            { label: 'Panics', value: stats?.recent_24h?.panics || 0, icon: 'alert', color: '#EF4444', route: '/admin/panics' },
            { label: 'Reports', value: stats?.recent_24h?.reports || 0, icon: 'document-text', color: '#3B82F6', route: '/admin/reports' },
            { label: 'New Users', value: stats?.recent_24h?.new_users || 0, icon: 'person-add', color: '#10B981', route: '/admin/users' },
          ].map((s, i, arr) => (
            <React.Fragment key={s.label}>
              <TouchableOpacity style={styles.recentItem} onPress={() => router.push(s.route as any)}>
                <Ionicons name={s.icon as any} size={18} color={s.color} />
                <Text style={styles.recentValue}>{s.value}</Text>
                <Text style={styles.recentLabel}>{s.label}</Text>
              </TouchableOpacity>
              {i < arr.length - 1 && <View style={styles.recentDivider} />}
            </React.Fragment>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Reports Queue</Text>
        <TouchableOpacity style={styles.queueCard} onPress={() => router.push('/admin/reports')}>
          {[
            { label: 'New / Pending', count: stats?.pending_reports || 0, color: '#EF4444' },
            { label: 'Under Review', count: stats?.under_review_reports || 0, color: '#F59E0B' },
            { label: 'Resolved', count: stats?.resolved_reports || 0, color: '#10B981' },
          ].map((q) => (
            <View key={q.label} style={styles.queueItem}>
              <View style={[styles.queueDot, { backgroundColor: q.color }]} />
              <Text style={styles.queueLabel}>{q.label}</Text>
              <Text style={styles.queueCount}>{q.count}</Text>
            </View>
          ))}
        </TouchableOpacity>

        {stats?.category_breakdown?.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Incident Types — 30 Days</Text>
            <View style={styles.categoryCard}>
              {stats.category_breakdown.slice(0, 6).map((item: any) => {
                const color = CATEGORY_COLORS[item.category] || '#64748B';
                const pct = (item.count / stats.category_breakdown[0].count) * 100;
                return (
                  <View key={item.category} style={styles.categoryRow}>
                    <Text style={styles.categoryLabel}>{item.category.charAt(0).toUpperCase() + item.category.slice(1)}</Text>
                    <View style={styles.categoryBarBg}>
                      <View style={[styles.categoryBarFill, { width: `${pct}%`, backgroundColor: color }]} />
                    </View>
                    <Text style={[styles.categoryCount, { color }]}>{item.count}</Text>
                  </View>
                );
              })}
            </View>
          </>
        )}

        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          {[
            { label: 'Manage Users', icon: 'people', color: '#3B82F6', route: '/admin/users' },
            { label: 'Security Teams', icon: 'shield-checkmark', color: '#F59E0B', route: '/admin/teams' },
            { label: 'All Panics', icon: 'alert-circle', color: '#EF4444', route: '/admin/panics' },
            { label: 'Evidence Library', icon: 'videocam', color: '#10B981', route: '/admin/reports' },
            { label: 'Analytics', icon: 'bar-chart', color: '#8B5CF6', route: '/admin/analytics' },
            { label: 'Broadcast', icon: 'megaphone', color: '#EC4899', route: '/admin/broadcast' },
            { label: 'Security Map', icon: 'map', color: '#14B8A6', route: '/admin/security-map' },
            { label: 'Messaging', icon: 'chatbubbles', color: '#6366F1', route: '/admin/messaging' },
            { label: 'Track Users', icon: 'locate', color: '#F97316', route: '/admin/track-user' },
            { label: 'Invite Codes', icon: 'key', color: '#64748B', route: '/admin/invite-codes' },
            { label: 'Escort Sessions', icon: 'navigate', color: '#10B981', route: '/security/escort-sessions' },
            { label: 'Search & Export', icon: 'search', color: '#0EA5E9', route: '/admin/search' },
            { label: 'Audit Log', icon: 'document-text', color: '#475569', route: '/admin/audit-log' },
          ].map((a: any) => (
            <TouchableOpacity key={a.label} style={styles.actionCard} onPress={() => router.push(a.route as any)}>
              <View style={[styles.actionIcon, { backgroundColor: `${a.color}20` }]}>
                <Ionicons name={a.icon as any} size={26} color={a.color} />
              </View>
              <Text style={styles.actionText}>{a.label}</Text>
            </TouchableOpacity>
          ))}

          {/* Clear Uploads — Danger Zone */}
          <TouchableOpacity style={styles.dangerCard} onPress={handleClearUploads}>
            <View style={[styles.actionIcon, { backgroundColor: '#EF444420' }]}>
              <Ionicons name="trash" size={26} color="#EF4444" />
            </View>
            <Text style={[styles.actionText, { color: '#EF4444' }]}>Clear All Uploads</Text>
          </TouchableOpacity>

          {/* Resolve Trapped Panics — Phase 1.1 fix */}
          <TouchableOpacity style={styles.dangerCard} onPress={handleResolveTrappedPanics}>
            <View style={[styles.actionIcon, { backgroundColor: '#F59E0B20' }]}>
              <Ionicons name="lock-open" size={26} color="#F59E0B" />
            </View>
            <Text style={[styles.actionText, { color: '#F59E0B' }]}>Resolve Trapped Panics</Text>
          </TouchableOpacity>

          {/* Clear Panics — Danger Zone */}
          <TouchableOpacity style={styles.dangerCard} onPress={handleClearPanics}>
            <View style={[styles.actionIcon, { backgroundColor: '#F9731620' }]}>
              <Ionicons name="alert-circle" size={26} color="#F97316" />
            </View>
            <Text style={[styles.actionText, { color: '#F97316' }]}>Clear All Panics</Text>
          </TouchableOpacity>

          {/* Reset All Data — Super Danger Zone */}
          <TouchableOpacity style={[styles.dangerCard, { borderColor: '#DC262640' }]} onPress={handleResetAllData}>
            <View style={[styles.actionIcon, { backgroundColor: '#DC262620' }]}>
              <Ionicons name="nuclear" size={26} color="#DC2626" />
            </View>
            <Text style={[styles.actionText, { color: '#DC2626' }]}>Reset ALL Data</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* ── Evidence Library Calendar Modal ───────────────────────────── */}
      <Modal
        visible={showCalendarModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCalendarModal(false)}
      >
        <View style={styles.calModalOverlay}>
          <View style={styles.calModal}>
            <View style={styles.calModalHeader}>
              <Ionicons name="calendar" size={22} color="#10B981" />
              <Text style={styles.calModalTitle}>Evidence Library — Date Filter</Text>
              <TouchableOpacity onPress={() => setShowCalendarModal(false)}>
                <Ionicons name="close" size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <Text style={styles.calLabel}>Start Date</Text>
            <TouchableOpacity
              style={styles.calDateBtn}
              onPress={() => setShowStartPicker(true)}
            >
              <Ionicons name="calendar-outline" size={18} color="#3B82F6" />
              <Text style={styles.calDateText}>
                {calStartDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </Text>
            </TouchableOpacity>
            {showStartPicker && (
              <DateTimePicker
                value={calStartDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                maximumDate={calEndDate}
                onChange={(_: any, d?: Date) => {
                  setShowStartPicker(false);
                  if (d) setCalStartDate(d);
                }}
              />
            )}

            <Text style={styles.calLabel}>End Date</Text>
            <TouchableOpacity
              style={styles.calDateBtn}
              onPress={() => setShowEndPicker(true)}
            >
              <Ionicons name="calendar-outline" size={18} color="#3B82F6" />
              <Text style={styles.calDateText}>
                {calEndDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </Text>
            </TouchableOpacity>
            {showEndPicker && (
              <DateTimePicker
                value={calEndDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                minimumDate={calStartDate}
                maximumDate={new Date()}
                onChange={(_: any, d?: Date) => {
                  setShowEndPicker(false);
                  if (d) setCalEndDate(d);
                }}
              />
            )}

            {/* Quick range presets */}
            <Text style={styles.calLabel}>Quick Range</Text>
            <View style={styles.calPresets}>
              {[
                { label: 'Today',     days: 0 },
                { label: '7 Days',    days: 7 },
                { label: '30 Days',   days: 30 },
                { label: '90 Days',   days: 90 },
              ].map(p => (
                <TouchableOpacity
                  key={p.label}
                  style={styles.calPresetBtn}
                  onPress={() => {
                    const end = new Date();
                    const start = new Date(Date.now() - p.days * 86400000);
                    setCalStartDate(start);
                    setCalEndDate(end);
                  }}
                >
                  <Text style={styles.calPresetText}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.calApplyBtn} onPress={openEvidenceWithDates}>
              <Ionicons name="search" size={18} color="#fff" />
              <Text style={styles.calApplyText}>Search Evidence Library</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.calCancelBtn}
              onPress={() => router.push('/admin/reports' as any)}
            >
              <Text style={styles.calCancelText}>View All (No Filter)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#94A3B8', marginTop: 16, fontSize: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  greeting: { fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: 1 },
  adminName: { fontSize: 17, fontWeight: 'bold', color: '#fff', maxWidth: 220 },
  headerActions: { flexDirection: 'row', gap: 4 },
  headerBtn: { padding: 8 },
  content: { flex: 1, paddingHorizontal: 16 },
  alertBanner: { marginTop: 14, borderRadius: 14, overflow: 'hidden' },
  alertBannerInner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EF4444', paddingVertical: 13, paddingHorizontal: 16, gap: 10 },
  alertBannerText: { flex: 1, color: '#fff', fontWeight: '700', fontSize: 13 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 12, marginTop: 20 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  statCard: { width: '48.5%', backgroundColor: '#1E293B', borderRadius: 16, padding: 14, borderLeftWidth: 4 },
  statIcon: { width: 38, height: 38, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  statValue: { fontSize: 26, fontWeight: 'bold', color: '#fff' },
  statTitle: { fontSize: 12, color: '#64748B', marginTop: 2 },
  secondaryStats: { flexDirection: 'row', backgroundColor: '#1E293B', borderRadius: 16, padding: 14, alignItems: 'center' },
  secStat: { flex: 1, alignItems: 'center', gap: 3 },
  secStatValue: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  secStatLabel: { fontSize: 10, color: '#64748B' },
  secDivider: { width: 1, height: 34, backgroundColor: '#334155' },
  recentStats: { flexDirection: 'row', backgroundColor: '#1E293B', borderRadius: 16, padding: 16, alignItems: 'center' },
  recentItem: { flex: 1, alignItems: 'center', gap: 4 },
  recentValue: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  recentLabel: { fontSize: 11, color: '#64748B' },
  recentDivider: { width: 1, height: 38, backgroundColor: '#334155' },
  queueCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 16 },
  queueItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  queueDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  queueLabel: { flex: 1, fontSize: 14, color: '#94A3B8' },
  queueCount: { fontSize: 18, fontWeight: '700', color: '#fff' },
  categoryCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 16 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  categoryLabel: { width: 86, fontSize: 12, color: '#94A3B8' },
  categoryBarBg: { flex: 1, height: 7, backgroundColor: '#0F172A', borderRadius: 4, marginHorizontal: 8, overflow: 'hidden' },
  categoryBarFill: { height: '100%', borderRadius: 4 },
  categoryCount: { width: 26, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionCard: { width: '31%', backgroundColor: '#1E293B', borderRadius: 14, padding: 12, alignItems: 'center', gap: 8, position: 'relative' },
  dangerCard: { width: '31%', backgroundColor: '#1E293B', borderRadius: 14, padding: 12, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#EF444440' },
  actionIcon: { width: 46, height: 46, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  actionText: { fontSize: 11, color: '#94A3B8', textAlign: 'center', fontWeight: '500' },

  // Calendar modal styles
  calIconBtn: { position: 'absolute', top: 6, right: 6, backgroundColor: '#10B98120', borderRadius: 10, padding: 4 },
  calModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  calModal: { backgroundColor: '#1E293B', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  calModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  calModalTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: '#fff' },
  calLabel: { fontSize: 12, fontWeight: '600', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 16 },
  calDateBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#0F172A', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#334155' },
  calDateText: { fontSize: 15, color: '#fff', fontWeight: '500' },
  calPresets: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  calPresetBtn: { backgroundColor: '#0F172A', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#334155' },
  calPresetText: { fontSize: 13, color: '#94A3B8', fontWeight: '500' },
  calApplyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#10B981', paddingVertical: 16, borderRadius: 14, marginTop: 24 },
  calApplyText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  calCancelBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 8 },
  calCancelText: { fontSize: 14, color: '#64748B' },
});
