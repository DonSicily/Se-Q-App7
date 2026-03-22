import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, Alert, Dimensions, ActivityIndicator, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import axios from 'axios';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import { NativeMap } from '../../components/NativeMap';
import BACKEND_URL from '../../../utils/config';

const { width } = Dimensions.get('window');

export default function SecurityNearby() {
  const router = useRouter();
  const [nearbyUsers, setNearbyUsers] = useState<any[]>([]);
  const [myLocation, setMyLocation] = useState<any>(null);
  const [myRadius, setMyRadius] = useState(25);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [locationError, setLocationError] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');

  const goBack = () => {
    router.replace('/security/home');
  };

  useEffect(() => {
    loadNearbyUsers();
  }, []);

  const updateMyLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Location permission denied');
        return false;
      }

      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const token = await getAuthToken();
      
      if (!token) {
        router.replace('/auth/login');
        return false;
      }
      
      await axios.post(`${BACKEND_URL}/api/security/update-location`, {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });

      setMyLocation(location.coords);
      setLocationError('');
      return true;
    } catch (error: any) {
      console.error('Location update error:', error);
      setLocationError(error.message || 'Failed to update location');
      return false;
    }
  };

  const loadNearbyUsers = async () => {
    try {
      // First update our location
      await updateMyLocation();

      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }
      
      const response = await axios.get(`${BACKEND_URL}/api/security/nearby`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      });
      
      setNearbyUsers(response.data.nearby_users || []);
      setMyRadius(response.data.your_radius_km || 25);
      setMyLocation(response.data.your_location?.coordinates ? {
        longitude: response.data.your_location.coordinates[0],
        latitude: response.data.your_location.coordinates[1]
      } : null);
    } catch (error: any) {
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
      } else if (error.response?.status === 400) {
        setLocationError('Please update your location first');
      } else {
        console.error('[SecurityNearby] Failed to load nearby users:', error);
        setLocationError('Failed to load nearby security. Pull to refresh.');
      }
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadNearbyUsers();
    setRefreshing(false);
  };

  const handleUpdateLocation = async () => {
    Alert.alert('Updating Location', 'Please wait...');
    const success = await updateMyLocation();
    if (success) {
      Alert.alert('Success', 'Location updated! Refreshing nearby users...');
      await loadNearbyUsers();
    } else {
      Alert.alert('Error', 'Failed to update location. Please enable GPS.');
    }
  };

  const startChat = async (userId: string) => {
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }
      
      const response = await axios.post(`${BACKEND_URL}/api/chat/start`, 
        { to_user_id: userId },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
      );
      
      if (response.data?.conversation_id) {
        router.push(`/security/chat/${response.data.conversation_id}`);
      } else {
        Alert.alert('Error', 'Could not start conversation');
      }
    } catch (error: any) {
      console.error('[SecurityNearby] Start chat error:', error?.response?.data);
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
      } else {
        Alert.alert('Error', error.response?.data?.detail || 'Failed to start conversation');
      }
    }
  };

  const openInMaps = (latitude: number, longitude: number, label: string) => {
    const scheme = Platform.select({ ios: 'maps:', android: 'geo:' });
    const url = Platform.select({
      ios: `maps:?q=${label}&ll=${latitude},${longitude}`,
      android: `geo:${latitude},${longitude}?q=${latitude},${longitude}(${label})`
    });
    if (url) {
      Linking.openURL(url);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: any = {
      available: '#10B981',
      busy: '#F59E0B',
      responding: '#EF4444',
      offline: '#64748B'
    };
    return colors[status] || '#64748B';
  };

  // Prepare markers for the map
  const getMapMarkers = () => {
    const markers: any[] = [];
    
    // Add user's own location as red marker
    if (myLocation) {
      markers.push({
        id: 'my-location',
        latitude: myLocation.latitude,
        longitude: myLocation.longitude,
        title: 'You',
        description: 'Your current location',
        pinColor: '#EF4444'
      });
    }
    
    // Add nearby security users as blue markers
    nearbyUsers.forEach((user: any) => {
      if (user.location?.coordinates) {
        markers.push({
          id: user.id,
          latitude: user.location.coordinates[1],
          longitude: user.location.coordinates[0],
          title: user.full_name || 'Security Agent',
          description: user.status || 'Available',
          pinColor: '#3B82F6'
        });
      }
    });
    
    return markers;
  };

  const renderUser = (user: any) => (
    <View key={user.id} style={styles.userCard}>
      <View style={styles.userHeader}>
        <View style={styles.userAvatar}>
          <Ionicons name="shield" size={24} color="#F59E0B" />
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{user.full_name}</Text>
          <Text style={styles.userRole}>
            {user.security_sub_role === 'supervisor' ? '⭐ Supervisor' : 'Team Member'}
          </Text>
          {user.team_name && (
            <Text style={styles.userTeam}>Team: {user.team_name}</Text>
          )}
        </View>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(user.status) + '20' }]}>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor(user.status) }]} />
          <Text style={[styles.statusText, { color: getStatusColor(user.status) }]}>
            {user.status || 'offline'}
          </Text>
        </View>
      </View>

      <View style={styles.userActions}>
        <TouchableOpacity style={styles.actionButton} onPress={() => startChat(user.id)}>
          <Ionicons name="chatbubble" size={20} color="#3B82F6" />
          <Text style={styles.actionText}>Message</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={() => Alert.alert('Call', `Calling ${user.full_name}...`)}>
          <Ionicons name="call" size={20} color="#10B981" />
          <Text style={styles.actionText}>Call</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.actionButton} 
          onPress={() => {
            if (user.location?.coordinates) {
              openInMaps(user.location.coordinates[1], user.location.coordinates[0], user.full_name || 'Security Agent');
            } else {
              Alert.alert('Location', 'Location not available');
            }
          }}
        >
          <Ionicons name="location" size={20} color="#F59E0B" />
          <Text style={styles.actionText}>Navigate</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Nearby Security</Text>
        <View style={styles.viewToggle}>
          <TouchableOpacity 
            style={[styles.toggleButton, viewMode === 'list' && styles.toggleActive]}
            onPress={() => setViewMode('list')}
          >
            <Ionicons name="list" size={20} color={viewMode === 'list' ? '#fff' : '#64748B'} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.toggleButton, viewMode === 'map' && styles.toggleActive]}
            onPress={() => setViewMode('map')}
          >
            <Ionicons name="map" size={20} color={viewMode === 'map' ? '#fff' : '#64748B'} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Location Status */}
      <View style={styles.locationBar}>
        <View style={styles.locationInfo}>
          <Ionicons name="location" size={18} color={myLocation ? '#10B981' : '#EF4444'} />
          <Text style={styles.locationText}>
            {myLocation 
              ? `${myLocation.latitude?.toFixed(4)}, ${myLocation.longitude?.toFixed(4)}` 
              : 'Location not set'}
          </Text>
        </View>
        <TouchableOpacity style={styles.updateButton} onPress={handleUpdateLocation}>
          <Ionicons name="refresh" size={18} color="#3B82F6" />
          <Text style={styles.updateButtonText}>Update</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.radiusInfo}>
        <Ionicons name="radio-outline" size={16} color="#64748B" />
        <Text style={styles.radiusText}>Showing users within {myRadius}km radius ({nearbyUsers.length} found)</Text>
      </View>

      {locationError ? (
        <View style={styles.errorBox}>
          <Ionicons name="warning" size={24} color="#EF4444" />
          <Text style={styles.errorText}>{locationError}</Text>
        </View>
      ) : null}

      {viewMode === 'map' && myLocation ? (
        <View style={styles.mapContainer}>
          <NativeMap
            region={{
              latitude: myLocation.latitude,
              longitude: myLocation.longitude,
              latitudeDelta: 0.1,
              longitudeDelta: 0.1,
            }}
            markers={getMapMarkers()}
            style={styles.map}
          />
          <View style={styles.mapLegend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#EF4444' }]} />
              <Text style={styles.legendText}>You</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#3B82F6' }]} />
              <Text style={styles.legendText}>Security Agents</Text>
            </View>
          </View>
        </View>
      ) : (
        <ScrollView 
          style={styles.usersList}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F59E0B" />}
        >
          {nearbyUsers.length > 0 ? (
            nearbyUsers.map(renderUser)
          ) : (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={48} color="#64748B" />
              <Text style={styles.emptyText}>
                {loading ? 'Loading nearby users...' : 'No security users nearby'}
              </Text>
              <Text style={styles.emptySubtext}>
                Update your location and increase radius in settings
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 20, fontWeight: '600', color: '#fff' },
  locationBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, backgroundColor: '#1E293B' },
  locationInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locationText: { fontSize: 14, color: '#94A3B8' },
  updateButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#3B82F620', borderRadius: 8 },
  updateButtonText: { fontSize: 14, color: '#3B82F6', fontWeight: '500' },
  radiusInfo: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 8 },
  radiusText: { fontSize: 12, color: '#64748B' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 12, margin: 20, padding: 16, backgroundColor: '#EF444420', borderRadius: 12 },
  errorText: { flex: 1, fontSize: 14, color: '#EF4444' },
  usersList: { flex: 1, padding: 20 },
  userCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 16, marginBottom: 12 },
  userHeader: { flexDirection: 'row', alignItems: 'center' },
  userAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F59E0B20', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  userInfo: { flex: 1 },
  userName: { fontSize: 16, fontWeight: '600', color: '#fff' },
  userRole: { fontSize: 12, color: '#94A3B8' },
  userTeam: { fontSize: 12, color: '#64748B' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '500', textTransform: 'capitalize' },
  userActions: { flexDirection: 'row', marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#334155', gap: 8 },
  actionButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 8, backgroundColor: '#0F172A' },
  actionText: { fontSize: 13, color: '#94A3B8' },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 16, color: '#64748B', marginTop: 12 },
  emptySubtext: { fontSize: 14, color: '#475569', marginTop: 4, textAlign: 'center' },
  viewToggle: { flexDirection: 'row', backgroundColor: '#1E293B', borderRadius: 8, padding: 4 },
  toggleButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  toggleActive: { backgroundColor: '#3B82F6' },
  mapContainer: { flex: 1, margin: 16 },
  map: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  mapLegend: { flexDirection: 'row', justifyContent: 'center', gap: 20, padding: 12, backgroundColor: '#1E293B', borderRadius: 8, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendText: { fontSize: 12, color: '#94A3B8' },
});
