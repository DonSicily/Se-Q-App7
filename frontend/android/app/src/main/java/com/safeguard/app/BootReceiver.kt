package com.safeguard.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * BootReceiver.kt
 *
 * Listens for the BOOT_COMPLETED broadcast that Android fires after
 * the device finishes booting. When received, starts BootRestartService
 * which restores Se-Q's persistent notification and any active GPS tasks.
 *
 * Registered in AndroidManifest.xml with RECEIVE_BOOT_COMPLETED permission.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return

        // Also handle QUICKBOOT_POWERON for HTC/some Chinese OEM devices
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON") {
            return
        }

        Log.d("SeQ_BootReceiver", "Boot completed — starting Se-Q restore service")

        val serviceIntent = Intent(context, BootRestartService::class.java)

        // On Android 8+ we must use startForegroundService for background starts
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent)
        } else {
            context.startService(serviceIntent)
        }
    }
}
