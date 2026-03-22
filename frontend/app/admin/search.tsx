import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, FlatList, ActivityIndicator, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import BACKEND_URL from '../../../utils/config';


type DataType = 'all' | 'panics' | 'reports' | 'users';
type SearchField = 'all' | 'name' | 'email' | 'phone' | 'date';

export default function AdminSearch() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [dataType, setDataType] = useState<DataType>('all');
  const [searchField, setSearchField] = useState<SearchField>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const searchData = async () => {
    if (!searchQuery && !startDate && !endDate) {
      Alert.alert('Search', 'Please enter a search term or select date range');
      return;
    }

    setLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/admin/login');
        return;
      }

      const response = await axios.get(`${BACKEND_URL}/api/admin/search`, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          query: searchQuery,
          data_type: dataType,
          field: searchField,
          start_date: startDate,
          end_date: endDate
        },
        timeout: 30000
      });
      
      setResults(response.data.results || []);
      
      if (response.data.results?.length === 0) {
        Alert.alert('No Results', 'No data found matching your search criteria');
      }
    } catch (error: any) {
      console.error('[AdminSearch] Error:', error);
      Alert.alert('Error', error?.response?.data?.detail || 'Failed to search');
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = async () => {
    if (results.length === 0) {
      Alert.alert('Export', 'No data to export. Perform a search first.');
      return;
    }

    setExporting(true);
    try {
      const token = await getAuthToken();
      if (!token) return;

      // Generate CSV content
      const headers = Object.keys(results[0]).join(',');
      const rows = results.map(item => 
        Object.values(item).map(val => {
          const strVal = String(val).replace(/"/g, '""');
          return `"${strVal}"`;
        }).join(',')
      ).join('\n');
      
      const csvContent = `${headers}\n${rows}`;
      
      if (Platform.OS === 'web') {
        // Web download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `safeguard_export_${Date.now()}.csv`;
        link.click();
        Alert.alert('Success', 'Data exported successfully');
      } else {
        // Native file save
        const fileUri = FileSystem.documentDirectory + `safeguard_export_${Date.now()}.csv`;
        await FileSystem.writeAsStringAsync(fileUri, csvContent);
        await Sharing.shareAsync(fileUri, { mimeType: 'text/csv' });
      }
    } catch (error: any) {
      console.error('[AdminSearch] Export error:', error);
      Alert.alert('Error', 'Failed to export data');
    } finally {
      setExporting(false);
    }
  };

  const deleteRecord = async (id: string, type: string) => {
    Alert.alert(
      'Delete Record',
      'Are you sure you want to permanently delete this record? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const token = await getAuthToken();
              if (!token) return;
              
              await axios.delete(`${BACKEND_URL}/api/admin/delete/${type}/${id}`, {
                headers: { Authorization: `Bearer ${token}` },
                timeout: 15000
              });
              
              setResults(prev => prev.filter(item => item.id !== id && item._id !== id));
              Alert.alert('Deleted', 'Record deleted successfully');
            } catch (error: any) {
              Alert.alert('Error', error?.response?.data?.detail || 'Failed to delete record');
            }
          }
        }
      ]
    );
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString();
  };

  const renderResult = ({ item }: any) => {
    const type = item.data_type || 'unknown';
    const iconMap: any = {
      panic: { icon: 'alert-circle', color: '#EF4444' },
      report: { icon: 'videocam', color: '#3B82F6' },
      user: { icon: 'person', color: '#10B981' },
    };
    const iconInfo = iconMap[type] || { icon: 'document', color: '#64748B' };

    return (
      <View style={styles.resultCard}>
        <View style={styles.resultHeader}>
          <View style={[styles.typeIcon, { backgroundColor: `${iconInfo.color}20` }]}>
            <Ionicons name={iconInfo.icon} size={20} color={iconInfo.color} />
          </View>
          <View style={styles.resultInfo}>
            <Text style={styles.resultType}>{type.toUpperCase()}</Text>
            <Text style={styles.resultDate}>{formatDate(item.created_at)}</Text>
          </View>
          <TouchableOpacity 
            style={styles.deleteBtn}
            onPress={() => deleteRecord(item.id || item._id, type)}
          >
            <Ionicons name="trash" size={18} color="#EF4444" />
          </TouchableOpacity>
        </View>
        
        {item.full_name && (
          <Text style={styles.resultDetail}>
            <Text style={styles.resultLabel}>Name: </Text>{item.full_name}
          </Text>
        )}
        {item.email && (
          <Text style={styles.resultDetail}>
            <Text style={styles.resultLabel}>Email: </Text>{item.email}
          </Text>
        )}
        {item.phone && (
          <Text style={styles.resultDetail}>
            <Text style={styles.resultLabel}>Phone: </Text>{item.phone}
          </Text>
        )}
        {item.category && (
          <Text style={styles.resultDetail}>
            <Text style={styles.resultLabel}>Category: </Text>{item.category}
          </Text>
        )}
        {item.caption && (
          <Text style={styles.resultDetail} numberOfLines={2}>
            <Text style={styles.resultLabel}>Caption: </Text>{item.caption}
          </Text>
        )}
        {(item.latitude && item.longitude) && (
          <Text style={styles.resultDetail}>
            <Text style={styles.resultLabel}>Location: </Text>
            {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}
          </Text>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Search & Export</Text>
        <TouchableOpacity 
          onPress={exportToExcel} 
          disabled={exporting || results.length === 0}
          style={[styles.exportBtn, results.length === 0 && { opacity: 0.5 }]}
        >
          {exporting ? (
            <ActivityIndicator size="small" color="#10B981" />
          ) : (
            <Ionicons name="download" size={24} color="#10B981" />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {/* Search Input */}
        <View style={styles.searchBox}>
          <Ionicons name="search" size={20} color="#64748B" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, email, phone..."
            placeholderTextColor="#64748B"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color="#64748B" />
            </TouchableOpacity>
          )}
        </View>

        {/* Data Type Filter */}
        <Text style={styles.filterLabel}>Data Type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
          {(['all', 'panics', 'reports', 'users'] as DataType[]).map((type) => (
            <TouchableOpacity
              key={type}
              style={[styles.filterChip, dataType === type && styles.filterChipActive]}
              onPress={() => setDataType(type)}
            >
              <Text style={[styles.filterChipText, dataType === type && styles.filterChipTextActive]}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Search Field Filter */}
        <Text style={styles.filterLabel}>Search Field</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
          {(['all', 'name', 'email', 'phone', 'date'] as SearchField[]).map((field) => (
            <TouchableOpacity
              key={field}
              style={[styles.filterChip, searchField === field && styles.filterChipActive]}
              onPress={() => setSearchField(field)}
            >
              <Text style={[styles.filterChipText, searchField === field && styles.filterChipTextActive]}>
                {field.charAt(0).toUpperCase() + field.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Date Range */}
        <Text style={styles.filterLabel}>Date Range (YYYY-MM-DD)</Text>
        <View style={styles.dateRow}>
          <TextInput
            style={styles.dateInput}
            placeholder="Start Date"
            placeholderTextColor="#64748B"
            value={startDate}
            onChangeText={setStartDate}
          />
          <Text style={styles.dateSeparator}>to</Text>
          <TextInput
            style={styles.dateInput}
            placeholder="End Date"
            placeholderTextColor="#64748B"
            value={endDate}
            onChangeText={setEndDate}
          />
        </View>

        {/* Search Button */}
        <TouchableOpacity style={styles.searchBtn} onPress={searchData} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="search" size={20} color="#fff" />
              <Text style={styles.searchBtnText}>Search</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Results Count */}
        {results.length > 0 && (
          <View style={styles.resultsHeader}>
            <Text style={styles.resultsCount}>{results.length} results found</Text>
            <TouchableOpacity onPress={exportToExcel} disabled={exporting}>
              <Text style={styles.exportText}>Export to CSV</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Results List */}
      <FlatList
        data={results}
        renderItem={renderResult}
        keyExtractor={(item, index) => item.id || item._id || `result-${index}`}
        contentContainerStyle={styles.resultsList}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyState}>
              <Ionicons name="search-outline" size={48} color="#64748B" />
              <Text style={styles.emptyText}>Search for data</Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 20, fontWeight: '600', color: '#fff' },
  exportBtn: { padding: 8 },
  content: { paddingHorizontal: 20 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  searchInput: { flex: 1, color: '#fff', fontSize: 16, marginLeft: 12 },
  filterLabel: { color: '#94A3B8', fontSize: 14, marginTop: 16, marginBottom: 8 },
  filterRow: { flexDirection: 'row', marginBottom: 8 },
  filterChip: { backgroundColor: '#1E293B', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, marginRight: 8 },
  filterChipActive: { backgroundColor: '#8B5CF6' },
  filterChipText: { color: '#94A3B8', fontSize: 14 },
  filterChipTextActive: { color: '#fff' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dateInput: { flex: 1, backgroundColor: '#1E293B', borderRadius: 12, padding: 14, color: '#fff', fontSize: 14 },
  dateSeparator: { color: '#64748B' },
  searchBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#8B5CF6', paddingVertical: 14, borderRadius: 12, marginTop: 20 },
  searchBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  resultsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, paddingBottom: 10 },
  resultsCount: { color: '#94A3B8', fontSize: 14 },
  exportText: { color: '#10B981', fontSize: 14, fontWeight: '500' },
  resultsList: { paddingHorizontal: 20, paddingBottom: 20 },
  resultCard: { backgroundColor: '#1E293B', borderRadius: 12, padding: 16, marginBottom: 12 },
  resultHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  typeIcon: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  resultInfo: { flex: 1, marginLeft: 12 },
  resultType: { color: '#fff', fontWeight: '600', fontSize: 14 },
  resultDate: { color: '#64748B', fontSize: 12, marginTop: 2 },
  deleteBtn: { padding: 8 },
  resultDetail: { color: '#94A3B8', fontSize: 14, marginBottom: 4 },
  resultLabel: { color: '#64748B' },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: '#64748B', fontSize: 16, marginTop: 12 },
});
