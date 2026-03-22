import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Alert, RefreshControl, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { Audio } from 'expo-av';
import { Video, ResizeMode } from 'expo-av';
import { getAuthToken, clearAuthData, getUserMetadata } from '../../utils/auth';
import { LocationMapModal } from '../../components/LocationMapModal';
import BACKEND_URL from '../../../utils/config';


export default function SecurityReports() {
  const router = useRouter();
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [userRole, setUserRole] = useState<string>('security');
  const [selectedVideoUrl, setSelectedVideoUrl] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [locationModal, setLocationModal] = useState<{ visible: boolean; lat: number; lng: number; title: string } | null>(null);

  // Refresh on focus
  useFocusEffect(
    useCallback(() => {
      loadReports();
      // Load token for video playback
      getAuthToken().then(t => setAuthToken(t));
      return () => {
        // Cleanup audio on unmount
        if (currentSound) {
          currentSound.unloadAsync();
        }
      };
    }, [])
  );

  useEffect(() => {
    checkUserRole();
    const interval = setInterval(loadReports, 30000);
    return () => {
      clearInterval(interval);
      if (currentSound) {
        currentSound.unloadAsync();
      }
    };
  }, []);

  const checkUserRole = async () => {
    const metadata = await getUserMetadata();
    setUserRole(metadata.role || 'security');
  };

  const loadReports = async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }
      
      // Add cache-busting timestamp
      const response = await axios.get(`${BACKEND_URL}/api/security/nearby-reports?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' },
        timeout: 15000
      });
      console.log('[SecurityReports] Loaded', response.data?.length, 'reports');
      setReports(response.data || []);
    } catch (error: any) {
      console.error('[SecurityReports] Failed to load reports:', error?.response?.status);
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadReports();
  };

  const resolveMediaUrl = (url: string): string => {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('file://') || url.startsWith('content://')) return ''; // unplayable local URI
    return `${BACKEND_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  const playAudio = async (audioUrl: string, reportId: string) => {
    const resolvedUrl = resolveMediaUrl(audioUrl);
    if (!resolvedUrl) {
      Alert.alert('Not Available', 'This audio was recorded before server upload was enabled and cannot be played back remotely.');
      return;
    }
    try {
      // If same audio is playing, toggle pause/play
      if (playingId === reportId && currentSound) {
        if (isPaused) {
          // Resume from position
          await currentSound.playFromPositionAsync(playbackPosition);
          setIsPaused(false);
        } else {
          // Pause and save position
          const status = await currentSound.getStatusAsync();
          if (status.isLoaded) {
            setPlaybackPosition(status.positionMillis);
          }
          await currentSound.pauseAsync();
          setIsPaused(true);
        }
        return;
      }

      // Stop current audio if different
      if (currentSound) {
        await currentSound.stopAsync();
        await currentSound.unloadAsync();
        setCurrentSound(null);
        setPlayingId(null);
        setIsPaused(false);
        setPlaybackPosition(0);
      }

      // Configure audio mode
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });

      console.log('[SecurityReports] Loading audio from:', resolvedUrl);

      // Load and play new audio
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: resolvedUrl },
        { shouldPlay: true }
      );

      setCurrentSound(newSound);
      setPlayingId(reportId);
      setIsPaused(false);
      setPlaybackPosition(0);

      // Handle playback finished
      newSound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlayingId(null);
          setIsPaused(false);
          setPlaybackPosition(0);
          newSound.unloadAsync();
          setCurrentSound(null);
        }
      });
    } catch (error: any) {
      console.error('[SecurityReports] Audio playback error:', error);
      Alert.alert('Playback Error', 'Unable to play audio file. ' + error.message);
    }
  };

  const stopAudio = async () => {
    if (currentSound) {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
      setCurrentSound(null);
      setPlayingId(null);
      setIsPaused(false);
      setPlaybackPosition(0);
    }
  };

  const playVideo = (videoUrl: string) => {
    setSelectedVideoUrl(videoUrl);
  };

  const openInMaps = (latitude: number, longitude: number) => {
    const scheme = Platform.select({ ios: 'maps:', android: 'geo:' });
    const url = Platform.select({
      ios: `maps:?q=Report&ll=${latitude},${longitude}`,
      android: `geo:${latitude},${longitude}?q=${latitude},${longitude}(Report)`
    });
    if (url) {
      Linking.openURL(url);
    }
  };

  const getSenderDisplay = (item: any) => {
    if (item.is_anonymous) {
      if (userRole === 'admin') {
        return {
          name: item.sender_name || item.full_name || item.sender_email || item.user_email || 'Unknown',
          label: '(Anonymous - for discreet attendance)'
        };
      } else {
        return { name: 'Anonymous', label: '' };
      }
    }
    return { 
      name: item.sender_name || item.full_name || item.sender_email || item.user_email || 'Unknown User', 
      label: '' 
    };
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const renderReport = ({ item }: any) => {
    const sender = getSenderDisplay(item);
    const isPlaying = playingId === item._id || playingId === item.id;
    const reportId = item._id || item.id;
    
    return (
      <View style={styles.reportCard}>
        <View style={styles.reportHeader}>
          <View style={styles.reportIcon}>
            <Ionicons
              name={item.type === 'video' ? 'videocam' : 'mic'}
              size={28}
              color={item.type === 'video' ? '#10B981' : '#8B5CF6'}
            />
          </View>
          <View style={styles.reportInfo}>
            <Text style={styles.reportType}>{item.type?.toUpperCase()} REPORT</Text>
            <Text style={styles.reportSender}>{sender.name}</Text>
            {sender.label ? (
              <Text style={styles.anonymousLabel}>{sender.label}</Text>
            ) : null}
            <Text style={styles.reportDate}>{formatDate(item.created_at)}</Text>
          </View>
        </View>

        {item.caption && (
          <Text style={styles.caption}>{item.caption}</Text>
        )}

        <View style={styles.reportActions}>
          {item.type === 'audio' && item.file_url && (
            <TouchableOpacity
              style={[styles.actionButton, isPlaying && !isPaused && styles.actionButtonActive]}
              onPress={() => playAudio(item.file_url, reportId)}
            >
              <Ionicons
                name={isPlaying ? (isPaused ? 'play' : 'pause') : 'play'}
                size={20}
                color={isPlaying && !isPaused ? '#fff' : '#8B5CF6'}
              />
              <Text style={[styles.actionText, isPlaying && !isPaused && styles.actionTextActive]}>
                {isPlaying ? (isPaused ? 'Resume' : 'Pause') : 'Play'}
              </Text>
            </TouchableOpacity>
          )}

          {item.type === 'audio' && isPlaying && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={stopAudio}
            >
              <Ionicons name="stop" size={20} color="#EF4444" />
              <Text style={styles.actionText}>Stop</Text>
            </TouchableOpacity>
          )}

          {item.type === 'video' && item.file_url && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => playVideo(item.file_url)}
            >
              <Ionicons name="play-circle" size={20} color="#10B981" />
              <Text style={styles.actionText}>Watch</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              if (item.latitude && item.longitude) {
                setLocationModal({
                  visible: true,
                  lat: item.latitude,
                  lng: item.longitude,
                  title: `${item.type?.toUpperCase()} Report Location`
                });
              } else {
                Alert.alert('Location', 'Location not available for this report');
              }
            }}
          >
            <Ionicons name="location" size={20} color="#F59E0B" />
            <Text style={styles.actionText}>Location</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.respondButton]}
            onPress={() => Alert.alert('Respond', 'Response feature coming soon. You will be able to initiate contact with the reporter.')}
          >
            <Ionicons name="checkmark-circle" size={20} color="#10B981" />
            <Text style={[styles.actionText, { color: '#10B981' }]}>Respond</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Video player modal with proper authentication
  if (selectedVideoUrl) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#000' }]}>
        <View style={styles.videoHeader}>
          <TouchableOpacity onPress={() => { setSelectedVideoUrl(null); setVideoError(false); setVideoLoading(true); }}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.videoTitle}>Video Report</Text>
          <View style={{ width: 28 }} />
        </View>
        <View style={styles.videoContainer}>
          {videoLoading && !videoError && (
            <View style={styles.videoLoadingOverlay}>
              <ActivityIndicator size="large" color="#8B5CF6" />
              <Text style={styles.videoLoadingText}>Loading video...</Text>
            </View>
          )}
          {videoError ? (
            <View style={styles.videoErrorContainer}>
              <Ionicons name="cloud-offline-outline" size={60} color="#64748B" />
              <Text style={styles.videoErrorTitle}>Video Unavailable</Text>
              <Text style={styles.videoErrorText}>This video could not be played. It may still be processing.</Text>
              <TouchableOpacity style={styles.videoRetryBtn} onPress={() => { setVideoError(false); setVideoLoading(true); }}>
                <Ionicons name="refresh" size={18} color="#fff" />
                <Text style={styles.videoRetryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Video
              source={{ 
                uri: (() => {
                  const base = selectedVideoUrl.startsWith('http') ? selectedVideoUrl : `${BACKEND_URL}${selectedVideoUrl}`;
                  return authToken ? `${base}?token=${encodeURIComponent(authToken)}` : base;
                })(),
                headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : undefined,
              }}
              style={styles.video}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay
              isLooping={false}
              onReadyForDisplay={() => setVideoLoading(false)}
              onLoad={() => setVideoLoading(false)}
              onPlaybackStatusUpdate={(status: any) => {
                if (status.isLoaded) setVideoLoading(false);
              }}
              onError={(err) => {
                console.error('[SecurityVideoPlayer] Error:', JSON.stringify(err));
                setVideoLoading(false);
                setVideoError(true);
              }}
            />
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/security/home')}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Nearby Reports ({reports.length})</Text>
        <TouchableOpacity onPress={onRefresh}>
          <Ionicons name="refresh" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#8B5CF6" />
        </View>
      ) : (
        <FlatList
          data={reports}
          renderItem={renderReport}
          keyExtractor={(item) => item._id || item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="document-text-outline" size={80} color="#64748B" />
              <Text style={styles.emptyText}>No reports nearby</Text>
              <Text style={styles.emptySubtext}>Pull to refresh</Text>
            </View>
          }
        />
      )}
      
      {/* Location Map Modal */}
      {locationModal && (
        <LocationMapModal
          visible={locationModal.visible}
          onClose={() => setLocationModal(null)}
          latitude={locationModal.lat}
          longitude={locationModal.lng}
          title={locationModal.title}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  title: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 16 },
  reportCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 16, marginBottom: 12 },
  reportHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  reportIcon: { width: 50, height: 50, borderRadius: 12, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  reportInfo: { flex: 1 },
  reportType: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 4 },
  reportSender: { fontSize: 14, color: '#94A3B8', marginBottom: 2 },
  anonymousLabel: { fontSize: 12, color: '#F59E0B', fontStyle: 'italic', marginBottom: 2 },
  reportDate: { fontSize: 12, color: '#64748B' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  uploadedBadge: { backgroundColor: '#10B98120' },
  pendingBadge: { backgroundColor: '#F59E0B20' },
  statusText: { fontSize: 12, fontWeight: '600' },
  uploadedText: { color: '#10B981' },
  pendingText: { color: '#F59E0B' },
  caption: { fontSize: 14, color: '#94A3B8', marginTop: 12, fontStyle: 'italic' },
  reportActions: { flexDirection: 'row', marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#334155', gap: 8 },
  actionButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 8, backgroundColor: '#0F172A' },
  actionButtonActive: { backgroundColor: '#8B5CF6' },
  actionText: { fontSize: 13, color: '#94A3B8' },
  actionTextActive: { color: '#fff' },
  respondButton: { borderWidth: 1, borderColor: '#10B98140', backgroundColor: '#10B98110' },
  emptyContainer: { alignItems: 'center', paddingVertical: 80 },
  emptyText: { fontSize: 18, color: '#64748B', marginTop: 16 },
  emptySubtext: { fontSize: 14, color: '#475569', marginTop: 4 },
  videoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, backgroundColor: '#000' },
  videoTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  videoContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  video: { width: '100%', height: 300 },
  videoLoadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  videoLoadingText: { color: '#94A3B8', marginTop: 12 },
  videoErrorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  videoErrorTitle: { fontSize: 18, fontWeight: '600', color: '#fff', marginTop: 16 },
  videoErrorText: { fontSize: 14, color: '#94A3B8', textAlign: 'center', marginTop: 8 },
  videoRetryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#8B5CF6', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8, marginTop: 20 },
  videoRetryText: { color: '#fff', fontWeight: '600' },
});
