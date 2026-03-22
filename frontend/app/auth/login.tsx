import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { saveAuthData, clearAuthData } from '../../utils/auth';
import { setupPushNotifications } from '../../utils/notifications';
import BACKEND_URL from '../../../utils/config';


export default function Login() {
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
    
    // Clear any previous auth data before login attempt
    await clearAuthData();
    
    try {
      console.log('[Login] Attempting login to:', `${BACKEND_URL}/api/auth/login`);
      console.log('[Login] Email:', email.trim().toLowerCase());
      
      const response = await axios.post(`${BACKEND_URL}/api/auth/login`, { 
        email: email.trim().toLowerCase(),
        password 
      }, { timeout: 15000 });

      console.log('[Login] Response received, role:', response.data?.role);

      // Save auth data using the centralized utility
      const saved = await saveAuthData({
        token: response.data.token,
        user_id: String(response.data.user_id),
        role: response.data.role,
        is_premium: response.data.is_premium
      });

      if (!saved) {
        throw new Error('Failed to save authentication data');
      }

      // Push Notification Setup (non-blocking)
      try {
        await setupPushNotifications();
      } catch (pushError) {
        console.warn('[Login] Push setup failed:', pushError);
      }

      console.log('[Login] Navigating based on role:', response.data.role);

      // Navigate based on role - IMPORTANT: Check admin first
      if (response.data.role === 'admin') {
        console.log('[Login] Admin user, redirecting to admin dashboard');
        router.replace('/admin/dashboard');
      } else if (response.data.role === 'security') {
        console.log('[Login] Security user, redirecting to security home');
        router.replace('/security/home');
      } else {
        console.log('[Login] Civil user, redirecting to civil home');
        router.replace('/civil/home');
      }

    } catch (error: any) {
      console.error('[Login] Error:', error);
      
      let errorMessage = 'An unexpected error occurred';

      if (error.response) {
        console.log('[Login] Server response:', error.response.status, error.response.data);
        errorMessage = error.response.data?.detail || 
                       error.response.data?.message || 
                       'Invalid credentials. Please try again.';
      } else if (error.request) {
        console.log('[Login] No response received');
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Ionicons name="shield-checkmark" size={80} color="#EF4444" />
            <Text style={styles.appName}>SafeGuard</Text>
            <Text style={styles.subtitle}>Welcome Back</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <Ionicons name="mail-outline" size={20} color="#64748B" />
              <TextInput 
                style={styles.input} 
                placeholder="Email" 
                placeholderTextColor="#64748B" 
                value={email} 
                onChangeText={setEmail} 
                keyboardType="email-address" 
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={20} color="#64748B" />
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
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.loginButton} onPress={handleLogin} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginButtonText}>Login</Text>}
            </TouchableOpacity>

            <View style={styles.footer}>
              <Text style={styles.footerText}>Don't have an account? </Text>
              <TouchableOpacity onPress={() => router.push('/auth/register')}>
                <Text style={styles.linkText}>Sign Up</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.adminLink} onPress={() => router.push('/admin/login')}>
              <Ionicons name="shield-checkmark" size={18} color="#8B5CF6" />
              <Text style={styles.adminLinkText}>Admin Portal</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 },
  header: { alignItems: 'center', marginBottom: 48 },
  appName: { fontSize: 36, fontWeight: 'bold', color: '#fff', marginTop: 16 },
  subtitle: { fontSize: 16, color: '#94A3B8', marginTop: 8 },
  form: { width: '100%' },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 12, paddingHorizontal: 16, marginBottom: 16, borderWidth: 1, borderColor: '#334155' },
  input: { flex: 1, color: '#fff', fontSize: 16, paddingVertical: 16, marginLeft: 12 },
  adminLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 32, paddingVertical: 12 },
  adminLinkText: { fontSize: 14, color: '#8B5CF6', fontWeight: '500' },
  loginButton: { backgroundColor: '#EF4444', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  loginButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  footerText: { color: '#94A3B8', fontSize: 14 },
  linkText: { color: '#3B82F6', fontSize: 14, fontWeight: '600' },
});
