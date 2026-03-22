import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, RefreshControl, Alert, Modal, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getAuthToken, clearAuthData } from '../../../utils/auth';
import BACKEND_URL from '../../../../utils/config';


export default function SecurityChat() {
  const router = useRouter();
  const [conversations, setConversations] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const goBack = () => {
    router.replace('/security/home');
  };

  useEffect(() => {
    loadConversations();
    loadUnreadCount();
  }, []);

  const loadConversations = async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }
      
      const response = await axios.get(`${BACKEND_URL}/api/chat/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      });
      setConversations(response.data.conversations || []);
    } catch (error: any) {
      console.error('[SecurityChat] Failed to load conversations:', error?.response?.status);
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
      }
    }
  };

  const loadUnreadCount = async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      
      const response = await axios.get(`${BACKEND_URL}/api/chat/unread-count`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });
      setUnreadCount(response.data.unread_count || 0);
    } catch (error) {
      console.error('[SecurityChat] Failed to load unread count:', error);
    }
  };

  const loadAvailableUsers = async () => {
    setLoadingUsers(true);
    try {
      const token = await getAuthToken();
      if (!token) return;
      
      // Get nearby security users to chat with
      const response = await axios.get(`${BACKEND_URL}/api/security/nearby-security`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      });
      setAvailableUsers(response.data || []);
    } catch (error: any) {
      console.error('[SecurityChat] Failed to load users:', error);
      Alert.alert('Error', 'Failed to load available users');
    } finally {
      setLoadingUsers(false);
    }
  };

  const startNewConversation = async (userId: string, userName: string) => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      
      // Create or get existing conversation
      const response = await axios.post(
        `${BACKEND_URL}/api/chat/start`,
        { other_user_id: userId },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
      );
      
      setShowNewChatModal(false);
      
      if (response.data.conversation_id) {
        router.push(`/security/chat/${response.data.conversation_id}`);
      } else {
        Alert.alert('Success', `Chat with ${userName} is ready!`);
        loadConversations();
      }
    } catch (error: any) {
      console.error('[SecurityChat] Failed to start conversation:', error);
      Alert.alert('Error', error?.response?.data?.detail || 'Failed to start conversation');
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadConversations();
    await loadUnreadCount();
    setRefreshing(false);
  };

  const getStatusColor = (status: string) => {
    const colors: any = {
      available: '#10B981',
      busy: '#F59E0B',
      responding: '#EF4444',
      offline: '#64748B'
    };
    return colors[status] || '#64748B';
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = diff / (1000 * 60 * 60);
    
    if (hours < 24) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (hours < 48) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString();
    }
  };

  const filteredUsers = availableUsers.filter(user => 
    user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderConversation = ({ item }: any) => (
    <TouchableOpacity 
      style={styles.conversationCard}
      onPress={() => router.push(`/security/chat/${item.id}`)}
    >
      <View style={styles.avatarContainer}>
        <View style={styles.avatar}>
          <Ionicons name="shield" size={24} color="#F59E0B" />
        </View>
        <View style={[styles.statusIndicator, { backgroundColor: getStatusColor(item.other_user?.status) }]} />
      </View>
      
      <View style={styles.conversationInfo}>
        <View style={styles.conversationHeader}>
          <Text style={styles.userName} numberOfLines={1}>
            {item.other_user?.full_name || 'Unknown User'}
          </Text>
          <Text style={styles.timeText}>{formatTime(item.last_message_at)}</Text>
        </View>
        <Text style={styles.subRole}>
          {item.other_user?.security_sub_role === 'supervisor' ? 'Supervisor' : 'Team Member'}
        </Text>
        <Text style={styles.lastMessage} numberOfLines={1}>
          {item.last_message || 'No messages yet'}
        </Text>
      </View>

      {item.unread_count > 0 && (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadText}>{item.unread_count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const renderAvailableUser = ({ item }: any) => (
    <TouchableOpacity 
      style={styles.userCard}
      onPress={() => startNewConversation(item.id || item._id, item.full_name)}
    >
      <View style={styles.userAvatar}>
        <Ionicons name="person" size={24} color="#F59E0B" />
      </View>
      <View style={styles.userInfo}>
        <Text style={styles.userNameText}>{item.full_name || 'Unknown'}</Text>
        <Text style={styles.userEmail}>{item.email}</Text>
      </View>
      <Ionicons name="chatbubble-ellipses" size={24} color="#3B82F6" />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Messages</Text>
          {unreadCount > 0 && (
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{unreadCount}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity onPress={() => {
          setShowNewChatModal(true);
          loadAvailableUsers();
        }}>
          <Ionicons name="create-outline" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={conversations}
        renderItem={renderConversation}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F59E0B" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={64} color="#334155" />
            <Text style={styles.emptyTitle}>No Conversations Yet</Text>
            <Text style={styles.emptyText}>Start a new chat with nearby security users</Text>
            <TouchableOpacity 
              style={styles.findButton}
              onPress={() => {
                setShowNewChatModal(true);
                loadAvailableUsers();
              }}
            >
              <Ionicons name="add-circle" size={20} color="#fff" />
              <Text style={styles.findButtonText}>New Conversation</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* New Chat Modal */}
      <Modal visible={showNewChatModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Start New Chat</Text>
              <TouchableOpacity onPress={() => setShowNewChatModal(false)}>
                <Ionicons name="close" size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            
            <TextInput
              style={styles.searchInput}
              placeholder="Search users..."
              placeholderTextColor="#64748B"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            
            {loadingUsers ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#F59E0B" />
                <Text style={styles.loadingText}>Loading users...</Text>
              </View>
            ) : filteredUsers.length === 0 ? (
              <View style={styles.emptyUsers}>
                <Ionicons name="people-outline" size={48} color="#64748B" />
                <Text style={styles.emptyUsersText}>No users found</Text>
                <Text style={styles.emptyUsersSubtext}>Set your team location to find nearby security agents</Text>
              </View>
            ) : (
              <FlatList
                data={filteredUsers}
                renderItem={renderAvailableUser}
                keyExtractor={(item) => item.id || item._id}
                style={styles.usersList}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 20, fontWeight: '600', color: '#fff' },
  headerBadge: { backgroundColor: '#EF4444', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  headerBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  list: { paddingHorizontal: 16 },
  conversationCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', padding: 16, borderRadius: 12, marginBottom: 12 },
  avatarContainer: { position: 'relative' },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#F59E0B20', justifyContent: 'center', alignItems: 'center' },
  statusIndicator: { position: 'absolute', bottom: 2, right: 2, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#1E293B' },
  conversationInfo: { flex: 1, marginLeft: 12 },
  conversationHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  userName: { fontSize: 16, fontWeight: '600', color: '#fff', flex: 1 },
  timeText: { fontSize: 12, color: '#64748B' },
  subRole: { fontSize: 12, color: '#F59E0B', marginTop: 2 },
  lastMessage: { fontSize: 14, color: '#94A3B8', marginTop: 4 },
  unreadBadge: { backgroundColor: '#EF4444', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  unreadText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: '#fff', marginTop: 16 },
  emptyText: { fontSize: 14, color: '#64748B', marginTop: 8, textAlign: 'center' },
  findButton: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F59E0B', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, marginTop: 24 },
  findButtonText: { color: '#fff', fontWeight: '600' },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1E293B', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80%', paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#334155' },
  modalTitle: { fontSize: 20, fontWeight: '600', color: '#fff' },
  searchInput: { backgroundColor: '#0F172A', margin: 16, padding: 14, borderRadius: 12, color: '#fff', fontSize: 16 },
  loadingContainer: { alignItems: 'center', paddingVertical: 40 },
  loadingText: { color: '#94A3B8', marginTop: 12 },
  emptyUsers: { alignItems: 'center', paddingVertical: 40 },
  emptyUsersText: { color: '#94A3B8', fontSize: 16, marginTop: 12 },
  emptyUsersSubtext: { color: '#64748B', fontSize: 14, marginTop: 4, textAlign: 'center', paddingHorizontal: 20 },
  usersList: { maxHeight: 400 },
  userCard: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#334155' },
  userAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F59E0B20', justifyContent: 'center', alignItems: 'center' },
  userInfo: { flex: 1, marginLeft: 12 },
  userNameText: { fontSize: 16, fontWeight: '500', color: '#fff' },
  userEmail: { fontSize: 13, color: '#64748B', marginTop: 2 },
});
