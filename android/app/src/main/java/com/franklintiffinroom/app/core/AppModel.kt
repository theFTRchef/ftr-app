package com.franklintiffinroom.app.core

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.franklintiffinroom.app.BuildConfig
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.time.Instant
import java.util.UUID
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * What's in the bag. Catering trays, pre-orders and the LIVE Dose Station are
 * booked as separate orders (same rule as the WhatsApp bot).
 */
@Serializable
data class Cart(val lines: List<Line> = emptyList(), val liveDose: LiveDose? = null) {
    @Serializable
    data class Line(
        val id: String = UUID.randomUUID().toString(),
        val itemId: String,
        val title: String,
        val unitPrice: Double,
        val halfTrayPrice: Double? = null,
        val qty: Double,
        val note: String? = null,
    ) {
        /** Matches the server: whole trays at full price, a half tray at the half-tray price. */
        val total: Double
            get() {
                val whole = floor(qty)
                val half = if (qty - whole > 0) (halfTrayPrice ?: (unitPrice / 2)) else 0.0
                return whole * unitPrice + half
            }
    }

    @Serializable
    data class LiveDose(val total: Int, val md: Int, val note: String? = null, val price: Double) {
        val od get() = total - md
    }

    val isEmpty get() = lines.isEmpty() && liveDose == null
    val isLiveDose get() = liveDose != null
    val count get() = if (liveDose != null) 1 else lines.size
    val subtotal get() = liveDose?.price ?: lines.sumOf { it.total }
}

@Serializable
data class SavedCart(val lines: List<Line> = emptyList(), val liveDose: LDS? = null) {
    @Serializable data class Line(val itemId: String, val qty: Double, val note: String? = null)
    @Serializable data class LDS(val total: Int, val md: Int, val note: String? = null)
}

@Serializable data class SavedCartResponse(val cart: SavedCart = SavedCart(), val updatedAt: String? = null)
@Serializable data class SavedCartBody(val cart: SavedCart)

@Serializable
data class OrderRequest(
    val kind: String,
    val items: List<Item>? = null,
    val liveDose: LDS? = null,
    val fulfillment: String,
    val date: String? = null,
    val slotId: String? = null,
    val address: String? = null,
    val useUnverifiedAddress: Boolean = false,
    val askChefOutOfRange: Boolean = false,
    val pickupAgreed: Boolean = false,
    val orderNote: String? = null,
    val clientRequestId: String,
) {
    @Serializable data class Item(val itemId: String, val qty: Double, val note: String? = null)
    @Serializable data class LDS(val total: Int, val md: Int, val note: String? = null, val extend: Boolean = false)
}

enum class Tab { MENU, ORDERS, MESSAGES, ACCOUNT }

data class ReplaceWarning(val title: String, val message: String, val action: String)

@Serializable private data class AlertsBody(val announcementAlerts: Boolean)
@Serializable private data class ChatBody(val text: String)
@Serializable private data class PushBody(val token: String, val environment: String, val platform: String = "android")
@Serializable private data class Unread(val unread: Int = 0)
@Serializable private data class Deleted(val deleted: Boolean = false)

class AppModel(app: Application) : AndroidViewModel(app) {
    var config by mutableStateOf<AppConfig?>(null)
    var categories by mutableStateOf<List<MenuCategory>>(emptyList())
    var loadError by mutableStateOf<String?>(null)
    var isLoading by mutableStateOf(false)

    var profile by mutableStateOf<Profile?>(null)
    val isSignedIn get() = profile != null

    private var _cart by mutableStateOf(Cart())
    var cart: Cart
        get() = _cart
        set(v) { _cart = v; saveCart() }
    var cartSavedAt by mutableStateOf<Instant?>(null)
    var orders by mutableStateOf<List<Order>>(emptyList())
    var inbox by mutableStateOf<List<InboxMessage>>(emptyList())
    var unread by mutableIntStateOf(0)
    var selectedTab by mutableStateOf(Tab.MENU)
    var openOrderId by mutableStateOf<String?>(null)
    var signInOpen by mutableStateOf(false)
    /** Set by MainActivity: asks Android for notification permission. */
    var requestNotificationPermission: (() -> Unit)? = null

    private val prefs = app.getSharedPreferences("ftr.app", Context.MODE_PRIVATE)
    private var pushToken: String? = null
    private var applyingSavedCart = false
    private var cartSyncJob: Job? = null

    init {
        Api.init(app)
        prefs.getString("cart", null)?.let { raw -> runCatching { _cart = Api.json.decodeFromString(Cart.serializer(), raw) } }
        Api.onSignedOut = { signedOut() }
    }

    val needsAppUpdate: Boolean
        get() {
            val min = config?.minAppVersion ?: return false
            return compareVersions(BuildConfig.VERSION_NAME, min) < 0
        }

    private fun compareVersions(a: String, b: String): Int {
        val pa = a.split(".").map { it.toIntOrNull() ?: 0 }
        val pb = b.split(".").map { it.toIntOrNull() ?: 0 }
        for (i in 0 until max(pa.size, pb.size)) {
            val d = (pa.getOrElse(i) { 0 }).compareTo(pb.getOrElse(i) { 0 })
            if (d != 0) return d
        }
        return 0
    }

    // MARK: loading

    fun bootstrap() = viewModelScope.launch {
        loadMenu()
        if (Api.token != null) {
            try {
                profile = Api.get<Profile>("me")
                unread = profile?.unread ?: 0
                refreshAccountData()
                restoreSavedCart()
                sendPushTokenIfNeeded()
            } catch (e: ApiError) {
                if (e.status == 401) signedOut()
            }
        }
    }

    suspend fun loadMenu() {
        isLoading = true
        try {
            val c = viewModelScope.async { Api.get<AppConfig>("config") }
            val m = viewModelScope.async { Api.get<MenuResponse>("menu") }
            config = c.await()
            categories = m.await().categories
            loadError = null
            reconcileCart()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            loadError = e.friendly()
        } finally {
            isLoading = false
        }
    }

    fun reloadMenu() = viewModelScope.launch { loadMenu() }

    suspend fun refreshAccountData() {
        if (!isSignedIn) return
        val o = viewModelScope.async { runCatching { Api.get<OrdersResponse>("orders") }.getOrNull() }
        val i = viewModelScope.async { runCatching { Api.get<InboxResponse>("inbox") }.getOrNull() }
        o.await()?.let { orders = it.orders }
        i.await()?.let { inbox = it.messages; unread = it.unread }
    }

    fun refreshAll() = viewModelScope.launch { refreshAccountData() }

    suspend fun refreshOrder(id: String): Order? {
        val o = runCatching { Api.get<Order>("orders/$id") }.getOrNull() ?: return null
        replaceOrder(o)
        return o
    }

    fun replaceOrder(o: Order) {
        orders = if (orders.any { it.orderId == o.orderId }) orders.map { if (it.orderId == o.orderId) o else it } else listOf(o) + orders
    }

    /** Send a reply to Chef's chat about an order. Throws with Chef-facing errors (e.g. chat closed). */
    suspend fun replyToChef(orderId: String, text: String) {
        replaceOrder(Api.post<Order, ChatBody>("orders/$orderId/chat", ChatBody(text)))
    }

    // MARK: account

    fun signedIn(result: SignInResult) {
        Api.token = result.token
        profile = result.profile
        viewModelScope.launch {
            refreshAccountData()
            restoreSavedCart()
            sendPushTokenIfNeeded()
        }
    }

    fun updateProfile(p: Profile) { profile = p }

    fun signOut() = viewModelScope.launch {
        runCatching { Api.post<OK, Empty>("auth/signout", Empty()) }
        signedOut()
    }

    suspend fun deleteAccount() {
        Api.delete<Deleted>("me")
        signedOut()
        cart = Cart()
    }

    private fun signedOut() {
        // The cart belongs to the account (it's saved there): clear it from this phone.
        cartSyncJob?.cancel()
        applyingSavedCart = true
        cart = Cart()
        applyingSavedCart = false
        Api.token = null
        profile = null
        orders = emptyList()
        inbox = emptyList()
        unread = 0
        cartSavedAt = null
    }

    // MARK: cart

    fun isPreorderDish(id: String) = categories.any { c -> c.preorder != null && c.items.any { it.id == id } }

    /** Where a pre-order dish stands for the next pickup day (min / most), if Chef set limits. */
    fun preorderStatus(dishId: String): Pair<PreorderDay, PreorderItemStatus>? {
        for (c in categories) {
            val day = c.preorder?.next ?: continue
            if (c.items.none { it.id == dishId }) continue
            day.items?.firstOrNull { it.itemId == dishId }?.let { return day to it }
        }
        return null
    }

    val cartIsPreorder get() = !cart.isLiveDose && cart.lines.any { isPreorderDish(it.itemId) }

    /** Why adding this dish would clear the cart (separate order types), or null. */
    fun replaceWarning(dish: Dish): ReplaceWarning? {
        val pre = isPreorderDish(dish.id)
        if (cart.isLiveDose) return ReplaceWarning("Your LIVE Dose Station will be removed", "The LIVE Dose Station is booked as its own order.", if (pre) "Start a pre-order instead" else "Start a catering order instead")
        if (cart.lines.isEmpty() || cartIsPreorder == pre) return null
        return if (pre) ReplaceWarning("Your catering trays will be removed", "Pre-orders (picked up on Chef's pre-order day) are a separate order from catering trays.", "Start a pre-order instead")
        else ReplaceWarning("Your pre-order will be removed", "Catering trays are a separate order from pre-orders (Dose-in-a-Box and weekly takeout).", "Start a catering order instead")
    }

    fun add(dish: Dish, qty: Double, note: String?) {
        var c = if (replaceWarning(dish) != null) Cart() else cart
        val n = note?.trim()?.ifEmpty { null }
        val idx = c.lines.indexOfFirst { it.itemId == dish.id && it.note == n }
        c = if (idx >= 0) {
            c.copy(lines = c.lines.mapIndexed { i, l -> if (i == idx) l.copy(qty = min(dish.maxQty, l.qty + qty)) else l })
        } else {
            c.copy(lines = c.lines + Cart.Line(itemId = dish.id, title = dish.title, unitPrice = dish.price, halfTrayPrice = dish.halfTrayPrice, qty = qty, note = n))
        }
        cart = c
    }

    fun setLineQty(lineId: String, qty: Double) { cart = cart.copy(lines = cart.lines.map { if (it.id == lineId) it.copy(qty = qty) else it }) }
    fun removeLine(lineId: String) { cart = cart.copy(lines = cart.lines.filter { it.id != lineId }) }
    fun setLiveDose(lds: Cart.LiveDose) { cart = Cart(liveDose = lds) }

    fun dish(id: String): Dish? = categories.asSequence().flatMap { it.items.asSequence() }.firstOrNull { it.id == id }
    val ldsInfo: LiveDoseInfo? get() = categories.firstOrNull { it.isLds }?.liveDose

    /** Keep the saved cart in step with today's menu and prices. */
    private fun reconcileCart() {
        var c = cart
        c = c.copy(lines = c.lines.mapNotNull { line ->
            val d = dish(line.itemId) ?: return@mapNotNull null
            var q = line.qty
            if (d.qtyStep >= 1) q = max(d.minQty, kotlin.math.ceil(q))
            q = min(max(q, d.minQty), d.maxQty)
            line.copy(title = d.title, unitPrice = d.price, halfTrayPrice = d.halfTrayPrice, qty = q)
        })
        c.liveDose?.let { l ->
            val price = ldsInfo?.options?.firstOrNull { it.total == l.total }?.price
            c = if (price != null) c.copy(liveDose = l.copy(price = price)) else c.copy(liveDose = null)
        }
        if (c != cart) cart = c
    }

    /** Saved on this phone right away, and to the customer's account a moment later. */
    private fun saveCart() {
        prefs.edit().putString("cart", Api.json.encodeToString(Cart.serializer(), _cart)).apply()
        if (!isSignedIn || applyingSavedCart) return
        cartSavedAt = null
        cartSyncJob?.cancel()
        cartSyncJob = viewModelScope.launch {
            delay(1000)
            pushCart()
        }
    }

    suspend fun saveCartNow(): Boolean {
        cartSyncJob?.cancel()
        return pushCart()
    }

    private suspend fun pushCart(): Boolean {
        if (!isSignedIn) return false
        val dto = SavedCart(
            lines = cart.lines.map { SavedCart.Line(it.itemId, it.qty, it.note) },
            liveDose = cart.liveDose?.let { SavedCart.LDS(it.total, it.md, it.note) },
        )
        val ok = runCatching { Api.put<SavedCartResponse, SavedCartBody>("me/cart", SavedCartBody(dto)) }.isSuccess
        cartSavedAt = if (ok) Instant.now() else null
        return ok
    }

    /** After sign-in: bring back a cart saved earlier if this phone's cart is empty. */
    private suspend fun restoreSavedCart() {
        if (!isSignedIn || categories.isEmpty()) return
        if (!cart.isEmpty) { pushCart(); return }
        val saved = runCatching { Api.get<SavedCartResponse>("me/cart") }.getOrNull() ?: return
        if (!cart.isEmpty) { pushCart(); return }
        var c = Cart()
        val l = saved.cart.liveDose
        val price = l?.let { lds -> ldsInfo?.options?.firstOrNull { it.total == lds.total }?.price }
        c = if (l != null && price != null) {
            Cart(liveDose = Cart.LiveDose(l.total, l.md, l.note, price))
        } else {
            Cart(lines = saved.cart.lines.mapNotNull { sl ->
                val d = dish(sl.itemId) ?: return@mapNotNull null
                Cart.Line(itemId = d.id, title = d.title, unitPrice = d.price, halfTrayPrice = d.halfTrayPrice, qty = sl.qty, note = sl.note)
            })
        }
        applyingSavedCart = true
        cart = c
        reconcileCart()
        applyingSavedCart = false
        if (!c.isEmpty) cartSavedAt = Iso.parse(saved.updatedAt) ?: Instant.now()
    }

    // MARK: messages

    suspend fun markInboxRead() {
        if (unread <= 0) return
        val r = runCatching { Api.post<Unread, Empty>("inbox/read", Empty()) }.getOrNull() ?: return
        unread = r.unread
        inbox = inbox.map { it.copy(read = true) }
    }

    // MARK: notifications

    /** Announcements and new dishes always land in Notifications; this adds a phone alert. */
    fun setAnnouncementAlerts(on: Boolean) = viewModelScope.launch {
        if (on) askForNotifications()
        runCatching { Api.put<Profile, AlertsBody>("me/preferences", AlertsBody(on)) }.getOrNull()?.let { profile = it }
    }

    /** Asked right after a first order, when it's obvious why. */
    fun askForNotifications() { requestNotificationPermission?.invoke() }

    /** Firebase hands the app a token; it goes to the server with the account. */
    fun didRegister(token: String) {
        pushToken = token
        sendPushTokenIfNeeded()
    }

    private fun sendPushTokenIfNeeded() {
        val t = pushToken ?: return
        if (!isSignedIn) return
        viewModelScope.launch { runCatching { Api.post<OK, PushBody>("me/push-token", PushBody(t, "production")) } }
    }

    fun openFromNotification(orderId: String?) {
        if (orderId != null) { selectedTab = Tab.ORDERS; openOrderId = orderId } else selectedTab = Tab.MESSAGES
        refreshAll()
    }
}
