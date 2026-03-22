/**
 * Authentication Utility Module
 * Centralized authentication handling for SafeGuard app
 * All screens should use this module for consistent auth behavior
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Keys used for storage
const AUTH_TOKEN_KEY = 'auth_token';
const USER_ID_KEY = 'user_id';
const USER_ROLE_KEY = 'user_role';
const IS_PREMIUM_KEY = 'is_premium';

/**
 * Check if SecureStore is available (not available on web)
 */
const isSecureStoreAvailable = async (): Promise<boolean> => {
  if (Platform.OS === 'web') return false;
  try {
    await SecureStore.getItemAsync('__test__');
    return true;
  } catch {
    return false;
  }
};

/**
 * Get the authentication token
 * Tries SecureStore first (for native), falls back to AsyncStorage
 */
export const getAuthToken = async (): Promise<string | null> => {
  try {
    // Try SecureStore first (native platforms)
    if (Platform.OS !== 'web') {
      try {
        const token = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
        if (token) {
          console.log('[Auth] Token retrieved from SecureStore');
          return token;
        }
      } catch (e) {
        console.log('[Auth] SecureStore not available, trying AsyncStorage');
      }
    }
    
    // Fallback to AsyncStorage
    const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      console.log('[Auth] Token retrieved from AsyncStorage');
    }
    return token;
  } catch (error) {
    console.error('[Auth] Error getting token:', error);
    return null;
  }
};

/**
 * Save authentication data after successful login/registration
 */
export const saveAuthData = async (data: {
  token: string;
  user_id: string;
  role: string;
  is_premium?: boolean;
}): Promise<boolean> => {
  try {
    // Save token
    if (Platform.OS !== 'web') {
      try {
        await SecureStore.setItemAsync(AUTH_TOKEN_KEY, data.token);
        console.log('[Auth] Token saved to SecureStore');
      } catch (e) {
        console.log('[Auth] SecureStore failed, using AsyncStorage for token');
        await AsyncStorage.setItem(AUTH_TOKEN_KEY, data.token);
      }
    } else {
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, data.token);
    }
    
    // Save metadata to AsyncStorage (non-sensitive)
    await AsyncStorage.multiSet([
      [USER_ID_KEY, data.user_id],
      [USER_ROLE_KEY, data.role],
      [IS_PREMIUM_KEY, String(data.is_premium || false)],
    ]);
    
    console.log('[Auth] Auth data saved successfully');
    return true;
  } catch (error) {
    console.error('[Auth] Error saving auth data:', error);
    return false;
  }
};

/**
 * Clear all authentication data (logout).
 * Also unregisters the push token so the user stops receiving notifications.
 */
export const clearAuthData = async (): Promise<boolean> => {
  try {
    // 1. Unregister push token with backend (best-effort — don't block logout if it fails)
    try {
      const token = await getAuthToken();
      if (token) {
        const { default: axios } = await import('axios');
        const { default: BACKEND_URL } = await import('./config');
        await axios.delete(`${BACKEND_URL}/api/push-token/unregister`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 5000,
        });
      }
    } catch (_) {
      // Non-fatal — token may already be expired
    }

    // 2. Clear token from SecureStore (native)
    if (Platform.OS !== 'web') {
      try {
        await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
        console.log('[Auth] Token cleared from SecureStore');
      } catch (e) {
        console.log('[Auth] SecureStore clear failed (may not exist)');
      }
    }

    // 3. Clear all auth keys from AsyncStorage (covers web + the mirrored BG-task copy)
    await AsyncStorage.multiRemove([
      AUTH_TOKEN_KEY,
      USER_ID_KEY,
      USER_ROLE_KEY,
      IS_PREMIUM_KEY,
    ]);

    console.log('[Auth] All auth data cleared');
    return true;
  } catch (error) {
    console.error('[Auth] Error clearing auth data:', error);
    return false;
  }
};

/**
 * Get user metadata (role, premium status, etc.)
 */
export const getUserMetadata = async (): Promise<{
  userId: string | null;
  role: string | null;
  isPremium: boolean;
}> => {
  try {
    const results = await AsyncStorage.multiGet([USER_ID_KEY, USER_ROLE_KEY, IS_PREMIUM_KEY]);
    const data: { [key: string]: string | null } = {};
    results.forEach(([key, value]) => {
      data[key] = value;
    });
    
    return {
      userId: data[USER_ID_KEY],
      role: data[USER_ROLE_KEY],
      isPremium: data[IS_PREMIUM_KEY] === 'true',
    };
  } catch (error) {
    console.error('[Auth] Error getting user metadata:', error);
    return { userId: null, role: null, isPremium: false };
  }
};

/**
 * Check if user is authenticated
 */
export const isAuthenticated = async (): Promise<boolean> => {
  const token = await getAuthToken();
  return !!token;
};

/**
 * Get authorization header for API requests
 */
export const getAuthHeader = async (): Promise<{ Authorization: string } | {}> => {
  const token = await getAuthToken();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
};
