package com.franklintiffinroom.app.core

import kotlinx.serialization.Serializable
import java.text.NumberFormat
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToLong

// Same shapes as the iPhone app (ios/FTR/Core/Models.swift) and src/appApi.js.

@Serializable
data class AppConfig(
    val businessName: String = "Franklin Tiffin Room",
    val shortName: String = "FTR",
    val tagline: String = "",
    val phoneDisplay: String = "1-234-FTR-DOSE",
    val phoneDial: String? = null,
    val halfTrays: Boolean = false,
    val halfTrayPercent: Double = 50.0,
    val orderMinimum: Double = 0.0,
    val maxOrderQtyPerItem: Double = 10.0,
    val cateringPickupOnly: Boolean = true,
    val pickupAgreementText: String = "",
    val paymentSentence: String = "",
    val deposit: Deposit = Deposit(),
    val zelleQrUrl: String? = null,
    val delivery: Delivery = Delivery(),
    val bookingWindowDays: Int = 60,
    val minAppVersion: String = "1.0",
    val supportEmail: String? = null,
    val zelle: Zelle? = null,
    val instagram: String? = null,
    val signInByWhatsApp: Boolean? = null,
    val menuVersion: String? = null,
) {
    @Serializable data class Deposit(val enabled: Boolean = false, val percent: Double = 50.0)
    @Serializable data class Delivery(val kitchenKnown: Boolean = false, val maxMiles: Double? = null, val ldsMaxMiles: Double? = null, val ldsTravelRule: String = "")
    @Serializable data class Zelle(val to: String = "", val name: String? = null)
}

@Serializable data class MenuResponse(val categories: List<MenuCategory> = emptyList())

@Serializable
data class MenuCategory(
    val id: String,
    val title: String = "",
    val subtitle: String = "",
    val kind: String = "catering",
    val open: Boolean = true,
    val items: List<Dish> = emptyList(),
    val liveDose: LiveDoseInfo? = null,
    val preorder: PreorderInfo? = null,
    /** Home button Chef put this section under: "festival" or "dry" (null = Catering Items / Weekly Specials). */
    val section: String? = null,
) {
    val isLds get() = kind == "lds"
    val isCatering get() = kind != "lds"
}

@Serializable
data class PreorderDay(
    val date: String,
    val label: String = "",
    val pickupTime: String = "",
    val pickupLabel: String = "",
    val orderByLabel: String = "",
    val items: List<PreorderItemStatus>? = null,
)

@Serializable
data class PreorderItemStatus(
    val itemId: String,
    val title: String = "",
    val ordered: Int = 0,
    val adding: Int? = null,
    val min: Int = 0,
    val max: Int? = null,
    val left: Int? = null,
    val needed: Int = 0,
    val reached: Boolean = false,
) {
    /** "4 of 10 ordered · 6 more needed for the batch · 8 left" */
    val summary: String
        get() {
            val parts = mutableListOf<String>()
            if (min > 0) parts += if (ordered >= min) "$ordered ordered · kitchen minimum of $min reached" else "$ordered of $min ordered · $needed more needed for the batch"
            else parts += "$ordered ordered"
            left?.let { parts += if (it == 0) "sold out" else "$it left" }
            return parts.joinToString(" · ")
        }
}

@Serializable data class PreorderInfo(val flagship: Boolean = false, val days: List<PreorderDay> = emptyList(), val next: PreorderDay? = null)

@Serializable
data class Dish(
    val id: String,
    val title: String = "",
    val description: String = "",
    val price: Double = 0.0,
    val halfTrayPrice: Double? = null,
    val size: String = "",
    val servesMin: Double? = null,
    val servesMax: Double? = null,
    val minQty: Double = 1.0,
    val maxQty: Double = 10.0,
    val qtyStep: Double = 1.0,
    val requiresNote: Boolean = false,
    val notePrompt: String? = null,
) {
    val servesText: String?
        get() {
            val lo = servesMin ?: return null
            if (lo <= 1) return null
            val hi = servesMax
            return if (hi != null && hi > lo) "Serves ${lo.toInt()}–${hi.toInt()}" else "Serves ${lo.toInt()}"
        }
    val meta: String get() = listOfNotNull(size.ifEmpty { null }, servesText).joinToString(" · ")
}

@Serializable
data class LiveDoseInfo(
    val setupFee: Double = 0.0,
    val pricePerHundred: Double = 0.0,
    val minTotal: Int = 100,
    val maxTotal: Int = 200,
    val increment: Int = 25,
    val mdTitle: String = "Mysore Masale Dose",
    val mdDescription: String = "",
    val odTitle: String = "Onion Dose",
    val odDescription: String = "",
    val delayFeePerHour: Double = 0.0,
    val options: List<Option> = emptyList(),
    val sessions: List<Session>? = null,
    val extraTime: Extension? = null,
    val extraDoseNote: String? = null,
    val setupMinutes: Int? = null,
) {
    @Serializable data class Option(val total: Int, val price: Double)
    @Serializable data class Session(val start: String = "", val end: String = "", val label: String = "", val title: String = "")
    @Serializable data class Extension(val minutes: Int = 30, val fee: Double = 0.0)
}

@Serializable
data class AvailabilityResponse(
    val kind: String? = null,
    val fulfillment: String = "pickup",
    val dates: List<OpenDate> = emptyList(),
    val fulfillmentOptions: FulfillmentOptions? = null,
    val preorderDays: List<PreorderDay>? = null,
) {
    @Serializable data class FulfillmentOptions(val pickup: Boolean = true, val delivery: Boolean = false)
}

@Serializable
data class OpenDate(
    val date: String,
    val label: String = "",
    val catering: Boolean = false,
    val cateringPickup: Boolean = false,
    val cateringDelivery: Boolean = false,
    val liveDose: Boolean = false,
    val summary: String = "",
    val slots: List<Slot>? = null,
)

@Serializable data class Slot(val id: String, val title: String = "", val subtitle: String? = null)

// MARK: account

@Serializable
data class Profile(
    val phone: String = "",
    val phoneDisplay: String = "",
    val firstName: String = "",
    val lastName: String = "",
    val savedAddress: String? = null,
    val needsName: Boolean = false,
    val unread: Int = 0,
    val isAdmin: Boolean? = null,
    val announcementAlerts: Boolean? = null,
)

@Serializable data class SignInResult(val token: String, val profile: Profile)

// MARK: checkout

@Serializable
data class AddressCheck(val status: String = "unavailable", val matches: List<Match> = emptyList()) {
    @Serializable data class Match(val label: String, val miles: Double? = null, val maxMiles: Double? = null, val inRange: Boolean = true, val travelFee: Double? = null)
}

@Serializable
data class OrderLine(
    val kind: String = "item",
    val itemId: String? = null,
    val title: String = "",
    val detail: String? = null,
    val qty: Double = 0.0,
    val qtyLabel: String = "",
    val note: String? = null,
    val total: Double = 0.0,
    val mdQty: Int? = null,
    val odQty: Int? = null,
    val setupFee: Double? = null,
    val travelFee: Double? = null,
    val extensionMinutes: Int? = null,
    val extensionFee: Double? = null,
)

@Serializable
data class OrderPreview(
    val lines: List<OrderLine> = emptyList(),
    val subtotal: Double = 0.0,
    val deliveryFeeNote: String? = null,
    val travelFee: Double? = null,
    val travelFeeUnknown: Boolean = false,
    val travelRule: String? = null,
    val fulfillment: String = "pickup",
    val address: String? = null,
    val addressVerified: Boolean = false,
    val distanceMiles: Double? = null,
    val outOfRange: OutOfRange? = null,
    val requestedTime: String = "",
    val schedule: Schedule? = null,
    val payment: Payment = Payment(),
    val preorder: Preorder? = null,
) {
    @Serializable data class Schedule(val arrival: String = "", val servingStart: String = "", val servingEnd: String = "", val sessionEnd: String? = null, val extraMinutes: Int = 0)
    @Serializable data class OutOfRange(val miles: Double = 0.0, val max: Double = 0.0)
    @Serializable data class Payment(val deposit: Boolean = false, val percent: Double? = null, val amount: Double? = null, val text: String = "")
    @Serializable data class Preorder(val pickupLabel: String = "", val orderByLabel: String = "", val notes: List<String>? = null)
}

// MARK: orders

@Serializable
data class Order(
    val orderId: String,
    val type: String = "catering",
    val status: String = "",
    val stage: String = "review",
    val createdAt: String? = null,
    val eventDate: String? = null,
    val eventDateLabel: String? = null,
    val requestedTime: String? = null,
    val fulfillment: String? = null,
    val address: String? = null,
    val subtotal: Double = 0.0,
    val lines: List<OrderLine> = emptyList(),
    val itemsText: String = "",
    val request: String? = null,
    val quote: Quote? = null,
    val payment: Payment? = null,
    val canUploadProof: Boolean = false,
    val orderNote: String? = null,
    val pastItems: String? = null,
    val canCancel: Boolean? = null,
    val timeChange: TimeChange? = null,
    val chat: List<ChatLine>? = null,
    val chatOpen: Boolean? = null,
) {
    @Serializable data class Quote(val price: Double = 0.0, val comment: String? = null, val open: Boolean = false)
    @Serializable data class Payment(
        val state: String = "",
        val depositDue: Double = 0.0,
        val balance: Double = 0.0,
        val deadline: String? = null,
        val deadlineLabel: String? = null,
        val zelleTo: String = "",
        val zelleName: String? = null,
        val memo: String = "",
        val qrUrl: String? = null,
        val summary: String = "",
        val screenshotsSent: Int = 0,
    )
    @Serializable data class TimeChange(val from: String = "", val to: String = "", val at: String? = null)
    @Serializable data class ChatLine(val from: String = "", val text: String = "", val at: String? = null)

    val isCustom get() = type == "custom"
    val isPast get() = type == "past"
    val isPreorder get() = type == "preorder"
    val isLiveDose get() = type == "lds"
    val isClosed get() = stage == "closed"
    val isConfirmed get() = stage == "confirmed"

    val title: String
        get() = when {
            isCustom -> "Custom request"
            isPast -> "Past order"
            isLiveDose -> "LIVE Dose Station"
            else -> {
                val names = lines.map { it.title }
                if (names.size <= 2) names.joinToString(" & ") else "${names[0]}, ${names[1]} +${names.size - 2}"
            }
        }
    val needsCustomerAction get() = stage == "deposit_due" || (quote?.open ?: false) || (chatOpen ?: false)
}

@Serializable data class OrdersResponse(val orders: List<Order> = emptyList())

@Serializable
data class InboxMessage(
    val id: String,
    val at: String = "",
    val read: Boolean = true,
    val header: String? = null,
    val text: String = "",
    val imageUrl: String? = null,
    val actions: List<Action>? = null,
    val orderId: String? = null,
    val actioned: Boolean? = null,
    val tag: String? = null,
    val tagLabel: String? = null,
) {
    @Serializable data class Action(val type: String = "", val orderId: String = "", val accept: Boolean = false, val title: String? = null)
}

@Serializable data class InboxResponse(val messages: List<InboxMessage> = emptyList(), val unread: Int = 0)

@Serializable data class FeedbackComment(val id: String, val text: String = "", val orderId: String? = null, val at: String? = null)
@Serializable data class FeedbackList(val comments: List<FeedbackComment> = emptyList())

object Iso {
    fun parse(s: String?): Instant? = s?.let { runCatching { OffsetDateTime.parse(it).toInstant() }.getOrNull() ?: runCatching { Instant.parse(it) }.getOrNull() }
}

object Money {
    fun text(value: Double, cents: Boolean? = null): String {
        val showCents = cents ?: (value.roundToLong().toDouble() != value)
        val f = NumberFormat.getCurrencyInstance(Locale.US)
        f.minimumFractionDigits = if (showCents) 2 else 0
        f.maximumFractionDigits = if (showCents) 2 else 0
        return f.format(value)
    }
    fun auto(value: Double) = text(value, value.roundToLong().toDouble() != value)
}

object Qty {
    /** 0.5 -> "½", 1.5 -> "1½", 2 -> "2" */
    fun text(q: Double): String {
        if (q.roundToLong().toDouble() == q) return q.toLong().toString()
        val whole = floor(q).toLong()
        return (if (whole > 0) whole.toString() else "") + "½"
    }
}
