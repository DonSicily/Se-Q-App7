import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import axios from 'axios';
import Slider from '@react-native-community/slider';
import { NativeMap } from '../../components/NativeMap';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import BACKEND_URL from '../../../utils/config';


export default function SetLocation() {
  const router = useRouter();
  const [region, setRegion] = useState({ latitude: 9.0820, longitude: 8.6753, latitudeDelta: 0.1, longitudeDelta: 0.1 });
  const [markerCoords, setMarkerCoords] = useState({ latitude: 9.0820, longitude: 8.6753 });
  const [radiusKm, setRadiusKm] = useState(10);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [locationSource, setLocationSource] = useState<'gps'|'saved'|'default'>('default');
  const hasGotGPS = useRef(false);

  useEffect(() => { initializeLocation(); }, []);

  const initializeLocation = async () => {
    setLoading(true);
    const token = await getAuthToken();
    if (!token) { router.replace('/auth/login'); return; }
    // ALWAYS get fresh GPS first — do not override with stale saved location
    await getMyCurrentLocation();
    // Load radius from saved settings (but not coordinates unless GPS failed)
    await loadSavedRadius();
    setLoading(false);
  };

  const getMyCurrentLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        await loadSavedLocation();
        return;
      }
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
      const coords = { latitude: location.coords.latitude, longitude: location.coords.longitude };
      hasGotGPS.current = true;
      setMarkerCoords(coords);
      setRegion({ ...coords, latitudeDelta: 0.05, longitudeDelta: 0.05 });
      setLocationSource('gps');
    } catch (error) {
      console.error('[SetLocation] GPS failed:', error);
      await loadSavedLocation();
    } finally {
      setLocating(false);
    }
  };

  const loadSavedRadius = async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      const response = await axios.get(`${BACKEND_URL}/api/security/team-location`, {
        headers: { Authorization: `Bearer ${token}` }, timeout: 10000,
      });
      if (response.data.radius_km) setRadiusKm(response.data.radius_km);
    } catch {}
  };

  const loadSavedLocation = async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      const response = await axios.get(`${BACKEND_URL}/api/security/team-location`, {
        headers: { Authorization: `Bearer ${token}` }, timeout: 10000,
      });
      if (response.data.latitude !== 0 && response.data.longitude !== 0 && !hasGotGPS.current) {
        const coords = { latitude: response.data.latitude, longitude: response.data.longitude };
        setMarkerCoords(coords);
        setRegion({ ...coords, latitudeDelta: 0.1, longitudeDelta: 0.1 });
        setLocationSource('saved');
      }
      if (response.data.radius_km) setRadiusKm(response.data.radius_km);
    } catch (error: any) {
      if (error?.response?.status === 401) { await clearAuthData(); router.replace('/auth/login'); }
    }
  };

  const handleRefreshLocation = async () => {
    hasGotGPS.current = false;
    await getMyCurrentLocation();
  };

  const saveTeamLocation = async () => {
    setLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/auth/login'); return; }

      await axios.post(`${BACKEND_URL}/api/security/set-location`, {
        latitude: markerCoords.latitude, longitude: markerCoords.longitude, radius_km: radiusKm,
      }, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });

      // Also sync current_location for nearby queries
      await axios.post(`${BACKEND_URL}/api/security/update-location`, {
        latitude: markerCoords.latitude, longitude: markerCoords.longitude,
      }, { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 });

      Alert.alert('✅ Location Saved', 'Team location and coverage area updated.', [
        { text: 'OK', onPress: () => router.replace('/security/home') },
      ]);
    } catch (error: any) {
      if (error?.response?.status === 401) { await clearAuthData(); router.replace('/auth/login'); return; }
      Alert.alert('Error', error?.response?.data?.detail || 'Failed to save location.');
    } finally {
      setLoading(false);
    }
  };

  const sourceLabel = locationSource === 'gps' ? '📍 Live GPS' : locationSource === 'saved' ? '💾 Last Saved' : '🌐 Default';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/security/home')} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Set Team Location</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.sourceBadge}>
        <Text style={styles.sourceText}>{sourceLabel}</Text>
        <TouchableOpacity style={styles.refreshLocationBtn} onPress={handleRefreshLocation} disabled={locating}>
          {locating ? <ActivityIndicator size="small" color="#3B82F6" /> : (
            <>
              <Ionicons name="locate" size={16} color="#3B82F6" />
              <Text style={styles.refreshLocationText}>Use My Location</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <NativeMap
        region={region}
        markerCoords={markerCoords}
        radiusKm={radiusKm}
        onPress={(coords) => { setMarkerCoords(coords); setLocationSource('gps'); }}
        onMarkerChange={(coords) => setMarkerCoords(coords)}
      />

      <View style={styles.controls}>
        <View style={styles.coordinatesDisplay}>
          <Text style={styles.coordLabel}>Lat: {markerCoords.latitude.toFixed(5)}</Text>
          <Text style={styles.coordLabel}>Lng: {markerCoords.longitude.toFixed(5)}</Text>
        </View>

        <View style={styles.radiusControl}>
          <Text style={styles.radiusLabel}>Coverage Radius: {radiusKm} km</Text>
          <Slider
            style={styles.slider} minimumValue={1} maximumValue={50} step={1}
            value={radiusKm} onValueChange={setRadiusKm}
            minimumTrackTintColor="#3B82F6" maximumTrackTintColor="#334155" thumbTintColor="#3B82F6"
          />
        </View>

        <TouchableOpacity style={styles.saveButton} onPress={saveTeamLocation} disabled={loading || locating}>
          {loading ? <ActivityIndicator color="#fff" /> : (
            <>
              <Ionicons name="save" size={20} color="#fff" />
              <Text style={styles.saveButtonText}>Save Location</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.helpText}>
          Tap "Use My Location" for precise GPS fix. Tap map to adjust manually.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 20, fontWeight: '600', color: '#fff' },
  placeholder: { width: 32 },
  sourceBadge: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#1E293B', borderBottomWidth: 1, borderBottomColor: '#334155' },
  sourceText: { fontSize: 13, color: '#94A3B8', fontWeight: '500' },
  refreshLocationBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#3B82F620', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  refreshLocationText: { fontSize: 13, color: '#3B82F6', fontWeight: '600' },
  controls: { backgroundColor: '#1E293B', padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  coordinatesDisplay: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 16, backgroundColor: '#0F172A', padding: 12, borderRadius: 8 },
  coordLabel: { fontSize: 13, color: '#94A3B8', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  radiusControl: { marginBottom: 20 },
  radiusLabel: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 12 },
  slider: { width: '100%', height: 40 },
  saveButton: { flexDirection: 'row', backgroundColor: '#3B82F6', borderRadius: 12, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 },
  saveButtonText: { fontSize: 18, fontWeight: '600', color: '#fff' },
  helpText: { fontSize: 12, color: '#94A3B8', textAlign: 'center', lineHeight: 18 },
});
