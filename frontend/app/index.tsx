/**
 * app/index.tsx — Simple auth router
 *
 * All PIN logic lives in _layout.tsx.
 * All panic activation/deactivation lives in civil/home.tsx.
 * This file just checks who is logged in and routes them to the right dashboard.
 */
import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { getAuthToken, getUserMetadata } from '../utils/auth';

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    const route = async () => {
      try {
        const token = await getAuthToken();
        if (!token) {
          router.replace('/auth/login');
          return;
        }
        const metadata = await getUserMetadata();
        if (metadata?.role === 'security') {
          router.replace('/security/home');
        } else if (metadata?.role === 'admin') {
          router.replace('/admin/dashboard');
        } else {
          // civil (default)
          router.replace('/civil/home');
        }
      } catch (_) {
        router.replace('/auth/login');
      }
    };
    route();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#3B82F6" />
    </View>
  );
}
