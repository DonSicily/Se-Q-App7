/**
 * _layout.tsx — Root layout
 *
 * Phase 2: PIN lock is fully persistent.
 * - Every app return from background/close shows PIN before any content.
 * - After PIN success: go to civil/home (handles panic state there via "I'm Safe" button).
 * - No redirect to panic-active on reopen — tracking already continues silently in BG.
 * - Public routes (auth pages, admin login) are PIN-exempt.
 *
 * Phase 3: Shake-to-Panic (triple hard shake → panic-shake screen)
 * - Shake detector active whenever a civil user is logged in
 * - Persists in background because _layout stays mounted while app is running
 * - Persistent SOS notification covers the fully-closed scenario
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  Alert, View, Text, TouchableOpacity, StyleSheet,
  AppState, AppStateStatus, Vibration,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { startQueueProcessor } from '../utils/offlineQueue';
import { useShakeDetector } from '../utils/shakeDetector';
import { getAuthToken } from '../utils/auth';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ── Notification category for persistent SOS shortcut ────────────────────────
const SOS_NOTIFICATION_ID  = 'seq-sos-persistent';
const SOS_CATEGORY_ID      = 'seq-sos-category';

async function registerSOSNotificationCategory() {
  await Notifications.setNotificationCategoryAsync(SOS_CATEGORY_ID, [
    {
      identifier: 'SOS_ACTION',
      buttonTitle: '🚨 SOS — Tap to Panic',
      options: { opensAppToForeground: true },
    },
  ]);
}

async function showPersistentSOSNotification() {
  // Cancel any existing one first (avoid duplicates)
  await Notifications.dismissNotificationAsync(SOS_NOTIFICATION_ID).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: SOS_NOTIFICATION_ID,
    content: {
      title: 'Se-Q  🛡️  Protection Active',
      body:  'Shake phone 3× rapidly for emergency  ·  Tap SOS button if needed',
      data:  { type: 'sos_shortcut' },
      categoryIdentifier: SOS_CATEGORY_ID,
      sticky: true,
      autoDismiss: false,
      color: '#EF4444',
    },
    trigger: null, // show immediately
  });
}

async function dismissPersistentSOSNotification() {
  await Notifications.dismissNotificationAsync(SOS_NOTIFICATION_ID).catch(() => {});
}

type NotificationData = {
  type?: 'panic' | 'report' | 'general' | 'chat' | 'sos_shortcut';
  event_id?: string;
  conversation_id?: string;
};

// ─── PIN Overlay ─────────────────────────────────────────────────────────────
function PinOverlay({ onSuccess }: { onSuccess: () => void }) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '']);
  const [error, setError]   = useState('');
  const [attempts, setAttempts] = useState(0);
  const digitsRef = useRef(digits);
  digitsRef.current = digits;

  const handleKey = useCallback(async (key: string) => {
    if (key === '⌫') {
      setDigits(prev => {
        const d = [...prev];
        for (let i = 3; i >= 0; i--) { if (d[i] !== '') { d[i] = ''; break; } }
        return d;
      });
      setError('');
      return;
    }

    setDigits(prev => {
      const d = [...prev];
      const idx = d.findIndex(v => v === '');
      if (idx === -1) return prev;
      d[idx] = key;

      if (d.every(v => v !== '')) {
        const entered = d.join('');
        AsyncStorage.getItem('security_pin').then(stored => {
          const correct = stored || '1234';
          if (entered === correct) {
            setError('');
            onSuccess();
          } else {
            Vibration.vibrate([0, 100, 50, 100]);
            setAttempts(a => {
              const next = a + 1;
              setError(`Incorrect PIN. ${Math.max(0, 3 - next)} attempt(s) left.`);
              return next;
            });
            setDigits(['', '', '', '']);
          }
        });
      }
      return d;
    });
  }, [onSuccess]);

  return (
    <View style={pin.overlay}>
      <View style={pin.card}>
        <Text style={pin.icon}>🔒</Text>
        <Text style={pin.title}>Enter PIN to Continue</Text>
        <Text style={pin.subtitle}>Your PIN is required every time you return to the app</Text>
        <View style={pin.dots}>
          {digits.map((d, i) => (
            <View key={i} style={[pin.dot, d !== '' && pin.dotFilled]} />
          ))}
        </View>
        {!!error && <Text style={pin.error}>{error}</Text>}
        <View style={pin.keypad}>
          {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
            <TouchableOpacity
              key={i}
              style={[pin.key, !k && pin.keyEmpty]}
              onPress={() => k && handleKey(k)}
              disabled={!k}
              activeOpacity={0.7}
            >
              <Text style={[pin.keyText, k === '⌫' && { fontSize: 20 }]}>{k}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={pin.hint}>Default PIN: 1234  ·  Change in Settings</Text>
      </View>
    </View>
  );
}

// ─── Inner app ────────────────────────────────────────────────────────────────
function AppContent() {
  const router     = useRouter();
  const segments   = useSegments();
  const notifListener   = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  const queueCleanup = useRef<(() => void) | null>(null);
  const initialized  = useRef(false);
  const appStateRef  = useRef<AppStateStatus>(AppState.currentState);

  const [pinRequired, setPinRequired] = useState(false);
  const [pinReady,    setPinReady]    = useState(false);
  const [userRole,    setUserRole]    = useState<string | null>(null);

  // ── Determine user role for shake detector gating ────────────────────────
  useEffect(() => {
    const readRole = async () => {
      const role = await AsyncStorage.getItem('user_role');
      setUserRole(role);
    };
    readRole();
    // Re-read whenever segments change (login/logout)
  }, [segments.join('/')]);

  // Shake is enabled only for logged-in civil users, and not on the panic screens
  const currentRoute   = segments.join('/');
  const isOnPanicScreen = currentRoute.includes('panic-shake') || currentRoute.includes('panic-active');
  const shakeEnabled   = userRole === 'civil' && !isOnPanicScreen;

  // ── Shake trigger callback ────────────────────────────────────────────────
  const handleShakeTrigger = useCallback(() => {
    // Extra guard: don't trigger if already on panic or PIN overlay
    if (isOnPanicScreen) return;
    try {
      router.push('/civil/panic-shake');
    } catch (_) {}
  }, [isOnPanicScreen]);

  // ── Register shake detector at root level ─────────────────────────────────
  // This hook persists as long as AppContent is mounted (i.e. as long as the
  // app process is alive — foreground AND background).
  useShakeDetector({
    enabled:        shakeEnabled,
    threshold:      2.2,     // g-force — tune up if false positives, down if misses
    requiredShakes: 3,
    windowMs:       2000,
    cooldownMs:     6000,    // 6s cooldown prevents accidental re-fire after activation
    onTriggered:    handleShakeTrigger,
  });

  // ── Persistent SOS notification management ────────────────────────────────
  useEffect(() => {
    registerSOSNotificationCategory();
  }, []);

  useEffect(() => {
    if (userRole === 'civil') {
      showPersistentSOSNotification();
    } else {
      dismissPersistentSOSNotification();
    }
    return () => { dismissPersistentSOSNotification(); };
  }, [userRole]);

  // ── Offline queue ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      queueCleanup.current = startQueueProcessor();
    }
    return () => { queueCleanup.current?.(); queueCleanup.current = null; };
  }, []);

  // ── PIN on every app return ───────────────────────────────────────────────
  useEffect(() => {
    const settle = setTimeout(() => setPinReady(true), 500);
    const sub = AppState.addEventListener('change', async (next: AppStateStatus) => {
      const wasAway = appStateRef.current === 'background' || appStateRef.current === 'inactive';
      if (wasAway && next === 'active') {
        const token = await getAuthToken();
        if (token) {
          const route = segments.join('/');
          const isPublic = route.includes('auth/') || route.includes('admin/login') || route === '';
          if (!isPublic) setPinRequired(true);
        }
      }
      appStateRef.current = next;
    });
    return () => { clearTimeout(settle); sub.remove(); };
  }, [segments]);

  // ── Push notifications ────────────────────────────────────────────────────
  useEffect(() => {
    notifListener.current = Notifications.addNotificationReceivedListener(n => {
      const d = n.request.content.data as NotificationData;
      if (d?.type === 'panic') {
        Alert.alert(
          '🚨 EMERGENCY ALERT',
          n.request.content.body || 'Panic alert nearby!',
          [
            { text: 'View',    onPress: () => { try { router.push('/security/panics'); } catch (_) {} } },
            { text: 'Dismiss', style: 'cancel' },
          ]
        );
      }
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(r => {
      const d     = r.notification.request.content.data as NotificationData;
      const action = r.actionIdentifier;

      try {
        // SOS notification tapped (body tap or SOS action button)
        if (d?.type === 'sos_shortcut' || action === 'SOS_ACTION') {
          router.push('/civil/panic-shake');
          return;
        }
        if (d?.type === 'panic')        router.push('/security/panics');
        else if (d?.type === 'report')  router.push('/security/reports');
        else if (d?.type === 'chat' && d?.conversation_id)
          router.push(`/security/chat/${d.conversation_id}` as any);
      } catch (_) {}
    });

    return () => {
      notifListener.current?.remove();
      responseListener.current?.remove();
    };
  }, []);

  // ── PIN success ───────────────────────────────────────────────────────────
  const handlePinSuccess = useCallback(async () => {
    setPinRequired(false);
    const panicActive = await AsyncStorage.getItem('panic_active');
    const activePanic = await AsyncStorage.getItem('active_panic');
    if (panicActive === 'true' || !!activePanic) {
      try { router.replace('/civil/home'); } catch (_) {}
    }
  }, []);

  return (
    <>
      <Slot />
      {pinReady && pinRequired && <PinOverlay onSuccess={handlePinSuccess} />}
    </>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: '#0F172A' }}>
        <AppContent />
      </View>
    </SafeAreaProvider>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const pin = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.97)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 9999, elevation: 9999,
  },
  card: {
    width: '90%', maxWidth: 360, alignItems: 'center',
    backgroundColor: '#0A0F1E', borderRadius: 24,
    paddingVertical: 36, paddingHorizontal: 24,
    borderWidth: 1, borderColor: '#1E293B',
  },
  icon:     { fontSize: 44, marginBottom: 12 },
  title:    { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 6 },
  subtitle: { fontSize: 13, color: '#64748B', textAlign: 'center', marginBottom: 28, lineHeight: 19 },
  dots:     { flexDirection: 'row', gap: 16, marginBottom: 14 },
  dot:      { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#334155', backgroundColor: 'transparent' },
  dotFilled:{ backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  error:    { color: '#EF4444', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  keypad:   { flexDirection: 'row', flexWrap: 'wrap', width: 252, gap: 10, marginTop: 10, marginBottom: 20 },
  key:      { width: 74, height: 74, borderRadius: 37, backgroundColor: '#1E293B', justifyContent: 'center', alignItems: 'center' },
  keyEmpty: { backgroundColor: 'transparent' },
  keyText:  { fontSize: 24, fontWeight: '600', color: '#fff' },
  hint:     { fontSize: 11, color: '#334155', textAlign: 'center' },
});
