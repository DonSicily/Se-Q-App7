import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { saveAuthData } from '../../utils/auth';
import { setupPushNotifications } from '../../utils/notifications';
import BACKEND_URL from '../../../utils/config';


export default function Register() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('civil');
  const [inviteCode, setInviteCode] = useState('');
  const [securitySubRole, setSecuritySubRole] = useState('team_member');
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleRegister = async () => {
    // Validation
    if (!email || !password || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    if (!validateEmail(email.trim())) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    if (role === 'security' && !inviteCode) {
      Alert.alert('Error', 'Security users require an invite code');
      return;
    }

    setLoading(true);
    try {
      console.log('Attempting registration to:', `${BACKEND_URL}/api/auth/register`);
      
      const response = await axios.post(`${BACKEND_URL}/api/auth/register`, {
        email: email.trim().toLowerCase(),
        phone: phone.trim() || null,
        full_name: fullName.trim() || null,
        password,
        confirm_password: confirmPassword,
        role,
        invite_code: inviteCode.trim().toUpperCase() || null,
        security_sub_role: role === 'security' ? securitySubRole : null,
        team_name: role === 'security' ? teamName.trim() : null
      }, { timeout: 15000 });

      console.log('Registration successful:', response.data?.role);

      // Use the centralised auth utility — handles SecureStore/AsyncStorage correctly on all platforms
      await saveAuthData({
        token:      response.data.token,
        user_id:    String(response.data.user_id),
        role:       response.data.role,
        is_premium: response.data.is_premium,
      });

      // Setup push notifications after successful registration
      try {
        const pushSetup = await setupPushNotifications();
        console.log('Push notifications setup:', pushSetup ? 'success' : 'skipped');
      } catch (pushError) {
        console.log('Push notification setup error (non-fatal):', pushError);
      }

      Alert.alert('Success!', 'Registration successful! Welcome to SafeGuard.', [
        { text: 'OK', onPress: () => {
          if (response.data.role === 'security') {
            router.replace('/security/home');
          } else {
            router.replace('/civil/home');
          }
        }}
      ]);
    } catch (error: any) {
      console.error('Registration Error:', error);
      
      let errorMessage = 'An unexpected error occurred';

      if (error.response) {
        errorMessage = error.response.data?.detail || 
                       error.response.data?.message || 
                       'Registration failed. Please try again.';
      } else if (error.request) {
        errorMessage = 'Server is unreachable. Please check your internet connection.';
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = 'Connection timed out. Please try again.';
      } else {
        errorMessage = error.message || 'Registration failed. Please try again.';
      }

      Alert.alert('Registration Failed', errorMessage);
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
            <Text style={styles.subtitle}>Create Your Account</Text>
          </View>

          <View style={styles.form}>
            {/* Role Selection */}
            <Text style={styles.label}>I am a:</Text>
            <View style={styles.roleContainer}>
              <TouchableOpacity
                style={[styles.roleButton, role === 'civil' && styles.roleButtonActive]}
                onPress={() => setRole('civil')}
              >
                <Ionicons name="person" size={24} color={role === 'civil' ? '#fff' : '#64748B'} />
                <Text style={[styles.roleText, role === 'civil' && styles.roleTextActive]}>Civil User</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.roleButton, role === 'security' && styles.roleButtonActive]}
                onPress={() => setRole('security')}
              >
                <Ionicons name="shield" size={24} color={role === 'security' ? '#fff' : '#64748B'} />
                <Text style={[styles.roleText, role === 'security' && styles.roleTextActive]}>Security Agency</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.inputContainer}>
              <Ionicons name="person-outline" size={20} color="#64748B" />
              <TextInput 
                style={styles.input} 
                placeholder="Full Name" 
                placeholderTextColor="#64748B" 
                value={fullName} 
                onChangeText={setFullName}
                autoCapitalize="words"
              />
            </View>

            <View style={styles.inputContainer}>
              <Ionicons name="mail-outline" size={20} color="#64748B" />
              <TextInput 
                style={styles.input} 
                placeholder="Email *" 
                placeholderTextColor="#64748B" 
                value={email} 
                onChangeText={setEmail} 
                keyboardType="email-address" 
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.inputContainer}>
              <Ionicons name="call-outline" size={20} color="#64748B" />
              <TextInput 
                style={styles.input} 
                placeholder="Phone (optional)" 
                placeholderTextColor="#64748B" 
                value={phone} 
                onChangeText={setPhone} 
                keyboardType="phone-pad" 
              />
            </View>

            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={20} color="#64748B" />
              <TextInput 
                style={styles.input} 
                placeholder="Password *" 
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

            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={20} color="#64748B" />
              <TextInput 
                style={styles.input} 
                placeholder="Confirm Password *" 
                placeholderTextColor="#64748B" 
                value={confirmPassword} 
                onChangeText={setConfirmPassword} 
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {role === 'security' && (
              <>
                <View style={styles.inputContainer}>
                  <Ionicons name="key-outline" size={20} color="#64748B" />
                  <TextInput 
                    style={styles.input} 
                    placeholder="Security Invite Code *" 
                    placeholderTextColor="#64748B" 
                    value={inviteCode} 
                    onChangeText={setInviteCode} 
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                </View>

                <Text style={styles.label}>Your Role:</Text>
                <View style={styles.roleContainer}>
                  <TouchableOpacity
                    style={[styles.subRoleButton, securitySubRole === 'supervisor' && styles.subRoleButtonActive]}
                    onPress={() => setSecuritySubRole('supervisor')}
                  >
                    <Ionicons name="star" size={20} color={securitySubRole === 'supervisor' ? '#F59E0B' : '#64748B'} />
                    <Text style={[styles.subRoleText, securitySubRole === 'supervisor' && styles.subRoleTextActive]}>Supervisor</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={[styles.subRoleButton, securitySubRole === 'team_member' && styles.subRoleButtonActive]}
                    onPress={() => setSecuritySubRole('team_member')}
                  >
                    <Ionicons name="people" size={20} color={securitySubRole === 'team_member' ? '#F59E0B' : '#64748B'} />
                    <Text style={[styles.subRoleText, securitySubRole === 'team_member' && styles.subRoleTextActive]}>Team Member</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.inputContainer}>
                  <Ionicons name="business-outline" size={20} color="#64748B" />
                  <TextInput 
                    style={styles.input} 
                    placeholder="Team Name (optional)" 
                    placeholderTextColor="#64748B" 
                    value={teamName} 
                    onChangeText={setTeamName} 
                  />
                </View>
              </>
            )}


            <TouchableOpacity style={styles.registerButton} onPress={handleRegister} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.registerButtonText}>Create Account</Text>}
            </TouchableOpacity>

            <View style={styles.footer}>
              <Text style={styles.footerText}>Already have an account? </Text>
              <TouchableOpacity onPress={() => router.replace('/auth/login')}>
                <Text style={styles.linkText}>Login</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 20 },
  header: { alignItems: 'center', marginBottom: 32 },
  appName: { fontSize: 36, fontWeight: 'bold', color: '#fff', marginTop: 16 },
  subtitle: { fontSize: 16, color: '#94A3B8', marginTop: 8 },
  form: { width: '100%' },
  label: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 12, marginTop: 8 },
  roleContainer: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  roleButton: { flex: 1, backgroundColor: '#1E293B', borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 2, borderColor: '#334155' },
  roleButtonActive: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  roleText: { fontSize: 14, color: '#64748B', marginTop: 8, fontWeight: '600' },
  roleTextActive: { color: '#fff' },
  subRoleButton: { flex: 1, flexDirection: 'row', backgroundColor: '#1E293B', borderRadius: 12, padding: 14, alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 2, borderColor: '#334155' },
  subRoleButtonActive: { backgroundColor: '#F59E0B20', borderColor: '#F59E0B' },
  subRoleText: { fontSize: 14, color: '#64748B', fontWeight: '600' },
  subRoleTextActive: { color: '#F59E0B' },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 12, paddingHorizontal: 16, marginBottom: 16, borderWidth: 1, borderColor: '#334155' },
  input: { flex: 1, color: '#fff', fontSize: 16, paddingVertical: 16, marginLeft: 12 },
  registerButton: { backgroundColor: '#EF4444', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  registerButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  footerText: { color: '#94A3B8', fontSize: 14 },
  linkText: { color: '#3B82F6', fontSize: 14, fontWeight: '600' },
});
