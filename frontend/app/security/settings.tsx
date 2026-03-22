import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Switch, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import axios from 'axios';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import BACKEND_URL from '../../../utils/config';


export default function SecuritySettings() {
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [radius, setRadius] = useState(25);
  const [isVisible, setIsVisible] = useState(true);
  const [status, setStatus] = useState('available');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const goBack = () => {
    router.replace('/security/home');
  };

  useEffect(() => {
    initializeSettings();
  }, []);

  const initializeSettings = async () => {
    setLoading(true);
    const token = await getAuthToken();
    if (!token) {
      router.replace('/auth/login');
      return;
    }
    await loadProfile();
    setLoading(false);
  };

  const loadProfile = async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      
      const response = await axios.get(`${BACKEND_URL}/api/security/profile`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });
      console.log('[SecuritySettings] Profile loaded:', response.data?.email);
      setProfile(response.data);
      setRadius(response.data.visibility_radius_km || 25);
      setIsVisible(response.data.is_visible !== false);
      setStatus(response.data.status || 'available');
    } catch (error: any) {
      console.error('[SecuritySettings] Failed to load profile:', error?.response?.status);
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
      }
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }
      
      console.log('[SecuritySettings] Saving settings...');
      await axios.put(`${BACKEND_URL}/api/security/settings`, {
        visibility_radius_km: Math.round(radius),
        is_visible: isVisible,
        status: status
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });
      console.log('[SecuritySettings] Settings saved');
      Alert.alert('Success', 'Settings saved successfully');
    } catch (error: any) {
      console.error('[SecuritySettings] Save error:', error?.response?.data);
      if (error?.response?.status === 401) {
        Alert.alert('Session Expired', 'Please login again');
        await clearAuthData();
        router.replace('/auth/login');
      } else {
        Alert.alert('Error', error.response?.data?.detail || 'Failed to save settings');
      }
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (newStatus: string) => {
    setStatus(newStatus);
    try {
      const token = await getAuthToken();
      if (!token) return;
      
      await axios.put(`${BACKEND_URL}/api/security/status`, {
        status: newStatus
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });
    } catch (error) {
      console.error('[SecuritySettings] Failed to update status:', error);
    }
  };

  const getStatusColor = (s: string) => {
    const colors: any = {
      available: '#10B981',
      busy: '#F59E0B',
      responding: '#EF4444',
      offline: '#64748B'
    };
    return colors[s] || '#64748B';
  };

  const StatusButton = ({ value, label, icon }: any) => (
    <TouchableOpacity
      style={[styles.statusButton, status === value && { backgroundColor: getStatusColor(value) + '30', borderColor: getStatusColor(value) }]}
      onPress={() => updateStatus(value)}
    >
      <Ionicons name={icon} size={24} color={status === value ? getStatusColor(value) : '#64748B'} />
      <Text style={[styles.statusButtonText, status === value && { color: getStatusColor(value) }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <TouchableOpacity onPress={saveSettings} disabled={saving}>
          <Text style={[styles.saveButton, saving && styles.saveButtonDisabled]}>
            {saving ? 'Saving...' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {/* Profile Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Profile</Text>
          <View style={styles.profileCard}>
            <View style={styles.profileAvatar}>
              <Ionicons name="shield" size={32} color="#F59E0B" />
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{profile?.full_name || profile?.email}</Text>
              <Text style={styles.profileRole}>
                {profile?.security_sub_role === 'supervisor' ? '⭐ Supervisor' : 'Team Member'}
              </Text>
              {profile?.team_name && (
                <Text style={styles.profileTeam}>Team: {profile.team_name}</Text>
              )}
            </View>
          </View>
        </View>

        {/* Status Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Status</Text>
          <View style={styles.statusGrid}>
            <StatusButton value="available" label="Available" icon="checkmark-circle" />
            <StatusButton value="busy" label="Busy" icon="time" />
            <StatusButton value="responding" label="Responding" icon="alert-circle" />
            <StatusButton value="offline" label="Offline" icon="moon" />
          </View>
        </View>

        {/* Visibility Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Visibility</Text>
          
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Show on Map</Text>
              <Text style={styles.settingDescription}>Allow other security users to see your location</Text>
            </View>
            <Switch
              value={isVisible}
              onValueChange={setIsVisible}
              trackColor={{ false: '#334155', true: '#F59E0B' }}
              thumbColor="#fff"
            />
          </View>

          <View style={styles.radiusSection}>
            <View style={styles.radiusHeader}>
              <Text style={styles.settingLabel}>Search Radius</Text>
              <Text style={styles.radiusValue}>{Math.round(radius)} km</Text>
            </View>
            <Text style={styles.settingDescription}>Distance to search for nearby security users</Text>
            <Slider
              style={styles.slider}
              minimumValue={5}
              maximumValue={100}
              step={5}
              value={radius}
              onValueChange={setRadius}
              minimumTrackTintColor="#F59E0B"
              maximumTrackTintColor="#334155"
              thumbTintColor="#F59E0B"
            />
            <View style={styles.sliderLabels}>
              <Text style={styles.sliderLabel}>5 km</Text>
              <Text style={styles.sliderLabel}>100 km</Text>
            </View>
          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/security/nearby')}>
            <Ionicons name="people" size={24} color="#F59E0B" />
            <Text style={styles.actionButtonText}>Find Nearby Security</Text>
            <Ionicons name="chevron-forward" size={20} color="#64748B" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/security/chat')}>
            <Ionicons name="chatbubbles" size={24} color="#3B82F6" />
            <Text style={styles.actionButtonText}>Messages</Text>
            <Ionicons name="chevron-forward" size={20} color="#64748B" />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 20, fontWeight: '600', color: '#fff' },
  saveButton: { fontSize: 16, color: '#F59E0B', fontWeight: '600' },
  saveButtonDisabled: { color: '#64748B' },
  content: { flex: 1 },
  section: { padding: 20, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  sectionTitle: { fontSize: 14, color: '#64748B', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 },
  profileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 16, padding: 16 },
  profileAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#F59E0B20', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 18, fontWeight: '600', color: '#fff' },
  profileRole: { fontSize: 14, color: '#94A3B8', marginTop: 2 },
  profileTeam: { fontSize: 14, color: '#64748B', marginTop: 2 },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statusButton: { width: '48%', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, backgroundColor: '#1E293B', borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  statusButtonText: { fontSize: 14, color: '#64748B', fontWeight: '500' },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1E293B', padding: 16, borderRadius: 12, marginBottom: 12 },
  settingInfo: { flex: 1, marginRight: 16 },
  settingLabel: { fontSize: 16, color: '#fff', fontWeight: '500' },
  settingDescription: { fontSize: 13, color: '#64748B', marginTop: 4 },
  radiusSection: { backgroundColor: '#1E293B', padding: 16, borderRadius: 12 },
  radiusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  radiusValue: { fontSize: 18, fontWeight: '600', color: '#F59E0B' },
  slider: { width: '100%', height: 40, marginTop: 8 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  sliderLabel: { fontSize: 12, color: '#64748B' },
  actionButton: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1E293B', padding: 16, borderRadius: 12, marginBottom: 12 },
  actionButtonText: { flex: 1, fontSize: 16, color: '#fff' },
});
