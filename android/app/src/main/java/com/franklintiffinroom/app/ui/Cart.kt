package com.franklintiffinroom.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.AddShoppingCart
import androidx.compose.material.icons.outlined.AttachMoney
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material.icons.outlined.TakeoutDining
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Icon
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.franklintiffinroom.app.core.AddressCheck
import com.franklintiffinroom.app.core.Api
import com.franklintiffinroom.app.core.ApiError
import com.franklintiffinroom.app.core.AppModel
import com.franklintiffinroom.app.core.AvailabilityResponse
import com.franklintiffinroom.app.core.Cart
import com.franklintiffinroom.app.core.Money
import com.franklintiffinroom.app.core.OpenDate
import com.franklintiffinroom.app.core.Order
import com.franklintiffinroom.app.core.OrderPreview
import com.franklintiffinroom.app.core.OrderRequest
import com.franklintiffinroom.app.core.Slot
import com.franklintiffinroom.app.core.Tab
import com.franklintiffinroom.app.core.friendly
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

private enum class CartStep { CART, CHECKOUT, PLACED }

@Composable
fun CartSheet(model: AppModel, onDismiss: () -> Unit) {
    var step by remember { mutableStateOf(CartStep.CART) }
    var placed by remember { mutableStateOf<Order?>(null) }
    var showSignIn by remember { mutableStateOf(false) }
    var signInThenSave by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var savedNote by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    // Chef may have changed a switch (half trays, minimum, pickup only) since the menu loaded.
    LaunchedEffect(Unit) { model.loadMenu() }

    fun saveForLater() {
        if (!model.isSignedIn) { signInThenSave = true; showSignIn = true; return }
        scope.launch {
            saving = true
            val ok = model.saveCartNow()
            saving = false
            savedNote = if (ok) "Saved to your account. Come back any time - on this phone or another - and it'll be here."
            else "Saved on this phone. Check your connection to save it to your account too."
        }
    }

    when (step) {
        CartStep.PLACED -> placed?.let { o ->
            FullSheet(onDismiss, closeLabel = null) { pad -> OrderPlaced(model, o, pad, onDismiss) }
        }
        CartStep.CHECKOUT -> CheckoutSheet(model, onBack = { step = CartStep.CART }, onDismiss = onDismiss) { o -> placed = o; step = CartStep.PLACED }
        CartStep.CART -> {
            val belowMin = model.config?.orderMinimum?.let { it > 0 && !model.cart.isLiveDose && !model.cartIsPreorder && model.cart.subtotal < it } ?: false
            FullSheet(onDismiss, title = "Your order", bottomBar = {
                if (!model.cart.isEmpty) BottomBar {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        SecondaryButton(if (saving) "Saving…" else "Save for later", Modifier.width(150.dp), enabled = !saving) { saveForLater() }
                        PrimaryButton("Choose date & time", Modifier.weight(1f), enabled = !belowMin) {
                            if (model.isSignedIn) step = CartStep.CHECKOUT else { signInThenSave = false; showSignIn = true }
                        }
                    }
                }
            }) { pad ->
                if (model.cart.isEmpty) {
                    Column(Modifier.fillMaxSize().padding(pad).padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically)) {
                        Icon(Icons.Outlined.TakeoutDining, null, tint = P.leaf, modifier = Modifier.size(44.dp))
                        Text("Nothing here yet", style = Type.display(24), color = P.ink)
                        MutedText("Pick dishes from the menu, or plan a LIVE Dose Station.", 16.0)
                        SecondaryButton("Back to the menu", Modifier.widthIn(max = 240.dp)) { onDismiss() }
                    }
                } else ScrollBody(pad, contentPadding = 16, spacing = 16) {
                    val lds = model.cart.liveDose
                    if (lds != null) {
                        Panel {
                            Row {
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text("LIVE Dose Station", style = Type.display(20), color = P.ink)
                                    MutedText(listOfNotNull(if (lds.md > 0) "${lds.md} Mysore Masale Dose" else null, if (lds.od > 0) "${lds.od} Onion Dose" else null).joinToString(" + "), 15.0)
                                    lds.note?.let { MutedText("“$it”") }
                                }
                                Text(Money.text(lds.price), style = Type.bold(17.0), color = P.ink)
                            }
                            TextButton(onClick = { model.cart = Cart() }) { Text("Remove", style = Type.semi(15.0), color = P.bad) }
                        }
                    } else {
                        Column(Modifier.fillMaxWidth().card(P.surface, P.line, RoundedCornerShape(18.dp))) {
                            model.cart.lines.forEachIndexed { i, line ->
                                CartLineRow(model, line)
                                if (i < model.cart.lines.lastIndex) Divider()
                            }
                        }
                    }
                    Row(Modifier.padding(horizontal = 4.dp)) {
                        Text("Subtotal", style = Type.semi(17.0), color = P.ink, modifier = Modifier.weight(1f))
                        Text(Money.text(model.cart.subtotal, true), style = Type.bold(19.0), color = P.ink)
                    }
                    if (belowMin) model.config?.orderMinimum?.let { min ->
                        Notice("Catering orders start at ${Money.text(min)}. Add ${Money.text(min - model.cart.subtotal, true)} more to check out.", Tone.WARN, Icons.Outlined.AddShoppingCart)
                    }
                    model.config?.paymentSentence?.takeIf { it.isNotEmpty() }?.let { MutedText(it) }
                    val sn = savedNote
                    if (sn != null) Notice(sn, Tone.INFO, Icons.Outlined.CheckCircle)
                    else if (model.cartSavedAt != null) LabelRow(Icons.Outlined.CloudDone, "Saved to your account", P.muted, 14.0)
                }
            }
        }
    }
    if (showSignIn) SignInSheet(model, onDismiss = { showSignIn = false }) {
        showSignIn = false
        if (signInThenSave) saveForLater() else step = CartStep.CHECKOUT
    }
}

@Composable
private fun CartLineRow(model: AppModel, line: Cart.Line) {
    val dish = model.dish(line.itemId)
    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row {
            Text(line.title, style = Type.display(18), color = P.ink, modifier = Modifier.weight(1f))
            Text(Money.auto(line.total), style = Type.bold(16.0), color = P.ink)
        }
        line.note?.let { MutedText("“$it”") }
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { model.removeLine(line.id) }) { Text("Remove", style = Type.semi(14.0), color = P.bad) }
            Spacer(Modifier.weight(1f))
            if (dish != null) QtyStepper(line.qty, dish.minQty, dish.maxQty, dish.qtyStep) { model.setLineQty(line.id, it) }
        }
    }
}

// MARK: checkout

@Serializable private data class AddressBody(val address: String, val kind: String)

@Composable
private fun CheckoutSheet(model: AppModel, onBack: () -> Unit, onDismiss: () -> Unit, onPlaced: (Order) -> Unit) {
    val scope = rememberCoroutineScope()
    val isLDS = model.cart.isLiveDose
    val isPre = model.cartIsPreorder
    val ldsInfo = model.ldsInfo
    val pickupOnly = model.config?.cateringPickupOnly ?: true

    var fulfillment by remember { mutableStateOf("pickup") }
    var options by remember { mutableStateOf<AvailabilityResponse.FulfillmentOptions?>(null) }
    var pickupAgreed by remember { mutableStateOf(false) }
    var addressText by remember { mutableStateOf(model.profile?.savedAddress ?: "") }
    var addressResult by remember { mutableStateOf<AddressCheck?>(null) }
    var chosen by remember { mutableStateOf<AddressCheck.Match?>(null) }
    var useUnverified by remember { mutableStateOf(false) }
    var askChef by remember { mutableStateOf(false) }
    var checking by remember { mutableStateOf(false) }
    var addressError by remember { mutableStateOf<String?>(null) }
    var dates by remember { mutableStateOf<List<OpenDate>>(emptyList()) }
    var loadingDates by remember { mutableStateOf(true) }
    var date by remember { mutableStateOf<OpenDate?>(null) }
    var slot by remember { mutableStateOf<Slot?>(null) }
    var preview by remember { mutableStateOf<OrderPreview?>(null) }
    var previewError by remember { mutableStateOf<ApiError?>(null) }
    var placing by remember { mutableStateOf(false) }
    var placeError by remember { mutableStateOf<String?>(null) }
    val requestId = remember { UUID.randomUUID().toString() }
    var extendTime by remember { mutableStateOf(false) }
    var orderNote by remember { mutableStateOf("") }

    val needsAddress = isLDS || fulfillment == "delivery"
    val addressReady = if (!needsAddress) true else when (addressResult?.status) {
        null -> false
        "match" -> chosen?.let { it.inRange || (isLDS && askChef) } ?: false
        "none" -> useUnverified
        else -> true // lookup service down: Chef checks it
    }
    val ready = addressReady && date != null && slot != null && (isLDS || isPre || fulfillment != "pickup" || !pickupOnly || pickupAgreed)

    fun request() = OrderRequest(
        kind = if (isLDS) "lds" else if (isPre) "preorder" else "catering",
        items = if (isLDS) null else model.cart.lines.map { OrderRequest.Item(it.itemId, it.qty, it.note) },
        liveDose = model.cart.liveDose?.let { OrderRequest.LDS(it.total, it.md, it.note, extendTime) },
        fulfillment = if (isLDS) "delivery" else if (isPre) "pickup" else fulfillment,
        date = date?.date, slotId = slot?.id,
        address = if (needsAddress) (chosen?.label ?: addressText.trim()) else null,
        useUnverifiedAddress = useUnverified, askChefOutOfRange = askChef, pickupAgreed = pickupAgreed,
        orderNote = orderNote.trim().ifEmpty { null }, clientRequestId = requestId,
    )

    suspend fun loadDates() {
        loadingDates = true
        val q = mutableMapOf("kind" to (if (isLDS) "lds" else if (isPre) "preorder" else "catering"), "fulfillment" to (if (isPre) "pickup" else fulfillment))
        model.cart.liveDose?.let { q["plates"] = it.total.toString() }
        val r = runCatching { Api.get<AvailabilityResponse>("availability", q) }.getOrNull()
        loadingDates = false
        r ?: return
        dates = r.dates
        r.fulfillmentOptions?.let { o -> if (!isLDS) { options = o; if (fulfillment == "pickup" && !o.pickup && o.delivery) fulfillment = "delivery" } }
        if (date != null && dates.none { it.date == date?.date }) { date = null; slot = null }
        if (dates.size == 1 && date == null) { date = dates[0]; dates[0].slots?.singleOrNull()?.let { slot = it } }
    }

    suspend fun checkAddress() {
        checking = true; addressError = null
        try {
            val r = Api.post<AddressCheck, AddressBody>("address/check", AddressBody(addressText, if (isLDS) "lds" else "catering"))
            addressResult = r
            chosen = if (r.matches.size == 1) r.matches[0] else null
        } catch (e: Exception) { addressError = e.friendly() } finally { checking = false }
    }

    LaunchedEffect(Unit) {
        loadDates()
        if (needsAddress && addressText.length >= 8) checkAddress()
    }
    val previewKey = listOf(date?.date, slot?.id, fulfillment, chosen?.label, useUnverified, askChef, pickupAgreed, addressReady, extendTime, model.cart.subtotal).joinToString("|")
    LaunchedEffect(previewKey) {
        preview = null; previewError = null
        if (!ready) return@LaunchedEffect
        try { preview = Api.post<OrderPreview, OrderRequest>("orders/preview", request()) } catch (e: ApiError) { previewError = e }
    }

    fun place() = scope.launch {
        placing = true; placeError = null
        try {
            val order = Api.post<Order, OrderRequest>("orders", request())
            model.cart = Cart()
            model.orders = listOf(order) + model.orders
            onPlaced(order)
            model.askForNotifications()
        } catch (e: Exception) {
            placeError = e.friendly()
            if ((e as? ApiError)?.code in listOf("date_gone", "slot_gone")) { slot = null; loadDates() }
        } finally { placing = false }
    }

    BackHandler { onBack() }
    val p = preview
    FullSheet(onDismiss = onBack, title = "Checkout", closeLabel = "Back", bottomBar = {
        BottomBar {
            PrimaryButton(if (p != null) "Send to Chef · ${Money.auto(p.subtotal)}" else "Send to Chef", enabled = p != null && ready, busy = placing) { place() }
        }
    }) { pad ->
        ScrollBody(pad, contentPadding = 16, spacing = 26) {
            if (isPre) Notice("Pre-order, pickup only. Pick the pickup day below - orders for each day close at the order-by time.", Tone.INFO, Icons.Outlined.ShoppingBag)
            else if (!isLDS) Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SectionTitle("Pickup")
                if (pickupOnly) Panel {
                    Text("All catering orders are for pickup from our kitchen. Chef shares the pickup details when your order is confirmed.", style = Type.body(16.0), color = P.ink)
                    ToggleRow("I'll pick up my order", pickupAgreed) { pickupAgreed = it }
                } else {
                    val opts = listOfNotNull(if (options?.pickup != false) "pickup" else null, if (options?.delivery == true) "delivery" else null)
                    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                        opts.forEachIndexed { i, o ->
                            SegmentedButton(selected = fulfillment == o, onClick = {
                                if (fulfillment != o) { fulfillment = o; date = null; slot = null; scope.launch { loadDates() } }
                            }, shape = SegmentedButtonDefaults.itemShape(i, opts.size), colors = SegmentedButtonDefaults.colors(activeContainerColor = P.leafSoft, activeContentColor = P.leaf)) {
                                Text(o.replaceFirstChar { it.uppercase() }, style = Type.semi(15.0))
                            }
                        }
                    }
                    if (fulfillment == "delivery") MutedText("A delivery fee based on distance is added when Chef confirms.")
                }
            }

            if (needsAddress) Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SectionTitle(if (isLDS) "Event address" else "Delivery address")
                if (isLDS) MutedText("Where should our crew set up?", 15.0)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Field(addressText, {
                        addressText = it; addressResult = null; chosen = null; useUnverified = false; askChef = false; addressError = null
                    }, "Street, town, ZIP", Modifier.weight(1f))
                    TextButton(onClick = { scope.launch { checkAddress() } }, enabled = addressText.trim().length >= 8 && !checking) {
                        Text(if (checking) "…" else "Check", style = Type.semi(16.0), color = P.leaf)
                    }
                }
                addressError?.let { Notice(it, Tone.BAD, Icons.Outlined.ErrorOutline) }
                addressResult?.let { r ->
                    when (r.status) {
                        "match" -> {
                            r.matches.forEach { m -> MatchRow(m, chosen == m) { chosen = m } }
                            chosen?.takeIf { !it.inRange }?.let { m ->
                                if (isLDS) {
                                    Notice("This is about ${miles(m.miles)} from our kitchen, past our ${miles(m.maxMiles)} range for the LIVE Dose Station.", Tone.WARN, Icons.Outlined.Map)
                                    ToggleRow("Ask Chef to make an exception", askChef) { askChef = it }
                                } else Notice("We deliver within ${miles(m.maxMiles)}, and this is about ${miles(m.miles)} away. Try another address${if (pickupOnly) "" else " or switch to pickup"}.", Tone.BAD, Icons.Outlined.Map)
                            }
                        }
                        "none" -> {
                            Notice("We couldn't find that on the map. Check the street number, street name and ZIP.", Tone.WARN, Icons.Outlined.Place)
                            ToggleRow("Use it as typed - Chef will check it", useUnverified) { useUnverified = it }
                        }
                        else -> Notice("We can't check addresses right now. Chef will confirm it when reviewing your order.", Tone.INFO, Icons.Outlined.Place)
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SectionTitle(if (isPre) "Pickup day" else "Date")
                when {
                    loadingDates -> androidx.compose.material3.CircularProgressIndicator(color = P.leaf)
                    dates.isEmpty() -> Notice("Chef has no open dates for this order in the next ${model.config?.bookingWindowDays ?: 60} days. Call ${model.config?.phoneDisplay ?: "us"} to ask about your event.", Tone.WARN, Icons.Outlined.CalendarMonth)
                    else -> Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        dates.forEach { d ->
                            val parts = d.label.split(", ")
                            val sel = date?.date == d.date
                            Column(
                                Modifier.width(96.dp).heightIn(min = 66.dp).background(if (sel) P.leaf else P.surface, RoundedCornerShape(14.dp))
                                    .border(1.dp, if (sel) P.leaf else P.line, RoundedCornerShape(14.dp))
                                    .clickable { date = d; slot = d.slots?.singleOrNull() }.padding(8.dp),
                                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                            ) {
                                Text(parts.firstOrNull() ?: "", style = Type.semi(14.0), color = if (sel) P.leafInk else P.ink)
                                Text(parts.drop(1).joinToString(", "), style = Type.display(18), color = if (sel) P.leafInk else P.ink, textAlign = TextAlign.Center)
                            }
                        }
                    }
                }
            }

            date?.let { d ->
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    SectionTitle(if (isLDS) "On-site serving time" else if (isPre || fulfillment == "pickup") "Pickup time" else "Delivery window")
                    d.slots.orEmpty().forEach { s ->
                        val sel = slot?.id == s.id
                        Row(
                            Modifier.fillMaxWidth().card(P.surface, if (sel) P.leaf else P.line, RoundedCornerShape(12.dp)).clickable { slot = s }.padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Icon(if (sel) Icons.Filled.CheckCircle else Icons.Outlined.RadioButtonUnchecked, null, tint = if (sel) P.leaf else P.muted)
                            Text(s.title, style = Type.semi(16.0), color = P.ink)
                            s.subtitle?.let { MutedText(it) }
                        }
                    }
                }
            }

            if (isLDS && slot != null) Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SectionTitle("Your LIVE Dose schedule")
                Panel {
                    slot?.let { s ->
                        val start = s.title.split(" - ").firstOrNull()
                        val setup = ldsInfo?.setupMinutes
                        if (start != null && setup != null) shift(start, -setup)?.let { ScheduleRow("Crew arrives to set up", "about $it") }
                        ScheduleRow("Serving on site", s.title)
                    }
                    ldsInfo?.extraDoseNote?.let { MutedText(it) }
                }
                ldsInfo?.extraTime?.let { ext ->
                    Text("Need longer? Add ${ext.minutes} extra minutes of serving for ${Money.text(ext.fee)}.", style = Type.body(15.0), color = P.ink)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Choice("No, that's fine", !extendTime, Modifier.weight(1f)) { extendTime = false }
                        Choice("Add ${ext.minutes} min +${Money.text(ext.fee)}", extendTime, Modifier.weight(1f)) { extendTime = true }
                    }
                }
            }

            if (ready) previewError?.let { Notice(it.message, Tone.BAD, Icons.Outlined.ErrorOutline) }
            if (p != null && ready) Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SectionTitle("Review")
                Panel {
                    p.lines.forEach { l ->
                        Row {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(if (l.kind == "lds") l.title else "${l.qtyLabel} × ${l.title}", style = Type.semi(16.0), color = P.ink)
                                if (l.kind == "lds") l.detail?.let { MutedText(it) }
                                l.note?.let { MutedText("“$it”") }
                            }
                            Text(Money.auto(l.total), style = Type.body(16.0), color = P.ink)
                        }
                    }
                    p.travelFee?.takeIf { it > 0 }?.let { MutedText("Includes ${Money.text(it)} travel (${p.travelRule ?: ""})") }
                    p.lines.firstOrNull { (it.extensionFee ?: 0.0) > 0 }?.let { l -> MutedText("Includes ${Money.text(l.extensionFee ?: 0.0)} for ${l.extensionMinutes ?: 30} extra minutes of serving") }
                    if (p.travelFeeUnknown) MutedText("Chef will add any travel fee after checking the address.")
                    p.deliveryFeeNote?.let { MutedText(it) }
                    Divider()
                    Row {
                        Text("Subtotal", style = Type.bold(17.0), color = P.ink, modifier = Modifier.weight(1f))
                        Text(Money.text(p.subtotal, true), style = Type.bold(18.0), color = P.ink)
                    }
                }
                Panel {
                    LabelRow(Icons.Outlined.CalendarMonth, p.requestedTime)
                    p.schedule?.let { s ->
                        Column(Modifier.padding(start = 26.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            ScheduleRow("Crew arrives", "about ${s.arrival}")
                            ScheduleRow("Serving on site", "${s.servingStart} - ${s.servingEnd}")
                            if (s.extraMinutes > 0) ScheduleRow("Extra time", "${s.extraMinutes} min")
                        }
                    }
                    p.address?.let { LabelRow(Icons.Outlined.Place, it) }
                    p.preorder?.let { pre ->
                        LabelRow(Icons.Outlined.Schedule, "Order by ${pre.orderByLabel}")
                        pre.notes.orEmpty().forEach { n -> Text(n, style = Type.semi(14.0), color = if ("batch is on" in n || "reached" in n) P.veg else P.turmericInk) }
                    }
                    if (p.outOfRange != null) LabelRow(Icons.Outlined.WarningAmber, "Outside our usual range - Chef will decide", P.turmericInk)
                    LabelRow(Icons.Outlined.AttachMoney, p.payment.text)
                }
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Note for Chef (optional)", style = Type.semi(16.0), color = P.ink)
                    Field(orderNote, { orderNote = it }, if (isLDS) "Gate code, parking, setup space…" else "Allergies, pickup person, anything else…", minLines = 2, maxLines = 4)
                }
                MutedText("Nothing is charged now. Chef reviews every order and you'll get the answer here in the app.")
                placeError?.let { Notice(it, Tone.BAD, Icons.Outlined.ErrorOutline) }
            }
        }
    }
}

@Composable
fun ToggleRow(label: String, checked: Boolean, sub: String? = null, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!checked) }, verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label, style = Type.semi(16.0), color = P.ink)
            sub?.let { MutedText(it, 13.0) }
        }
        Switch(checked, onChange, colors = SwitchDefaults.colors(checkedTrackColor = P.leaf, checkedThumbColor = P.leafInk))
    }
}

@Composable
private fun MatchRow(m: AddressCheck.Match, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().card(P.surface, if (selected) P.leaf else P.line, RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(if (selected) Icons.Filled.CheckCircle else Icons.Outlined.RadioButtonUnchecked, null, tint = if (selected) P.leaf else P.muted)
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(m.label, style = Type.semi(16.0), color = P.ink)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                m.miles?.let { MutedText("About ${miles(it)} from our kitchen") }
                m.travelFee?.takeIf { it > 0 }?.let { Text("Travel fee ${Money.text(it)}", style = Type.body(14.0), color = P.turmericInk) }
            }
        }
    }
}

@Composable
private fun Choice(title: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Row(
        modifier.heightIn(min = 48.dp).background(if (selected) P.leaf else P.surface, RoundedCornerShape(12.dp))
            .border(1.dp, if (selected) P.leaf else P.line, RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(if (selected) Icons.Filled.CheckCircle else Icons.Outlined.RadioButtonUnchecked, null, tint = if (selected) P.leafInk else P.ink, modifier = Modifier.size(20.dp))
        Text(title, style = Type.semi(15.0), color = if (selected) P.leafInk else P.ink)
    }
}

@Composable
private fun ScheduleRow(label: String, time: String) {
    Row { MutedText(label, modifier = Modifier.weight(1f)); Text(time, style = Type.body(14.0), color = P.ink) }
}

private fun miles(m: Double?): String = when {
    m == null -> "?"
    m == Math.rint(m) -> "${m.toInt()} miles"
    else -> String.format(Locale.US, "%.1f miles", m)
}

/** "7:00 PM" moved by some minutes, e.g. -30 -> "6:30 PM". */
private fun shift(label: String, minutes: Int): String? = runCatching {
    val f = DateTimeFormatter.ofPattern("h:mm a", Locale.US)
    LocalTime.parse(label.trim().uppercase(Locale.US), f).plusMinutes(minutes.toLong()).format(f)
}.getOrNull()

// MARK: placed

@Composable
private fun OrderPlaced(model: AppModel, order: Order, pad: androidx.compose.foundation.layout.PaddingValues, close: () -> Unit) {
    ScrollBody(pad, spacing = 22) {
        Text("Sent to Chef", style = Type.display(34), color = P.ink)
        Text("Order ${order.orderId} · ${Money.text(order.subtotal, true)}", style = Type.semi(17.0), color = P.ink)
        TiffinProgress(order)
        MutedText(
            if (model.config?.deposit?.enabled == true) "Chef reviews every order personally. Once approved, you'll get Zelle details for the ${model.config?.deposit?.percent?.toInt() ?: 50}% deposit right here."
            else "Chef reviews every order personally. You'll get the answer right here in the app.", 16.0,
        )
        PrimaryButton("See my order") {
            model.selectedTab = Tab.ORDERS
            model.openOrderId = order.orderId
            close()
        }
        SecondaryButton("Done") { close() }
    }
}

