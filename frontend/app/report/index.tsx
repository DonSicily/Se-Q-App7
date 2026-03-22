import React, { useState, useEffect, useRef } from 'react';
import { 
  View, Text, TouchableOpacity, StyleSheet, TextInput, Alert, 
  ActivityIndicator, Switch, Animated, Dimensions,
  Modal, KeyboardAvoidingView, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Camera, CameraView } from 'expo-camera';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';
import axios from 'axios';
import Slider from '@react-native-community/slider';
import { getAuthToken } from '../../utils/auth';
import BACKEND_URL from '../../../utils/config';
import { addToQueue } from '../../utils/offlineQueue';

const MIN_RECORDING_DURATION = 2;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function VideoReport() {
  const router = useRouter();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [caption, setCaption] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const cameraRef = useRef<any>(null);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [location, setLocation] = useState<any>(null);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [savedDuration, setSavedDuration] = useState(0);
  const [recordingFileSize, setRecordingFileSize] = useState<number>(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [showCaptionModal, setShowCaptionModal] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [isOnline, setIsOnline] = useState(true);
  
  const recordingPromiseRef = useRef<Promise<any> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const durationRef = useRef(0);
  const actualStartTimeRef = useRef<number>(0);
  const intervalRef = useRef<any>(null);

  useEffect(() => {
    if (isRecording) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [isRecording]);

  useEffect(() => {
    if (isRecording && recordingStartTime) {
      intervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        setRecordingDuration(elapsed);
        durationRef.current = elapsed;
      }, 100);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRecording, recordingStartTime]);

  useEffect(() => {
    requestPermissions();
    
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected ?? true);
      console.log('[VideoReport] Network state:', state.isConnected ? 'Online' : 'Offline');
    });
    
    return () => unsubscribe();
  }, []);

  const requestPermissions = async () => {
    try {
      console.log('[VideoReport] Requesting permissions...');
      const { status: cameraStatus } = await Camera.requestCameraPermissionsAsync();
      const { status: micStatus } = await Camera.requestMicrophonePermissionsAsync();
      const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
      
      console.log('[VideoReport] Permissions:', { camera: cameraStatus, mic: micStatus, location: locationStatus });
      setHasPermission(cameraStatus === 'granted' && micStatus === 'granted');
      
      if (locationStatus === 'granted') {
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          setLocation(loc);
          console.log('[VideoReport] Location obtained:', loc.coords.latitude, loc.coords.longitude);
        } catch (err) {
          console.error('[VideoReport] Location error:', err);
        }
      }
    } catch (error) {
      console.error('[VideoReport] Permission error:', error);
      setHasPermission(false);
    }
  };

  const startRecording = async () => {
    console.log('[VideoReport] startRecording called');
    console.log('[VideoReport] Camera ref exists:', !!cameraRef.current);
    console.log('[VideoReport] Camera ready:', cameraReady);
    
    if (!cameraRef.current || !cameraReady) {
      Alert.alert('Please Wait', 'Camera is still initializing...');
      return;
    }

    // Get location in background - don't block recording
    if (!location) {
      console.log('[VideoReport] Getting location in background...');
      Location.getCurrentPositionAsync({ 
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 5000,
      }).then(loc => {
        setLocation(loc);
        console.log('[VideoReport] Background location obtained:', loc.coords.latitude, loc.coords.longitude);
      }).catch(err => {
        console.warn('[VideoReport] Background location failed (non-blocking):', err);
      });
    }

    durationRef.current = 0;
    setRecordingDuration(0);
    setSavedDuration(0);
    setRecordingUri(null);
    
    const startTime = Date.now();
    actualStartTimeRef.current = startTime;
    setIsRecording(true);
    setRecordingStartTime(startTime);
    
    try {
      console.log('[VideoReport] Starting camera.recordAsync() with compression...');
      recordingPromiseRef.current = cameraRef.current.recordAsync({ 
        maxDuration: 180, // 3 min max
        // Use lowest quality available for smallest file size
        // Note: 'quality' values differ by platform - Android uses CamcorderProfile
        quality: '480p',  // 480p is more universally supported than 360p
        mute: false,
        // Lower bitrate for smaller files - target ~2MB per minute
        videoBitrate: 500000, // 500 Kbps (0.5 Mbps)
        // For codec control (if supported)
        codec: 'avc1', // H.264 codec for better compression
      });
      
      const video = await recordingPromiseRef.current;
      
      const endTime = Date.now();
      const calculatedDuration = Math.floor((endTime - actualStartTimeRef.current) / 1000);
      const refDuration = durationRef.current;
      const finalDuration = Math.max(calculatedDuration, refDuration, 2);
      
      console.log('[VideoReport] Recording finished.');
      console.log('[VideoReport] Durations - Calculated:', calculatedDuration, 'Ref:', refDuration, 'Final:', finalDuration);
      
      if (video && video.uri) {
        const fileInfo = await FileSystem.getInfoAsync(video.uri);
        const fileSizeMB = fileInfo.size ? (fileInfo.size / (1024 * 1024)) : 0;
        console.log('[VideoReport] File info - Size:', fileInfo.size, 'bytes (', fileSizeMB.toFixed(2), 'MB), Exists:', fileInfo.exists);
        
        if (fileInfo.exists && fileInfo.size && fileInfo.size > 0) {
          setRecordingUri(video.uri);
          setRecordingFileSize(fileInfo.size);
          setSavedDuration(finalDuration);
          setShowCaptionModal(true);
          console.log('[VideoReport] ✅ Video saved successfully - Size:', fileSizeMB.toFixed(2), 'MB');
        } else {
          throw new Error('Video file is empty or invalid');
        }
      } else {
        throw new Error('No video URI returned');
      }
    } catch (error: any) {
      console.error('[VideoReport] Recording error:', error);
      if (!error?.message?.toLowerCase().includes('stopped')) {
        Alert.alert('Recording Error', error?.message || 'Failed to record video.');
      }
    } finally {
      setIsRecording(false);
      setRecordingStartTime(null);
      recordingPromiseRef.current = null;
      actualStartTimeRef.current = 0;
    }
  };

  const stopRecording = async () => {
    if (!isRecording) {
      console.log('[VideoReport] stopRecording: Not recording, ignoring');
      return;
    }
    
    const currentDuration = durationRef.current;
    console.log('[VideoReport] stopRecording called, duration:', currentDuration);
    
    if (currentDuration < MIN_RECORDING_DURATION) {
      Alert.alert('Recording Too Short', `Please record for at least ${MIN_RECORDING_DURATION} seconds.`);
      return;
    }
    
    try {
      if (cameraRef.current) {
        console.log('[VideoReport] Calling cameraRef.stopRecording()');
        await cameraRef.current.stopRecording();
        console.log('[VideoReport] stopRecording() completed');
      } else {
        console.warn('[VideoReport] Camera ref not available during stop');
      }
    } catch (error: any) {
      console.error('[VideoReport] Error stopping recording:', error);
      // Even if stop fails, the recording promise should resolve/reject
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const onCameraReady = () => {
    console.log('[VideoReport] ✅ Camera ready callback fired');
    // Delay ensures camera hardware is fully initialized before recording is allowed
    setTimeout(() => {
      setCameraReady(true);
    }, 800);
  };

  const toggleFacing = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  const submitReport = async () => {
    if (!recordingUri) {
      Alert.alert('Error', 'Please record a video first');
      return;
    }

    const finalDuration = savedDuration;
    
    if (finalDuration === 0 || finalDuration < MIN_RECORDING_DURATION) {
      Alert.alert(
        'Invalid Duration', 
        `Video duration (${finalDuration}s) is invalid. Please re-record for at least ${MIN_RECORDING_DURATION} seconds.`,
        [
          { text: 'Re-record', onPress: () => setShowCaptionModal(false) },
          { text: 'Cancel', style: 'cancel' }
        ]
      );
      return;
    }

    console.log('[VideoReport] Submitting with duration:', finalDuration);

    setShowCaptionModal(false);
    setLoading(true);
    setUploadProgress(0);
    
    let currentLocation = location;
    if (!currentLocation) {
      try {
        currentLocation = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setLocation(currentLocation);
      } catch (err) {
        console.error('[VideoReport] Location fallback failed:', err);
        Alert.alert(
          'Location Required',
          'Unable to get your location. Report cannot be submitted without location.',
          [{ text: 'OK' }]
        );
        setLoading(false);
        return;
      }
    }

    if (!isOnline) {
      setLoading(false);
      Alert.alert(
        'Offline',
        'You are currently offline. The report will be saved locally and uploaded when you reconnect.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save Locally', onPress: () => saveReportLocally(currentLocation, finalDuration) }
        ]
      );
      return;
    }

    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }
      
      setUploadProgress(5);
      const fileInfo = await FileSystem.getInfoAsync(recordingUri);
      if (!fileInfo.exists || !fileInfo.size || fileInfo.size === 0) {
        throw new Error('Video file not found or is empty');
      }

      const fileSizeMB = (fileInfo.size / (1024 * 1024)).toFixed(1);
      console.log('[VideoReport] Uploading via multipart — Size:', fileSizeMB, 'MB, Duration:', finalDuration);

      setUploadProgress(15);

      // ── Multipart upload — no base64 inflation (33% smaller on the wire) ──
      const formData = new FormData();
      formData.append('video', {
        uri: recordingUri,
        type: 'video/mp4',
        name: `video_report_${Date.now()}.mp4`,
      } as any);
      formData.append('caption',          caption || 'Live security report');
      formData.append('is_anonymous',     String(isAnonymous));
      formData.append('latitude',         String(currentLocation.coords.latitude));
      formData.append('longitude',        String(currentLocation.coords.longitude));
      formData.append('duration_seconds', String(finalDuration));

      setUploadProgress(30);

      const response = await axios.post(
        `${BACKEND_URL}/api/report/upload-video`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data',
          },
          timeout: 180000,   // 3 min — server also needs time to transcode
          onUploadProgress: (progressEvent) => {
            const loaded = progressEvent.loaded || 0;
            const total  = progressEvent.total  || loaded || 1;
            // Map upload progress (0→1) into the 30%–90% band
            const pct = 30 + Math.min(Math.round((loaded / total) * 60), 60);
            setUploadProgress(pct);
          },
        }
      );

      setUploadProgress(100);
      console.log('[VideoReport] ✅ Upload successful');

      Alert.alert('Success!', 'Your video report has been uploaded successfully.', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error: any) {
      console.error('[VideoReport] Submit error:', error);
      
      let errorMessage = 'Failed to upload report.';
      if (error.response) {
        errorMessage = error.response.data?.detail || errorMessage;
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = 'Upload timed out. Try with a shorter video.';
      } else if (error.request) {
        errorMessage = 'Network error. Check your connection.';
      } else {
        errorMessage = error.message || errorMessage;
      }
      
      Alert.alert(
        'Upload Failed',
        `${errorMessage}\n\nWould you like to save the report locally to upload later?`,
        [
          { text: 'Discard', style: 'destructive' },
          { text: 'Save Locally', onPress: () => saveReportLocally(currentLocation, finalDuration) }
        ]
      );
    } finally {
      setLoading(false);
    }
  };

  const saveReportLocally = async (loc: any, duration: number) => {
    try {
      await addToQueue({
        type: 'video',
        localUri: recordingUri!,
        caption: caption || 'Live security report',
        isAnonymous,
        latitude:  loc?.coords?.latitude  || 0,
        longitude: loc?.coords?.longitude || 0,
        duration_seconds: duration,
        timestamp: new Date().toISOString(),
      });

      Alert.alert(
        '📥 Saved Locally',
        'Report saved on your device. It will upload automatically when you reconnect.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (error) {
      console.error('[VideoReport] Local save error:', error);
      Alert.alert('Error', 'Failed to save report locally');
    }
  };

  if (hasPermission === null) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#10B981" />
          <Text style={styles.loadingText}>Requesting permissions...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (hasPermission === false) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={80} color="#EF4444" />
          <Text style={styles.errorText}>Camera & Microphone access required</Text>
          <TouchableOpacity style={styles.retryButton} onPress={requestPermissions}>
            <Text style={styles.retryButtonText}>Grant Permissions</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.fullScreenContainer}>
      <CameraView
        ref={cameraRef}
        style={styles.fullCamera}
        facing={facing}
        mode="video"
        zoom={zoom}
        onCameraReady={onCameraReady}
      />
      
      <SafeAreaView style={styles.topOverlay}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>
        
        {isRecording && (
          <View style={styles.recordingIndicator}>
            <Animated.View style={[styles.recordingDot, { transform: [{ scale: pulseAnim }] }]} />
            <Text style={styles.recordingTime}>{formatDuration(recordingDuration)}</Text>
          </View>
        )}
        
        <TouchableOpacity style={styles.flipButton} onPress={toggleFacing} disabled={isRecording}>
          <Ionicons name="camera-reverse" size={28} color="#fff" />
        </TouchableOpacity>
      </SafeAreaView>
      
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline" size={18} color="#F59E0B" />
          <Text style={styles.offlineText}>Offline - Reports will be saved locally</Text>
        </View>
      )}
      
      {location && (
        <View style={styles.locationBadge}>
          <Ionicons name="location" size={14} color="#10B981" />
          <Text style={styles.locationText}>
            GPS: {location.coords.latitude.toFixed(4)}, {location.coords.longitude.toFixed(4)}
          </Text>
        </View>
      )}
      
      {!isRecording && (
        <View style={styles.zoomContainer}>
          <Text style={styles.zoomLabel}>Zoom: {Math.round(zoom * 100)}%</Text>
          <Slider
            style={styles.zoomSlider}
            minimumValue={0}
            maximumValue={1}
            step={0.01}
            value={zoom}
            onValueChange={setZoom}
            minimumTrackTintColor="#10B981"
            maximumTrackTintColor="#ffffff50"
            thumbTintColor="#10B981"
          />
        </View>
      )}
      
      {recordingUri && !isRecording && savedDuration > 0 && (
        <View style={styles.recordedBadge}>
          <Ionicons name="checkmark-circle" size={20} color="#10B981" />
          <Text style={styles.recordedText}>Recorded: {formatDuration(savedDuration)}</Text>
        </View>
      )}
      
      <View style={styles.bottomOverlay}>
        <View style={styles.controlsRow}>
          <View style={styles.sideButton} />
          
          <TouchableOpacity
            style={[styles.recordButton, isRecording && styles.recordButtonActive]}
            onPress={isRecording ? stopRecording : startRecording}
            disabled={loading || !cameraReady}
          >
            <View style={[styles.recordButtonInner, isRecording && styles.recordButtonInnerActive]}>
              {isRecording ? (
                <Ionicons name="stop" size={32} color="#fff" />
              ) : (
                <View style={styles.recordButtonCircle} />
              )}
            </View>
          </TouchableOpacity>
          
          {recordingUri && !isRecording && savedDuration > 0 ? (
            <TouchableOpacity style={styles.uploadButton} onPress={() => setShowCaptionModal(true)}>
              <Ionicons name="cloud-upload" size={28} color="#fff" />
            </TouchableOpacity>
          ) : (
            <View style={styles.sideButton} />
          )}
        </View>
        
        <Text style={styles.instructionText}>
          {!cameraReady ? 'Initializing camera...' : 
           isRecording ? `Recording... ${formatDuration(recordingDuration)}` : 
           recordingUri && savedDuration > 0 ? `Ready to upload (${formatDuration(savedDuration)})` : 
           'Tap record to start'}
        </Text>
      </View>
      
      {loading && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#10B981" />
            <Text style={styles.loadingTitle}>Uploading Report</Text>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${uploadProgress}%` }]} />
            </View>
            <Text style={styles.progressText}>{uploadProgress}%</Text>
          </View>
        </View>
      )}
      
      <Modal visible={showCaptionModal} animationType="slide" transparent>
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Details</Text>
              <TouchableOpacity onPress={() => setShowCaptionModal(false)}>
                <Ionicons name="close" size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.durationDisplay}>
              <Ionicons name="time" size={20} color="#10B981" />
              <Text style={styles.durationText}>
                Duration: {formatDuration(savedDuration)}
              </Text>
            </View>
            
            <View style={styles.fileSizeDisplay}>
              <Ionicons name="document" size={20} color="#3B82F6" />
              <Text style={styles.fileSizeText}>
                File Size: {recordingFileSize > 0 ? (recordingFileSize / (1024 * 1024)).toFixed(2) : '0'} MB
              </Text>
            </View>
            
            <Text style={styles.inputLabel}>Caption (Optional)</Text>
            <TextInput
              style={styles.captionInput}
              value={caption}
              onChangeText={setCaption}
              placeholder="Describe the situation..."
              placeholderTextColor="#64748B"
              multiline
              numberOfLines={3}
            />
            
            <View style={styles.toggleRow}>
              <View>
                <Text style={styles.toggleLabel}>Submit Anonymously</Text>
                <Text style={styles.toggleDescription}>Your identity will be hidden</Text>
              </View>
              <Switch
                value={isAnonymous}
                onValueChange={setIsAnonymous}
                trackColor={{ false: '#334155', true: '#10B98150' }}
                thumbColor={isAnonymous ? '#10B981' : '#94A3B8'}
              />
            </View>
            
            <TouchableOpacity style={styles.submitButton} onPress={submitReport}>
              <Ionicons name="cloud-upload" size={24} color="#fff" />
              <Text style={styles.submitButtonText}>
                {isOnline ? 'Upload Report' : 'Save Locally'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  fullScreenContainer: { flex: 1, backgroundColor: '#000' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#94A3B8', marginTop: 16 },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  errorText: { color: '#EF4444', fontSize: 18, marginTop: 16, textAlign: 'center' },
  retryButton: { marginTop: 20, backgroundColor: '#3B82F6', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  retryButtonText: { color: '#fff', fontWeight: '600' },
  fullCamera: { flex: 1, width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
  topOverlay: { 
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 50 : 16
  },
  backButton: { 
    width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center'
  },
  flipButton: { 
    width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center'
  },
  recordingIndicator: { 
    flexDirection: 'row', alignItems: 'center', 
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 
  },
  recordingDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#EF4444', marginRight: 8 },
  recordingTime: { color: '#fff', fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
  offlineBanner: {
    position: 'absolute', top: Platform.OS === 'ios' ? 90 : 70, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.9)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20
  },
  offlineText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  locationBadge: {
    position: 'absolute', top: Platform.OS === 'ios' ? 130 : 110, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.9)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20
  },
  locationText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  zoomContainer: { 
    position: 'absolute', top: 120, left: 20, right: 20,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, padding: 12
  },
  zoomLabel: { color: '#fff', fontSize: 14, marginBottom: 8, textAlign: 'center' },
  zoomSlider: { width: '100%', height: 40 },
  recordedBadge: { 
    position: 'absolute', top: 180, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.9)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, gap: 8
  },
  recordedText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  bottomOverlay: { 
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20, paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.4)'
  },
  controlsRow: { 
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    paddingHorizontal: 40
  },
  sideButton: { width: 60 },
  recordButton: { 
    width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: '#fff',
    justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent'
  },
  recordButtonActive: { borderColor: '#EF4444' },
  recordButtonInner: { 
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#EF4444',
    justifyContent: 'center', alignItems: 'center'
  },
  recordButtonInnerActive: { backgroundColor: '#EF4444', borderRadius: 8 },
  recordButtonCircle: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' },
  uploadButton: { 
    width: 60, height: 60, borderRadius: 30, backgroundColor: '#10B981',
    justifyContent: 'center', alignItems: 'center'
  },
  instructionText: { color: '#fff', textAlign: 'center', marginTop: 16, fontSize: 14, opacity: 0.8 },
  loadingOverlay: { 
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center', alignItems: 'center'
  },
  loadingCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 32, alignItems: 'center', width: 280 },
  loadingTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 16, marginBottom: 20 },
  progressBar: { width: '100%', height: 8, backgroundColor: '#334155', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#10B981' },
  progressText: { color: '#94A3B8', marginTop: 8 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { backgroundColor: '#1E293B', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '600', color: '#fff' },
  durationDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#10B98120',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 8,
    alignSelf: 'flex-start'
  },
  durationText: { fontSize: 15, fontWeight: '600', color: '#10B981' },
  fileSizeDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#3B82F620',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 16,
    alignSelf: 'flex-start'
  },
  fileSizeText: { fontSize: 15, fontWeight: '600', color: '#3B82F6' },
  inputLabel: { color: '#94A3B8', marginBottom: 8, fontSize: 14 },
  captionInput: { 
    backgroundColor: '#0F172A', borderRadius: 12, padding: 16, color: '#fff', 
    minHeight: 100, textAlignVertical: 'top', marginBottom: 20
  },
  toggleRow: { 
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#0F172A', padding: 16, borderRadius: 12, marginBottom: 20
  },
  toggleLabel: { color: '#fff', fontWeight: '500' },
  toggleDescription: { color: '#64748B', fontSize: 12, marginTop: 2 },
  submitButton: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#10B981', paddingVertical: 16, borderRadius: 12
  },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
