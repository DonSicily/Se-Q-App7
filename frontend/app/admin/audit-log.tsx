import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import BACKEND_URL from '../../../utils/config';


const ACTION_ICONS: Record<string, { icon: string; color: string }> = {
  clear_uploads: { icon: 'trash', color: '#EF4444' },
  broadcast: { icon: 'megaphone', color: '#EC4899' },
  deactivate_panic: { icon: 'shield-checkmark', color: '#10B981' },
  false_alarm: { icon: 'warning', color: '#F59E0B' },
  toggle_user: { icon: 'person', color: '#3B82F6' },
  flag_user: { icon: 'flag', color: '#EF4444' },
  delete_user: { icon: 'person-remove', color: '#DC2626' },
  toggle_premium: { icon: 'star', color: '#F59E0B' },
  verify_user: { icon: 'checkmark-circle', color: '#10B981' },
  add_note: { icon: 'create', color: '#8B5CF6' },
  update_report: { icon: 'document-text', color: '#3B82F6' },
};

export default function AdminAuditLog() {
  const router = useRouter();
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [skip, setSkip] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const LIMIT = 30;

  useEffect(() => { loadLogs(0); }, []);

  const loadLogs = async (offset = 0) => {
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/admin/login'); return; }
      const res = await axios.get(`${BACKEND_URL}/api/admin/audit-log?skip=${offset}&limit=${LIMIT}`, {
        headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
      });
      const newLogs = res.data.logs || [];
      setTotal(res.data.total || 0);
      if (offset === 0) setLogs(newLogs);
      else setLogs(prev => [...prev, ...newLogs]);
      setSkip(offset + newLogs.length);
    } catch (e: any) {
      if (e?.response?.status === 401 || e?.response?.status === 403) { await clearAuthData(); router.replace('/admin/login'); }
    } finally { setLoading(false); setRefreshing(false); setLoadingMore(false); }
  };

  const onRefresh = () => { setRefreshing(true); loadLogs(0); };
  const loadMore = () => {
    if (loadingMore || logs.length >= total) return;
    setLoadingMore(true);
    loadLogs(skip);
  };

  const formatAction = (action: string) => action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const renderLog = ({ item }: any) => {
    const meta = ACTION_ICONS[item.action] || { icon: 'information-circle', color: '#8B5CF6' };
    return (
      <View style={styles.logCard}>
        <View style={[styles.logIcon, { backgroundColor: `${meta.color}20` }]}>
          <Ionicons name={meta.icon as any} size={20} color={meta.color} />
        </View>
        <View style={styles.logContent}>
          <Text style={styles.logAction}>{formatAction(item.action)}</Text>
          <Text style={styles.logAdmin}>{item.admin_email || item.admin_name || 'Admin'}</Text>
          {item.target_type && item.target_id && (
            <Text style={styles.logTarget}>{item.target_type}: {item.target_id !== 'all' ? item.target_id.slice(-8) : 'all'}</Text>
          )}
          {item.details && Object.keys(item.details).length > 0 && (
            <Text style={styles.logDetails} numberOfLines={2}>
              {Object.entries(item.details).map(([k, v]) => `${k}: ${v}`).join(' · ')}
            </Text>
          )}
        </View>
        <Text style={styles.logTime}>{formatTime(item.timestamp)}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/admin/dashboard')} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Audit Log ({total})</Text>
        <TouchableOpacity onPress={onRefresh}>
          <Ionicons name="refresh" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator size="large" color="#8B5CF6" /></View>
      ) : (
        <FlatList
          data={logs}
          renderItem={renderLog}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={loadingMore ? <ActivityIndicator color="#8B5CF6" style={{ marginVertical: 16 }} /> : null}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="document-text-outline" size={64} color="#334155" />
              <Text style={styles.emptyText}>No audit log entries yet</Text>
              <Text style={styles.emptySub}>Admin actions will appear here</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  backBtn: { padding: 4 },
  title: { fontSize: 17, fontWeight: '700', color: '#fff' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16 },
  logCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#1E293B', borderRadius: 12, padding: 14, marginBottom: 10, gap: 12 },
  logIcon: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  logContent: { flex: 1 },
  logAction: { fontSize: 14, fontWeight: '600', color: '#fff', marginBottom: 2 },
  logAdmin: { fontSize: 12, color: '#94A3B8' },
  logTarget: { fontSize: 11, color: '#64748B', marginTop: 2 },
  logDetails: { fontSize: 11, color: '#475569', marginTop: 3, lineHeight: 16 },
  logTime: { fontSize: 11, color: '#475569', flexShrink: 0, textAlign: 'right' },
  empty: { alignItems: 'center', paddingVertical: 80 },
  emptyText: { fontSize: 18, color: '#64748B', marginTop: 16, fontWeight: '600' },
  emptySub: { fontSize: 14, color: '#475569', marginTop: 4 },
});
