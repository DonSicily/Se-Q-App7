/**
 * civil/escort.tsx — Phase 3
 *
 * Security Escort now records GPS every 60 seconds via BOTH:
 *   - Foreground interval (when app is open)
 *   - Background location task (when app is closed/minimised)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { getAuthToken, getUserMetadata, clearAuthData } from '../../utils/auth';
import BACKEND_URL from '../../../utils/config';


const ESCORT_TASK = 'background-location-escort';

// ── Background task ───────────────────────────────────────────────────────────
if (!TaskManager.isTaskDefined(ESCORT_TASK)) {
  TaskManager.defineTask(ESCORT_TASK, async ({ data, error }: any) => {
    if (error) return;
    if (data?.locations?.[0]) {
      const loc = data.locations[0];
      try {
        // Background tasks can't use SecureStore; token is mirrored to AsyncStorage when escort starts.
        const token = await AsyncStorage.getItem('auth_token');
        if (token) {
          await axios.post(
            `${BACKEND_URL}/api/escort/location`,
            {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              accuracy: loc.coords.accuracy,
              timestamp: new Date().toISOString(),
            },
            { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
          );
        }
      } catch (_) {}
    }
  });
}

export default function Escort() {
  const router = useRouter();
  const [isTracking, setIsTracking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingPremium, setCheckingPremium] = useState(true);
  const [isPremium, setIsPremium] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentGps, setCurrentGps] = useState<{ lat: number; lng: number; updatedAt: string } | null>(null);
  const intervalRef = useRef<any>(null);
  const timerRef = useRef<any>(null);

  // Live elapsed timer
  useEffect(() => {
    if (isTracking && startTime) {
      const start = new Date(startTime).getTime();
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setElapsedSeconds(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isTracking, startTime]);

  useFocusEffect(
    useCallback(() => {
      checkActiveEscort();
      return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [])
  );

  const checkActiveEscort = async () => {
    setCheckingPremium(true);
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/auth/login'); return; }

      const storedEscort = await AsyncStorage.getItem('active_escort');
      if (storedEscort) {
        const data = JSON.parse(storedEscort);
        setIsTracking(true);
        setSessionId(data.session_id);
        setStartTime(data.started_at);
        startLocationTracking(token);
      }

      const metadata = await getUserMetadata();
      if (metadata.isPremium) {
        setIsPremium(true);
      } else {
        const res = await axios.get(`${BACKEND_URL}/api/user/profile`, {
          headers: { Authorization: `Bearer ${token}` }, timeout: 10000,
        });
        const premium = res.data?.is_premium === true;
        setIsPremium(premium);
        if (!premium && !storedEscort) {
          Alert.alert(
            'Premium Feature',
            'Security Escort is a premium feature. Would you like to upgrade?',
            [
              { text: 'Go Back', onPress: () => router.back() },
              { text: 'Upgrade', onPress: () => router.replace('/premium') },
            ]
          );
        }
      }
    } catch (err: any) {
      if (err?.response?.status === 401) { await clearAuthData(); router.replace('/auth/login'); }
    } finally {
      setCheckingPremium(false);
    }
  };

  const startEscort = async () => {
    if (!isPremium) { Alert.alert('Premium Required', 'Please upgrade to use Security Escort.'); return; }
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission required');
        setLoading(false);
        return;
      }
      await Location.requestBackgroundPermissionsAsync();

      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const token = await getAuthToken();
      if (!token) { router.replace('/auth/login'); return; }

      const res = await axios.post(
        `${BACKEND_URL}/api/escort/action`,
        {
          action: 'start',
          location: {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy,
            timestamp: new Date().toISOString(),
          },
        },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
      );

      const newSessionId = res.data.session_id;
      const startedAt = new Date().toISOString();

      await AsyncStorage.multiSet([
        ['active_escort', JSON.stringify({ session_id: newSessionId, started_at: startedAt })],
        ['auth_token', token],
      ]);

      setSessionId(newSessionId);
      setStartTime(startedAt);
      setIsTracking(true);
      startLocationTracking(token);

      Alert.alert('Escort Started', 'Nearby security can now track your journey safely.');
    } catch (err: any) {
      if (err?.response?.status === 401) { await clearAuthData(); router.replace('/auth/login'); return; }
      Alert.alert('Error', err.response?.data?.detail || 'Failed to start escort');
    } finally {
      setLoading(false);
    }
  };

  // Post a single GPS point to the backend and update local display
  const postGpsPoint = async (token: string) => {
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setCurrentGps({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        updatedAt: new Date().toLocaleTimeString(),
      });
      await axios.post(
        `${BACKEND_URL}/api/escort/location`,
        {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          accuracy: loc.coords.accuracy,
          timestamp: new Date().toISOString(),
        },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
      );
    } catch (err: any) {
      console.warn('[Escort] GPS post failed:', err?.response?.status, err?.response?.data?.detail);
    }
  };

  const startLocationTracking = async (token: string) => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    // ── Post IMMEDIATELY so the security page shows GPS straight away ──
    await postGpsPoint(token);

    // ── Then post every 60 seconds ─────────────────────────────────────
    intervalRef.current = setInterval(() => postGpsPoint(token), 60000);

    // Background task: 60 seconds
    try {
      const isRunning = await Location.hasStartedLocationUpdatesAsync(ESCORT_TASK).catch(() => false);
      if (!isRunning) {
        await Location.startLocationUpdatesAsync(ESCORT_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: 60000,
          distanceInterval: 0,
          foregroundService: {
            notificationTitle: '🛡 SafeGuard Escort Active',
            notificationBody: 'Security can see your location. Tap when you arrive safely.',
          },
          pausesUpdatesAutomatically: false,
        });
      }
    } catch (_) {}
  };

  const stopEscort = async () => {
    Alert.alert(
      'Arrived Safely?',
      'Stopping will remove all tracking data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, I Arrived',
          onPress: async () => {
            setLoading(true);
            try {
              if (intervalRef.current) clearInterval(intervalRef.current);
              try { await Location.stopLocationUpdatesAsync(ESCORT_TASK); } catch (_) {}

              const token = await getAuthToken();
              if (token) {
                await axios.post(
                  `${BACKEND_URL}/api/escort/action`,
                  { action: 'stop', location: { latitude: 0, longitude: 0, timestamp: new Date().toISOString() } },
                  { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
                );
              }
              await AsyncStorage.removeItem('active_escort');
              setIsTracking(false);
              setSessionId(null);
              setStartTime(null);
              Alert.alert('Arrived Safely!', 'Tracking stopped. Data will be deleted.', [
                { text: 'OK', onPress: () => router.back() },
              ]);
            } catch (_) {
              Alert.alert('Error', 'Failed to stop escort. Please try again.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const fmt = () => {
    const m = Math.floor(elapsedSeconds / 60);
    const s = elapsedSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  if (checkingPremium) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.loading}><ActivityIndicator size="large" color="#3B82F6" /><Text style={s.loadingText}>Loading...</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.title}>Security Escort</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={s.content}>
        {isTracking ? (
          <View style={s.trackingBox}>
            <View style={s.pulseWrap}>
              <View style={s.pulseOuter} />
              <View style={s.pulseInner}>
                <Ionicons name="shield-checkmark" size={60} color="#10B981" />
              </View>
            </View>
            <Text style={s.trackTitle}>Escort Active</Text>
            <Text style={s.trackSub}>Security can track your journey</Text>
            <Text style={s.elapsed}>Duration: {fmt()}</Text>

            <View style={s.gpsPanel}>
              <View style={s.gpsHeader}>
                <Ionicons name="location" size={16} color="#10B981" />
                <Text style={s.gpsTitle}>GPS Location Tracking</Text>
                <View style={s.gpsDot} />
              </View>
              {currentGps ? (
                <>
                  <Text style={s.gpsCoords}>{currentGps.lat.toFixed(6)}, {currentGps.lng.toFixed(6)}</Text>
                  <Text style={s.gpsUpdated}>Updated: {currentGps.updatedAt}</Text>
                </>
              ) : (
                <Text style={s.gpsWaiting}>Acquiring location…</Text>
              )}
              <Text style={s.gpsNote}>GPS posted to server every 60 seconds (background-safe)</Text>
            </View>

            <TouchableOpacity style={s.arrivedBtn} onPress={stopEscort} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="checkmark-circle" size={24} color="#fff" />
                  <Text style={s.arrivedText}>I've Arrived Safely</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.startBox}>
            <View style={s.iconBox}>
              <Ionicons name="walk" size={80} color="#3B82F6" />
            </View>
            <Text style={s.mainTitle}>Security Escort</Text>
            <Text style={s.desc}>
              Enable tracking so nearby security personnel can monitor your journey and ensure your safety.
            </Text>
            <View style={s.features}>
              {[
                { icon: 'location', text: 'GPS recorded every 60 seconds' },
                { icon: 'shield', text: 'Works when app is in background' },
                { icon: 'trash', text: 'Data deleted when you arrive' },
              ].map((f, i) => (
                <View key={i} style={s.feature}>
                  <Ionicons name={f.icon as any} size={20} color="#10B981" />
                  <Text style={s.featureText}>{f.text}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity style={s.startBtn} onPress={startEscort} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="play" size={24} color="#fff" />
                  <Text style={s.startText}>Start Escort</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#94A3B8', marginTop: 12 },
  content: { flex: 1, padding: 20 },
  startBox: { flex: 1, alignItems: 'center', paddingTop: 32 },
  iconBox: { width: 140, height: 140, borderRadius: 70, backgroundColor: '#1E293B', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  mainTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 12 },
  desc: { fontSize: 16, color: '#94A3B8', textAlign: 'center', lineHeight: 24, marginBottom: 28 },
  features: { width: '100%', backgroundColor: '#1E293B', borderRadius: 16, padding: 20, marginBottom: 28 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  featureText: { fontSize: 14, color: '#fff' },
  startBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#3B82F6', paddingVertical: 16, paddingHorizontal: 32, borderRadius: 12, width: '100%' },
  startText: { fontSize: 18, fontWeight: '600', color: '#fff' },
  trackingBox: { flex: 1, alignItems: 'center', paddingTop: 32 },
  pulseWrap: { position: 'relative', width: 140, height: 140, marginBottom: 24, justifyContent: 'center', alignItems: 'center' },
  pulseOuter: { position: 'absolute', width: 140, height: 140, borderRadius: 70, backgroundColor: '#10B98130' },
  pulseInner: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#10B98120', justifyContent: 'center', alignItems: 'center' },
  trackTitle: { fontSize: 28, fontWeight: 'bold', color: '#10B981', marginBottom: 8 },
  trackSub: { fontSize: 16, color: '#94A3B8', marginBottom: 12 },
  elapsed: { fontSize: 20, color: '#fff', fontWeight: '600', marginBottom: 28 },
  gpsPanel: { width: '100%', backgroundColor: '#0F172A', borderRadius: 12, padding: 14, marginBottom: 24, borderWidth: 1, borderColor: '#10B98130' },
  gpsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  gpsTitle: { fontSize: 13, fontWeight: '600', color: '#10B981', flex: 1 },
  gpsDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' },
  gpsCoords: { fontSize: 13, color: '#fff', fontFamily: 'monospace', marginBottom: 4 },
  gpsUpdated: { fontSize: 11, color: '#64748B' },
  gpsWaiting: { fontSize: 13, color: '#64748B', fontStyle: 'italic' },
  gpsNote: { fontSize: 11, color: '#475569', marginTop: 8 },
  arrivedBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#10B981', paddingVertical: 16, paddingHorizontal: 32, borderRadius: 12, width: '100%' },
  arrivedText: { fontSize: 18, fontWeight: '600', color: '#fff' },
});
