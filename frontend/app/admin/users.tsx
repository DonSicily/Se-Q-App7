import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  RefreshControl, Alert, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import BACKEND_URL from '../../../utils/config';


export default function AdminUsers() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const initialFilter = (params.filter as string) || (params.role as string) || '';
  const [roleFilter, setRoleFilter] = useState(initialFilter);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadUsers();
  }, [roleFilter]);

  const loadUsers = async () => {
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/admin/login'); return; }

      let url = `${BACKEND_URL}/api/admin/users?limit=200`;
      if (roleFilter) url += `&role=${roleFilter}`;

      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      });
      setUsers(response.data.users || []);
    } catch (error: any) {
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/admin/login');
      } else {
        Alert.alert('Error', 'Failed to load users');
      }
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadUsers();
    setRefreshing(false);
  };

  const toggleUserStatus = async (userId: string, currentStatus: boolean) => {
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/admin/login'); return; }

      await axios.put(
        `${BACKEND_URL}/api/admin/users/${userId}/toggle`,
        {},
        { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
      );
      setUsers(users.map(u => u.id === userId ? { ...u, is_active: !currentStatus } : u));
    } catch (error: any) {
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/admin/login');
      } else {
        Alert.alert('Error', 'Failed to update user status');
      }
    }
  };

  const confirmDeleteUser = (userId: string, userName: string) => {
    Alert.alert(
      'Delete User',
      `Are you sure you want to delete "${userName}"?\n\nThis action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteUser(userId, userName),
        },
      ]
    );
  };

  const deleteUser = async (userId: string, userName: string) => {
    setDeletingId(userId);
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/admin/login'); return; }

      await axios.delete(
        `${BACKEND_URL}/api/admin/users/${userId}`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
      );

      // Remove from local list immediately
      setUsers(prev => prev.filter(u => u.id !== userId));
      Alert.alert('Deleted', `"${userName}" has been removed.`);
    } catch (error: any) {
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/admin/login');
      } else if (error?.response?.status === 404) {
        Alert.alert('Not Found', 'User no longer exists.');
        setUsers(prev => prev.filter(u => u.id !== userId));
      } else {
        Alert.alert('Error', 'Failed to delete user. Please try again.');
      }
    } finally {
      setDeletingId(null);
    }
  };

  const getRoleBadge = (role: string, subRole?: string) => {
    const colors: any = {
      admin: '#8B5CF6',
      security: '#F59E0B',
      civil: '#10B981',
    };
    const color = colors[role] || '#64748B';
    return (
      <View style={[styles.badge, { backgroundColor: `${color}20` }]}>
        <Text style={[styles.badgeText, { color }]}>
          {role.toUpperCase()}{subRole ? ` · ${subRole}` : ''}
        </Text>
      </View>
    );
  };

  const filteredUsers = users.filter(u =>
    u.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.phone?.includes(searchQuery)
  );

  const renderUser = ({ item }: any) => {
    const isDeleting = deletingId === item.id;
    const displayName = item.full_name?.trim() || item.email || 'Unknown User';

    return (
      <View style={[styles.userCard, !item.is_active && styles.inactiveCard]}>

        {/* ── Delete icon — top-right corner ─────────────────────────── */}
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => confirmDeleteUser(item.id, displayName)}
          disabled={isDeleting}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color="#EF4444" />
          ) : (
            <Ionicons name="trash" size={18} color="#EF4444" />
          )}
        </TouchableOpacity>

        {/* ── User info row ───────────────────────────────────────────── */}
        <View style={styles.userInfo}>
          <View style={styles.avatar}>
            <Ionicons
              name={item.role === 'security' ? 'shield' : item.role === 'admin' ? 'key' : 'person'}
              size={22}
              color={item.role === 'security' ? '#F59E0B' : item.role === 'admin' ? '#8B5CF6' : '#64748B'}
            />
          </View>

          <View style={styles.userDetails}>
            <Text style={styles.userName} numberOfLines={1}>{displayName}</Text>
            <Text style={styles.userEmail} numberOfLines={1}>{item.email}</Text>
            {item.phone ? (
              <Text style={styles.userPhone}>📞 {item.phone}</Text>
            ) : null}
            <View style={styles.badgeRow}>
              {getRoleBadge(item.role, item.security_sub_role)}
              {item.team_name ? (
                <Text style={styles.teamName}>{item.team_name}</Text>
              ) : null}
            </View>
          </View>

          {/* Active / Deactivate toggle */}
          <View style={styles.userActions}>
            <View style={[styles.statusDot, { backgroundColor: item.is_active ? '#10B981' : '#EF4444' }]} />
            <TouchableOpacity
              style={styles.toggleButton}
              onPress={() => toggleUserStatus(item.id, item.is_active)}
            >
              <Ionicons
                name={item.is_active ? 'close-circle' : 'checkmark-circle'}
                size={26}
                color={item.is_active ? '#EF4444' : '#10B981'}
              />
            </TouchableOpacity>
          </View>
        </View>

      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/admin/dashboard')}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>User Management</Text>
        <Text style={styles.count}>{filteredUsers.length}</Text>
      </View>

      <View style={styles.filters}>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color="#64748B" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search name, email or phone..."
            placeholderTextColor="#64748B"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color="#64748B" />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.filterButtons}>
          {['', 'civil', 'security', 'admin'].map(role => (
            <TouchableOpacity
              key={role}
              style={[styles.filterButton, roleFilter === role && styles.filterButtonActive]}
              onPress={() => setRoleFilter(role)}
            >
              <Text style={[styles.filterButtonText, roleFilter === role && styles.filterButtonTextActive]}>
                {role || 'All'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#8B5CF6" />
          <Text style={styles.loadingText}>Loading users…</Text>
        </View>
      ) : (
        <FlatList
          data={filteredUsers}
          renderItem={renderUser}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={52} color="#334155" />
              <Text style={styles.emptyText}>No users found</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#0F172A' },
  header:               { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  title:                { fontSize: 20, fontWeight: '600', color: '#fff' },
  count:                { fontSize: 14, color: '#64748B', fontWeight: '500', minWidth: 24, textAlign: 'right' },
  filters:              { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  searchContainer:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 12, paddingHorizontal: 14, gap: 8 },
  searchInput:          { flex: 1, paddingVertical: 12, fontSize: 15, color: '#fff' },
  filterButtons:        { flexDirection: 'row', gap: 8 },
  filterButton:         { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1E293B' },
  filterButtonActive:   { backgroundColor: '#8B5CF6' },
  filterButtonText:     { fontSize: 13, color: '#64748B', textTransform: 'capitalize' },
  filterButtonTextActive: { color: '#fff', fontWeight: '600' },
  loadingBox:           { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText:          { color: '#94A3B8', marginTop: 12 },
  list:                 { padding: 16, gap: 12 },

  // Card — position relative so the delete icon can sit in the corner
  userCard:             { backgroundColor: '#1E293B', borderRadius: 16, padding: 16, paddingTop: 20, position: 'relative' },
  inactiveCard:         { opacity: 0.55 },

  // ── Trash icon — absolute top-right ──────────────────────────────────────
  deleteBtn:            {
    position: 'absolute',
    top: 10,
    right: 12,
    zIndex: 10,
    backgroundColor: '#EF444415',
    borderRadius: 8,
    padding: 6,
  },

  // User info row
  userInfo:             { flexDirection: 'row', alignItems: 'center' },
  avatar:               { width: 46, height: 46, borderRadius: 23, backgroundColor: '#334155', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  userDetails:          { flex: 1 },
  userName:             { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 2, paddingRight: 32 },
  userEmail:            { fontSize: 13, color: '#94A3B8', marginBottom: 2 },
  userPhone:            { fontSize: 12, color: '#10B981', marginBottom: 4 },
  badgeRow:             { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  badge:                { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText:            { fontSize: 10, fontWeight: '700' },
  teamName:             { fontSize: 11, color: '#64748B' },
  userActions:          { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 8 },
  statusDot:            { width: 9, height: 9, borderRadius: 5 },
  toggleButton:         { padding: 4 },
  empty:                { alignItems: 'center', paddingVertical: 60 },
  emptyText:            { fontSize: 16, color: '#64748B', marginTop: 10 },
});
