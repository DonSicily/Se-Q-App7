import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, TextInput, KeyboardAvoidingView, Platform, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getAuthToken, clearAuthData } from '../../../utils/auth';
import BACKEND_URL from '../../../../utils/config';


export default function ChatConversation() {
  const router = useRouter();
  const { id: conversationId } = useLocalSearchParams();
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [otherUser, setOtherUser] = useState<any>(null);
  const flatListRef = useRef<FlatList>(null);
  const refreshInterval = useRef<any>(null);

  useEffect(() => {
    loadMessages();
    // Refresh messages every 5 seconds
    refreshInterval.current = setInterval(loadMessages, 5000);
    return () => {
      if (refreshInterval.current) clearInterval(refreshInterval.current);
    };
  }, []);

  const loadMessages = async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }
      
      const response = await axios.get(`${BACKEND_URL}/api/chat/${conversationId}/messages?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      });
      setMessages(response.data.messages || []);
      
      // Get other user info from conversations if needed
      if (!otherUser) {
        const convResponse = await axios.get(`${BACKEND_URL}/api/chat/conversations`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15000
        });
        const conv = convResponse.data.conversations?.find((c: any) => c.id === conversationId);
        if (conv) setOtherUser(conv.other_user);
      }
    } catch (error: any) {
      console.error('[ChatConversation] Failed to load messages:', error?.response?.status);
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
      }
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || sending) return;
    
    setSending(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }
      
      await axios.post(`${BACKEND_URL}/api/chat/send`, {
        to_user_id: otherUser?.id,
        content: newMessage.trim(),
        message_type: 'text'
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      });
      
      setNewMessage('');
      await loadMessages();
      flatListRef.current?.scrollToEnd({ animated: true });
    } catch (error: any) {
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
        return;
      }
      Alert.alert('Error', error.response?.data?.detail || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const initiateCall = () => {
    Alert.alert(
      'Voice Call',
      `Call ${otherUser?.full_name || 'this user'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Call', onPress: () => {
          // In production, integrate with a VoIP service like Twilio
          Alert.alert('Calling...', 'Voice call feature requires VoIP integration (Twilio/Agora)');
        }}
      ]
    );
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderMessage = ({ item }: any) => (
    <View style={[styles.messageBubble, item.is_mine ? styles.myMessage : styles.theirMessage]}>
      <Text style={[styles.messageText, item.is_mine ? styles.myMessageText : styles.theirMessageText]}>
        {item.content}
      </Text>
      <Text style={[styles.messageTime, item.is_mine ? styles.myMessageTime : styles.theirMessageTime]}>
        {formatTime(item.created_at)}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace("/security/chat")} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        
        <View style={styles.headerInfo}>
          <View style={styles.headerAvatar}>
            <Ionicons name="shield" size={20} color="#F59E0B" />
          </View>
          <View>
            <Text style={styles.headerName} numberOfLines={1}>
              {otherUser?.full_name || 'Loading...'}
            </Text>
            <Text style={styles.headerStatus}>
              {otherUser?.security_sub_role === 'supervisor' ? '⭐ Supervisor' : 'Team Member'}
            </Text>
          </View>
        </View>

        <TouchableOpacity style={styles.callButton} onPress={initiateCall}>
          <Ionicons name="call" size={22} color="#10B981" />
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messagesList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="chatbubble-outline" size={48} color="#334155" />
            <Text style={styles.emptyText}>No messages yet</Text>
            <Text style={styles.emptySubtext}>Send a message to start the conversation</Text>
          </View>
        }
      />

      {/* Input */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            placeholder="Type a message..."
            placeholderTextColor="#64748B"
            value={newMessage}
            onChangeText={setNewMessage}
            multiline
            maxLength={1000}
          />
          <TouchableOpacity 
            style={[styles.sendButton, (!newMessage.trim() || sending) && styles.sendButtonDisabled]} 
            onPress={sendMessage}
            disabled={!newMessage.trim() || sending}
          >
            <Ionicons name="send" size={20} color={newMessage.trim() && !sending ? '#fff' : '#64748B'} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#1E293B', borderBottomWidth: 1, borderBottomColor: '#334155' },
  backButton: { padding: 4, marginRight: 8 },
  headerInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F59E0B20', justifyContent: 'center', alignItems: 'center' },
  headerName: { fontSize: 16, fontWeight: '600', color: '#fff' },
  headerStatus: { fontSize: 12, color: '#94A3B8' },
  callButton: { padding: 8, backgroundColor: '#10B98120', borderRadius: 20 },
  messagesList: { padding: 16, flexGrow: 1 },
  messageBubble: { maxWidth: '80%', padding: 12, borderRadius: 16, marginBottom: 8 },
  myMessage: { alignSelf: 'flex-end', backgroundColor: '#3B82F6', borderBottomRightRadius: 4 },
  theirMessage: { alignSelf: 'flex-start', backgroundColor: '#1E293B', borderBottomLeftRadius: 4 },
  messageText: { fontSize: 15, lineHeight: 20 },
  myMessageText: { color: '#fff' },
  theirMessageText: { color: '#fff' },
  messageTime: { fontSize: 10, marginTop: 4 },
  myMessageTime: { color: '#93C5FD', textAlign: 'right' },
  theirMessageTime: { color: '#64748B' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 16, color: '#64748B', marginTop: 12 },
  emptySubtext: { fontSize: 14, color: '#475569', marginTop: 4 },
  inputContainer: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, backgroundColor: '#1E293B', borderTopWidth: 1, borderTopColor: '#334155', gap: 8 },
  textInput: { flex: 1, backgroundColor: '#0F172A', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 16, color: '#fff', maxHeight: 100, borderWidth: 1, borderColor: '#334155' },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#3B82F6', justifyContent: 'center', alignItems: 'center' },
  sendButtonDisabled: { backgroundColor: '#334155' },
});
