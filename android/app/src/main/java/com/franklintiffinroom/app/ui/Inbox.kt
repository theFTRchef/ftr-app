package com.franklintiffinroom.app.ui

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachMoney
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Message
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.RequestQuote
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.franklintiffinroom.app.core.Api
import com.franklintiffinroom.app.core.AppModel
import com.franklintiffinroom.app.core.InboxMessage
import com.franklintiffinroom.app.core.Iso
import com.franklintiffinroom.app.core.Order
import com.franklintiffinroom.app.core.Tab
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private enum class Filter(val label: String) {
    ALL("All"), NEWS("Announcements"), DECISIONS("Approvals & declines"), MESSAGES("Messages from Chef"), PAYMENTS("Payments");
    fun includes(tag: String?) = when (this) {
        ALL -> true
        NEWS -> tag == "announcement"
        DECISIONS -> tag in listOf("approved", "declined", "quote", "released")
        MESSAGES -> tag == "chef_message"
        PAYMENTS -> tag in listOf("deposit_due", "reminder", "paid", "not_received", "screenshot", "released")
    }
}

@Serializable private data class QuoteAnswer(val accept: Boolean)

/** Everything Chef's kitchen has sent this customer, each labelled, newest first. */
@Composable
fun InboxScreen(model: AppModel) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var filter by remember { mutableStateOf(Filter.ALL) }
    var acting by remember { mutableStateOf<String?>(null) }
    val prefs = remember { ctx.getSharedPreferences("ftr.app", Context.MODE_PRIVATE) }
    var cardDismissed by remember { mutableStateOf(prefs.getBoolean("alertsCardDismissed", false)) }

    TabScreen("Notifications") { pad ->
        SignedInGate(model, "Sign in to get Chef's approvals, deposit requests and updates about your orders.", pad) {
            LaunchedEffect(Unit) { model.refreshAccountData(); model.markInboxRead() }
            RefreshColumn(pad, onRefresh = { model.refreshAccountData() }, spacing = 14) {
                if (model.inbox.isEmpty()) {
                    Column(Modifier.fillMaxWidth().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("No messages yet", style = Type.display(24), color = P.ink)
                        Text("Updates from Chef about your orders will show up here.", style = Type.body(16.0), color = P.muted, textAlign = TextAlign.Center)
                    }
                    return@RefreshColumn
                }
                if (model.profile?.announcementAlerts != true && !cardDismissed) {
                    Column(Modifier.fillMaxWidth().background(P.turmericSoft, RoundedCornerShape(16.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        LabelRow(Icons.Filled.Campaign, "Hear about new dishes first", P.ink, 16.0, androidx.compose.ui.text.font.FontWeight.Bold)
                        MutedText("Get a phone alert when Chef adds festival specials, new dishes or dry products. You can turn it off any time in Account.")
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            PrimaryButton("Turn on alerts", Modifier.weight(1f)) { model.setAnnouncementAlerts(true) }
                            SecondaryButton("Not now", Modifier.weight(1f)) { cardDismissed = true; prefs.edit().putBoolean("alertsCardDismissed", true).apply() }
                        }
                    }
                }
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Filter.entries.forEach { f ->
                        val sel = filter == f
                        Text(f.label, style = Type.semi(14.0), color = if (sel) P.leafInk else P.ink,
                            modifier = Modifier.background(if (sel) P.leaf else P.surface, RoundedCornerShape(50)).border(1.dp, if (sel) P.leaf else P.line, RoundedCornerShape(50))
                                .clickable { filter = f }.padding(horizontal = 12.dp, vertical = 7.dp))
                    }
                }
                val shown = model.inbox.filter { filter.includes(it.tag) }
                if (shown.isEmpty()) MutedText("Nothing here yet.", 15.0, Modifier.padding(top = 20.dp))
                shown.forEach { m ->
                    Bubble(model, m, acting != null) { a ->
                        scope.launch {
                            acting = a.orderId
                            runCatching { Api.post<Order, QuoteAnswer>("orders/${a.orderId}/quote", QuoteAnswer(a.accept)) }
                            model.refreshAccountData()
                            acting = null
                        }
                    }
                }
            }
        }
    }
}

private val whenFormat = DateTimeFormatter.ofPattern("MMM d, h:mm a", Locale.US)

@Composable
private fun Bubble(model: AppModel, m: InboxMessage, busy: Boolean, answer: (InboxMessage.Action) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        BrandMark(28)
        Column(
            Modifier.weight(1f).background(if (m.read) P.surface else P.leafSoft, RoundedCornerShape(topStart = 4.dp, topEnd = 18.dp, bottomEnd = 18.dp, bottomStart = 18.dp)).padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (m.tagLabel != null && m.tag != "update") TagChip(m.tag ?: "", m.tagLabel)
            m.header?.let { Text(it, style = Type.bold(15.0), color = P.ink) }
            if (m.text.isNotEmpty()) SelectionContainer { Text(m.text.replace("*", ""), style = Type.body(16.0), color = P.ink) }
            Api.absolute(m.imageUrl)?.let { url ->
                AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.widthIn(max = 220.dp).heightIn(max = 220.dp))
            }
            val actions = m.actions.orEmpty()
            if (actions.isNotEmpty() && m.actioned != true && model.orders.firstOrNull { it.orderId == actions[0].orderId }?.quote?.open == true) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    actions.forEach { a ->
                        if (a.accept) PrimaryButton("Accept", Modifier.weight(1f), enabled = !busy) { answer(a) }
                        else SecondaryButton("Decline", Modifier.weight(1f), enabled = !busy) { answer(a) }
                    }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Iso.parse(m.at)?.let { MutedText(it.atZone(ZoneId.systemDefault()).format(whenFormat), 13.0) }
                Spacer(Modifier.weight(1f))
                val o = m.orderId?.let { id -> model.orders.firstOrNull { it.orderId == id } }
                if (o != null) TextButton(onClick = { model.openOrderId = o.orderId; model.selectedTab = Tab.ORDERS }) {
                    Text(if (m.tag == "chef_message" && o.chatOpen == true) "Reply" else "View order", style = Type.semi(14.0), color = P.leaf)
                }
            }
        }
    }
}

/** The label on each notification: good news in green, problems in red, things to do in gold. */
@Composable
fun TagChip(tag: String, label: String) {
    val good = tag in listOf("approved", "paid")
    val bad = tag in listOf("declined", "released", "not_received")
    val todo = tag in listOf("deposit_due", "reminder", "quote", "chef_message", "announcement")
    val icon = when (tag) {
        "approved" -> Icons.Filled.Verified
        "paid" -> Icons.Filled.CheckCircle
        "declined", "released" -> Icons.Filled.Cancel
        "not_received" -> Icons.Filled.Error
        "deposit_due", "reminder" -> Icons.Filled.AttachMoney
        "quote" -> Icons.Filled.RequestQuote
        "screenshot" -> Icons.Filled.Image
        "chef_message" -> Icons.Filled.Message
        "announcement" -> Icons.Filled.Campaign
        else -> Icons.Filled.Notifications
    }
    val fg = if (good) P.leaf else if (bad) P.bad else if (todo) P.turmericInk else P.muted
    val bg = if (good) P.leafSoft else if (bad) P.chiliSoft else if (todo) P.turmericSoft else P.surface2
    Pill(label, fg, bg, icon = icon)
}

