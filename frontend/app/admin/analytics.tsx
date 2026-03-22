import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import BACKEND_URL from '../../../utils/config';


const CAT_COLORS: Record<string, string> = {
  violence: '#EF4444', robbery: '#F97316', kidnapping: '#DC2626',
  breakin: '#8B5CF6', harassment: '#EC4899', medical: '#10B981', fire: '#F59E0B', other: '#64748B',
};

export default function AdminAnalytics() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { loadAnalytics(); }, []);

  const loadAnalytics = async () => {
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/admin/login'); return; }
      const res = await axios.get(`${BACKEND_URL}/api/admin/analytics`, {
        headers: { Authorization: `Bearer ${token}` }, timeout: 20000,
      });
      setData(res.data);
    } catch (e: any) {
      if (e?.response?.status === 401 || e?.response?.status === 403) { await clearAuthData(); router.replace('/admin/login'); }
    } finally { setLoading(false); setRefreshing(false); }
  };

  const onRefresh = () => { setRefreshing(true); loadAnalytics(); };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loading}><ActivityIndicator size="large" color="#8B5CF6" /></View>
      </SafeAreaView>
    );
  }

  const maxPanic = Math.max(...(data?.daily_panics || []).map((d: any) => d.count), 1);
  const maxUsers = Math.max(...(data?.daily_users || []).map((d: any) => d.count), 1);
  const maxCat = data?.categories?.[0]?.count || 1;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/admin/dashboard')} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Analytics</Text>
        <TouchableOpacity onPress={onRefresh}>
          <Ionicons name="refresh" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}>
        {/* Summary */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryValue}>{data?.total_panics_30d || 0}</Text>
            <Text style={styles.summaryLabel}>Panics (30d)</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={[styles.summaryValue, { color: '#10B981' }]}>{data?.false_alarm_rate || 0}%</Text>
            <Text style={styles.summaryLabel}>False Alarm Rate</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={[styles.summaryValue, { color: '#3B82F6' }]}>
              {(data?.reports_by_type || []).reduce((s: number, r: any) => s + r.count, 0)}
            </Text>
            <Text style={styles.summaryLabel}>Total Reports</Text>
          </View>
        </View>

        {/* Daily Panics Bar Chart */}
        <Text style={styles.sectionTitle}>Panic Events — Last 7 Days</Text>
        <View style={styles.chartCard}>
          <View style={styles.barChart}>
            {(data?.daily_panics || []).map((d: any, i: number) => (
              <View key={i} style={styles.barItem}>
                <Text style={styles.barValue}>{d.count}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { height: `${(d.count / maxPanic) * 100}%`, backgroundColor: '#EF4444' }]} />
                </View>
                <Text style={styles.barLabel}>{d.day}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* New Users */}
        <Text style={styles.sectionTitle}>New Users — Last 7 Days</Text>
        <View style={styles.chartCard}>
          <View style={styles.barChart}>
            {(data?.daily_users || []).map((d: any, i: number) => (
              <View key={i} style={styles.barItem}>
                <Text style={styles.barValue}>{d.count}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { height: `${(d.count / maxUsers) * 100}%`, backgroundColor: '#10B981' }]} />
                </View>
                <Text style={styles.barLabel}>{d.day}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Category Breakdown */}
        {(data?.categories || []).length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Incident Types — 30 Days</Text>
            <View style={styles.listCard}>
              {data.categories.map((cat: any) => {
                const color = CAT_COLORS[cat.category] || '#64748B';
                const pct = (cat.count / maxCat) * 100;
                return (
                  <View key={cat.category} style={styles.catRow}>
                    <Text style={styles.catLabel}>{cat.category.charAt(0).toUpperCase() + cat.category.slice(1)}</Text>
                    <View style={styles.catBarBg}>
                      <View style={[styles.catBarFill, { width: `${pct}%`, backgroundColor: color }]} />
                    </View>
                    <Text style={[styles.catCount, { color }]}>{cat.count}</Text>
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* Response Times */}
        {(data?.response_time_buckets || []).some((b: any) => b.count > 0) && (
          <>
            <Text style={styles.sectionTitle}>Response Times</Text>
            <View style={styles.listCard}>
              {data.response_time_buckets.map((b: any) => (
                <View key={b.label} style={styles.catRow}>
                  <Text style={styles.catLabel}>{b.label}</Text>
                  <View style={styles.catBarBg}>
                    <View style={[styles.catBarFill, { width: `${(b.count / Math.max(...data.response_time_buckets.map((x: any) => x.count), 1)) * 100}%`, backgroundColor: '#8B5CF6' }]} />
                  </View>
                  <Text style={[styles.catCount, { color: '#8B5CF6' }]}>{b.count}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Reports by Type */}
        <Text style={styles.sectionTitle}>Reports by Type</Text>
        <View style={styles.listCard}>
          {(data?.reports_by_type || []).map((r: any) => (
            <View key={r.type} style={styles.catRow}>
              <Text style={styles.catLabel}>{r.type}</Text>
              <View style={styles.catBarBg}>
                <View style={[styles.catBarFill, { width: `${(r.count / Math.max(...(data?.reports_by_type || [{ count: 1 }]).map((x: any) => x.count), 1)) * 100}%`, backgroundColor: r.type === 'Video' ? '#10B981' : '#8B5CF6' }]} />
              </View>
              <Text style={[styles.catCount, { color: r.type === 'Video' ? '#10B981' : '#8B5CF6' }]}>{r.count}</Text>
            </View>
          ))}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  backBtn: { padding: 4 },
  title: { fontSize: 18, fontWeight: '700', color: '#fff' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1, paddingHorizontal: 16 },
  summaryRow: { flexDirection: 'row', gap: 10, marginTop: 16, marginBottom: 4 },
  summaryCard: { flex: 1, backgroundColor: '#1E293B', borderRadius: 14, padding: 14, alignItems: 'center' },
  summaryValue: { fontSize: 26, fontWeight: 'bold', color: '#EF4444' },
  summaryLabel: { fontSize: 11, color: '#64748B', marginTop: 2, textAlign: 'center' },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#94A3B8', marginTop: 20, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  chartCard: { backgroundColor: '#1E293B', borderRadius: 14, padding: 16 },
  barChart: { flexDirection: 'row', alignItems: 'flex-end', height: 100, gap: 6 },
  barItem: { flex: 1, alignItems: 'center', height: '100%' },
  barValue: { fontSize: 11, color: '#94A3B8', marginBottom: 4 },
  barTrack: { flex: 1, width: '60%', backgroundColor: '#0F172A', borderRadius: 4, overflow: 'hidden', justifyContent: 'flex-end' },
  barFill: { width: '100%', borderRadius: 4 },
  barLabel: { fontSize: 11, color: '#64748B', marginTop: 6 },
  listCard: { backgroundColor: '#1E293B', borderRadius: 14, padding: 16 },
  catRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  catLabel: { width: 90, fontSize: 13, color: '#94A3B8' },
  catBarBg: { flex: 1, height: 8, backgroundColor: '#0F172A', borderRadius: 4, marginHorizontal: 8, overflow: 'hidden' },
  catBarFill: { height: '100%', borderRadius: 4 },
  catCount: { width: 28, fontSize: 12, fontWeight: '700', textAlign: 'right' },
});
