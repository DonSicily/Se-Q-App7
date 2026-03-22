/**
 * security/messages.tsx — Phase 4a
 *
 * Security Message Centre — identical design & full functionality
 * to civil/messages.tsx (Phase 4a spec).
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, TextInput, Modal, RefreshControl,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import BACKEND_URL from '../../../utils/config';


type TabType = 'broadcasts' | 'conversations';

export default function SecurityMessages() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('conversations');
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [conversations, setConversations] = useState<any[]>([]);
  const [contactableUsers, setContactableUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // New conversation modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  // Chat view
  const [activeConv, setActiveConv] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [chatMsg, setChatMsg] = useState('');

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
      const [bc, cv, us] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/broadcasts`, { headers, timeout: 10000 }).catch(() => ({ data: { broadcasts: [] } })),
        axios.get(`${BACKEND_URL}/api/chat/conversations`, { headers, timeout: 10000 }).catch(() => ({ data: { conversations: [] } })),
        axios.get(`${BACKEND_URL}/api/users/contactable`, { headers, timeout: 10000 }).catch(() => ({ data: { users: [] } })),
      ]);
      setBroadcasts(bc.data?.broadcasts || []);
      setConversations(cv.data?.conversations || []);
      setContactableUsers(us.data?.users || []);
    } catch (err: any) {
      if (err?.response?.status === 401) { await clearAuthData(); router.replace('/auth/login'); }
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const loadMessages = async (convId: string) => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      const res = await axios.get(`${BACKEND_URL}/api/chat/${convId}/messages`, {
        headers: { Authorization: `Bearer ${token}` }, timeout: 10000,
      });
      setMessages(res.data?.messages || []);
    } catch (_) {}
  };

  const openConv = async (conv: any) => { setActiveConv(conv); await loadMessages(conv.id); };

  const sendMessage = async () => {
    if (!chatMsg.trim() || !activeConv) return;
    setSending(true);
    try {
      const token = await getAuthToken();
      if (!token) return;
      await axios.post(`${BACKEND_URL}/api/chat/send`,
        { to_user_id: activeConv.other_user.id, content: chatMsg.trim(), message_type: 'text' },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
      );
      setChatMsg('');
      await loadMessages(activeConv.id);
      loadData();
    } catch (_) {}
    finally { setSending(false); }
  };

  const startNewConv = async () => {
    if (!selectedUser || !newMessage.trim()) return;
    setSending(true);
    try {
      const token = await getAuthToken();
      if (!token) return;
      await axios.post(`${BACKEND_URL}/api/chat/start`,
        { to_user_id: selectedUser.id },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
      );
      await axios.post(`${BACKEND_URL}/api/chat/send`,
        { to_user_id: selectedUser.id, content: newMessage.trim(), message_type: 'text' },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
      );
      setShowNewModal(false); setSelectedUser(null); setNewMessage(''); setUserSearch('');
      setActiveTab('conversations');
      await loadData();
    } catch (_) {}
    finally { setSending(false); }
  };

  const fmtTime = (iso: string) => {
    try {
      const d = new Date(iso); const now = new Date(); const diff = now.getTime() - d.getTime();
      if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      if (diff < 604800000) return d.toLocaleDateString('en-US', { weekday: 'short' });
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return ''; }
  };

  const filtered = contactableUsers.filter(u =>
    !userSearch ||
    u.full_name?.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.email?.toLowerCase().includes(userSearch.toLowerCase())
  );

  // ── Chat view ─────────────────────────────────────────────────────────────
  if (activeConv) {
    return (
      <SafeAreaView style={st.container}>
        <View style={st.chatHeader}>
          <TouchableOpacity onPress={() => setActiveConv(null)} style={{ padding: 4 }}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={st.chatName}>{activeConv.other_user?.full_name || 'Chat'}</Text>
            <Text style={st.chatSub}>{activeConv.other_user?.status === 'available' ? '🟢 Online' : '⚫ Offline'}</Text>
          </View>
          <TouchableOpacity onPress={() => loadMessages(activeConv.id)}>
            <Ionicons name="refresh" size={22} color="#3B82F6" />
          </TouchableOpacity>
        </View>
        <FlatList
          data={messages}
          keyExtractor={item => item.id}
          contentContainerStyle={st.msgList}
          renderItem={({ item }) => (
            <View style={[st.bubble, item.is_mine ? st.mine : st.theirs]}>
              <Text style={[st.bubbleText, item.is_mine && { color: '#fff' }]}>{item.content}</Text>
              <Text style={[st.bubbleTime, item.is_mine && { color: '#ffffff80' }]}>{fmtTime(item.created_at)}</Text>
            </View>
          )}
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={st.inputRow}>
            <TextInput
              style={st.input}
              placeholder="Type a message…"
              placeholderTextColor="#64748B"
              value={chatMsg}
              onChangeText={setChatMsg}
              multiline
            />
            <TouchableOpacity
              style={[st.sendBtn, !chatMsg.trim() && st.sendBtnOff]}
              onPress={sendMessage}
              disabled={!chatMsg.trim() || sending}
            >
              {sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={20} color="#fff" />}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={st.container}>
        <View style={st.loadBox}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={st.loadText}>Loading messages…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.container}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.replace('/security/home')}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={st.title}>Message Centre</Text>
        <TouchableOpacity onPress={() => { setShowNewModal(true); setUserSearch(''); }}>
          <Ionicons name="create-outline" size={26} color="#3B82F6" />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={st.tabs}>
        <TouchableOpacity
          style={[st.tab, activeTab === 'broadcasts' && st.tabActive]}
          onPress={() => setActiveTab('broadcasts')}
        >
          <Ionicons name="megaphone" size={18} color={activeTab === 'broadcasts' ? '#F59E0B' : '#64748B'} />
          <Text style={[st.tabText, activeTab === 'broadcasts' && { color: '#F59E0B' }]}>Broadcasts</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[st.tab, activeTab === 'conversations' && st.tabActive]}
          onPress={() => setActiveTab('conversations')}
        >
          <Ionicons name="chatbubbles" size={18} color={activeTab === 'conversations' ? '#3B82F6' : '#64748B'} />
          <Text style={[st.tabText, activeTab === 'conversations' && { color: '#3B82F6' }]}>Conversations</Text>
          {conversations.reduce((a, c) => a + (c.unread_count || 0), 0) > 0 && (
            <View style={st.tabBadge}>
              <Text style={st.tabBadgeText}>{conversations.reduce((a, c) => a + (c.unread_count || 0), 0)}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {activeTab === 'broadcasts' ? (
        <FlatList
          data={broadcasts}
          keyExtractor={item => item.id}
          contentContainerStyle={st.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F59E0B" />}
          renderItem={({ item }) => (
            <View style={st.bcCard}>
              <View style={st.bcHeader}>
                <View style={st.bcIcon}><Ionicons name="megaphone" size={20} color="#F59E0B" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={st.bcTitle}>{item.title}</Text>
                  <Text style={st.bcTime}>{fmtTime(item.sent_at)} · From Admin</Text>
                </View>
              </View>
              <Text style={st.bcMsg}>{item.message}</Text>
            </View>
          )}
          ListEmptyComponent={
            <View style={st.empty}>
              <Ionicons name="megaphone-outline" size={60} color="#334155" />
              <Text style={st.emptyText}>No broadcasts yet</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={item => item.id}
          contentContainerStyle={st.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3B82F6" />}
          renderItem={({ item }) => (
            <TouchableOpacity style={st.convCard} onPress={() => openConv(item)}>
              <View style={st.avatar}><Ionicons name="person" size={24} color="#3B82F6" /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.convName}>{item.other_user?.full_name || 'Unknown'}</Text>
                <Text style={st.convPrev} numberOfLines={1}>{item.last_message || 'No messages yet'}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={st.convTime}>{fmtTime(item.last_message_at)}</Text>
                {item.unread_count > 0 && (
                  <View style={st.unread}><Text style={st.unreadText}>{item.unread_count}</Text></View>
                )}
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={st.empty}>
              <Ionicons name="chatbubbles-outline" size={60} color="#334155" />
              <Text style={st.emptyText}>No conversations yet</Text>
              <Text style={st.emptySub}>Tap + to start a message</Text>
            </View>
          }
        />
      )}

      {/* New Message Modal */}
      <Modal visible={showNewModal} animationType="slide" transparent>
        <View style={st.modalOverlay}>
          <View style={st.modalBox}>
            <View style={st.modalHeader}>
              <Text style={st.modalTitle}>New Message</Text>
              <TouchableOpacity onPress={() => { setShowNewModal(false); setSelectedUser(null); setNewMessage(''); setUserSearch(''); }}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>

            <TextInput
              style={st.searchInput}
              placeholder="Search by name or email…"
              placeholderTextColor="#64748B"
              value={userSearch}
              onChangeText={setUserSearch}
              autoCapitalize="none"
            />

            <Text style={st.modalLabel}>Select Recipient</Text>
            <FlatList
              data={filtered}
              keyExtractor={item => item.id}
              style={{ maxHeight: 200 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[st.userItem, selectedUser?.id === item.id && st.userItemSel]}
                  onPress={() => setSelectedUser(item)}
                >
                  <View style={[st.userAvatar, { backgroundColor: item.role === 'security' ? '#3B82F620' : '#10B98120' }]}>
                    <Ionicons name={item.role === 'security' ? 'shield' : 'person'} size={18} color={item.role === 'security' ? '#3B82F6' : '#10B981'} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.userName}>{item.full_name}</Text>
                    <Text style={st.userRole}>{item.role === 'security' ? '🛡 Security' : '🙋 Civilian'}</Text>
                  </View>
                  {selectedUser?.id === item.id && <Ionicons name="checkmark-circle" size={24} color="#3B82F6" />}
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={st.noUsers}>No users found</Text>}
            />

            {selectedUser && (
              <>
                <Text style={st.modalLabel}>Message</Text>
                <TextInput
                  style={st.msgInput}
                  placeholder="Type your message…"
                  placeholderTextColor="#64748B"
                  value={newMessage}
                  onChangeText={setNewMessage}
                  multiline
                  numberOfLines={4}
                />
              </>
            )}

            <TouchableOpacity
              style={[st.sendButton, (!selectedUser || !newMessage.trim()) && st.sendButtonOff]}
              onPress={startNewConv}
              disabled={!selectedUser || !newMessage.trim() || sending}
            >
              {sending ? <ActivityIndicator size="small" color="#fff" /> : (
                <><Ionicons name="send" size={20} color="#fff" /><Text style={st.sendButtonText}>Send Message</Text></>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  loadBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadText: { color: '#94A3B8', marginTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  title: { fontSize: 20, fontWeight: '600', color: '#fff' },
  tabs: { flexDirection: 'row', padding: 12, gap: 8 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: '#1E293B' },
  tabActive: { borderWidth: 1, borderColor: '#3B82F630' },
  tabText: { fontSize: 14, fontWeight: '500', color: '#64748B' },
  tabBadge: { backgroundColor: '#EF4444', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  tabBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  list: { padding: 16 },
  bcCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 16, marginBottom: 12, borderLeftWidth: 3, borderLeftColor: '#F59E0B' },
  bcHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  bcIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F59E0B20', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  bcTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
  bcTime: { fontSize: 12, color: '#64748B', marginTop: 2 },
  bcMsg: { fontSize: 14, color: '#CBD5E1', lineHeight: 20 },
  convCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 14, padding: 14, marginBottom: 10, gap: 12 },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#3B82F620', justifyContent: 'center', alignItems: 'center' },
  convName: { fontSize: 15, fontWeight: '600', color: '#fff' },
  convPrev: { fontSize: 13, color: '#94A3B8', marginTop: 2 },
  convTime: { fontSize: 11, color: '#64748B' },
  unread: { backgroundColor: '#3B82F6', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginTop: 4 },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 18, color: '#475569', marginTop: 16, fontWeight: '500' },
  emptySub: { fontSize: 14, color: '#334155', marginTop: 4 },
  chatHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  chatName: { fontSize: 17, fontWeight: '600', color: '#fff' },
  chatSub: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  msgList: { padding: 16, paddingBottom: 8 },
  bubble: { maxWidth: '80%', padding: 12, borderRadius: 16, marginBottom: 8 },
  mine: { alignSelf: 'flex-end', backgroundColor: '#3B82F6', borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#1E293B', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, color: '#E2E8F0', lineHeight: 20 },
  bubbleTime: { fontSize: 10, color: '#64748B', marginTop: 4, textAlign: 'right' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, borderTopWidth: 1, borderTopColor: '#1E293B', gap: 10 },
  input: { flex: 1, backgroundColor: '#1E293B', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 12, color: '#fff', fontSize: 15, maxHeight: 100 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#3B82F6', justifyContent: 'center', alignItems: 'center' },
  sendBtnOff: { backgroundColor: '#334155' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#1E293B', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '600', color: '#fff' },
  modalLabel: { fontSize: 14, fontWeight: '500', color: '#94A3B8', marginBottom: 8, marginTop: 12 },
  searchInput: { backgroundColor: '#0F172A', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, color: '#fff', fontSize: 15, marginBottom: 4 },
  userItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, marginBottom: 8, backgroundColor: '#0F172A', gap: 12 },
  userItemSel: { borderWidth: 1, borderColor: '#3B82F6' },
  userAvatar: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  userName: { fontSize: 15, fontWeight: '500', color: '#fff' },
  userRole: { fontSize: 12, color: '#64748B', marginTop: 2 },
  noUsers: { color: '#64748B', textAlign: 'center', padding: 20 },
  msgInput: { backgroundColor: '#0F172A', borderRadius: 12, padding: 14, color: '#fff', fontSize: 15, minHeight: 80, textAlignVertical: 'top' },
  sendButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#3B82F6', paddingVertical: 14, borderRadius: 12, marginTop: 16 },
  sendButtonOff: { backgroundColor: '#334155' },
  sendButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
