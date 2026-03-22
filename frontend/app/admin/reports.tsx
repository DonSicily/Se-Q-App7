import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  RefreshControl, Linking, Modal, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { Audio } from 'expo-av';
import BACKEND_URL from '../../../utils/config';


type DateFilter = 'all' | 'today' | 'last_week' | 'last_month' | 'custom';

export default function AdminReports() {
  const router = useRouter();
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');

  // Date filtering
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [customStartDate, setCustomStartDate] = useState<Date | null>(null);
  const [customEndDate, setCustomEndDate] = useState<Date | null>(null);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // Media playback
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [audioStatus, setAudioStatus] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>('idle');
  const [videoStatus, setVideoStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const soundRef = useRef<Audio.Sound | null>(null);
  const videoRef = useRef<Video>(null);

  useEffect(() => {
    // Configure audio session once on mount — critical for iOS speaker playback
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,          // Play even when silent switch is on
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,    // Use speaker, not earpiece
    }).catch(() => {});

    return () => {
      cleanupAudio();
    };
  }, []);

  useEffect(() => {
    loadReports();
  }, [typeFilter, dateFilter, customStartDate, customEndDate]);

  const cleanupAudio = async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch (_) {}
      soundRef.current = null;
    }
    setAudioStatus('idle');
  };

  const getDateRange = () => {
    const now = new Date();
    let startDate: Date | null = null;
    let endDate: Date | null = null;
    switch (dateFilter) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'last_week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'last_month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'custom':
        startDate = customStartDate;
        endDate = customEndDate;
        break;
      default:
        return '';
    }
    let params = '';
    if (startDate) params += `&start_date=${startDate.toISOString()}`;
    if (endDate) params += `&end_date=${endDate.toISOString()}`;
    return params;
  };

  const loadReports = async () => {
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/admin/login'); return; }
      const dateParams = getDateRange();
      let url = `${BACKEND_URL}/api/admin/all-reports?limit=100${dateParams}`;
      if (typeFilter) url += `&report_type=${typeFilter}`;
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      });
      setReports(response.data.reports || []);
    } catch (error: any) {
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/admin/login');
      }
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadReports();
    setRefreshing(false);
  };

  // Build absolute URL — the media endpoint is public (no auth required)
  const getMediaUrl = (fileUrl: string): string => {
    if (!fileUrl) return '';
    // Already absolute server URL
    if (fileUrl.startsWith('http')) return fileUrl;
    // Local device URI — file was never uploaded to server (old records)
    // Return empty so the player shows "unavailable" rather than a broken URL
    if (fileUrl.startsWith('file://') || fileUrl.startsWith('content://')) return '';
    // Relative server path like /api/media/audio/file.m4a
    return `${BACKEND_URL}${fileUrl.startsWith('/') ? '' : '/'}${fileUrl}`;
  };

  const isLocalUri = (fileUrl: string): boolean =>
    !!fileUrl && (fileUrl.startsWith('file://') || fileUrl.startsWith('content://'));

  // ── Audio playback ──────────────────────────────────────────────────────
  const handleAudioToggle = async (fileUrl: string) => {
    if (audioStatus === 'playing') {
      // Pause
      try { await soundRef.current?.pauseAsync(); } catch (_) {}
      setAudioStatus('paused');
      return;
    }

    if (audioStatus === 'paused' && soundRef.current) {
      // Resume
      try { await soundRef.current.playAsync(); } catch (_) {}
      setAudioStatus('playing');
      return;
    }

    // Fresh load
    await cleanupAudio();
    setAudioStatus('loading');

    try {
      const uri = getMediaUrl(fileUrl);
      console.log('[AudioPlay] Loading:', uri);

      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true, progressUpdateIntervalMillis: 500 }
      );
      soundRef.current = sound;
      setAudioStatus('playing');

      sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
        if (!status.isLoaded) {
          if (status.error) {
            console.error('[AudioPlay] Error:', status.error);
            setAudioStatus('error');
          }
          return;
        }
        if (status.didJustFinish) {
          setAudioStatus('idle');
        }
      });
    } catch (err) {
      console.error('[AudioPlay] Failed to load:', err);
      setAudioStatus('error');
    }
  };

  const stopAudio = async () => {
    await cleanupAudio();
  };

  // ── Modal helpers ───────────────────────────────────────────────────────
  const openMediaModal = async (report: any) => {
    await cleanupAudio();       // stop any currently-playing audio first
    setSelectedReport(report);
    setAudioStatus('idle');
    setVideoStatus('idle');
  };

  const closeMediaModal = async () => {
    await cleanupAudio();
    setVideoStatus('idle');
    setSelectedReport(null);
  };

  // ── Misc helpers ────────────────────────────────────────────────────────
  const getDateFilterLabel = () => {
    const labels: Record<DateFilter, string> = {
      all: 'All Time', today: 'Today', last_week: 'Last Week',
      last_month: 'Last Month',
      custom: customStartDate
        ? `${customStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${customEndDate ? ` – ${customEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`
        : 'Select Date',
    };
    return labels[dateFilter];
  };

  const handleDateFilterSelect = (filter: DateFilter) => {
    setDateFilter(filter);
    if (filter !== 'custom') {
      setCustomStartDate(null);
      setCustomEndDate(null);
      setShowDateDropdown(false);
    }
  };

  const getSenderDisplay = (item: any) => {
    if (item.is_anonymous) return { name: 'Anonymous Reporter', email: '', phone: '', isAnonymous: true };
    return {
      name: item.full_name || 'Unknown User',
      email: item.user_email || '',
      phone: item.user_phone || '',
      isAnonymous: false,
    };
  };

  // ── Card renderer ───────────────────────────────────────────────────────
  const renderReport = ({ item }: any) => {
    const sender = getSenderDisplay(item);
    const hasMedia = !!item.file_url;
    return (
      <TouchableOpacity
        style={styles.reportCard}
        onPress={() => hasMedia && openMediaModal(item)}
        activeOpacity={hasMedia ? 0.7 : 1}
      >
        <View style={styles.reportHeader}>
          <View style={[styles.typeBadge, { backgroundColor: item.type === 'video' ? '#3B82F620' : '#10B98120' }]}>
            <Ionicons name={item.type === 'video' ? 'videocam' : 'mic'} size={16} color={item.type === 'video' ? '#3B82F6' : '#10B981'} />
            <Text style={[styles.typeText, { color: item.type === 'video' ? '#3B82F6' : '#10B981' }]}>
              {item.type?.toUpperCase()}
            </Text>
          </View>
          {item.is_anonymous && (
            <View style={styles.anonymousBadge}>
              <Ionicons name="eye-off" size={14} color="#64748B" />
              <Text style={styles.anonymousText}>Anonymous</Text>
            </View>
          )}
        </View>

        <View style={styles.senderSection}>
          <View style={[styles.senderAvatar, sender.isAnonymous && { backgroundColor: '#64748B20' }]}>
            <Ionicons name={sender.isAnonymous ? 'eye-off' : 'person'} size={22} color={sender.isAnonymous ? '#64748B' : '#8B5CF6'} />
          </View>
          <View style={styles.senderInfo}>
            <Text style={styles.senderName}>{sender.name}</Text>
            {!!sender.email && <Text style={styles.senderDetail}>✉️ {sender.email}</Text>}
            {!!sender.phone && <Text style={styles.senderDetail}>📞 {sender.phone}</Text>}
          </View>
        </View>

        {!!item.caption && <Text style={styles.caption} numberOfLines={2}>{item.caption}</Text>}
        <Text style={styles.timestamp}>📅 {new Date(item.created_at).toLocaleString()}</Text>
        {item.location?.coordinates && (
          <Text style={styles.location}>
            📍 {item.location.coordinates[1]?.toFixed(4)}, {item.location.coordinates[0]?.toFixed(4)}
          </Text>
        )}
        {hasMedia && (
          <View style={styles.mediaIndicator}>
            <Ionicons name="play-circle" size={22} color="#3B82F6" />
            <Text style={styles.mediaText}>Tap to play {item.type}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // ── Audio status label ──────────────────────────────────────────────────
  const audioLabel = () => {
    switch (audioStatus) {
      case 'loading': return 'Loading…';
      case 'playing': return 'Pause';
      case 'paused':  return 'Resume';
      case 'error':   return 'Playback Error — Retry';
      default:        return 'Play Audio';
    }
  };
  const audioIcon = () => {
    switch (audioStatus) {
      case 'loading': return null;
      case 'playing': return 'pause';
      case 'paused':  return 'play';
      case 'error':   return 'refresh';
      default:        return 'play';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/admin/dashboard')}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Evidence Library</Text>
        <TouchableOpacity onPress={() => setShowDateDropdown(true)} style={styles.calendarBtn}>
          <Ionicons name="calendar-outline" size={24} color={dateFilter !== 'all' ? '#3B82F6' : '#fff'} />
        </TouchableOpacity>
      </View>

      {dateFilter !== 'all' && (
        <View style={styles.dateFilterBanner}>
          <Ionicons name="calendar" size={16} color="#3B82F6" />
          <Text style={styles.dateFilterText}>{getDateFilterLabel()}</Text>
          <TouchableOpacity onPress={() => handleDateFilterSelect('all')}>
            <Ionicons name="close-circle" size={18} color="#64748B" />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.filters}>
        {['', 'video', 'audio'].map(type => (
          <TouchableOpacity
            key={type}
            style={[styles.filterButton, typeFilter === type && styles.filterButtonActive]}
            onPress={() => setTypeFilter(type)}
          >
            <Ionicons
              name={type === 'video' ? 'videocam' : type === 'audio' ? 'mic' : 'apps'}
              size={16}
              color={typeFilter === type ? '#fff' : '#64748B'}
            />
            <Text style={[styles.filterButtonText, typeFilter === type && styles.filterButtonTextActive]}>
              {type || 'All'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={reports}
        renderItem={renderReport}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="document-outline" size={48} color="#64748B" />
            <Text style={styles.emptyText}>{loading ? 'Loading…' : 'No reports found'}</Text>
            {dateFilter !== 'all' && <Text style={styles.emptySubText}>Try adjusting your date filter</Text>}
          </View>
        }
      />

      {/* ── Date Filter Modal ──────────────────────────────────────────── */}
      <Modal visible={showDateDropdown} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowDateDropdown(false)}>
          <View style={styles.dropdownContainer}>
            <Text style={styles.dropdownTitle}>Filter by Date</Text>
            {[
              { key: 'all',        label: 'All Time',         icon: 'infinite' },
              { key: 'today',      label: 'Today',            icon: 'today' },
              { key: 'last_week',  label: 'Last Week',        icon: 'calendar' },
              { key: 'last_month', label: 'Last Month',       icon: 'calendar-outline' },
              { key: 'custom',     label: 'Custom Date Range', icon: 'options' },
            ].map(option => (
              <TouchableOpacity
                key={option.key}
                style={[styles.dropdownItem, dateFilter === option.key && styles.dropdownItemActive]}
                onPress={() => handleDateFilterSelect(option.key as DateFilter)}
              >
                <Ionicons name={option.icon as any} size={20} color={dateFilter === option.key ? '#3B82F6' : '#94A3B8'} />
                <Text style={[styles.dropdownItemText, dateFilter === option.key && styles.dropdownItemTextActive]}>
                  {option.label}
                </Text>
                {dateFilter === option.key && <Ionicons name="checkmark" size={20} color="#3B82F6" />}
              </TouchableOpacity>
            ))}
            {dateFilter === 'custom' && (
              <View style={styles.customDateSection}>
                <TouchableOpacity style={styles.datePickerButton} onPress={() => setShowStartPicker(true)}>
                  <Ionicons name="calendar" size={18} color="#3B82F6" />
                  <Text style={styles.datePickerText}>{customStartDate ? customStartDate.toLocaleDateString() : 'Start Date'}</Text>
                </TouchableOpacity>
                <Text style={styles.dateSeparator}>to</Text>
                <TouchableOpacity style={styles.datePickerButton} onPress={() => setShowEndPicker(true)}>
                  <Ionicons name="calendar" size={18} color="#3B82F6" />
                  <Text style={styles.datePickerText}>{customEndDate ? customEndDate.toLocaleDateString() : 'End Date'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.applyButton, !customStartDate && styles.applyButtonDisabled]}
                  onPress={() => setShowDateDropdown(false)}
                  disabled={!customStartDate}
                >
                  <Text style={styles.applyButtonText}>Apply</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {showStartPicker && (
        <DateTimePicker
          value={customStartDate || new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_, date) => { setShowStartPicker(false); if (date) setCustomStartDate(date); }}
          maximumDate={customEndDate || new Date()}
        />
      )}
      {showEndPicker && (
        <DateTimePicker
          value={customEndDate || new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_, date) => { setShowEndPicker(false); if (date) setCustomEndDate(date); }}
          minimumDate={customStartDate || undefined}
          maximumDate={new Date()}
        />
      )}

      {/* ── Media Playback Modal ───────────────────────────────────────── */}
      {selectedReport && (
        <Modal
          visible={true}
          animationType="slide"
          presentationStyle="pageSheet"    // Full native sheet — no transparency issues
          onRequestClose={closeMediaModal}
        >
          <SafeAreaView style={styles.mediaModal}>
            {/* Header */}
            <View style={styles.mediaHeader}>
              <TouchableOpacity onPress={closeMediaModal} style={styles.mediaCloseBtn}>
                <Ionicons name="close" size={26} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.mediaTitle}>
                {selectedReport.type === 'video' ? '🎬 Video Report' : '🎙️ Audio Report'}
              </Text>
              <View style={{ width: 40 }} />
            </View>

            {/* Sender */}
            <View style={styles.mediaSender}>
              <Ionicons name="person-circle" size={36} color="#8B5CF6" />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.mediaSenderName}>{getSenderDisplay(selectedReport).name}</Text>
                <Text style={styles.mediaSenderSub}>{new Date(selectedReport.created_at).toLocaleString()}</Text>
              </View>
            </View>

            {!!selectedReport.caption && (
              <Text style={styles.mediaCaption}>{selectedReport.caption}</Text>
            )}

            {/* ── VIDEO ─────────────────────────────────────────────────── */}
            {selectedReport.type === 'video' && !!selectedReport.file_url && (
              <View style={styles.videoWrapper}>
                <Video
                  ref={videoRef}
                  source={{ uri: getMediaUrl(selectedReport.file_url) }}
                  style={styles.videoPlayer}
                  useNativeControls
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay={false}
                  onLoadStart={() => setVideoStatus('loading')}
                  onLoad={() => setVideoStatus('ready')}
                  onError={(err) => {
                    console.error('[VideoPlay] Error:', err);
                    setVideoStatus('error');
                  }}
                />
                {videoStatus === 'loading' && (
                  <View style={styles.videoOverlay}>
                    <ActivityIndicator size="large" color="#3B82F6" />
                    <Text style={styles.videoOverlayText}>Loading video…</Text>
                  </View>
                )}
                {videoStatus === 'error' && (
                  <View style={styles.videoOverlay}>
                    <Ionicons name="warning" size={40} color="#EF4444" />
                    <Text style={styles.videoOverlayText}>Could not load video</Text>
                    <Text style={styles.videoOverlaySub}>{getMediaUrl(selectedReport.file_url)}</Text>
                  </View>
                )}
              </View>
            )}

            {/* ── AUDIO ─────────────────────────────────────────────────── */}
            {selectedReport.type === 'audio' && !!selectedReport.file_url && (
              <View style={styles.audioContainer}>
                {isLocalUri(selectedReport.file_url) ? (
                  // Old record — audio was stored as local device URI, cannot be played remotely
                  <>
                    <Ionicons name="musical-notes" size={60} color="#334155" />
                    <Text style={styles.audioLabel}>Audio Not Available</Text>
                    <View style={styles.unavailableBox}>
                      <Ionicons name="information-circle" size={18} color="#F59E0B" />
                      <Text style={styles.unavailableText}>
                        This audio was recorded before server upload was enabled.
                        New recordings will be fully playable.
                      </Text>
                    </View>
                  </>
                ) : !getMediaUrl(selectedReport.file_url) ? (
                  // No valid URL at all
                  <>
                    <Ionicons name="musical-notes" size={60} color="#334155" />
                    <Text style={styles.audioLabel}>No audio file attached</Text>
                  </>
                ) : (
                  // Server-hosted audio — fully playable
                  <>
                    <View style={styles.audioIconWrap}>
                      <Ionicons
                        name={audioStatus === 'playing' ? 'volume-high' : 'musical-notes'}
                        size={60}
                        color={audioStatus === 'playing' ? '#10B981' : '#64748B'}
                      />
                      {audioStatus === 'playing' && (
                        <View style={styles.audioWave}>
                          {[1, 2, 3, 4, 5].map(i => (
                            <View key={i} style={[styles.audioBar, { height: 8 + (i * 4) }]} />
                          ))}
                        </View>
                      )}
                    </View>

                    <Text style={styles.audioLabel}>
                      {audioStatus === 'playing' ? 'Now Playing…' : audioStatus === 'paused' ? 'Paused' : 'Audio Recording'}
                    </Text>

                    <TouchableOpacity
                      style={[
                        styles.playButton,
                        audioStatus === 'playing' && styles.pauseButton,
                        audioStatus === 'error' && styles.errorButton,
                      ]}
                      onPress={() => handleAudioToggle(selectedReport.file_url)}
                      disabled={audioStatus === 'loading'}
                    >
                      {audioStatus === 'loading' ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <>
                          <Ionicons name={audioIcon() as any} size={26} color="#fff" />
                          <Text style={styles.playButtonText}>{audioLabel()}</Text>
                        </>
                      )}
                    </TouchableOpacity>

                    {(audioStatus === 'playing' || audioStatus === 'paused') && (
                      <TouchableOpacity style={styles.stopButton} onPress={stopAudio}>
                        <Ionicons name="stop" size={20} color="#EF4444" />
                        <Text style={styles.stopText}>Stop</Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </View>
            )}

            {/* Location */}
            {selectedReport.location?.coordinates && (
              <TouchableOpacity
                style={styles.locationBtn}
                onPress={() => Linking.openURL(
                  `https://maps.google.com/?q=${selectedReport.location.coordinates[1]},${selectedReport.location.coordinates[0]}`
                )}
              >
                <Ionicons name="location" size={18} color="#3B82F6" />
                <Text style={styles.locationBtnText}>
                  View Location: {selectedReport.location.coordinates[1]?.toFixed(4)}, {selectedReport.location.coordinates[0]?.toFixed(4)}
                </Text>
              </TouchableOpacity>
            )}
          </SafeAreaView>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#0F172A' },
  header:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  title:              { fontSize: 20, fontWeight: '600', color: '#fff' },
  calendarBtn:        { padding: 4 },
  dateFilterBanner:   { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#3B82F620', marginHorizontal: 20, marginBottom: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  dateFilterText:     { flex: 1, fontSize: 14, color: '#3B82F6', fontWeight: '500' },
  filters:            { flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 8 },
  filterButton:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: '#1E293B' },
  filterButtonActive: { backgroundColor: '#8B5CF6' },
  filterButtonText:   { fontSize: 14, color: '#64748B', textTransform: 'capitalize' },
  filterButtonTextActive: { color: '#fff' },
  list:               { padding: 20, gap: 12 },

  // Report card
  reportCard:         { backgroundColor: '#1E293B', borderRadius: 16, padding: 16 },
  reportHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  typeBadge:          { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  typeText:           { fontSize: 12, fontWeight: '600' },
  anonymousBadge:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  anonymousText:      { fontSize: 12, color: '#64748B' },
  senderSection:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderRadius: 12, padding: 12, marginBottom: 12 },
  senderAvatar:       { width: 48, height: 48, borderRadius: 24, backgroundColor: '#8B5CF620', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  senderInfo:         { flex: 1 },
  senderName:         { fontSize: 16, fontWeight: '600', color: '#fff' },
  senderDetail:       { fontSize: 13, color: '#94A3B8', marginTop: 2 },
  caption:            { fontSize: 14, color: '#fff', marginBottom: 8 },
  timestamp:          { fontSize: 12, color: '#64748B', marginBottom: 4 },
  location:           { fontSize: 12, color: '#3B82F6' },
  mediaIndicator:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#334155' },
  mediaText:          { fontSize: 14, color: '#3B82F6' },
  empty:              { alignItems: 'center', paddingVertical: 40 },
  emptyText:          { fontSize: 16, color: '#64748B', marginTop: 8 },
  emptySubText:       { fontSize: 13, color: '#475569', marginTop: 4 },

  // Date dropdown
  modalOverlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  dropdownContainer:  { backgroundColor: '#1E293B', borderRadius: 20, padding: 20, width: '100%', maxWidth: 320 },
  dropdownTitle:      { fontSize: 18, fontWeight: '600', color: '#fff', marginBottom: 16, textAlign: 'center' },
  dropdownItem:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12, marginBottom: 4 },
  dropdownItemActive: { backgroundColor: '#3B82F620' },
  dropdownItemText:   { flex: 1, fontSize: 15, color: '#94A3B8' },
  dropdownItemTextActive: { color: '#fff', fontWeight: '500' },
  customDateSection:  { backgroundColor: '#0F172A', borderRadius: 12, padding: 16, marginTop: 12 },
  datePickerButton:   { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1E293B', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, marginBottom: 8 },
  datePickerText:     { fontSize: 14, color: '#E2E8F0' },
  dateSeparator:      { color: '#64748B', fontSize: 13, textAlign: 'center', marginBottom: 8 },
  applyButton:        { backgroundColor: '#3B82F6', paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  applyButtonDisabled:{ backgroundColor: '#334155' },
  applyButtonText:    { fontSize: 15, fontWeight: '600', color: '#fff' },

  // Media modal
  mediaModal:         { flex: 1, backgroundColor: '#0F172A' },
  mediaHeader:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  mediaCloseBtn:      { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1E293B', justifyContent: 'center', alignItems: 'center' },
  mediaTitle:         { fontSize: 18, fontWeight: '600', color: '#fff' },
  mediaSender:        { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  mediaSenderName:    { fontSize: 16, fontWeight: '600', color: '#fff' },
  mediaSenderSub:     { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  mediaCaption:       { fontSize: 14, color: '#CBD5E1', paddingHorizontal: 20, paddingVertical: 12 },

  // Video
  videoWrapper:       { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', position: 'relative' },
  videoPlayer:        { width: '100%', height: '100%' },
  videoOverlay:       { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  videoOverlayText:   { color: '#fff', fontSize: 16, marginTop: 12, fontWeight: '500' },
  videoOverlaySub:    { color: '#64748B', fontSize: 11, marginTop: 6, textAlign: 'center', paddingHorizontal: 20 },

  // Audio
  audioContainer:     { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24 },
  audioIconWrap:      { marginBottom: 16, alignItems: 'center' },
  audioWave:          { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginTop: 8, height: 28 },
  audioBar:           { width: 4, backgroundColor: '#10B981', borderRadius: 2 },
  audioLabel:         { fontSize: 15, color: '#94A3B8', marginBottom: 24 },
  playButton:         { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#10B981', paddingHorizontal: 28, paddingVertical: 16, borderRadius: 32, marginBottom: 16 },
  pauseButton:        { backgroundColor: '#3B82F6' },
  errorButton:        { backgroundColor: '#EF4444' },
  playButtonText:     { fontSize: 16, fontWeight: '700', color: '#fff' },
  stopButton:         { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stopText:           { fontSize: 14, color: '#EF4444', fontWeight: '500' },
  unavailableBox:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#F59E0B15', borderRadius: 12, padding: 14, marginTop: 16, borderWidth: 1, borderColor: '#F59E0B30' },
  unavailableText:    { flex: 1, fontSize: 13, color: '#F59E0B', lineHeight: 19 },

  // Location
  locationBtn:        { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, borderTopWidth: 1, borderTopColor: '#1E293B', margin: 16, backgroundColor: '#1E293B', borderRadius: 12 },
  locationBtnText:    { fontSize: 13, color: '#3B82F6', flex: 1 },
});
