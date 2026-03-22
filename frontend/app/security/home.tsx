import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getAuthToken, clearAuthData, getUserMetadata } from '../../utils/auth';
import BACKEND_URL from '../../../utils/config';


export default function SecurityHome() {
  const router = useRouter();
  const [teamLocation, setTeamLocation] = useState<any>(null);
  const [nearbyReports, setNearbyReports] = useState([]);
  const [nearbyPanics, setNearbyPanics] = useState([]);
  const [radiusKm, setRadiusKm] = useState(10);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [agentName, setAgentName] = useState('Agent');

  useEffect(() => {
    initializeScreen();
    const interval = setInterval(loadNearbyData, 30000);
    return () => clearInterval(interval);
  }, []);

  const initializeScreen = async () => {
    setLoading(true);

    const token = await getAuthToken();
    if (!token) {
      router.replace('/auth/login');
      return;
    }

    // Do NOT block on local metadata role — AsyncStorage can return null
    // during the brief window after the PIN overlay clears.
    // The backend API calls will return 401 if the session is genuinely invalid.
    await loadAgentProfile();
    await loadTeamLocation();
    await loadNearbyData();
    setLoading(false);
  };

  const loadAgentProfile = async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      
      const response = await axios.get(`${BACKEND_URL}/api/user/profile`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });
      if (response.data?.full_name) {
        const firstName = response.data.full_name.split(' ')[0];
        setAgentName(firstName);
      }
    } catch (error) {
      console.log('[SecurityHome] Could not load profile');
    }
  };

  const loadTeamLocation = async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      
      const response = await axios.get(`${BACKEND_URL}/api/security/team-location`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });
      console.log('[SecurityHome] Team location loaded:', response.data);
      setTeamLocation(response.data);
      setRadiusKm(response.data.radius_km || 10);
    } catch (error: any) {
      console.error('[SecurityHome] Failed to load team location:', error?.response?.status);
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
      }
    }
  };

  const loadNearbyData = async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      
      console.log('[SecurityHome] Loading nearby data...');
      const [reportsRes, panicsRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/security/nearby-reports`, { 
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15000 
        }),
        axios.get(`${BACKEND_URL}/api/security/nearby-panics`, { 
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15000 
        })
      ]);
      console.log('[SecurityHome] Reports:', reportsRes.data?.length, 'Panics:', panicsRes.data?.length);
      setNearbyReports(reportsRes.data || []);
      setNearbyPanics(panicsRes.data || []);
    } catch (error: any) {
      console.error('[SecurityHome] Failed to load nearby data:', error?.response?.status);
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
      }
    }
  };

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      Alert.alert('Error', 'Please enter phone or email');
      return;
    }

    setSearchLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }
      
      console.log('[SecurityHome] Searching for:', searchTerm);
      const response = await axios.post(`${BACKEND_URL}/api/security/search-user`, 
        { search_term: searchTerm.trim() },
        { 
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15000 
        }
      );
      
      console.log('[SecurityHome] Search result:', response.data?.user_id);
      router.push({
        pathname: '/security/user-track',
        params: { userData: JSON.stringify(response.data) }
      });
    } catch (error: any) {
      console.error('[SecurityHome] Search error:', error?.response?.data);
      if (error?.response?.status === 401) {
        Alert.alert('Session Expired', 'Please login again');
        await clearAuthData();
        router.replace('/auth/login');
      } else {
        Alert.alert('Not Found', error.response?.data?.detail || 'User not found');
      }
    } finally {
      setSearchLoading(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            console.log('[SecurityHome] Logout confirmed');
            await clearAuthData();
            router.replace('/auth/login');
          }
        }
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading Dashboard...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Hello, Agent {agentName}</Text>
            <Text style={styles.appName}>Security Dashboard</Text>
          </View>
          <TouchableOpacity style={styles.settingsButton} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {(!teamLocation || (teamLocation.latitude === 0 && teamLocation.longitude === 0)) && (
          <View style={styles.warningBanner}>
            <Ionicons name="warning" size={24} color="#F59E0B" />
            <Text style={styles.warningText}>
              ⚠️ Set your team location to see nearby panics and reports!
            </Text>
          </View>
        )}

        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.quickAction} onPress={() => router.push('/security/nearby')}>
            <View style={[styles.quickActionIcon, { backgroundColor: '#F59E0B20' }]}>
              <Ionicons name="people" size={24} color="#F59E0B" />
            </View>
            <Text style={styles.quickActionText}>Nearby</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickAction} onPress={() => router.push('/security/messages')}>
            <View style={[styles.quickActionIcon, { backgroundColor: '#3B82F620' }]}>
              <Ionicons name="chatbubbles" size={24} color="#3B82F6" />
            </View>
            <Text style={styles.quickActionText}>Message Centre</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickAction} onPress={() => router.push('/security/escort-sessions')}>
            <View style={[styles.quickActionIcon, { backgroundColor: '#10B98120' }]}>
              <Ionicons name="navigate" size={24} color="#10B981" />
            </View>
            <Text style={styles.quickActionText}>Escorts</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickAction} onPress={() => router.push('/security/settings')}>
            <View style={[styles.quickActionIcon, { backgroundColor: '#8B5CF620' }]}>
              <Ionicons name="settings" size={24} color="#8B5CF6" />
            </View>
            <Text style={styles.quickActionText}>Settings</Text>
          </TouchableOpacity>
        </View>
        
        <TouchableOpacity style={styles.locationCard} onPress={() => router.push('/security/set-location')}>
          <View style={styles.cardHeader}>
            <Ionicons name="location" size={32} color="#3B82F6" />
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardTitle}>Team Location</Text>
              <Text style={styles.cardSubtitle}>
                {teamLocation && teamLocation.latitude !== 0 ? `Radius: ${radiusKm}km` : '⚠️ Not Set - Click to Set'}
              </Text>
            </View>
          </View>
          <Text style={styles.cardAction}>Tap to set/update location</Text>
        </TouchableOpacity>

        <View style={styles.searchCard}>
          <Text style={styles.sectionTitle}>Search & Track User</Text>
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={20} color="#64748B" />
            <TextInput
              style={styles.searchInput}
              placeholder="Phone or Email"
              placeholderTextColor="#64748B"
              value={searchTerm}
              onChangeText={setSearchTerm}
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.searchButton} onPress={handleSearch} disabled={searchLoading}>
              {searchLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="arrow-forward" size={20} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>🚨 Active Panics ({nearbyPanics.length})</Text>
            <TouchableOpacity onPress={() => router.push('/security/panics')}>
              <Text style={styles.viewAll}>View All</Text>
            </TouchableOpacity>
          </View>
          {nearbyPanics.length === 0 ? (
            <Text style={styles.emptyText}>No active panics nearby</Text>
          ) : (
            nearbyPanics.slice(0, 3).map((panic: any) => (
              <TouchableOpacity
                key={panic.id}
                style={styles.panicCard}
                onPress={() => router.push('/security/panics')}
              >
                <View style={styles.panicCardLeft}>
                  <Ionicons name="alert-circle" size={28} color="#EF4444" />
                  <View>
                    <Text style={styles.panicEmail}>{panic.user_email}</Text>
                    <Text style={styles.panicTime}>
                      {new Date(panic.activated_at).toLocaleTimeString()}
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#64748B" />
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Nearby Reports ({nearbyReports.length})</Text>
            <TouchableOpacity onPress={() => router.push('/security/reports')}>
              <Text style={styles.viewAll}>View All</Text>
            </TouchableOpacity>
          </View>
          {nearbyReports.length === 0 ? (
            <Text style={styles.emptyText}>No reports in your area</Text>
          ) : (
            nearbyReports.slice(0, 3).map((report: any) => (
              <TouchableOpacity
                key={report.id}
                style={styles.reportCard}
                onPress={() => router.push('/security/reports')}
              >
                <Ionicons
                  name={report.type === 'video' ? 'videocam' : 'mic'}
                  size={24}
                  color={report.type === 'video' ? '#10B981' : '#8B5CF6'}
                />
                <View style={styles.reportInfo}>
                  <Text style={styles.reportType}>{report.type.toUpperCase()} Report</Text>
                  <Text style={styles.reportCaption} numberOfLines={1}>
                    {report.caption || 'No caption'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#64748B" />
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  scrollContent: { padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  greeting: { fontSize: 16, color: '#94A3B8' },
  appName: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginTop: 4 },
  settingsButton: { padding: 8 },
  warningBanner: { backgroundColor: '#FEF3C7', borderRadius: 12, padding: 16, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#F59E0B' },
  warningText: { flex: 1, fontSize: 14, color: '#92400E', fontWeight: '600' },
  quickActions: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 24 },
  quickAction: { alignItems: 'center', gap: 8 },
  quickActionIcon: { width: 56, height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  quickActionText: { fontSize: 12, color: '#94A3B8', fontWeight: '500' },
  locationCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 20, marginBottom: 24, borderWidth: 2, borderColor: '#3B82F6' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 12 },
  cardHeaderText: { flex: 1 },
  cardTitle: { fontSize: 18, fontWeight: '600', color: '#fff', marginBottom: 4 },
  cardSubtitle: { fontSize: 14, color: '#94A3B8' },
  cardAction: { fontSize: 14, color: '#3B82F6', marginTop: 8 },
  searchCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 20, marginBottom: 24 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderRadius: 12, paddingHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: '#334155' },
  searchInput: { flex: 1, color: '#fff', fontSize: 16, paddingVertical: 14, marginLeft: 12 },
  searchButton: { backgroundColor: '#3B82F6', borderRadius: 8, padding: 10 },
  section: { marginBottom: 32 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#fff' },
  viewAll: { fontSize: 14, color: '#3B82F6', fontWeight: '600' },
  emptyText: { fontSize: 14, color: '#64748B', textAlign: 'center', paddingVertical: 24 },
  panicCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1E293B', padding: 16, borderRadius: 12, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: '#EF4444' },
  panicCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  panicEmail: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 4 },
  panicTime: { fontSize: 12, color: '#94A3B8' },
  reportCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1E293B', padding: 16, borderRadius: 12, marginBottom: 12 },
  reportInfo: { flex: 1 },
  reportType: { fontSize: 14, fontWeight: '600', color: '#fff', marginBottom: 4 },
  reportCaption: { fontSize: 12, color: '#94A3B8' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#94A3B8', marginTop: 16, fontSize: 16 },
});
