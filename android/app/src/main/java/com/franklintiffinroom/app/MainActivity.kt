package com.franklintiffinroom.app

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.franklintiffinroom.app.core.AppModel
import com.franklintiffinroom.app.ui.FtrTheme
import com.franklintiffinroom.app.ui.Root

class MainActivity : ComponentActivity() {
    private val model: AppModel by viewModels()

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) Push.register(this, model)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        model.requestNotificationPermission = {
            if (Build.VERSION.SDK_INT >= 33) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS) else Push.register(this, model)
        }
        if (savedInstanceState == null) model.bootstrap()
        Push.registerIfAllowed(this, model)
        handle(intent)
        setContent { FtrTheme { Root(model) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    /** Tapping a notification opens the order it's about (or Notifications). */
    private fun handle(intent: Intent?) {
        if (intent?.getBooleanExtra(Push.EXTRA_FROM_PUSH, false) == true) {
            model.openFromNotification(intent.getStringExtra("orderId"))
        }
    }
}
