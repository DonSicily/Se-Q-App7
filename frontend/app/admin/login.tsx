import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { saveAuthData, clearAuthData } from '../../utils/auth';
import BACKEND_URL from '../../../utils/config';


export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    
    // Clear any previous auth data
    await clearAuthData();
    
    try {
      console.log('[AdminLogin] Attempting login to:', `${BACKEND_URL}/api/admin/login`);
      
      const response = await axios.post(`${BACKEND_URL}/api/admin/login`, { 
        email: email.trim().toLowerCase(),
        password 
      }, { timeout: 15000 });

      console.log('[AdminLogin] Response received, role:', response.data?.role);

      // Save auth data using centralized utility
      const saved = await saveAuthData({
        token: response.data.token,
        user_id: String(response.data.user_id),
        role: 'admin',
        is_premium: false
      });

      if (!saved) {
        throw new Error('Failed to save authentication data');
      }

      console.log('[AdminLogin] Auth data saved, navigating to dashboard');
      router.replace('/admin/dashboard');
    } catch (error: any) {
      console.error('[AdminLogin] Error:', error);
      
      let errorMessage = 'An unexpected error occurred';

      if (error.response) {
        console.log('[AdminLogin] Server response:', error.response.status, error.response.data);
        errorMessage = error.response.data?.detail || 
                       error.response.data?.message || 
                       'Invalid admin credentials.';
      } else if (error.request) {
        errorMessage = 'Server is unreachable. Please check your internet connection.';
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = 'Connection timed out. Please try again.';
      } else {
        errorMessage = error.message || 'Login failed. Please try again.';
      }

      Alert.alert('Login Failed', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.content}>
        <View style={styles.header}>
          <View style={styles.iconContainer}>
            <Ionicons name="shield-checkmark" size={60} color="#8B5CF6" />
          </View>
          <Text style={styles.title}>Admin Portal</Text>
          <Text style={styles.subtitle}>SafeGuard Management Console</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Ionicons name="mail-outline" size={20} color="#64748B" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Admin Email"
              placeholderTextColor="#64748B"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={20} color="#64748B" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#64748B"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color="#64748B" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.loginButton} onPress={handleLogin} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginButtonText}>Login as Admin</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.backButton} onPress={() => router.replace("/auth/login")}>
            <Ionicons name="arrow-back" size={20} color="#64748B" />
            <Text style={styles.backButtonText}>Back to App</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  content: { flex: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 40 },
  iconContainer: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#8B5CF620', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#64748B' },
  form: { gap: 16 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 12, paddingHorizontal: 16, borderWidth: 1, borderColor: '#334155' },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, paddingVertical: 16, fontSize: 16, color: '#fff' },
  loginButton: { backgroundColor: '#8B5CF6', borderRadius: 12, paddingVertical: 18, alignItems: 'center', marginTop: 8 },
  loginButtonText: { fontSize: 18, fontWeight: '600', color: '#fff' },
  backButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, gap: 8 },
  backButtonText: { fontSize: 16, color: '#64748B' },
});
