import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Alert, ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Image, Modal } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuthToken, clearAuthData, getUserMetadata } from '../utils/auth';
import BACKEND_URL from '../../utils/config';


const ICON_OPTIONS = ['shield', 'shield-checkmark', 'lock-closed', 'lock-open', 'key', 'finger-print', 'eye', 'eye-off', 'pulse', 'heart', 'flash', 'star', 'moon', 'sunny', 'cloudy', 'rainy', 'snow', 'thunderstorm', 'partly-sunny', 'water', 'flame', 'leaf', 'flower', 'paw', 'bug', 'airplane', 'car', 'bicycle', 'boat', 'bus', 'rocket', 'train', 'walk', 'fitness', 'basketball', 'football', 'baseball', 'golf', 'tennisball', 'trophy', 'medal', 'ribbon', 'rose', 'earth', 'globe', 'map', 'location', 'navigate', 'compass', 'pin', 'home', 'business', 'school', 'library', 'briefcase', 'calendar', 'time', 'alarm', 'stopwatch', 'timer', 'notifications', 'chatbubble', 'mail', 'call', 'videocam', 'camera', 'mic', 'musical-notes', 'volume-high', 'headset', 'cart', 'bag', 'pricetag', 'card', 'cash', 'gift', 'balloon', 'cafe', 'pizza', 'beer', 'wine', 'ice-cream', 'nutrition', 'restaurant', 'fast-food', 'book', 'newspaper', 'bookmark', 'document', 'folder', 'calculator', 'clipboard', 'create', 'pencil', 'brush', 'color-palette', 'image', 'images', 'aperture', 'barcode'];

interface EmergencyContact {
  name: string;
  phone: string;
  email: string;
}

export default function Settings() {
  const router = useRouter();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [appName, setAppName] = useState('SafeGuard');
  const [selectedIcon, setSelectedIcon] = useState('shield');
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([
    { name: '', phone: '', email: '' },
    { name: '', phone: '', email: '' }
  ]);
  const [savingContacts, setSavingContacts] = useState(false);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const cameraRef = React.useRef<CameraView>(null);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [savingPin, setSavingPin] = useState(false);

  useEffect(() => {
    initializeSettings();
  }, []);

  const initializeSettings = async () => {
    setPageLoading(true);
    const token = await getAuthToken();
    if (!token) {
      router.replace('/auth/login');
      return;
    }
    await loadProfile();
    setPageLoading(false);
  };

  const loadProfile = async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;

      // Load local customization first for instant display
      try {
        const localCustomization = await AsyncStorage.getItem('app_customization');
        if (localCustomization) {
          const { app_name, app_logo } = JSON.parse(localCustomization);
          if (app_name) setAppName(app_name);
          if (app_logo) setSelectedIcon(app_logo);
        }
      } catch (e) {}
      
      const response = await axios.get(`${BACKEND_URL}/api/user/profile`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });
      console.log('[Settings] Profile loaded');
      setUserProfile(response.data);
      setAppName(response.data.app_name || 'SafeGuard');
      setSelectedIcon(response.data.app_logo || 'shield');
      if (response.data.profile_photo_url) {
        const photoUrl = response.data.profile_photo_url;
        // Prepend backend URL if it's a relative path
        setProfilePhoto(photoUrl.startsWith('http') ? photoUrl : `${BACKEND_URL}${photoUrl}`);
      }
      
      // Load emergency contacts
      if (response.data.emergency_contacts && response.data.emergency_contacts.length > 0) {
        const contacts = [...response.data.emergency_contacts];
        while (contacts.length < 2) {
          contacts.push({ name: '', phone: '', email: '' });
        }
        setEmergencyContacts(contacts);
      }
    } catch (error: any) {
      console.error('[Settings] Failed to load profile:', error?.response?.status);
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
      }
    }
  };

  const pickAndUploadPhoto = async () => {
    Alert.alert('Update Profile Photo', 'Choose photo source:', [
      {
        text: 'Camera',
        onPress: async () => {
          if (!cameraPermission?.granted) {
            const result = await requestCameraPermission();
            if (!result.granted) {
              Alert.alert('Permission Required', 'Camera permission is needed.');
              return;
            }
          }
          setShowCamera(true);
        },
      },
      {
        text: 'Photo Library',
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permission Required', 'Photo library access is needed to pick a photo.');
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1] as [number, number],
            quality: 0.7,
          });
          if (!result.canceled && result.assets[0]?.uri) {
            await uploadPhotoUri(
              result.assets[0].uri,
              result.assets[0].mimeType || 'image/jpeg'
            );
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const uploadPhotoUri = async (uri: string, mimeType: string = 'image/jpeg') => {
    setUploadingPhoto(true);
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/auth/login'); return; }

      // Read file as base64 - more reliable across platforms
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Use JSON body with base64 - avoids multipart issues on web/mobile
      const response = await axios.post(
        `${BACKEND_URL}/api/user/profile-photo-base64`,
        {
          photo_base64: base64,
          mime_type: mimeType,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );
      const photoUrl = response.data.photo_url;
      setProfilePhoto(photoUrl.startsWith('http') ? photoUrl : `${BACKEND_URL}${photoUrl}`);
      Alert.alert('Success', 'Profile photo updated! Security agents can now identify you.');
    } catch (error: any) {
      const status = (error as any)?.response?.status;
      const msg = (error as any)?.response?.data?.detail || (error as any)?.message || 'Failed to upload photo.';
      Alert.alert('Upload Failed', `${msg}${status ? ' ('+status+')' : ''}`);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const captureAndUpload = async () => {
    if (!cameraRef.current) {
      Alert.alert('Error', 'Camera not ready. Please try again.');
      return;
    }
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      setShowCamera(false);
      if (!photo?.uri) { Alert.alert('Error', 'Could not capture photo'); return; }
      await uploadPhotoUri(photo.uri, 'image/jpeg');
    } catch (error: any) {
      setShowCamera(false);
      Alert.alert('Camera Error', error?.message || 'Failed to take photo. Please try again.');
    }
  };

  const savePin = async () => {
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      Alert.alert('Invalid PIN', 'PIN must be exactly 4 digits');
      return;
    }
    if (newPin !== confirmPin) {
      Alert.alert('PIN Mismatch', 'New PIN and confirmation do not match');
      return;
    }
    setSavingPin(true);
    try {
      await AsyncStorage.setItem('security_pin', newPin);
      setCurrentPin(''); setNewPin(''); setConfirmPin('');
      Alert.alert('Success', 'Security PIN updated! Use this PIN to unlock the app after panic mode.');
    } catch (e) {
      Alert.alert('Error', 'Failed to save PIN');
    } finally {
      setSavingPin(false);
    }
  };

  const saveCustomization = async () => {
    if (!appName.trim()) {
      Alert.alert('Error', 'App name cannot be empty');
      return;
    }

    setLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }
      
      await axios.put(`${BACKEND_URL}/api/user/customize-app`, {
        app_name: appName,
        app_logo: selectedIcon
      }, { 
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });

      // Persist locally so the app header updates immediately
      await AsyncStorage.setItem('app_customization', JSON.stringify({ app_name: appName, app_logo: selectedIcon }));

      Alert.alert('Success', `App customization saved! The app will now appear as "${appName}".`);
    } catch (error: any) {
      console.error('[Settings] Save error:', error?.response?.data);
      if (error?.response?.status === 401) {
        Alert.alert('Session Expired', 'Please login again');
        await clearAuthData();
        router.replace('/auth/login');
      } else {
        Alert.alert('Error', 'Failed to save customization');
      }
    } finally {
      setLoading(false);
    }
  };

  const updateEmergencyContact = (index: number, field: keyof EmergencyContact, value: string) => {
    const newContacts = [...emergencyContacts];
    newContacts[index] = { ...newContacts[index], [field]: value };
    setEmergencyContacts(newContacts);
  };

  const saveEmergencyContacts = async () => {
    // Validate at least one contact has phone number
    const validContacts = emergencyContacts.filter(c => c.phone.trim() !== '');
    if (validContacts.length === 0) {
      Alert.alert('Error', 'Please add at least one emergency contact with phone number');
      return;
    }

    setSavingContacts(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }
      
      await axios.put(`${BACKEND_URL}/api/user/emergency-contacts`, {
        contacts: emergencyContacts.filter(c => c.phone.trim() !== '')
      }, { 
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });

      Alert.alert('Success', 'Emergency contacts saved. They will be notified during panic events.');
    } catch (error: any) {
      console.error('[Settings] Save contacts error:', error?.response?.data);
      Alert.alert('Error', 'Failed to save emergency contacts');
    } finally {
      setSavingContacts(false);
    }
  };

  if (pageLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3B82F6" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Settings</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView style={styles.content}>
          {/* User Profile Section */}
          {userProfile && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Your Profile</Text>
              <View style={styles.profileCard}>
                <TouchableOpacity style={styles.profileAvatar} onPress={pickAndUploadPhoto} disabled={uploadingPhoto}>
                  {profilePhoto ? (
                    <Image source={{ uri: profilePhoto }} style={styles.profileAvatarImage} />
                  ) : (
                    <Ionicons name="person" size={40} color="#3B82F6" />
                  )}
                  <View style={styles.photoEditBadge}>
                    {uploadingPhoto ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera" size={12} color="#fff" />}
                  </View>
                </TouchableOpacity>
                <View style={styles.profileInfo}>
                  <Text style={styles.profileName}>{userProfile.full_name || 'User'}</Text>
                  <Text style={styles.profileEmail}>{userProfile.email}</Text>
                  {userProfile.phone && (
                    <Text style={styles.profilePhone}>{userProfile.phone}</Text>
                  )}
                  <View style={[styles.premiumBadge, userProfile.is_premium ? styles.premiumActive : styles.premiumInactive]}>
                    <Text style={styles.premiumText}>
                      {userProfile.is_premium ? '⭐ Premium' : 'Free Plan'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* App Customization Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>App Customization</Text>
            <Text style={styles.sectionDescription}>Disguise the app name and icon. The custom name will show as the app title and in your phone's app launcher if the device supports dynamic shortcuts.</Text>

            <View style={styles.customizationCard}>
              <Text style={styles.inputLabel}>App Name</Text>
              <TextInput
                style={styles.input}
                value={appName}
                onChangeText={setAppName}
                placeholder="Enter app name"
                placeholderTextColor="#64748B"
              />

              <Text style={styles.inputLabel}>App Icon</Text>
              <TouchableOpacity style={styles.iconSelector} onPress={() => setShowIconPicker(!showIconPicker)}>
                <View style={styles.selectedIconContainer}>
                  <Ionicons name={selectedIcon as any} size={32} color="#3B82F6" />
                </View>
                <Text style={styles.iconSelectorText}>Tap to change icon</Text>
                <Ionicons name={showIconPicker ? 'chevron-up' : 'chevron-down'} size={24} color="#64748B" />
              </TouchableOpacity>

              {showIconPicker && (
                <View style={styles.iconGrid}>
                  <FlatList
                    data={ICON_OPTIONS.slice(0, 40)}
                    numColumns={6}
                    keyExtractor={(item) => item}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={[styles.iconOption, selectedIcon === item && styles.iconOptionSelected]}
                        onPress={() => { setSelectedIcon(item); setShowIconPicker(false); }}
                      >
                        <Ionicons name={item as any} size={24} color={selectedIcon === item ? '#3B82F6' : '#94A3B8'} />
                      </TouchableOpacity>
                    )}
                  />
                </View>
              )}

              <TouchableOpacity style={styles.saveButton} onPress={saveCustomization} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="save" size={20} color="#fff" />
                    <Text style={styles.saveButtonText}>Save Customization</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Emergency Contacts Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Emergency Contacts</Text>
            <Text style={styles.sectionDescription}>These contacts will be notified via SMS during panic events</Text>

            {emergencyContacts.map((contact, index) => (
              <View key={index} style={styles.contactCard}>
                <Text style={styles.contactHeader}>Contact {index + 1}</Text>
                
                <Text style={styles.inputLabel}>Name</Text>
                <TextInput
                  style={styles.input}
                  value={contact.name}
                  onChangeText={(v) => updateEmergencyContact(index, 'name', v)}
                  placeholder="Contact name"
                  placeholderTextColor="#64748B"
                />
                
                <Text style={styles.inputLabel}>Phone Number *</Text>
                <TextInput
                  style={styles.input}
                  value={contact.phone}
                  onChangeText={(v) => updateEmergencyContact(index, 'phone', v)}
                  placeholder="Phone number"
                  placeholderTextColor="#64748B"
                  keyboardType="phone-pad"
                />
                
                <Text style={styles.inputLabel}>Email (Optional)</Text>
                <TextInput
                  style={styles.input}
                  value={contact.email}
                  onChangeText={(v) => updateEmergencyContact(index, 'email', v)}
                  placeholder="Email address"
                  placeholderTextColor="#64748B"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
            ))}

            <View style={styles.smsPreview}>
              <Text style={styles.smsPreviewTitle}>📱 SMS Preview:</Text>
              <Text style={styles.smsPreviewText}>
                Hello {emergencyContacts[0]?.name || '[Contact Name]'}, Kindly reach-out to your {userProfile?.full_name || '[User Name]'} - {userProfile?.phone || '[User Phone]'} who has activated a Panic Emergency. Thanks{"\n\n"}- Se-Q Securities
              </Text>
            </View>

            <TouchableOpacity style={styles.saveContactsButton} onPress={saveEmergencyContacts} disabled={savingContacts}>
              {savingContacts ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="people" size={20} color="#fff" />
                  <Text style={styles.saveButtonText}>Save Emergency Contacts</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Quick Emergency Numbers */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Emergency Services</Text>
            <View style={styles.emergencyServicesCard}>
              <View style={styles.emergencyService}>
                <View style={[styles.serviceIcon, { backgroundColor: '#EF444420' }]}>
                  <Ionicons name="call" size={24} color="#EF4444" />
                </View>
                <View style={styles.serviceInfo}>
                  <Text style={styles.serviceName}>Police / Emergency</Text>
                  <Text style={styles.serviceNumber}>911 / 112</Text>
                </View>
              </View>
              <View style={styles.emergencyService}>
                <View style={[styles.serviceIcon, { backgroundColor: '#10B98120' }]}>
                  <Ionicons name="medkit" size={24} color="#10B981" />
                </View>
                <View style={styles.serviceInfo}>
                  <Text style={styles.serviceName}>Medical Emergency</Text>
                  <Text style={styles.serviceNumber}>112</Text>
                </View>
              </View>
              <View style={styles.emergencyService}>
                <View style={[styles.serviceIcon, { backgroundColor: '#F59E0B20' }]}>
                  <Ionicons name="flame" size={24} color="#F59E0B" />
                </View>
                <View style={styles.serviceInfo}>
                  <Text style={styles.serviceName}>Fire Service</Text>
                  <Text style={styles.serviceNumber}>101</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Security PIN Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Security PIN</Text>
            <Text style={styles.sectionDescription}>Set a 4-digit PIN to unlock the app after panic mode activates</Text>
            <View style={styles.customizationCard}>
              <Text style={styles.inputLabel}>New PIN (4 digits)</Text>
              <TextInput
                style={styles.input}
                value={newPin}
                onChangeText={(v) => setNewPin(v.replace(/[^0-9]/g, '').slice(0, 4))}
                placeholder="Enter 4-digit PIN"
                placeholderTextColor="#64748B"
                keyboardType="numeric"
                secureTextEntry
                maxLength={4}
              />
              <Text style={styles.inputLabel}>Confirm PIN</Text>
              <TextInput
                style={styles.input}
                value={confirmPin}
                onChangeText={(v) => setConfirmPin(v.replace(/[^0-9]/g, '').slice(0, 4))}
                placeholder="Confirm PIN"
                placeholderTextColor="#64748B"
                keyboardType="numeric"
                secureTextEntry
                maxLength={4}
              />
              <TouchableOpacity style={[styles.saveButton, { backgroundColor: '#8B5CF6' }]} onPress={savePin} disabled={savingPin}>
                {savingPin ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="lock-closed" size={20} color="#fff" />
                    <Text style={styles.saveButtonText}>Save Security PIN</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* About Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <View style={styles.aboutCard}>
              <Ionicons name="shield-checkmark" size={48} color="#3B82F6" />
              <Text style={styles.aboutTitle}>SafeGuard</Text>
              <Text style={styles.aboutVersion}>Version 1.0.0</Text>
              <Text style={styles.aboutDescription}>Your personal safety companion</Text>
            </View>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Camera Modal */}
      <Modal visible={showCamera} animationType="slide" onRequestClose={() => setShowCamera(false)}>
        <View style={styles.cameraModal}>
          <CameraView ref={cameraRef} style={styles.cameraView} facing="front">
            <View style={styles.cameraOverlay}>
              <View style={styles.cameraHeader}>
                <TouchableOpacity onPress={() => setShowCamera(false)} style={styles.cameraCancelBtn}>
                  <Ionicons name="close" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.cameraTitle}>Take Profile Photo</Text>
                <View style={{ width: 44 }} />
              </View>
              <View style={styles.cameraGuide}>
                <View style={styles.cameraFaceFrame} />
                <Text style={styles.cameraGuideText}>Position your face in the circle</Text>
              </View>
              <View style={styles.cameraBottom}>
                <TouchableOpacity style={styles.captureBtn} onPress={captureAndUpload}>
                  <View style={styles.captureBtnInner} />
                </TouchableOpacity>
              </View>
            </View>
          </CameraView>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  content: { flex: 1, padding: 16 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#fff', marginBottom: 8 },
  sectionDescription: { fontSize: 14, color: '#64748B', marginBottom: 16 },
  profileCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 20, flexDirection: 'row', alignItems: 'center' },
  profileAvatar: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 18, fontWeight: '600', color: '#fff', marginBottom: 4 },
  profileEmail: { fontSize: 14, color: '#94A3B8', marginBottom: 2 },
  profilePhone: { fontSize: 14, color: '#64748B', marginBottom: 8 },
  premiumBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, alignSelf: 'flex-start' },
  premiumActive: { backgroundColor: '#F59E0B20' },
  premiumInactive: { backgroundColor: '#64748B20' },
  premiumText: { fontSize: 12, fontWeight: '600', color: '#F59E0B' },
  customizationCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 20 },
  inputLabel: { fontSize: 14, color: '#94A3B8', marginBottom: 8, marginTop: 16 },
  input: { backgroundColor: '#0F172A', borderRadius: 12, padding: 16, color: '#fff', fontSize: 16 },
  iconSelector: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderRadius: 12, padding: 16 },
  selectedIconContainer: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#3B82F620', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  iconSelectorText: { flex: 1, color: '#94A3B8', fontSize: 14 },
  iconGrid: { marginTop: 12, backgroundColor: '#0F172A', borderRadius: 12, padding: 12 },
  iconOption: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 8, margin: 2 },
  iconOptionSelected: { backgroundColor: '#3B82F620' },
  saveButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#3B82F6', paddingVertical: 14, borderRadius: 12, marginTop: 20 },
  saveButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  contactCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 20, marginBottom: 16 },
  contactHeader: { fontSize: 16, fontWeight: '600', color: '#3B82F6', marginBottom: 8 },
  smsPreview: { backgroundColor: '#1E293B', borderRadius: 12, padding: 16, marginBottom: 16 },
  smsPreviewTitle: { fontSize: 14, fontWeight: '600', color: '#fff', marginBottom: 8 },
  smsPreviewText: { fontSize: 13, color: '#94A3B8', lineHeight: 20 },
  saveContactsButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#10B981', paddingVertical: 14, borderRadius: 12 },
  emergencyServicesCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 16 },
  emergencyService: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#334155' },
  serviceIcon: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  serviceInfo: { flex: 1 },
  serviceName: { fontSize: 16, fontWeight: '500', color: '#fff', marginBottom: 2 },
  serviceNumber: { fontSize: 14, color: '#64748B' },
  aboutCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 24, alignItems: 'center' },
  aboutTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginTop: 12 },
  aboutVersion: { fontSize: 14, color: '#64748B', marginTop: 4 },
  aboutDescription: { fontSize: 14, color: '#94A3B8', textAlign: 'center', marginTop: 8 },
  profileAvatarImage: { width: 70, height: 70, borderRadius: 35 },
  photoEditBadge: { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#3B82F6', borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center' },
  // Camera modal
  cameraModal: { flex: 1, backgroundColor: '#000' },
  cameraView: { flex: 1 },
  cameraOverlay: { flex: 1, justifyContent: 'space-between' },
  cameraHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingTop: 60, backgroundColor: 'rgba(0,0,0,0.4)' },
  cameraCancelBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  cameraTitle: { fontSize: 18, fontWeight: '600', color: '#fff' },
  cameraGuide: { alignItems: 'center' },
  cameraFaceFrame: { width: 220, height: 220, borderRadius: 110, borderWidth: 3, borderColor: 'rgba(255,255,255,0.7)', borderStyle: 'dashed' },
  cameraGuideText: { color: 'rgba(255,255,255,0.8)', marginTop: 16, fontSize: 14 },
  cameraBottom: { alignItems: 'center', paddingBottom: 60, backgroundColor: 'rgba(0,0,0,0.4)' },
  captureBtn: { width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  captureBtnInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff' },
});
