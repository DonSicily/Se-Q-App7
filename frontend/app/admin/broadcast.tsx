import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import BACKEND_URL from '../../../utils/config';


const TARGET_OPTIONS = [
  { label: 'All Users', value: 'all', icon: 'people', color: '#8B5CF6' },
  { label: 'Civil Users', value: 'civil', icon: 'person', color: '#3B82F6' },
  { label: 'Security Teams', value: 'security', icon: 'shield', color: '#F59E0B' },
];

export default function AdminBroadcast() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState('all');
  const [sending, setSending] = useState(false);

  const sendBroadcast = async () => {
    if (!title.trim() || !message.trim()) {
      Alert.alert('Required Fields', 'Please enter both a title and message.');
      return;
    }
    Alert.alert(
      'Confirm Broadcast',
      `Send "${title}" to ${TARGET_OPTIONS.find(t => t.value === target)?.label}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            setSending(true);
            try {
              const token = await getAuthToken();
              if (!token) { router.replace('/admin/login'); return; }
              const res = await axios.post(
                `${BACKEND_URL}/api/admin/broadcast`,
                { title: title.trim(), message: message.trim(), target_role: target },
                { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 }
              );
              Alert.alert('✅ Broadcast Sent', `Message delivered to ${res.data?.recipients || 0} users.`, [
                { text: 'OK', onPress: () => { setTitle(''); setMessage(''); } }
              ]);
            } catch (e: any) {
              if (e?.response?.status === 401 || e?.response?.status === 403) { await clearAuthData(); router.replace('/admin/login'); return; }
              Alert.alert('Error', e?.response?.data?.detail || 'Failed to send broadcast.');
            } finally { setSending(false); }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/admin/dashboard')} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Broadcast Message</Text>
        <View style={{ width: 32 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionTitle}>Target Audience</Text>
          <View style={styles.targetRow}>
            {TARGET_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.targetCard, target === opt.value && { borderColor: opt.color, borderWidth: 2 }]}
                onPress={() => setTarget(opt.value)}
              >
                <View style={[styles.targetIcon, { backgroundColor: `${opt.color}20` }]}>
                  <Ionicons name={opt.icon as any} size={22} color={opt.color} />
                </View>
                <Text style={[styles.targetLabel, target === opt.value && { color: opt.color }]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionTitle}>Message Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Maintenance Notice"
            placeholderTextColor="#475569"
            maxLength={100}
          />
          <Text style={styles.charCount}>{title.length}/100</Text>

          <Text style={styles.sectionTitle}>Message Body</Text>
          <TextInput
            style={[styles.input, styles.bodyInput]}
            value={message}
            onChangeText={setMessage}
            placeholder="Write your message to users..."
            placeholderTextColor="#475569"
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            maxLength={500}
          />
          <Text style={styles.charCount}>{message.length}/500</Text>

          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>📱 Preview</Text>
            <View style={styles.notifPreview}>
              <Text style={styles.previewNotifTitle}>{title || 'Message Title'}</Text>
              <Text style={styles.previewNotifBody} numberOfLines={3}>{message || 'Your message will appear here...'}</Text>
            </View>
          </View>

          <TouchableOpacity style={[styles.sendBtn, sending && { opacity: 0.7 }]} onPress={sendBroadcast} disabled={sending}>
            {sending ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="megaphone" size={22} color="#fff" />
                <Text style={styles.sendText}>Send Broadcast</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  backBtn: { padding: 4 },
  title: { fontSize: 18, fontWeight: '700', color: '#fff' },
  scroll: { flex: 1, paddingHorizontal: 20 },
  sectionTitle: { fontSize: 13, color: '#94A3B8', fontWeight: '600', marginTop: 20, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  targetRow: { flexDirection: 'row', gap: 10 },
  targetCard: { flex: 1, backgroundColor: '#1E293B', borderRadius: 14, padding: 14, alignItems: 'center', gap: 8, borderWidth: 2, borderColor: 'transparent' },
  targetIcon: { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  targetLabel: { fontSize: 12, color: '#94A3B8', fontWeight: '600', textAlign: 'center' },
  input: { backgroundColor: '#1E293B', borderRadius: 12, padding: 16, color: '#fff', fontSize: 15 },
  bodyInput: { minHeight: 140, textAlignVertical: 'top' },
  charCount: { fontSize: 11, color: '#475569', textAlign: 'right', marginTop: 4 },
  previewCard: { backgroundColor: '#1E293B', borderRadius: 14, padding: 16, marginTop: 20 },
  previewTitle: { fontSize: 13, color: '#64748B', marginBottom: 10, fontWeight: '600' },
  notifPreview: { backgroundColor: '#0F172A', borderRadius: 10, padding: 14 },
  previewNotifTitle: { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 4 },
  previewNotifBody: { fontSize: 13, color: '#94A3B8', lineHeight: 18 },
  sendBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#EC4899', borderRadius: 14, paddingVertical: 16, marginTop: 24 },
  sendText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
