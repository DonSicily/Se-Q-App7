import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, FlatList, ActivityIndicator, Alert, RefreshControl, Modal, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import BACKEND_URL from '../../../utils/config';


// Web-compatible alert helper
const showAlert = (title: string, message: string, buttons?: Array<{text: string, onPress?: () => void}>) => {
  if (Platform.OS === 'web') {
    const result = window.confirm(`${title}\n\n${message}`);
    if (result && buttons) {
      const confirmButton = buttons.find(b => b.text !== 'Cancel');
      if (confirmButton?.onPress) confirmButton.onPress();
    }
  } else {
    Alert.alert(title, message, buttons);
  }
};

export default function AdminTeams() {
  const router = useRouter();
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [creating, setCreating] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadTeams();
    }, [])
  );

  const loadTeams = async () => {
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/admin/login'); return; }
      
      const response = await axios.get(`${BACKEND_URL}/api/admin/security-teams`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      });
      setTeams(response.data || []);
    } catch (error: any) {
      console.error('[AdminTeams] Error:', error?.response?.status);
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        await clearAuthData();
        router.replace('/admin/login');
      }
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTeams();
    setRefreshing(false);
  };

  const createTeam = async () => {
    if (!newTeamName.trim()) {
      showAlert('Error', 'Please enter a team name');
      return;
    }
    setCreating(true);
    try {
      const token = await getAuthToken();
      await axios.post(`${BACKEND_URL}/api/admin/create-team`, {
        name: newTeamName.trim()
      }, { headers: { Authorization: `Bearer ${token}` } });
      showAlert('Success', 'Team created successfully');
      setShowCreateModal(false);
      setNewTeamName('');
      loadTeams();
    } catch (error: any) {
      showAlert('Error', error?.response?.data?.detail || 'Failed to create team');
    } finally {
      setCreating(false);
    }
  };

  const toggleExpand = (teamId: string) => {
    setExpandedTeam(expandedTeam === teamId ? null : teamId);
  };

  const renderMember = (member: any) => (
    <View key={member.id} style={styles.memberCard}>
      <View style={[styles.memberAvatar, { backgroundColor: member.sub_role === 'supervisor' ? '#F59E0B20' : '#3B82F620' }]}>
        <Ionicons name={member.sub_role === 'supervisor' ? 'star' : 'person'} size={18} color={member.sub_role === 'supervisor' ? '#F59E0B' : '#3B82F6'} />
      </View>
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>{member.full_name || member.email || 'Unknown'}</Text>
        <Text style={styles.memberEmail}>{member.email}</Text>
        {member.phone && <Text style={styles.memberPhone}>📞 {member.phone}</Text>}
      </View>
      <View style={[styles.statusBadge, { backgroundColor: member.status === 'available' ? '#10B98120' : '#64748B20' }]}>
        <Text style={[styles.statusText, { color: member.status === 'available' ? '#10B981' : '#64748B' }]}>
          {member.status || 'offline'}
        </Text>
      </View>
    </View>
  );

  const renderTeam = ({ item }: any) => (
    <View style={styles.teamCard}>
      <TouchableOpacity style={styles.teamHeader} onPress={() => toggleExpand(item.id)}>
        <View style={styles.teamIcon}>
          <Ionicons name="shield-checkmark" size={24} color="#F59E0B" />
        </View>
        <View style={styles.teamInfo}>
          <Text style={styles.teamName}>{item.name}</Text>
          <Text style={styles.teamStats}>{item.member_count} members · {item.radius_km || 10} km radius</Text>
        </View>
        <Ionicons name={expandedTeam === item.id ? 'chevron-up' : 'chevron-down'} size={24} color="#64748B" />
      </TouchableOpacity>
      
      {expandedTeam === item.id && (
        <View style={styles.teamMembers}>
          {item.members?.length > 0 ? (
            item.members.map(renderMember)
          ) : (
            <Text style={styles.noMembers}>No members in this team</Text>
          )}
        </View>
      )}
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#F59E0B" />
          <Text style={styles.loadingText}>Loading teams...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.replace('/admin/dashboard')} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.title}>Security Teams</Text>
        <Pressable onPress={() => setShowCreateModal(true)} style={styles.addBtn}>
          <Ionicons name="add-circle" size={28} color="#F59E0B" />
        </Pressable>
      </View>

      <FlatList
        data={teams}
        renderItem={renderTeam}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F59E0B" />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={64} color="#64748B" />
            <Text style={styles.emptyText}>No security teams found</Text>
            <Text style={styles.emptySubtext}>Create a team to get started</Text>
          </View>
        }
      />

      <Modal visible={showCreateModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create New Team</Text>
            <TextInput
              style={styles.modalInput}
              value={newTeamName}
              onChangeText={setNewTeamName}
              placeholder="Team name"
              placeholderTextColor="#64748B"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCreateModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.createBtn} onPress={createTeam} disabled={creating}>
                {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Create</Text>}
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
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#94A3B8', marginTop: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  backBtn: { padding: 4 },
  addBtn: { padding: 4, cursor: 'pointer' } as any,
  title: { fontSize: 20, fontWeight: '600', color: '#fff' },
  listContent: { padding: 16 },
  teamCard: { backgroundColor: '#1E293B', borderRadius: 16, marginBottom: 12, overflow: 'hidden' },
  teamHeader: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  teamIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F59E0B20', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  teamInfo: { flex: 1 },
  teamName: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 2 },
  teamStats: { fontSize: 13, color: '#64748B' },
  teamMembers: { backgroundColor: '#0F172A', padding: 12 },
  memberCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', padding: 12, borderRadius: 12, marginBottom: 8 },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 14, fontWeight: '600', color: '#fff' },
  memberEmail: { fontSize: 12, color: '#94A3B8' },
  memberPhone: { fontSize: 11, color: '#10B981', marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  noMembers: { fontSize: 14, color: '#64748B', textAlign: 'center', padding: 16 },
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#64748B', marginTop: 16 },
  emptySubtext: { fontSize: 14, color: '#475569', marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: '#1E293B', borderRadius: 20, padding: 24, width: '100%', maxWidth: 360 },
  modalTitle: { fontSize: 20, fontWeight: '600', color: '#fff', marginBottom: 20, textAlign: 'center' },
  modalInput: { backgroundColor: '#0F172A', borderRadius: 12, padding: 16, color: '#fff', fontSize: 16, marginBottom: 20 },
  modalActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#334155', alignItems: 'center' },
  cancelBtnText: { fontSize: 16, fontWeight: '600', color: '#94A3B8' },
  createBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#F59E0B', alignItems: 'center' },
  createBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
