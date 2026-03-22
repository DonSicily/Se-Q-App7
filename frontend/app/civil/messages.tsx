import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, TextInput, Modal, RefreshControl, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import BACKEND_URL from '../../../utils/config';


type TabType = 'broadcasts' | 'conversations';

export default function CivilMessages() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('broadcasts');
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [conversations, setConversations] = useState<any[]>([]);
  const [contactableUsers, setContactableUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // New conversation modal
  const [showNewMessageModal, setShowNewMessageModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  
  // Chat view
  const [activeConversation, setActiveConversation] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [chatMessage, setChatMessage] = useState('');

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const loadData = async () => {
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/auth/login'); return; }
      
      const headers = { Authorization: `Bearer ${token}` };
      
      const [broadcastsRes, conversationsRes, usersRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/broadcasts`, { headers, timeout: 10000 }).catch(() => ({ data: { broadcasts: [] } })),
        axios.get(`${BACKEND_URL}/api/chat/conversations`, { headers, timeout: 10000 }).catch(() => ({ data: { conversations: [] } })),
        axios.get(`${BACKEND_URL}/api/users/contactable`, { headers, timeout: 10000 }).catch(() => ({ data: { users: [] } }))
      ]);
      
      setBroadcasts(broadcastsRes.data?.broadcasts || []);
      setConversations(conversationsRes.data?.conversations || []);
      setContactableUsers(usersRes.data?.users || []);
    } catch (error: any) {
      console.error('[Messages] Load error:', error?.response?.status);
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
      }
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const loadMessages = async (conversationId: string) => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      
      const response = await axios.get(`${BACKEND_URL}/api/chat/${conversationId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });
      setMessages(response.data?.messages || []);
    } catch (error) {
      console.error('[Messages] Load messages error:', error);
    }
  };

  const openConversation = async (conv: any) => {
    setActiveConversation(conv);
    await loadMessages(conv.id);
  };

  const sendMessage = async () => {
    if (!chatMessage.trim() || !activeConversation) return;
    setSending(true);
    
    try {
      const token = await getAuthToken();
      if (!token) return;
      
      await axios.post(`${BACKEND_URL}/api/chat/send`, {
        to_user_id: activeConversation.other_user.id,
        content: chatMessage.trim(),
        message_type: 'text'
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });
      
      setChatMessage('');
      await loadMessages(activeConversation.id);
      loadData();
    } catch (error) {
      console.error('[Messages] Send error:', error);
    } finally {
      setSending(false);
    }
  };

  const startNewConversation = async () => {
    if (!selectedUser || !newMessage.trim()) return;
    setSending(true);
    
    try {
      const token = await getAuthToken();
      if (!token) return;
      
      // Start conversation
      await axios.post(`${BACKEND_URL}/api/chat/start`, {
        other_user_id: selectedUser.id
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });
      
      // Send message
      await axios.post(`${BACKEND_URL}/api/chat/send`, {
        to_user_id: selectedUser.id,
        content: newMessage.trim(),
        message_type: 'text'
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });
      
      setShowNewMessageModal(false);
      setSelectedUser(null);
      setNewMessage('');
      setActiveTab('conversations');
      await loadData();
    } catch (error) {
      console.error('[Messages] Start conversation error:', error);
    } finally {
      setSending(false);
    }
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      
      if (diff < 86400000) {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } else if (diff < 604800000) {
        return date.toLocaleDateString('en-US', { weekday: 'short' });
      }
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return ''; }
  };

  const renderBroadcast = ({ item }: any) => (
    <View style={styles.broadcastCard}>
      <View style={styles.broadcastHeader}>
        <View style={styles.broadcastIconWrap}>
          <Ionicons name="megaphone" size={20} color="#F59E0B" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.broadcastTitle}>{item.title}</Text>
          <Text style={styles.broadcastTime}>{formatTime(item.sent_at)} · From Admin</Text>
        </View>
      </View>
      <Text style={styles.broadcastMessage}>{item.message}</Text>
    </View>
  );

  const renderConversation = ({ item }: any) => (
    <TouchableOpacity style={styles.conversationCard} onPress={() => openConversation(item)}>
      <View style={[styles.avatarCircle, { backgroundColor: '#3B82F620' }]}>
        <Ionicons name="person" size={24} color="#3B82F6" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.conversationName}>{item.other_user?.full_name || 'Unknown'}</Text>
        <Text style={styles.conversationPreview} numberOfLines={1}>
          {item.last_message || 'No messages yet'}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.conversationTime}>{formatTime(item.last_message_at)}</Text>
        {item.unread_count > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{item.unread_count}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  const renderMessage = ({ item }: any) => (
    <View style={[styles.messageBubble, item.is_mine ? styles.myMessage : styles.theirMessage]}>
      <Text style={[styles.messageText, item.is_mine && { color: '#fff' }]}>{item.content}</Text>
      <Text style={[styles.messageTime, item.is_mine && { color: '#ffffff80' }]}>{formatTime(item.created_at)}</Text>
    </View>
  );

  // Chat View
  if (activeConversation) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.chatHeader}>
          <TouchableOpacity onPress={() => setActiveConversation(null)} style={{ padding: 4 }}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.chatHeaderName}>{activeConversation.other_user?.full_name || 'Chat'}</Text>
            <Text style={styles.chatHeaderSub}>
              {activeConversation.other_user?.status === 'available' ? '🟢 Online' : '⚫ Offline'}
            </Text>
          </View>
          <TouchableOpacity onPress={() => loadMessages(activeConversation.id)}>
            <Ionicons name="refresh" size={22} color="#3B82F6" />
          </TouchableOpacity>
        </View>
        
        <FlatList
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesList}
          inverted={false}
        />
        
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.chatInputRow}>
            <TextInput
              style={styles.chatInput}
              placeholder="Type a message..."
              placeholderTextColor="#64748B"
              value={chatMessage}
              onChangeText={setChatMessage}
              multiline
            />
            <TouchableOpacity 
              style={[styles.sendBtn, !chatMessage.trim() && styles.sendBtnDisabled]} 
              onPress={sendMessage}
              disabled={!chatMessage.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="send" size={20} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading messages...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/civil/home')}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Message Centre</Text>
        <TouchableOpacity onPress={() => setShowNewMessageModal(true)}>
          <Ionicons name="create-outline" size={26} color="#3B82F6" />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'broadcasts' && styles.tabActive]}
          onPress={() => setActiveTab('broadcasts')}
        >
          <Ionicons name="megaphone" size={18} color={activeTab === 'broadcasts' ? '#F59E0B' : '#64748B'} />
          <Text style={[styles.tabText, activeTab === 'broadcasts' && styles.tabTextActive]}>Broadcasts</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'conversations' && styles.tabActive]}
          onPress={() => setActiveTab('conversations')}
        >
          <Ionicons name="chatbubbles" size={18} color={activeTab === 'conversations' ? '#3B82F6' : '#64748B'} />
          <Text style={[styles.tabText, activeTab === 'conversations' && { color: '#3B82F6' }]}>Conversations</Text>
          {conversations.reduce((acc, c) => acc + (c.unread_count || 0), 0) > 0 && (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeText}>
                {conversations.reduce((acc, c) => acc + (c.unread_count || 0), 0)}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {activeTab === 'broadcasts' ? (
        <FlatList
          data={broadcasts}
          renderItem={renderBroadcast}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F59E0B" />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="megaphone-outline" size={60} color="#334155" />
              <Text style={styles.emptyText}>No broadcasts yet</Text>
              <Text style={styles.emptySubtext}>Admin announcements will appear here</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={conversations}
          renderItem={renderConversation}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3B82F6" />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="chatbubbles-outline" size={60} color="#334155" />
              <Text style={styles.emptyText}>No conversations yet</Text>
              <Text style={styles.emptySubtext}>Tap + to start a new message</Text>
            </View>
          }
        />
      )}

      {/* New Message Modal */}
      <Modal visible={showNewMessageModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Message</Text>
              <TouchableOpacity onPress={() => { setShowNewMessageModal(false); setSelectedUser(null); setNewMessage(''); }}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalLabel}>Select Recipient</Text>
            <FlatList
              data={contactableUsers}
              keyExtractor={(item) => item.id}
              style={styles.usersList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.userItem, selectedUser?.id === item.id && styles.userItemSelected]}
                  onPress={() => setSelectedUser(item)}
                >
                  <View style={[styles.avatarCircle, { width: 40, height: 40, backgroundColor: item.role === 'security' ? '#3B82F620' : '#10B98120' }]}>
                    <Ionicons name={item.role === 'security' ? 'shield' : 'person'} size={18} color={item.role === 'security' ? '#3B82F6' : '#10B981'} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.userName}>{item.full_name}</Text>
                    <Text style={styles.userRole}>{item.role === 'security' ? '🛡 Security' : '🙋 Civilian'}</Text>
                  </View>
                  {selectedUser?.id === item.id && <Ionicons name="checkmark-circle" size={24} color="#3B82F6" />}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.noUsersText}>No users available to message</Text>
              }
            />

            {selectedUser && (
              <>
                <Text style={styles.modalLabel}>Message</Text>
                <TextInput
                  style={styles.messageInput}
                  placeholder="Type your message..."
                  placeholderTextColor="#64748B"
                  value={newMessage}
                  onChangeText={setNewMessage}
                  multiline
                  numberOfLines={4}
                />
              </>
            )}

            <TouchableOpacity
              style={[styles.sendButton, (!selectedUser || !newMessage.trim()) && styles.sendButtonDisabled]}
              onPress={startNewConversation}
              disabled={!selectedUser || !newMessage.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="send" size={20} color="#fff" />
                  <Text style={styles.sendButtonText}>Send Message</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#94A3B8', marginTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  title: { fontSize: 20, fontWeight: '600', color: '#fff' },
  tabs: { flexDirection: 'row', padding: 12, gap: 8 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: '#1E293B' },
  tabActive: { backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#F59E0B30' },
  tabText: { fontSize: 14, fontWeight: '500', color: '#64748B' },
  tabTextActive: { color: '#F59E0B' },
  tabBadge: { backgroundColor: '#EF4444', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  tabBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  listContent: { padding: 16 },
  
  broadcastCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 16, marginBottom: 12, borderLeftWidth: 3, borderLeftColor: '#F59E0B' },
  broadcastHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  broadcastIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F59E0B20', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  broadcastTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
  broadcastTime: { fontSize: 12, color: '#64748B', marginTop: 2 },
  broadcastMessage: { fontSize: 14, color: '#CBD5E1', lineHeight: 20 },
  
  conversationCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 14, padding: 14, marginBottom: 10, gap: 12 },
  avatarCircle: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  conversationName: { fontSize: 15, fontWeight: '600', color: '#fff' },
  conversationPreview: { fontSize: 13, color: '#94A3B8', marginTop: 2 },
  conversationTime: { fontSize: 11, color: '#64748B' },
  unreadBadge: { backgroundColor: '#3B82F6', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginTop: 4 },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 18, color: '#475569', marginTop: 16, fontWeight: '500' },
  emptySubtext: { fontSize: 14, color: '#334155', marginTop: 4 },
  
  chatHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  chatHeaderName: { fontSize: 17, fontWeight: '600', color: '#fff' },
  chatHeaderSub: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  messagesList: { padding: 16, paddingBottom: 8 },
  messageBubble: { maxWidth: '80%', padding: 12, borderRadius: 16, marginBottom: 8 },
  myMessage: { alignSelf: 'flex-end', backgroundColor: '#3B82F6', borderBottomRightRadius: 4 },
  theirMessage: { alignSelf: 'flex-start', backgroundColor: '#1E293B', borderBottomLeftRadius: 4 },
  messageText: { fontSize: 15, color: '#E2E8F0', lineHeight: 20 },
  messageTime: { fontSize: 10, color: '#64748B', marginTop: 4, textAlign: 'right' },
  chatInputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, borderTopWidth: 1, borderTopColor: '#1E293B', gap: 10 },
  chatInput: { flex: 1, backgroundColor: '#1E293B', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 12, color: '#fff', fontSize: 15, maxHeight: 100 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#3B82F6', justifyContent: 'center', alignItems: 'center' },
  sendBtnDisabled: { backgroundColor: '#334155' },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalContainer: { backgroundColor: '#1E293B', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '600', color: '#fff' },
  modalLabel: { fontSize: 14, fontWeight: '500', color: '#94A3B8', marginBottom: 8, marginTop: 12 },
  usersList: { maxHeight: 220 },
  userItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, marginBottom: 8, backgroundColor: '#0F172A', gap: 12 },
  userItemSelected: { borderWidth: 1, borderColor: '#3B82F6' },
  userName: { fontSize: 15, fontWeight: '500', color: '#fff' },
  userRole: { fontSize: 12, color: '#64748B', marginTop: 2 },
  noUsersText: { color: '#64748B', textAlign: 'center', padding: 20 },
  messageInput: { backgroundColor: '#0F172A', borderRadius: 12, padding: 14, color: '#fff', fontSize: 15, minHeight: 80, textAlignVertical: 'top' },
  sendButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#3B82F6', paddingVertical: 14, borderRadius: 12, marginTop: 16 },
  sendButtonDisabled: { backgroundColor: '#334155' },
  sendButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
