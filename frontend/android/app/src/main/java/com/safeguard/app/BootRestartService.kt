package com.safeguard.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONObject

/**
 * BootRestartService.kt
 *
 * Runs immediately after device boot (started by BootReceiver).
 * Restores Se-Q's persistent protection state without requiring
 * the user to manually open the app.
 *
 * What it restores:
 *   1. The persistent "Se-Q Protection Active" SOS notification
 *      (stays in the notification shade, tap → opens panic-shake screen)
 *   2. If a panic was ACTIVE before the reboot, posts a high-priority
 *      "PANIC STILL ACTIVE" alert notification as well
 *
 * Note: Background GPS (expo-location task) requires the Expo runtime
 * to be running and cannot be restarted from pure native code.
 * The notification prompts the user to reopen the app, which re-registers
 * the GPS task automatically on the JS side.
 */
class BootRestartService : Service() {

    companion object {
        private const val TAG                   = "SeQ_BootRestart"
        private const val CHANNEL_SOS           = "seq_sos_channel"
        private const val CHANNEL_PANIC         = "seq_panic_channel"
        private const val NOTIF_FOREGROUND_ID   = 9001   // required for startForeground
        private const val NOTIF_SOS_ID          = 9002   // persistent SOS shortcut
        private const val NOTIF_PANIC_ID        = 9003   // active panic reminder
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "BootRestartService started")

        // Must call startForeground immediately on Android 8+ to avoid ANR
        startForeground(NOTIF_FOREGROUND_ID, buildForegroundNotification())

        try {
            restoreSeQProtection()
        } catch (e: Exception) {
            Log.e(TAG, "Error restoring Se-Q protection: ${e.message}")
        }

        // Stop self — we are a one-shot service, not a long-running daemon
        stopSelf()
        return START_NOT_STICKY
    }

    // ── Core restore logic ────────────────────────────────────────────────────
    private fun restoreSeQProtection() {
        val prefs = getSharedPreferences("RCTAsyncLocalStorage_V1", Context.MODE_PRIVATE)

        // Read panic state from AsyncStorage (React Native persists it here)
        val panicActive = readAsyncStorageValue(prefs, "panic_active")
        val activePanic = readAsyncStorageValue(prefs, "active_panic")
        val authToken   = readAsyncStorageValue(prefs, "auth_token")

        Log.d(TAG, "Panic active: $panicActive | Auth token present: ${authToken != null}")

        // Always restore the persistent SOS notification for logged-in users
        if (authToken != null) {
            postSOSNotification()
        }

        // If a panic was running before reboot — post urgent reminder
        if (panicActive == "true" || activePanic != null) {
            val category = extractCategory(activePanic)
            postPanicActiveNotification(category)
            Log.d(TAG, "Panic was active before reboot — posted reminder (category: $category)")
        }
    }

    // ── AsyncStorage reader ───────────────────────────────────────────────────
    // React Native's AsyncStorage on Android persists to SharedPreferences.
    // The key format is the raw key string.
    private fun readAsyncStorageValue(prefs: SharedPreferences, key: String): String? {
        // Try both common RN AsyncStorage storage formats
        return prefs.getString(key, null)
            ?: getSharedPreferences("AsyncStorage", Context.MODE_PRIVATE).getString(key, null)
    }

    private fun extractCategory(activePanicJson: String?): String {
        if (activePanicJson == null) return "Emergency"
        return try {
            val obj = JSONObject(activePanicJson)
            when (obj.optString("category", "other")) {
                "violence"   -> "Violence/Assault"
                "kidnapping" -> "Kidnapping/Abduction"
                "robbery"    -> "Armed Robbery"
                "harassment" -> "Harassment/Stalking"
                "medical"    -> "Medical Emergency"
                "fire"       -> "Fire/Accident"
                "burglary"   -> "Break-in/Burglary"
                else         -> "Emergency"
            }
        } catch (e: Exception) { "Emergency" }
    }

    // ── Notifications ─────────────────────────────────────────────────────────
    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // SOS channel — low priority, persistent
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_SOS, "Se-Q Protection", NotificationManager.IMPORTANCE_LOW).apply {
                description     = "Persistent Se-Q safety status notification"
                setShowBadge(false)
            }
        )

        // Panic channel — maximum priority
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_PANIC, "Se-Q Emergency", NotificationManager.IMPORTANCE_HIGH).apply {
                description     = "Active panic alert notifications"
                enableLights(true)
                lightColor      = 0xFFEF4444.toInt()
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 300, 100, 300, 100, 600)
            }
        )
    }

    private fun buildForegroundNotification(): Notification {
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pi = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_SOS)
            .setSmallIcon(R.drawable.ic_sos_notification)
            .setContentTitle("Se-Q")
            .setContentText("Restoring protection after reboot...")
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .build()
    }

    private fun postSOSNotification() {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            // Deep-link directly to panic-shake screen via custom data
            putExtra("seq_navigate", "civil/panic-shake")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

        val pi = PendingIntent.getActivity(
            this, 100, launchIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_SOS)
            .setSmallIcon(R.drawable.ic_sos_notification)
            .setContentTitle("Se-Q  \uD83D\uDEE1\uFE0F  Protection Active")
            .setContentText("Shake phone 3\u00d7 rapidly for emergency  \u00b7  Tap SOS if needed")
            .setContentIntent(pi)
            .addAction(
                R.drawable.ic_sos_notification,
                "\uD83D\uDEA8 SOS \u2014 Tap to Panic",
                pi
            )
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)          // Cannot be swiped away
            .setAutoCancel(false)
            .setSilent(true)
            .setColor(0xFFEF4444.toInt())
            .build()

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_SOS_ID, notification)
        Log.d(TAG, "SOS notification posted")
    }

    private fun postPanicActiveNotification(category: String) {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            putExtra("seq_navigate", "civil/home")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

        val pi = PendingIntent.getActivity(
            this, 200, launchIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_PANIC)
            .setSmallIcon(R.drawable.ic_sos_notification)
            .setContentTitle("\uD83D\uDEA8 PANIC STILL ACTIVE \u2014 $category")
            .setContentText("Your emergency was active before reboot. Open Se-Q to manage.")
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOngoing(true)
            .setAutoCancel(false)
            .setColor(0xFFEF4444.toInt())
            .setVibrate(longArrayOf(0, 300, 100, 300))
            .addAction(
                R.drawable.ic_sos_notification,
                "Open Se-Q",
                pi
            )
            .build()

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_PANIC_ID, notification)
        Log.d(TAG, "Active panic reminder notification posted")
    }
}
