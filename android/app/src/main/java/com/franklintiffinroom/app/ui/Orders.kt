package com.franklintiffinroom.app.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.Done
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Message
import androidx.compose.material.icons.outlined.Notes
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material.icons.outlined.Upload
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
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
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.franklintiffinroom.app.core.Api
import com.franklintiffinroom.app.core.AppModel
import com.franklintiffinroom.app.core.Iso
import com.franklintiffinroom.app.core.Money
import com.franklintiffinroom.app.core.Order
import com.franklintiffinroom.app.core.Tab
import com.franklintiffinroom.app.core.friendly
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import java.io.ByteArrayOutputStream
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val NJ = ZoneId.of("America/New_York")

/** Sortable "YYYY-MM-DD": event date if there is one, otherwise the New Jersey day it was sent. */
val Order.dateKey: String
    get() = eventDate ?: Iso.parse(createdAt)?.atZone(NJ)?.toLocalDate()?.toString() ?: "0000-00-00"
val Order.whenText: String get() = requestedTime?.ifEmpty { null } ?: request ?: ""
private val Order.monthLabel: String
    get() = runCatching { LocalDate.parse(dateKey).format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.US)) }.getOrDefault("Earlier")

@Composable
fun OrdersScreen(model: AppModel, nav: Nav) {
    TabScreen("Orders") { pad ->
        SignedInGate(model, "Sign in to see your orders, deposits and Chef's replies.", pad) {
            LaunchedEffect(Unit) { model.refreshAccountData() }
            RefreshColumn(pad, onRefresh = { model.refreshAccountData() }) {
                if (model.orders.isEmpty()) {
                    Column(Modifier.fillMaxWidth().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("No orders yet", style = Type.display(24), color = P.ink)
                        Text("When you send an order, you'll follow it here - from Chef's approval to your deposit and pickup.", style = Type.body(16.0), color = P.muted, textAlign = TextAlign.Center)
                        SecondaryButton("Browse the menu", Modifier.widthIn(max = 240.dp)) { model.selectedTab = Tab.MENU }
                    }
                } else {
                    val today = LocalDate.now(NJ).toString()
                    val needsYou = model.orders.filter { it.needsCustomerAction }.sortedBy { it.dateKey }
                    val rest = model.orders.filter { !it.needsCustomerAction }
                    val upcoming = rest.filter { o -> !o.isClosed && (if (o.eventDate == null) !o.isConfirmed else o.dateKey >= today) }.sortedBy { it.dateKey }
                    val upIds = upcoming.map { it.orderId }.toSet()
                    val past = rest.filter { it.orderId !in upIds }.sortedByDescending { it.dateKey }
                    if (needsYou.isNotEmpty()) { SectionTitle("Needs you", P.turmericInk); needsYou.forEach { OrderRow(it) { nav.push(Screen.OrderDetail(it.orderId)) } } }
                    if (upcoming.isNotEmpty()) { SectionTitle("Upcoming", P.red); upcoming.forEach { OrderRow(it) { nav.push(Screen.OrderDetail(it.orderId)) } } }
                    if (past.isNotEmpty()) {
                        SectionTitle("Past orders", P.red)
                        past.groupBy { if (it.dateKey == "0000-00-00") "Earlier" else it.monthLabel }.forEach { (month, list) ->
                            Text(month, style = Type.semi(14.0), color = P.muted)
                            list.forEach { OrderRow(it) { nav.push(Screen.OrderDetail(it.orderId)) } }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun OrderRow(o: Order, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().card(P.surface, if (o.needsCustomerAction) P.turmeric else P.line).clickable(onClick = onClick).padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        DateTile(o.dateKey)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(o.title, style = Type.display(18), color = P.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(6.dp))
                StatusPill(o)
            }
            if (o.whenText.isNotEmpty()) Text(o.whenText, style = Type.body(14.0), color = P.muted, maxLines = 2)
            if (o.chatOpen == true) LabelRow(Icons.Outlined.Message, "Chef sent you a message", P.turmericInk, 14.0, FontWeight.SemiBold)
            Row {
                Text(o.orderId, style = Type.body(13.0), color = P.muted, modifier = Modifier.weight(1f))
                if (o.subtotal > 0) Text(Money.text(o.subtotal, true), style = Type.bold(15.0), color = P.ink)
            }
        }
    }
}

/** A small calendar page with the order's date: month, day number, weekday. */
@Composable
private fun DateTile(key: String) {
    val d = runCatching { LocalDate.parse(key) }.getOrNull()
    Column(Modifier.width(50.dp).card(P.surface, P.line, RoundedCornerShape(10.dp)), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.fillMaxWidth().background(P.red, RoundedCornerShape(topStart = 10.dp, topEnd = 10.dp)).padding(vertical = 3.dp), contentAlignment = Alignment.Center) {
            Text(d?.format(DateTimeFormatter.ofPattern("MMM", Locale.US))?.uppercase() ?: "", style = Type.bold(11.0), color = P.cream)
        }
        Text(d?.dayOfMonth?.toString() ?: "–", style = Type.display(22), color = P.ink, modifier = Modifier.padding(top = 2.dp))
        Text(d?.format(DateTimeFormatter.ofPattern("EEE", Locale.US)) ?: "", style = Type.semi(11.0), color = P.muted, modifier = Modifier.padding(bottom = 4.dp))
    }
}

@Serializable private data class AcceptBody(val accept: Boolean)

@Composable
fun OrderDetailScreen(model: AppModel, nav: Nav, orderId: String) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val order = model.orders.firstOrNull { it.orderId == orderId }
    var uploading by remember { mutableStateOf(false) }
    var uploadMessage by remember { mutableStateOf<String?>(null) }
    var uploadError by remember { mutableStateOf<String?>(null) }
    var answering by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf<String?>(null) }
    var commentOn by remember { mutableStateOf(false) }
    var confirmCancel by remember { mutableStateOf(false) }
    var cancelling by remember { mutableStateOf(false) }
    var cancelError by remember { mutableStateOf<String?>(null) }

    // Keep it current while Chef is working on it.
    LaunchedEffect(orderId) { while (true) { model.refreshOrder(orderId); delay(30_000) } }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            uploading = true; uploadError = null; uploadMessage = null
            try {
                val jpeg = withContext(Dispatchers.IO) { jpegForUpload(ctx, uri) } ?: run { uploadError = "That picture couldn't be opened. Please try a different one."; return@launch }
                model.replaceOrder(Api.upload<Order>("orders/$orderId/payment-proof", jpeg, "image/jpeg"))
                uploadMessage = "Got your confirmation - Chef will check the payment and confirm your deposit shortly."
                model.refreshAccountData()
            } catch (e: Exception) { uploadError = e.friendly() } finally { uploading = false }
        }
    }

    fun copy(label: String, value: String) {
        (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(label, value))
        copied = label
    }

    TabScreen(orderId, onBack = { nav.pop() }) { pad ->
        if (order == null) { Loading(); return@TabScreen }
        val o: Order = order
        RefreshColumn(pad, onRefresh = { model.refreshOrder(orderId) }, spacing = 22) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                StatusPill(o)
                Text(o.title, style = Type.display(28), color = P.ink)
                o.requestedTime?.let { MutedText(it, 16.0) }
            }
            o.timeChange?.let { Notice("Chef has set your time to ${it.to}. You asked for ${it.from}.", Tone.WARN, Icons.Outlined.History) }
            if (o.isClosed) Notice(closedText(o), Tone.BAD, Icons.Outlined.Cancel) else TiffinProgress(o)
            if (o.chatOpen == true || !o.chat.isNullOrEmpty()) ChefChatPanel(model, o)

            o.quote?.takeIf { it.open }?.let { q ->
                Panel {
                    Text("Chef's quote", style = Type.display(20), color = P.ink)
                    Text(Money.auto(q.price), style = Type.display(36), color = P.ink)
                    q.comment?.let { Text("“$it”", style = Type.body(16.0), color = P.ink) }
                    o.request?.let { MutedText("Your request: $it") }
                    model.config?.paymentSentence?.let { MutedText(it) }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        fun answer(accept: Boolean) = scope.launch {
                            answering = true
                            runCatching { Api.post<Order, AcceptBody>("orders/${o.orderId}/quote", AcceptBody(accept)) }.onSuccess { model.refreshAccountData() }
                            answering = false
                        }
                        SecondaryButton("Decline", Modifier.weight(1f), enabled = !answering) { answer(false) }
                        PrimaryButton("Accept quote", Modifier.weight(1f), enabled = !answering) { answer(true) }
                    }
                }
            }

            val pay = o.payment
            if (pay != null && o.canUploadProof) Panel {
                Text(if (pay.state == "review") "Confirmation received" else "Pay your deposit by Zelle", style = Type.display(20), color = P.ink)
                if (pay.state == "review") Notice("Thanks - we have your payment confirmation. Chef will check the payment and confirm your deposit here.", Tone.INFO, Icons.Outlined.CheckCircle)
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(Money.text(pay.depositDue, true), style = Type.display(36), color = P.ink, modifier = Modifier.weight(1f))
                    pay.deadlineLabel?.let {
                        Column(horizontalAlignment = Alignment.End) {
                            MutedText("Pay by", 13.0)
                            Text(it, style = Type.bold(15.0), color = P.turmericInk)
                        }
                    }
                }
                PayStep(1, "Scan this code to pay ${Money.text(pay.depositDue, true)}") {
                    MutedText("Open your bank app, choose Zelle, and scan the code. Put ${pay.memo} in the memo.")
                    Api.absolute(pay.qrUrl)?.let { url ->
                        AsyncImage(model = url, contentDescription = "Zelle QR code for Franklin Tiffin Room - scan with your bank app",
                            contentScale = ContentScale.Fit, modifier = Modifier.widthIn(max = 210.dp).heightIn(max = 280.dp).background(Color.White, RoundedCornerShape(10.dp)))
                    }
                    MutedText("Can't scan? Send it by Zelle to:")
                    CopyRow("Send to", pay.zelleTo + (pay.zelleName?.let { " ($it)" } ?: ""), copied == "Send to") { copy("Send to", pay.zelleTo) }
                    CopyRow("Memo", pay.memo, copied == "Memo") { copy("Memo", pay.memo) }
                }
                PayStep(2, "Take a screenshot of the confirmation") {
                    MutedText("When your bank shows the payment as sent, take a screenshot of that confirmation screen.")
                }
                PayStep(3, "Upload the screenshot here") {
                    MutedText("Chef checks it against the payment and confirms your deposit${if (pay.state == "review") "" else " - that locks in your date"}.")
                    PrimaryButton(if (pay.screenshotsSent > 0) "Upload another confirmation" else "Upload payment confirmation", busy = uploading) {
                        picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    }
                    uploadMessage?.let { Notice(it, Tone.INFO, Icons.Outlined.CheckCircle) }
                    uploadError?.let { Notice(it, Tone.BAD, Icons.Outlined.ErrorOutline) }
                }
                if (pay.balance > 0) MutedText("The balance of ${Money.text(pay.balance, true)} is due ${balanceWhere(o)}.")
            }
            if (pay != null && pay.state == "paid") Notice(pay.summary, Tone.INFO, Icons.Outlined.Verified)

            Panel {
                Text("Details", style = Type.display(20), color = P.ink)
                if (o.isCustom) o.request?.let { Text(it, style = Type.body(16.0), color = P.ink) }
                if (o.isPast && !o.pastItems.isNullOrEmpty()) {
                    Text(o.pastItems, style = Type.body(16.0), color = P.ink)
                    MutedText("Added by Chef from our records.", 13.0)
                }
                o.orderNote?.takeIf { it.isNotEmpty() }?.let { LabelRow(Icons.Outlined.Notes, "“$it”", P.muted) }
                o.lines.forEach { l ->
                    Row {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(if (l.kind == "lds") l.title else "${l.qtyLabel} × ${l.title}", style = Type.semi(16.0), color = P.ink)
                            if (l.kind == "lds") l.detail?.let { MutedText(it) }
                            l.note?.let { MutedText("“$it”") }
                        }
                        Text(Money.auto(l.total), style = Type.body(15.0), color = P.ink)
                    }
                }
                if (o.subtotal > 0) {
                    Divider()
                    Row {
                        Text("Total", style = Type.bold(16.0), color = P.ink, modifier = Modifier.weight(1f))
                        Text(Money.text(o.subtotal, true), style = Type.bold(17.0), color = P.ink)
                    }
                }
                val f = o.fulfillment
                if (f != null && !o.isCustom) LabelRow(if (f == "pickup") Icons.Outlined.ShoppingBag else Icons.Outlined.DirectionsCar, if (o.isLiveDose) "At your event" else f.replaceFirstChar { it.uppercase() })
                o.address?.takeIf { it.isNotEmpty() }?.let { LabelRow(Icons.Outlined.Place, it) }
                if (!o.isCustom && !o.isLiveDose && o.lines.isNotEmpty()) {
                    SecondaryButton("Order these again") {
                        o.lines.forEach { l -> l.itemId?.let { model.dish(it) }?.let { d -> model.add(d, minOf(l.qty, d.maxQty), l.note) } }
                        model.selectedTab = Tab.MENU
                    }
                }
            }
            SecondaryButton("Comment on this order") { commentOn = true }
            if (o.canCancel == true) {
                SecondaryButton(if (cancelling) "Cancelling…" else "Cancel this order", enabled = !cancelling, color = P.bad) { confirmCancel = true }
                MutedText(if (o.payment != null) "You can cancel until you've paid the deposit." else "You can cancel while Chef is reviewing it, or after approval until you pay the deposit.", 13.0)
            }
            cancelError?.let { Notice(it, Tone.BAD, Icons.Outlined.ErrorOutline) }
            val dial = model.config?.phoneDial
            val display = model.config?.phoneDisplay
            if (dial != null && display != null) {
                TextButton(onClick = { Intents.dial(ctx, dial) }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.Phone, null, tint = P.leaf); Spacer(Modifier.width(8.dp))
                    Text("Questions? Call Chef at $display", style = Type.semi(15.0), color = P.leaf)
                }
            }
        }
    }

    if (commentOn) FeedbackSheet(model, orderId) { commentOn = false }
    if (confirmCancel) Confirm("Cancel order $orderId?", "Chef will be told right away. You can place a new order any time.", "Cancel order", onConfirm = {
        scope.launch {
            cancelling = true; cancelError = null
            try { model.replaceOrder(Api.post<Order, com.franklintiffinroom.app.core.Empty>("orders/$orderId/cancel", com.franklintiffinroom.app.core.Empty())) }
            catch (e: Exception) { cancelError = e.friendly(); model.refreshOrder(orderId) }
            finally { cancelling = false }
        }
    }, onDismiss = { confirmCancel = false }, cancel = "Keep it")
}

private fun closedText(o: Order): String = when {
    "Released" in o.status -> "This order was released because the deposit didn't arrive in time. Call Chef if you'd still like the date."
    "Quote Declined" in o.status -> "You declined this quote."
    "Cancelled by customer" in o.status -> "You cancelled this order."
    "(batch)" in o.status -> "We're truly sorry - Chef had to cancel this pickup day's batch. Any deposit will be refunded by Zelle. This is rare and only happens in extreme situations."
    "Cancelled by Chef" in o.status -> "Chef cancelled this order. Please call if you have questions."
    else -> "Chef isn't able to take this order. Please call to talk it through, or try another date."
}

private fun balanceWhere(o: Order) = when {
    o.isCustom -> "on the day of your order"
    o.isLiveDose -> "on the day of your event"
    o.fulfillment == "delivery" -> "at delivery"
    else -> "at pickup"
}

/** Screenshots can be huge; 2000px on the long side is plenty to read. */
private fun jpegForUpload(ctx: Context, uri: Uri): ByteArray? {
    val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
    val longest = maxOf(bmp.width, bmp.height)
    val scaled = if (longest > 2000) Bitmap.createScaledBitmap(bmp, bmp.width * 2000 / longest, bmp.height * 2000 / longest, true) else bmp
    return ByteArrayOutputStream().use { out -> scaled.compress(Bitmap.CompressFormat.JPEG, 85, out); out.toByteArray() }
}

@Composable
private fun CopyRow(label: String, value: String, copied: Boolean, onCopy: () -> Unit) {
    Row(Modifier.fillMaxWidth().background(P.surface2, RoundedCornerShape(12.dp)).clickable(onClick = onCopy).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            MutedText(label, 13.0)
            Text(value, style = Type.semi(16.0), color = P.ink)
        }
        Icon(if (copied) Icons.Outlined.Done else Icons.Outlined.ContentCopy, "Copy", tint = P.leaf)
    }
}

/** One numbered step of paying the deposit. */
@Composable
private fun PayStep(number: Int, title: String, content: @Composable () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.semantics { contentDescription = "Step $number: $title" }) {
        Box(Modifier.size(28.dp).background(P.forest, CircleShape), contentAlignment = Alignment.Center) {
            Text("$number", style = androidx.compose.ui.text.TextStyle(fontFamily = Type.josefin, fontWeight = FontWeight.Bold, fontSize = androidx.compose.ui.unit.TextUnit(15f, androidx.compose.ui.unit.TextUnitType.Sp)), color = P.cream)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = Type.bold(16.0), color = P.ink)
            content()
        }
    }
}

/**
 * Order progress drawn as a steel tiffin carrier: one tier per step, stacked
 * bottom-up and filled with turmeric as the order moves along.
 */
@Composable
fun TiffinProgress(order: Order) {
    data class Step(val title: String, val detail: String?)
    val steps = buildList {
        if (order.isCustom) { add(Step("Request sent", null)); add(Step("Chef's quote", order.quote?.let { Money.text(it.price) })) }
        else { add(Step("Sent to Chef", null)); add(Step("Chef approves", null)) }
        if (order.payment != null || order.stage in listOf("deposit_due", "deposit_review")) add(Step("Zelle deposit", order.payment?.let { Money.text(it.depositDue, true) }))
        add(Step("Booked", order.eventDateLabel))
    }
    val filled = when (order.stage) {
        "quote_ready", "deposit_due", "deposit_review" -> 2
        "confirmed" -> steps.size
        "closed" -> 0
        else -> 1
    }
    val inProgress = order.stage != "confirmed" && order.stage != "closed"
    val tierH = 34.dp
    val gap = 6.dp
    val surface2 = P.surface2; val line = P.line; val turmeric = P.turmeric; val chili = P.chili; val muted = P.muted
    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(18.dp),
        modifier = Modifier.semantics { contentDescription = if (order.isClosed) "Order not booked: ${order.status}" else "Progress: ${steps.take(filled).joinToString { it.title }.ifEmpty { "starting" }} done of ${steps.size} steps" }) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(gap)) {
            Canvas(Modifier.width(46.dp).height(22.dp)) {
                drawRoundRect(muted.copy(alpha = 0.55f), topLeft = Offset(0f, 4.dp.toPx()), size = Size(size.width, 26.dp.toPx()), cornerRadius = CornerRadius(12.dp.toPx()), style = Stroke(4.dp.toPx()))
            }
            for (idx in steps.indices.reversed()) {
                val full = idx < filled
                val current = inProgress && idx == filled
                Canvas(Modifier.width(72.dp).height(tierH)) {
                    val r = CornerRadius(9.dp.toPx())
                    drawRoundRect(surface2, cornerRadius = r)
                    drawRoundRect(line.copy(alpha = 0.9f), topLeft = Offset(size.width * 0.33f, 0f), size = Size(size.width * 0.34f, size.height), cornerRadius = r, alpha = 0.6f)
                    if (full) drawRoundRect(if (order.isClosed) chili else turmeric, topLeft = Offset(4.dp.toPx(), 4.dp.toPx()), size = Size(size.width - 8.dp.toPx(), size.height - 8.dp.toPx()), cornerRadius = r)
                    drawRect(line, topLeft = Offset(0f, 4.dp.toPx()), size = Size(size.width, 2.dp.toPx()))
                    if (current) drawRoundRect(turmeric, cornerRadius = r, style = Stroke(2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))))
                }
            }
            Box(Modifier.width(84.dp).height(10.dp).background(muted.copy(alpha = 0.35f), RoundedCornerShape(50)))
        }
        Column(Modifier.weight(1f).padding(bottom = 10.dp + gap / 2)) {
            for (idx in steps.indices.reversed()) {
                val s = steps[idx]
                val strong = idx < filled || (inProgress && idx == filled)
                Row(Modifier.height(tierH + gap), verticalAlignment = Alignment.CenterVertically) {
                    Text(s.title, style = Type.body(16.0, if (strong) FontWeight.Bold else FontWeight.Normal),
                        color = if (idx < filled) P.ink else if (inProgress && idx == filled) P.turmericInk else P.muted, modifier = Modifier.weight(1f))
                    s.detail?.let { MutedText(it) }
                }
            }
        }
    }
}

// MARK: chat with Chef

@Composable
fun ChefChatPanel(model: AppModel, order: Order) {
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Messages with Chef", style = Type.display(20), color = P.ink, modifier = Modifier.weight(1f))
            if (order.chatOpen == true) Pill("Chef is waiting", P.turmericInk, P.turmeric.copy(alpha = 0.25f))
        }
        order.chat.orEmpty().forEach { m ->
            val mine = m.from != "chef"
            Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start, modifier = Modifier.padding(start = if (mine) 40.dp else 0.dp, end = if (mine) 0.dp else 40.dp)) {
                    Text(if (mine) "You" else "Chef", style = Type.semi(12.0), color = P.muted)
                    Text(m.text, style = Type.body(16.0), color = if (mine) P.leafInk else P.ink,
                        modifier = Modifier.background(if (mine) P.leaf else P.surface, RoundedCornerShape(14.dp)).border(1.dp, if (mine) P.leaf else P.line, RoundedCornerShape(14.dp)).padding(horizontal = 12.dp, vertical = 8.dp))
                }
            }
        }
        if (order.chatOpen == true) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Field(text, { text = it }, "Reply to Chef", Modifier.weight(1f), minLines = 1, maxLines = 5)
                IconButton(
                    onClick = {
                        val t = text.trim()
                        if (t.isEmpty()) return@IconButton
                        scope.launch {
                            sending = true; error = null
                            try { model.replyToChef(order.orderId, t); text = "" } catch (e: Exception) { error = e.friendly(); model.refreshOrder(order.orderId) } finally { sending = false }
                        }
                    },
                    enabled = text.isNotBlank() && !sending,
                    colors = IconButtonDefaults.iconButtonColors(containerColor = P.leaf, contentColor = P.leafInk, disabledContainerColor = P.leaf.copy(alpha = 0.4f)),
                    modifier = Modifier.size(48.dp),
                ) {
                    if (sending) CircularProgressIndicator(Modifier.size(20.dp), color = P.leafInk, strokeWidth = 2.dp) else Icon(Icons.AutoMirrored.Filled.Send, "Send to Chef")
                }
            }
            MutedText("Chef gets this on WhatsApp right away. Chef will approve your order once you've sorted it out.", 13.0)
        } else MutedText("Chef has closed this chat. Use Ask a question in Account to message Chef.", 13.0)
        error?.let { Notice(it, Tone.BAD, Icons.Outlined.ErrorOutline) }
    }
}
