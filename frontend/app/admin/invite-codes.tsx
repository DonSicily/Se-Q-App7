import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, RefreshControl, Alert, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import * as Clipboard from 'expo-clipboard';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import BACKEND_URL from '../../../utils/config';


export default function AdminInviteCodes() {
  const router = useRouter();
  const [codes, setCodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [maxUses, setMaxUses] = useState('10');
  const [expiresDays, setExpiresDays] = useState('30');

  useEffect(() => {
    loadCodes();
  }, []);

  const loadCodes = async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/admin/login');
        return;
      }
      
      const response = await axios.get(`${BACKEND_URL}/api/admin/invite-codes`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      });
      setCodes(response.data.codes || []);
    } catch (error: any) {
      console.error('[AdminInviteCodes] Failed to load codes:', error?.response?.status);
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/admin/login');
      } else {
        Alert.alert('Error', 'Failed to load invite codes');
      }
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadCodes();
    setRefreshing(false);
  };

  const createCode = async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/admin/login');
        return;
      }
      
      const response = await axios.post(`${BACKEND_URL}/api/admin/invite-codes`, {
        code: newCode || null,
        max_uses: parseInt(maxUses) || 10,
        expires_days: parseInt(expiresDays) || 30
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });
      
      Alert.alert('Success', `Code created: ${response.data.code}`);
      setShowCreateModal(false);
      setNewCode('');
      loadCodes();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to create code');
    }
  };

  const copyCode = async (code: string) => {
    await Clipboard.setStringAsync(code);
    Alert.alert('Copied!', `Code "${code}" copied to clipboard`);
  };

  const renderCode = ({ item }: any) => {
    const isExpired = new Date(item.expires_at) < new Date();
    const usagePercent = (item.used_count / item.max_uses) * 100;
    
    return (
      <View style={[styles.codeCard, isExpired && styles.expiredCard]}>
        <View style={styles.codeHeader}>
          <TouchableOpacity style={styles.codeText} onPress={() => copyCode(item.code)}>
            <Ionicons name="key" size={20} color="#8B5CF6" />
            <Text style={styles.codeValue}>{item.code}</Text>
            <Ionicons name="copy-outline" size={16} color="#64748B" />
          </TouchableOpacity>
          <View style={[styles.statusBadge, { backgroundColor: item.is_active && !isExpired ? '#10B98120' : '#EF444420' }]}>
            <Text style={[styles.statusText, { color: item.is_active && !isExpired ? '#10B981' : '#EF4444' }]}>
              {isExpired ? 'Expired' : item.is_active ? 'Active' : 'Inactive'}
            </Text>
          </View>
        </View>
        
        <View style={styles.usageBar}>
          <View style={[styles.usageFill, { width: `${usagePercent}%` }]} />
        </View>
        <Text style={styles.usageText}>{item.used_count} / {item.max_uses} uses</Text>
        
        <Text style={styles.expiryText}>
          Expires: {new Date(item.expires_at).toLocaleDateString()}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace("/admin/dashboard")}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Invite Codes</Text>
        <TouchableOpacity onPress={() => setShowCreateModal(true)}>
          <Ionicons name="add-circle" size={28} color="#8B5CF6" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={codes}
        renderItem={renderCode}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="key-outline" size={48} color="#64748B" />
            <Text style={styles.emptyText}>No invite codes</Text>
          </View>
        }
      />

      <Modal visible={showCreateModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create Invite Code</Text>
            
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Code (optional - auto-generate if empty)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., TEAM-ALPHA-2025"
                placeholderTextColor="#64748B"
                value={newCode}
                onChangeText={setNewCode}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Max Uses</Text>
              <TextInput
                style={styles.input}
                placeholder="10"
                placeholderTextColor="#64748B"
                value={maxUses}
                onChangeText={setMaxUses}
                keyboardType="number-pad"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Expires In (days)</Text>
              <TextInput
                style={styles.input}
                placeholder="30"
                placeholderTextColor="#64748B"
                value={expiresDays}
                onChangeText={setExpiresDays}
                keyboardType="number-pad"
              />
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setShowCreateModal(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.createButton} onPress={createCode}>
                <Text style={styles.createButtonText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 20, fontWeight: '600', color: '#fff' },
  list: { padding: 20, gap: 12 },
  codeCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 16 },
  expiredCard: { opacity: 0.6 },
  codeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  codeText: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  codeValue: { fontSize: 18, fontWeight: '600', color: '#fff' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontWeight: '600' },
  usageBar: { height: 6, backgroundColor: '#334155', borderRadius: 3, marginBottom: 8 },
  usageFill: { height: '100%', backgroundColor: '#8B5CF6', borderRadius: 3 },
  usageText: { fontSize: 14, color: '#94A3B8', marginBottom: 8 },
  expiryText: { fontSize: 12, color: '#64748B' },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 16, color: '#64748B', marginTop: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1E293B', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: '600', color: '#fff', marginBottom: 20 },
  inputGroup: { marginBottom: 16 },
  inputLabel: { fontSize: 14, color: '#94A3B8', marginBottom: 8 },
  input: { backgroundColor: '#0F172A', borderRadius: 12, padding: 16, fontSize: 16, color: '#fff', borderWidth: 1, borderColor: '#334155' },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelButton: { flex: 1, padding: 16, borderRadius: 12, backgroundColor: '#334155', alignItems: 'center' },
  cancelButtonText: { fontSize: 16, color: '#fff' },
  createButton: { flex: 1, padding: 16, borderRadius: 12, backgroundColor: '#8B5CF6', alignItems: 'center' },
  createButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
