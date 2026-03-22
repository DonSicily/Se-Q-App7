import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import BACKEND_URL from './config';
import { getAuthToken } from './auth';


/**
 * Request notification permissions and get Expo push token
 */
export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (!Device.isDevice) {
      console.log('Push notifications require a physical device');
      return null;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Failed to get push notification permission');
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;
    console.log('Expo Push Token:', token);

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'SafeGuard Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#EF4444',
        sound: 'default',
      });

      await Notifications.setNotificationChannelAsync('emergency', {
        name: 'Emergency Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 250, 500],
        lightColor: '#FF0000',
        sound: 'default',
        bypassDnd: true,
      });
    }

    return token;
  } catch (error) {
    console.error('Error registering for push notifications:', error);
    return null;
  }
}

/**
 * Register push token with backend server.
 * Uses getAuthToken() so it works correctly with SecureStore on native.
 */
export async function registerTokenWithServer(token: string): Promise<boolean> {
  try {
    const authToken = await getAuthToken();   // ← was AsyncStorage.getItem('auth_token')
    if (!authToken) {
      console.log('No auth token available to register push token');
      return false;
    }

    await axios.post(
      `${BACKEND_URL}/api/push-token/register`,
      token,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    await AsyncStorage.setItem('push_token', token);
    console.log('Push token registered with server successfully');
    return true;
  } catch (error: any) {
    console.error('Failed to register push token with server:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Full push notification setup — call after login/register
 */
export async function setupPushNotifications(): Promise<boolean> {
  const token = await registerForPushNotifications();
  if (token) {
    return await registerTokenWithServer(token);
  }
  return false;
}
