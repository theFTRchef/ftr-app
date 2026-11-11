package com.franklintiffinroom.app.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

/** A full-screen sheet with a top bar, like the iPhone app's sheets. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FullSheet(
    onDismiss: () -> Unit,
    title: String = "",
    closeLabel: String? = "Close",
    dismissable: Boolean = true,
    actions: @Composable () -> Unit = {},
    bottomBar: @Composable () -> Unit = {},
    barColor: androidx.compose.ui.graphics.Color? = null,
    barTextColor: androidx.compose.ui.graphics.Color? = null,
    content: @Composable (PaddingValues) -> Unit,
) {
    Dialog(
        onDismissRequest = { if (dismissable) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false, dismissOnBackPress = dismissable, dismissOnClickOutside = false),
    ) {
        FtrTheme {
            Surface(Modifier.fillMaxSize(), color = P.bg) {
                Scaffold(
                    modifier = Modifier.fillMaxSize().imePadding(),
                    containerColor = P.bg,
                    topBar = {
                        CenterAlignedTopAppBar(
                            title = { Text(title, style = Type.semi(17.0), color = barTextColor ?: P.ink) },
                            navigationIcon = { if (closeLabel != null) TextButton(onClick = onDismiss) { Text(closeLabel, style = Type.semi(16.0), color = barTextColor ?: P.leaf) } },
                            actions = { actions() },
                            colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = barColor ?: P.bg),
                        )
                    },
                    bottomBar = { Box(Modifier.navigationBarsPadding()) { bottomBar() } },
                    content = content,
                )
            }
        }
    }
}

/** A screen inside a tab, with a back arrow when it isn't the first. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TabScreen(
    title: String,
    onBack: (() -> Unit)? = null,
    navigationIcon: @Composable () -> Unit = {},
    actions: @Composable () -> Unit = {},
    bottomBar: @Composable () -> Unit = {},
    content: @Composable (PaddingValues) -> Unit,
) {
    Scaffold(
        containerColor = P.bg,
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text(title, style = Type.semi(17.0), color = P.ink) },
                navigationIcon = {
                    if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = P.leaf) }
                    else navigationIcon()
                },
                actions = { actions() },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = P.bg),
            )
        },
        bottomBar = bottomBar,
        content = content,
    )
}

/** Scrolling column with pull-to-refresh. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RefreshColumn(
    padding: PaddingValues,
    onRefresh: suspend () -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: Int = 16,
    spacing: Int = 12,
    content: @Composable ColumnScope.() -> Unit,
) {
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = { scope.launch { refreshing = true; try { onRefresh() } finally { refreshing = false } } },
        modifier = modifier.fillMaxSize().padding(padding),
    ) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(contentPadding.dp),
            verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(spacing.dp),
            content = content,
        )
    }
}

@Composable
fun ScrollBody(padding: PaddingValues, contentPadding: Int = 20, spacing: Int = 18, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(contentPadding.dp),
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(spacing.dp),
        content = content,
    )
}

/** The bar at the bottom of a screen holding its main button. */
@Composable
fun BottomBar(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().background(P.surface)) {
        HorizontalDivider(color = P.line)
        Box(Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) { content() }
    }
}

@Composable
fun Confirm(title: String, message: String, confirm: String, onConfirm: () -> Unit, onDismiss: () -> Unit, cancel: String = "Cancel", destructive: Boolean = true) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title, style = Type.bold(18.0), color = P.ink) },
        text = { Text(message, style = Type.body(15.0), color = P.muted) },
        confirmButton = { TextButton(onClick = { onDismiss(); onConfirm() }) { Text(confirm, style = Type.semi(15.0), color = if (destructive) P.bad else P.leaf) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(cancel, style = Type.semi(15.0), color = P.leaf) } },
        containerColor = P.surface,
    )
}

@Composable
fun InfoDialog(title: String, message: String, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title, style = Type.bold(18.0), color = P.ink) },
        text = { Text(message, style = Type.body(15.0), color = P.muted) },
        confirmButton = { TextButton(onClick = onDismiss) { Text("OK", style = Type.semi(15.0), color = P.leaf) } },
        containerColor = P.surface,
    )
}

/** Day-of-month tile for a "YYYY-MM-DD" date. */
@Composable
fun DateBadge(iso: String) {
    val d = runCatching { LocalDate.parse(iso) }.getOrNull()
    Column(
        Modifier.width(54.dp).background(P.surface2, RoundedCornerShape(12.dp)).padding(vertical = 6.dp).clearAndSetSemantics { },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(d?.month?.getDisplayName(TextStyle.SHORT, Locale.US)?.uppercase() ?: "", style = Type.bold(12.0), color = P.red)
        Text(d?.dayOfMonth?.toString() ?: "", style = Type.display(24), color = P.ink)
    }
}

@Composable
fun Divider() = HorizontalDivider(color = P.line)

@Composable
fun MutedText(text: String, size: Double = 14.0, modifier: Modifier = Modifier) = Text(text, style = Type.body(size), color = P.muted, modifier = modifier)

@Composable
fun LabelRow(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, color: androidx.compose.ui.graphics.Color = P.ink, size: Double = 15.0, weight: FontWeight = FontWeight.Normal) {
    Row(verticalAlignment = Alignment.Top) {
        Icon(icon, null, tint = color, modifier = Modifier.padding(top = 2.dp).size(18.dp))
        Text(text, style = Type.body(size, weight), color = color, modifier = Modifier.padding(start = 8.dp))
    }
}

object Intents {
    fun dial(ctx: Context, number: String) = open(ctx, Intent(Intent.ACTION_DIAL, Uri.parse("tel:$number")))
    fun email(ctx: Context, to: String) = open(ctx, Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$to")))
    fun url(ctx: Context, url: String) = open(ctx, Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    fun share(ctx: Context, subject: String, text: String) {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, subject)
            putExtra(Intent.EXTRA_TEXT, text)
        }
        open(ctx, Intent.createChooser(send, "Share FTR"))
    }
    private fun open(ctx: Context, i: Intent) {
        runCatching { ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }
}

/** The share message, same as the iPhone app's Share FTR. */
fun shareMessage(phoneDisplay: String?, phoneDial: String?): String {
    val phone = phoneDisplay ?: "1-234-FTR-DOSE"
    return "Franklin Tiffin Room - Karnataka-style vegetarian home catering in Somerset, NJ. The LIVE Masale Dose Station at your party, Dose-in-a-Box to make at home, and catering trays. " +
        "Order on WhatsApp: https://wa.me/${phoneDial ?: "12343873673"}?text=hi or call $phone. https://franklintiffinroom.com"
}

