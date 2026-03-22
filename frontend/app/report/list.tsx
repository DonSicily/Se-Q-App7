import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { Audio } from 'expo-av';
import { Video, ResizeMode } from 'expo-av';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import BACKEND_URL from '../../../utils/config';
import {
  getQueuedReports,
  removeFromQueue,
  uploadQueuedReport,
  QueuedReport,
} from '../../utils/offlineQueue';


export default function ReportList() {
  const router = useRouter();
  const [reports, setReports] = useState<any[]>([]);
  const [pendingReports, setPendingReports] = useState<QueuedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  
  // Audio player state
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  
  // Video player state
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadReports();
      loadPendingReports();
      // Load token for video playback headers
      getAuthToken().then(t => setAuthToken(t));
      return () => {
        if (currentSound) {
          currentSound.unloadAsync();
        }
      };
    }, [])
  );

  const loadReports = async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }
      
      const response = await axios.get(`${BACKEND_URL}/api/report/my-reports?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' },
        timeout: 15000
      });
      setReports(response.data || []);
    } catch (error: any) {
      console.error('[ReportList] Failed to load reports:', error?.response?.status);
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadPendingReports = async () => {
    try {
      const queued = await getQueuedReports();
      setPendingReports(queued);
    } catch (error) {
      console.error('[ReportList] Failed to load pending reports:', error);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadReports();
    loadPendingReports();
  };

  const retryUpload = async (pendingReport: QueuedReport) => {
    setRetrying(pendingReport.id);
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/auth/login'); return; }
      const success = await uploadQueuedReport(pendingReport, token);
      if (success) {
        Alert.alert('✅ Uploaded', 'Report uploaded successfully!');
        loadReports();
      } else {
        Alert.alert('Upload Failed', 'Please check your connection and try again.');
      }
      loadPendingReports();
    } catch (error: any) {
      Alert.alert('Upload Failed', error?.response?.data?.detail || 'Please try again later.');
    } finally {
      setRetrying(null);
    }
  };

  const removePendingReport = async (id: string) => {
    await removeFromQueue(id);
    loadPendingReports();
  };

  // Resolve relative server paths to absolute URLs for playback
  const resolveMediaUrl = (url: string): string => {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('file://') || url.startsWith('content://')) return ''; // old local-only record
    return `${BACKEND_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  // Audio playback functions
  const playAudio = async (audioUrl: string, reportId: string) => {
    const resolvedUrl = resolveMediaUrl(audioUrl);
    if (!resolvedUrl) {
      Alert.alert(
        'Not Available',
        'This audio was saved before server upload was enabled and cannot be played on this device.'
      );
      return;
    }
    try {
      if (playingId === reportId && currentSound) {
        if (isPaused) {
          await currentSound.playFromPositionAsync(playbackPosition);
          setIsPaused(false);
        } else {
          const status = await currentSound.getStatusAsync();
          if (status.isLoaded) {
            setPlaybackPosition(status.positionMillis);
          }
          await currentSound.pauseAsync();
          setIsPaused(true);
        }
        return;
      }

      if (currentSound) {
        await currentSound.stopAsync();
        await currentSound.unloadAsync();
        setCurrentSound(null);
        setPlayingId(null);
        setIsPaused(false);
        setPlaybackPosition(0);
      }

      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });

      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: resolvedUrl },
        { shouldPlay: true }
      );

      setCurrentSound(newSound);
      setPlayingId(reportId);
      setIsPaused(false);
      setPlaybackPosition(0);

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
      Alert.alert('Playback Error', 'Unable to play audio: ' + error.message);
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const renderPendingReport = ({ item }: { item: QueuedReport }) => (
    <View style={styles.pendingCard}>
      <View style={styles.pendingHeader}>
        <View style={styles.pendingIcon}>
          <Ionicons name={item.type === 'audio' ? 'mic' : 'cloud-offline'} size={24} color="#F59E0B" />
        </View>
        <View style={styles.pendingInfo}>
          <Text style={styles.pendingTitle}>Pending Upload — {item.type.toUpperCase()}</Text>
          <Text style={styles.pendingDate}>{formatDate(item.timestamp)}</Text>
          <Text style={styles.pendingDuration}>
            Duration: {Math.floor((item.duration_seconds || 0) / 60)}:{((item.duration_seconds || 0) % 60).toString().padStart(2, '0')}
            {item.retryCount > 0 ? `  ·  ${item.retryCount} retries` : ''}
          </Text>
          {item.caption ? <Text style={styles.pendingCaption} numberOfLines={1}>{item.caption}</Text> : null}
        </View>
      </View>
      
      <View style={styles.pendingActions}>
        <TouchableOpacity 
          style={styles.retryButton}
          onPress={() => retryUpload(item)}
          disabled={retrying === item.id}
        >
          {retrying === item.id ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.retryButtonText}>Retry Upload</Text>
            </>
          )}
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.deleteButton}
          onPress={() => {
            Alert.alert('Delete?', 'This will permanently delete this report.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => removePendingReport(item.id) }
            ]);
          }}
        >
          <Ionicons name="trash" size={18} color="#EF4444" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderReport = ({ item }: any) => {
    const reportId = item._id || item.id;
    const isPlaying = playingId === reportId;
    const isAudio = item.type === 'audio';
    const isVideo = item.type === 'video';
    
    return (
      <View style={styles.reportCard}>
        <View style={styles.reportHeader}>
          <View style={[styles.reportIcon, { backgroundColor: isVideo ? '#10B98120' : '#8B5CF620' }]}>
            <Ionicons
              name={isVideo ? 'videocam' : 'mic'}
              size={28}
              color={isVideo ? '#10B981' : '#8B5CF6'}
            />
          </View>
          <View style={styles.reportInfo}>
            <Text style={styles.reportType}>{item.type?.toUpperCase()} REPORT</Text>
            <Text style={styles.reportDate}>{formatDate(item.created_at)}</Text>
            {item.caption && (
              <Text style={styles.reportCaption} numberOfLines={2}>{item.caption}</Text>
            )}
          </View>
          <View style={[styles.statusBadge, item.uploaded ? styles.uploadedBadge : styles.pendingBadge]}>
            <Text style={[styles.statusText, item.uploaded ? styles.uploadedText : styles.pendingText]}>
              {item.uploaded ? 'Uploaded' : 'Pending'}
            </Text>
          </View>
        </View>

        {/* Playback Controls */}
        {item.file_url && (
          <View style={styles.playbackControls}>
            {isAudio && (
              <>
                <TouchableOpacity
                  style={[styles.playButton, isPlaying && !isPaused && styles.playButtonActive]}
                  onPress={() => playAudio(item.file_url, reportId)}
                >
                  <Ionicons
                    name={isPlaying ? (isPaused ? 'play' : 'pause') : 'play'}
                    size={24}
                    color={isPlaying && !isPaused ? '#fff' : '#8B5CF6'}
                  />
                  <Text style={[styles.playButtonText, isPlaying && !isPaused && styles.playButtonTextActive]}>
                    {isPlaying ? (isPaused ? 'Resume' : 'Pause') : 'Play Audio'}
                  </Text>
                </TouchableOpacity>
                
                {isPlaying && (
                  <TouchableOpacity style={styles.stopButton} onPress={stopAudio}>
                    <Ionicons name="stop" size={20} color="#EF4444" />
                  </TouchableOpacity>
                )}
              </>
            )}

            {isVideo && (
              <TouchableOpacity
                style={styles.playButton}
                onPress={() => { setVideoError(false); setVideoLoading(true); setSelectedVideo(item.file_url); }}
              >
                <Ionicons name="play-circle" size={24} color="#10B981" />
                <Text style={styles.playButtonText}>Watch Video</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  };

  // Video player modal
  if (selectedVideo) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#000' }]}>
        <View style={styles.videoHeader}>
          <TouchableOpacity onPress={() => setSelectedVideo(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.videoTitle}>Video Report</Text>
          <View style={{ width: 28 }} />
        </View>
        <View style={styles.videoContainer}>
          {videoLoading && !videoError && (
            <View style={styles.videoLoadingOverlay}>
              <ActivityIndicator size="large" color="#3B82F6" />
              <Text style={styles.videoLoadingText}>Loading video...</Text>
            </View>
          )}
          {videoError ? (
            <View style={styles.videoErrorContainer}>
              <Ionicons name="cloud-offline-outline" size={60} color="#64748B" />
              <Text style={styles.videoErrorTitle}>Video Unavailable</Text>
              <Text style={styles.videoErrorText}>This video could not be played. It may still be processing — please try again in a moment.</Text>
              <TouchableOpacity style={styles.videoRetryBtn} onPress={() => { setVideoError(false); setVideoLoading(true); }}>
                <Ionicons name="refresh" size={18} color="#fff" />
                <Text style={styles.videoRetryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Video
              source={{ 
                uri: (() => {
                  const base = selectedVideo.startsWith('http') ? selectedVideo : `${BACKEND_URL}${selectedVideo}`;
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
                console.error('[VideoPlayer] Error:', JSON.stringify(err));
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
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>My Reports ({reports.length + pendingReports.length})</Text>
        <TouchableOpacity onPress={onRefresh}>
          <Ionicons name="refresh" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3B82F6" />
        </View>
      ) : (
        <FlatList
          data={[...pendingReports.map(r => ({ ...r, isPending: true })), ...reports]}
          renderItem={({ item }) => item.isPending ? renderPendingReport({ item }) : renderReport({ item })}
          keyExtractor={(item) => item.id || item._id || String(Math.random())}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3B82F6" />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="document-text-outline" size={80} color="#64748B" />
              <Text style={styles.emptyText}>No reports yet</Text>
              <Text style={styles.emptySubtext}>Your submitted reports will appear here</Text>
            </View>
          }
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
  
  // Pending report styles
  pendingCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 16, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: '#F59E0B' },
  pendingHeader: { flexDirection: 'row', alignItems: 'center' },
  pendingIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#F59E0B20', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  pendingInfo: { flex: 1 },
  pendingTitle: { fontSize: 16, fontWeight: '600', color: '#F59E0B' },
  pendingDate: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  pendingDuration: { fontSize: 12, color: '#64748B', marginTop: 2 },
  pendingCaption: { fontSize: 12, color: '#94A3B8', marginTop: 2, fontStyle: 'italic' },
  pendingActions: { flexDirection: 'row', marginTop: 12, gap: 8 },
  retryButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#10B981', paddingVertical: 10, borderRadius: 8 },
  retryButtonText: { color: '#fff', fontWeight: '600' },
  deleteButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: '#EF444420', borderRadius: 8 },
  
  // Report card styles
  reportCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 16, marginBottom: 12 },
  reportHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  reportIcon: { width: 50, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  reportInfo: { flex: 1 },
  reportType: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 2 },
  reportDate: { fontSize: 12, color: '#64748B', marginBottom: 4 },
  reportCaption: { fontSize: 13, color: '#94A3B8', fontStyle: 'italic' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  uploadedBadge: { backgroundColor: '#10B98120' },
  pendingBadge: { backgroundColor: '#F59E0B20' },
  statusText: { fontSize: 12, fontWeight: '600' },
  uploadedText: { color: '#10B981' },
  pendingText: { color: '#F59E0B' },
  
  // Playback controls
  playbackControls: { flexDirection: 'row', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#334155', gap: 8 },
  playButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10, backgroundColor: '#0F172A', borderRadius: 8 },
  playButtonActive: { backgroundColor: '#8B5CF6' },
  playButtonText: { color: '#94A3B8', fontWeight: '500' },
  playButtonTextActive: { color: '#fff' },
  stopButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: '#EF444420', borderRadius: 8 },
  
  // Video player
  videoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, backgroundColor: '#000' },
  videoTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  videoContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  video: { width: '100%', height: 300 },
  videoLoadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000', zIndex: 2 },
  videoLoadingText: { color: '#94A3B8', marginTop: 12, fontSize: 15 },
  videoErrorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  videoErrorTitle: { color: '#fff', fontSize: 20, fontWeight: '600', marginTop: 16 },
  videoErrorText: { color: '#94A3B8', fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  videoRetryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#3B82F6', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, marginTop: 20 },
  videoRetryText: { color: '#fff', fontWeight: '600' },
  
  // Empty state
  emptyContainer: { alignItems: 'center', paddingVertical: 80 },
  emptyText: { fontSize: 18, color: '#64748B', marginTop: 16 },
  emptySubtext: { fontSize: 14, color: '#475569', marginTop: 4 },
});
