package com.franklintiffinroom.app.ui

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.franklintiffinroom.app.core.Api
import com.franklintiffinroom.app.core.Empty
import com.franklintiffinroom.app.core.friendly
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable private data class Handoff(val path: String)

/**
 * Chef's Kitchen: the real admin page, opened inside the app and already signed in
 * (one-time link from /admin/handoff). Same data as the website and the WhatsApp bot.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun KitchenSheet(onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var web by remember { mutableStateOf<WebView?>(null) }
    var fileCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        fileCallback?.onReceiveValue(uri?.let { arrayOf(it) } ?: arrayOf())
        fileCallback = null
    }

    fun open() = scope.launch {
        error = null; loading = true
        try { url = Api.absolute(Api.post<Handoff, Empty>("admin/handoff", Empty()).path) }
        catch (e: Exception) { loading = false; error = e.friendly() }
    }
    LaunchedEffect(Unit) { open() }
    BackHandler(enabled = web?.canGoBack() == true) { web?.goBack() }

    FullSheet(onDismiss, title = "Chef's Kitchen", closeLabel = "Done", actions = {
        IconButton(onClick = { web?.reload() }, enabled = web != null) { Icon(Icons.Outlined.Refresh, "Reload", tint = P.leaf) }
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val u = url
            if (u != null) {
                val host = Uri.parse(u).host
                AndroidView(modifier = Modifier.fillMaxSize(), factory = { c ->
                    WebView(c).apply {
                        layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        CookieManager.getInstance().setAcceptCookie(true)
                        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                        webViewClient = object : WebViewClient() {
                            override fun onPageFinished(view: WebView?, url: String?) { loading = false; CookieManager.getInstance().flush() }
                            /** Stay on your own server; WhatsApp, phone and other sites open in their apps. */
                            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                                val target = request.url
                                if (target.host == host || target.scheme in listOf("about", "blob", "data")) return false
                                runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, target).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                                return true
                            }
                        }
                        webChromeClient = object : WebChromeClient() {
                            override fun onShowFileChooser(view: WebView?, callback: ValueCallback<Array<Uri>>?, params: FileChooserParams?): Boolean {
                                fileCallback?.onReceiveValue(arrayOf())
                                fileCallback = callback
                                filePicker.launch(params?.acceptTypes?.firstOrNull { it.isNotBlank() } ?: "image/*")
                                return true
                            }
                        }
                        // "Orders for Excel" / "Customers for Excel" downloads, with the admin sign-in cookie.
                        setDownloadListener { dlUrl, userAgent, disposition, mime, _ -> download(ctx, dlUrl, userAgent, disposition, mime) }
                        loadUrl(u)
                        web = this
                    }
                })
            } else error?.let { e ->
                Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally) {
                    Notice(e, Tone.BAD, Icons.Outlined.ErrorOutline)
                    SecondaryButton("Try again", Modifier.widthIn(max = 220.dp)) { open() }
                }
            }
            if (loading && error == null) CircularProgressIndicator(color = P.leaf, modifier = Modifier.align(Alignment.Center))
        }
    }
}

private fun download(ctx: Context, url: String, userAgent: String?, disposition: String?, mime: String?) {
    runCatching {
        val name = URLUtil.guessFileName(url, disposition, mime)
        val req = DownloadManager.Request(Uri.parse(url))
            .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
            .addRequestHeader("User-Agent", userAgent ?: "FTR-Android")
            .setMimeType(mime)
            .setTitle(name)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
        (ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
        Toast.makeText(ctx, "Downloading $name - it'll be in your Downloads", Toast.LENGTH_LONG).show()
    }.onFailure { Toast.makeText(ctx, "Couldn't download that file.", Toast.LENGTH_LONG).show() }
}
