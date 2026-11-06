package com.franklintiffinroom.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.franklintiffinroom.app.core.AppModel
import com.franklintiffinroom.app.core.Cart
import com.franklintiffinroom.app.core.Dish
import com.franklintiffinroom.app.core.LiveDoseInfo
import com.franklintiffinroom.app.core.MenuCategory
import com.franklintiffinroom.app.core.Money
import com.franklintiffinroom.app.core.PreorderDay
import com.franklintiffinroom.app.core.PreorderItemStatus
import com.franklintiffinroom.app.core.Qty
import kotlin.math.max
import kotlin.math.min

private fun lineTotal(d: Dish, qty: Double) = Cart.Line(itemId = d.id, title = d.title, unitPrice = d.price, halfTrayPrice = d.halfTrayPrice, qty = qty).total

@Composable
fun DishSheet(model: AppModel, dish: Dish, category: MenuCategory?, onDismiss: () -> Unit) {
    var qty by remember { mutableStateOf(if (dish.minQty < 1) 1.0 else dish.minQty) }
    var note by remember { mutableStateOf("") }
    var confirmReplace by remember { mutableStateOf(false) }
    val ps = model.preorderStatus(dish.id)
    val isPre = category?.preorder != null
    val maxQty = ps?.second?.left?.let { max(dish.minQty, min(dish.maxQty, it.toDouble())) } ?: dish.maxQty
    val canAdd = ps?.second?.left != 0 && category?.open != false && (!dish.requiresNote || note.isNotBlank())
    val total = lineTotal(dish, qty)
    val warning = model.replaceWarning(dish)
    fun commit() { model.add(dish, qty, note); onDismiss() }

    FullSheet(onDismiss, bottomBar = {
        BottomBar { PrimaryButton("Add to order · ${Money.auto(total)}", enabled = canAdd) { if (warning != null) confirmReplace = true else commit() } }
    }) { pad ->
        ScrollBody(pad) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(dish.title, style = Type.display(30), color = P.ink)
                if (dish.meta.isNotEmpty()) Text(dish.meta, style = Type.semi(16.0), color = P.muted)
            }
            if (dish.description.isNotEmpty()) Text(dish.description, style = Type.body(17.0), color = P.ink)
            if (ps != null) PreorderProgress(ps.first, ps.second, qty.toInt())
            Panel {
                Row {
                    Text(if (isPre) "Each" else "Full tray", style = Type.body(16.0), color = P.ink, modifier = Modifier.weight(1f))
                    Text(Money.text(dish.price), style = Type.bold(16.0), color = P.ink)
                }
                dish.halfTrayPrice?.let { half ->
                    Row {
                        Text("Half tray", style = Type.body(16.0), color = P.ink, modifier = Modifier.weight(1f))
                        Text(Money.auto(half), style = Type.bold(16.0), color = P.ink)
                    }
                }
                Divider()
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(if (isPre) "How many?" else "How many trays?", style = Type.semi(16.0), color = P.ink)
                        val parts = mutableListOf<String>()
                        if (dish.qtyStep < 1) parts += "Half trays welcome"
                        if (dish.minQty > 1) parts += "Minimum ${Qty.text(dish.minQty)}"
                        parts += "Up to ${Qty.text(dish.maxQty)}"
                        MutedText(parts.joinToString(" · "), 13.0)
                    }
                    QtyStepper(qty, dish.minQty, maxQty, dish.qtyStep) { qty = it }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (dish.requiresNote) (dish.notePrompt ?: "Your preference") else "Notes for Chef (optional)", style = Type.semi(16.0), color = P.ink)
                Field(note, { note = it }, if (dish.requiresNote) "Required" else "Spice level, customizations…", minLines = 2, maxLines = 4)
            }
            if (qty >= dish.maxQty) model.config?.phoneDisplay?.let {
                Notice("Need more than ${Qty.text(dish.maxQty)}? Call Chef at $it so we can plan properly.", Tone.INFO, Icons.Outlined.Phone)
            }
            if (ps?.second?.left == 0) Notice("Sold out for the next pickup day.", Tone.WARN, Icons.Outlined.Cancel)
            else if (category?.open == false) Notice("No catering dates are open right now, so this can't be ordered yet.", Tone.WARN, Icons.Outlined.CalendarMonth)
        }
    }
    if (confirmReplace && warning != null) Confirm(warning.title, warning.message, warning.action, onConfirm = { commit() }, onDismiss = { confirmReplace = false })
}

@Composable
fun QtyStepper(value: Double, min: Double, max: Double, step: Double, onChange: (Double) -> Unit) {
    val canDown = value - step >= min - 0.001
    val canUp = value + step <= max + 0.001
    Row(
        Modifier.background(P.surface2, RoundedCornerShape(50)).semantics { contentDescription = "Quantity"; stateDescription = Qty.text(value) },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = { onChange(kotlin.math.max(min, value - step)) }, enabled = canDown) {
            Icon(Icons.Filled.Remove, "Fewer", tint = if (canDown) P.leaf else P.muted.copy(alpha = 0.5f))
        }
        Text(Qty.text(value), style = Type.bold(18.0), color = P.ink, textAlign = TextAlign.Center, modifier = Modifier.widthIn(min = 36.dp))
        IconButton(onClick = { onChange(kotlin.math.min(max, value + step)) }, enabled = canUp) {
            Icon(Icons.Filled.Add, "More", tint = if (canUp) P.leaf else P.muted.copy(alpha = 0.5f))
        }
    }
}

/** Several dishes picked at once: set each quantity (and any required note), then add them all. */
@Composable
fun MultiAddSheet(model: AppModel, dishes: List<Dish>, onAdded: () -> Unit, onDismiss: () -> Unit) {
    val qty = remember { mutableStateMapOf<String, Double>() }
    val notes = remember { mutableStateMapOf<String, String>() }
    var confirmReplace by remember { mutableStateOf(false) }
    fun q(d: Dish) = qty[d.id] ?: max(1.0, d.minQty)
    val total = dishes.sumOf { lineTotal(it, q(it)) }
    val ready = dishes.isNotEmpty() && dishes.all { !it.requiresNote || !notes[it.id].isNullOrBlank() }
    val warning = dishes.firstOrNull()?.let { model.replaceWarning(it) }
    fun commit() { dishes.forEach { model.add(it, q(it), notes[it.id]) }; onAdded(); onDismiss() }

    FullSheet(onDismiss, bottomBar = {
        BottomBar { PrimaryButton("Add all to order · ${Money.auto(total)}", enabled = ready) { if (warning != null) confirmReplace = true else commit() } }
    }) { pad ->
        ScrollBody(pad, contentPadding = 16, spacing = 14) {
            Text("Add ${dishes.size} dishes", style = Type.display(28), color = P.ink)
            dishes.forEach { d ->
                Panel {
                    Row {
                        Text(d.title, style = Type.display(19), color = P.ink, modifier = Modifier.weight(1f))
                        Text(Money.auto(lineTotal(d, q(d))), style = Type.bold(16.0), color = P.ink)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        MutedText(d.meta, modifier = Modifier.weight(1f))
                        QtyStepper(q(d), d.minQty, d.maxQty, d.qtyStep) { qty[d.id] = it }
                    }
                    Field(notes[d.id] ?: "", { notes[d.id] = it }, if (d.requiresNote) (d.notePrompt ?: "Your preference (required)") else "Notes for Chef (optional)", minLines = 1, maxLines = 3, style = Type.body(15.0))
                    if (d.requiresNote && notes[d.id].isNullOrBlank()) Text("Chef needs this to prepare ${d.title}.", style = Type.body(13.0), color = P.turmericInk)
                }
            }
        }
    }
    if (confirmReplace && warning != null) Confirm(warning.title, warning.message, warning.action, onConfirm = { commit() }, onDismiss = { confirmReplace = false })
}

/** Kitchen minimum / most for a pickup day, with what this order adds. */
@Composable
fun PreorderProgress(day: PreorderDay, status: PreorderItemStatus, adding: Int = 0) {
    Panel {
        Text("Pickup ${day.pickupLabel}", style = Type.bold(15.0), color = P.ink)
        MutedText("Order by ${day.orderByLabel}", 13.0)
        if (status.min > 0) {
            val total = status.ordered + adding
            LinearProgressIndicator(
                progress = { min(total, status.min).toFloat() / status.min },
                modifier = Modifier.fillMaxWidth(),
                color = if (total >= status.min) P.veg else P.turmeric, trackColor = P.surface2,
            )
            val msg = when {
                status.ordered >= status.min -> "${status.ordered} ordered - kitchen minimum of ${status.min} reached, the batch is on"
                adding > 0 && total >= status.min -> "Your $adding bring${if (adding == 1) "s" else ""} it to $total - that makes the minimum of ${status.min}, the batch is on!"
                adding > 0 -> "With yours: $total of ${status.min} - ${status.min - total} more needed for the batch"
                else -> "${status.ordered} of ${status.min} ordered so far - ${status.min - total} more needed for the batch"
            }
            Text(msg, style = Type.semi(14.0), color = if (total >= status.min) P.veg else P.turmericInk)
        } else Text(status.summary, style = Type.body(14.0), color = P.ink)
        status.left?.let { MutedText(if (it == 0) "Sold out for this day" else "$it left for this day", 13.0) }
        if (status.min > 0) MutedText("The kitchen minimum is for the whole day, all customers together. If it isn't reached by the order-by time, Chef may cancel the batch and everyone is told.", 12.5)
    }
}

// MARK: LIVE Dose Station

/** Pick a combined plate total, split it between Mysore Masale Dose and Onion Dose, add a note. Same rules as the bot. */
@Composable
fun LiveDoseSheet(model: AppModel, category: MenuCategory, onDismiss: () -> Unit) {
    val lds: LiveDoseInfo = category.liveDose ?: LiveDoseInfo()
    val existing = model.cart.liveDose
    var total by remember { mutableStateOf(existing?.total ?: (lds.options.firstOrNull()?.total ?: lds.minTotal)) }
    var md by remember { mutableStateOf(existing?.md ?: total) }
    var note by remember { mutableStateOf(existing?.note ?: "") }
    var confirmReplace by remember { mutableStateOf(false) }
    val price = lds.options.firstOrNull { it.total == total }?.price ?: 0.0
    fun commit() { model.setLiveDose(Cart.LiveDose(total, md, note.trim().ifEmpty { null }, price)); onDismiss() }

    FullSheet(onDismiss, bottomBar = {
        BottomBar { PrimaryButton("Add station · ${Money.text(price)}") { if (model.cart.lines.isNotEmpty()) confirmReplace = true else commit() } }
    }) { pad ->
        ScrollBody(pad, spacing = 22) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Plan your LIVE Dose Station", style = Type.display(28), color = P.ink)
                MutedText("Our crew sets up at your event and cooks every dose fresh. One setup fee per event.", 16.0)
            }
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("How many plates in total?", style = Type.bold(17.0), color = P.ink)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    lds.options.forEach { o ->
                        val sel = total == o.total
                        Column(
                            Modifier.weight(1f).heightIn(min = 74.dp)
                                .background(if (sel) P.leaf else P.surface, RoundedCornerShape(14.dp))
                                .border(1.dp, if (sel) P.leaf else P.line, RoundedCornerShape(14.dp))
                                .clickable { total = o.total; md = min(md, total) }.padding(8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                        ) {
                            Text("${o.total}", style = Type.display(24), color = if (sel) P.leafInk else P.ink)
                            Text(Money.text(o.price), style = Type.semi(14.0), color = if (sel) P.leafInk else P.ink)
                        }
                    }
                }
                MutedText("Prices include the ${Money.text(lds.setupFee)} setup fee.", 13.0)
            }
            Panel {
                Text("Your mix", style = Type.bold(17.0), color = P.ink)
                SplitRow(lds.mdTitle, lds.mdDescription, md)
                Divider()
                SplitRow(lds.odTitle, lds.odDescription, total - md)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MutedText("${lds.mdTitle}, in steps of ${lds.increment}", modifier = Modifier.weight(1f))
                    QtyStepper(md.toDouble(), 0.0, total.toDouble(), lds.increment.toDouble()) { md = it.toInt() }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Notes for the crew (optional)", style = Type.semi(16.0), color = P.ink)
                Field(note, { note = it }, "Spice level, timing, setup space…", minLines = 2, maxLines = 4)
            }
            lds.sessions?.takeIf { it.isNotEmpty() }?.let { sessions ->
                Panel {
                    Text("On-site serving times", style = Type.bold(17.0), color = P.ink)
                    sessions.forEach { s ->
                        Row { MutedText(s.label, 15.0, Modifier.weight(1f)); Text(s.title, style = Type.body(15.0), color = P.ink) }
                    }
                    lds.extraTime?.let { MutedText("Need longer? Add ${it.minutes} extra minutes for ${Money.text(it.fee)} when you book.") }
                    lds.extraDoseNote?.let { MutedText(it) }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Notice("Travel: ${model.config?.delivery?.ldsTravelRule?.ifEmpty { null } ?: "first miles included"}. You'll see the exact fee once you enter the event address.", Tone.INFO, Icons.Outlined.DirectionsCar)
                if (lds.delayFeePerHour > 0) Notice("Delays on the event side (late access, space not ready) are charged at ${Money.text(lds.delayFeePerHour)}/hr.", Tone.WARN, Icons.Outlined.Schedule)
            }
            Spacer(Modifier.size(4.dp))
        }
    }
    if (confirmReplace) Confirm("Your catering trays will be removed", "Catering trays and the LIVE Dose Station are booked as separate orders.", "Book the LIVE Dose Station instead", onConfirm = { commit() }, onDismiss = { confirmReplace = false })
}

@Composable
private fun SplitRow(title: String, detail: String, count: Int) {
    Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = Type.display(18), color = P.ink)
            if (detail.isNotEmpty()) MutedText(detail)
        }
        Text("$count", style = Type.display(24), color = P.ink, modifier = Modifier.padding(start = 8.dp))
    }
}
