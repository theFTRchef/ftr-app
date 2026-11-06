package com.franklintiffinroom.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.franklintiffinroom.app.core.AppModel

/**
 * Phone alerts. Android delivers them through Firebase Cloud Messaging; that
 * is switched on once the Firebase project file (google-services.json) is
 * added. Until then, everything still arrives in the Notifications tab.
 */
object Push {
    const val EXTRA_FROM_PUSH = "ftr.fromPush"

    fun allowed(ctx: Context) = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun registerIfAllowed(ctx: Context, model: AppModel) { if (allowed(ctx)) register(ctx, model) }

    @Suppress("UNUSED_PARAMETER")
    fun register(ctx: Context, model: AppModel) {
        // Firebase token -> model.didRegister(token), added with google-services.json.
    }
}
