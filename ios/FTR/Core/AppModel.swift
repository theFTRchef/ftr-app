import Foundation
import Observation
import UserNotifications
import UIKit

/// What's in the bag. Catering trays and the LIVE Dose Station are booked as
/// separate orders (same rule as the WhatsApp bot), so a cart holds one or the other.
struct Cart: Codable, Equatable {
    struct Line: Codable, Equatable, Identifiable {
        var id = UUID()
        var itemId: String
        var title: String
        var unitPrice: Double
        var halfTrayPrice: Double?
        var qty: Double
        var note: String?

        /// Matches the server: whole trays at full price, a half tray at the half-tray price.
        var total: Double {
            let whole = qty.rounded(.down)
            let half = qty - whole > 0 ? (halfTrayPrice ?? unitPrice / 2) : 0
            return whole * unitPrice + half
        }
    }
    struct LiveDose: Codable, Equatable {
        var total: Int
        var md: Int
        var note: String?
        var price: Double
        var od: Int { total - md }
    }

    var lines: [Line] = []
    var liveDose: LiveDose?

    var isEmpty: Bool { lines.isEmpty && liveDose == nil }
    var isLiveDose: Bool { liveDose != nil }
    var count: Int { liveDose != nil ? 1 : lines.count }
    var subtotal: Double { liveDose?.price ?? lines.reduce(0) { $0 + $1.total } }
}

/// The cart as saved to the account: dish ids, quantities and notes only.
struct SavedCart: Codable {
    struct Line: Codable { let itemId: String; let qty: Double; let note: String? }
    struct LDS: Codable { let total: Int; let md: Int; let note: String? }
    let lines: [Line]
    let liveDose: LDS?
}

struct SavedCartResponse: Decodable {
    let cart: SavedCart
    let updatedAt: String?
}

struct OrderRequest: Encodable {
    struct Item: Encodable { let itemId: String; let qty: Double; let note: String? }
    struct LDS: Encodable { let total: Int; let md: Int; let note: String?; var extend: Bool = false }
    var kind: String
    var items: [Item]?
    var liveDose: LDS?
    var fulfillment: String
    var date: String?
    var slotId: String?
    var address: String?
    var useUnverifiedAddress: Bool
    var askChefOutOfRange: Bool
    var pickupAgreed: Bool
    var orderNote: String? = nil
    var clientRequestId: String
}

@MainActor
@Observable
final class AppModel {
    var config: AppConfig?
    var categories: [MenuCategory] = []
    var loadError: String?
    var isLoading = false

    var profile: Profile?
    var isSignedIn: Bool { profile != nil }

    var cart = Cart() { didSet { saveCart() } }
    /// When the cart was last saved to the customer's account (nil = only on this phone).
    var cartSavedAt: Date?
    var orders: [Order] = []
    var inbox: [InboxMessage] = []
    var unread = 0
    var selectedTab: Tab = .menu
    var openOrderId: String?
    /// True while the sign-in sheet is up (it asks for the name itself).
    var signInOpen = false

    enum Tab: Hashable { case menu, orders, messages, account }

    private let api = APIClient.shared
    private var pushToken: String?
    private var applyingSavedCart = false
    private var cartSyncTask: Task<Void, Never>?

    init() {
        if let data = UserDefaults.standard.data(forKey: "ftr.cart"), let c = try? JSONDecoder().decode(Cart.self, from: data) {
            cart = c
        }
        api.onSignedOut = { [weak self] in self?.signedOut() }
    }

    var needsAppUpdate: Bool {
        guard let min = config?.minAppVersion,
              let mine = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String else { return false }
        return mine.compare(min, options: .numeric) == .orderedAscending
    }

    // MARK: loading

    func bootstrap() async {
        await loadMenu()
        if api.token != nil {
            do {
                profile = try await (api.get("me") as Profile)
                unread = profile?.unread ?? 0
                await refreshAccountData()
                await restoreSavedCart()
                sendPushTokenIfNeeded()
            } catch let e as APIError where e.status == 401 {
                signedOut()
            } catch {}
        }
    }

    func loadMenu() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let c: AppConfig = api.get("config")
            async let m: MenuResponse = api.get("menu")
            config = try await c
            categories = try await m.categories
            loadError = nil
            reconcileCart()
        } catch is CancellationError {
            // The screen that asked for it closed - not a problem.
        } catch {
            loadError = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    func refreshAccountData() async {
        guard isSignedIn else { return }
        async let o = try? (api.get("orders") as OrdersResponse)
        async let i = try? (api.get("inbox") as InboxResponse)
        let ordersResult = await o
        let inboxResult = await i
        if let ordersResult { orders = ordersResult.orders }
        if let inboxResult {
            inbox = inboxResult.messages
            unread = inboxResult.unread
        }
        UNUserNotificationCenter.current().setBadgeCount(unread) { _ in }
    }

    func refreshOrder(_ id: String) async -> Order? {
        guard let o = try? await (api.get("orders/\(id)") as Order) else { return nil }
        if let idx = orders.firstIndex(where: { $0.orderId == id }) { orders[idx] = o } else { orders.insert(o, at: 0) }
        return o
    }

    /// Send a reply to Chef's chat about an order. Throws with Chef-facing errors (e.g. chat closed).
    func replyToChef(orderId: String, text: String) async throws {
        struct B: Encodable { let text: String }
        let o: Order = try await api.post("orders/\(orderId)/chat", B(text: text))
        if let idx = orders.firstIndex(where: { $0.orderId == orderId }) { orders[idx] = o } else { orders.insert(o, at: 0) }
    }

    // MARK: account

    func signedIn(_ result: SignInResult) {
        api.token = result.token
        profile = result.profile
        Task {
            await refreshAccountData()
            await restoreSavedCart()
            sendPushTokenIfNeeded()
        }
    }

    func updateProfile(_ p: Profile) { profile = p }

    func signOut() async {
        _ = try? await api.post("auth/signout", APIClient.Empty()) as APIClient.OK
        signedOut()
    }

    func deleteAccount() async throws {
        struct Deleted: Decodable { let deleted: Bool }
        let _: Deleted = try await api.delete("me")
        signedOut()
        cart = Cart()
    }

    private func signedOut() {
        // The cart belongs to the account (it's saved there). Clear it from this phone so
        // the next person to sign in here doesn't overwrite their own saved cart with it.
        cartSyncTask?.cancel()
        applyingSavedCart = true
        cart = Cart()
        applyingSavedCart = false
        api.token = nil
        profile = nil
        orders = []
        inbox = []
        unread = 0
        cartSavedAt = nil
    }

    // MARK: cart

    func add(_ dish: Dish, qty: Double, note: String?) {
        if cart.isLiveDose { cart = Cart() }
        let trimmed = note?.trimmingCharacters(in: .whitespacesAndNewlines)
        let n = (trimmed?.isEmpty ?? true) ? nil : trimmed
        if let idx = cart.lines.firstIndex(where: { $0.itemId == dish.id && $0.note == n }) {
            cart.lines[idx].qty = min(dish.maxQty, cart.lines[idx].qty + qty)
        } else {
            cart.lines.append(.init(itemId: dish.id, title: dish.title, unitPrice: dish.price, halfTrayPrice: dish.halfTrayPrice, qty: qty, note: n))
        }
    }

    func setLiveDose(_ lds: Cart.LiveDose) {
        cart = Cart(lines: [], liveDose: lds)
    }

    func dish(_ id: String) -> Dish? {
        categories.lazy.flatMap(\.items).first { $0.id == id }
    }

    /// Keep the saved cart in step with today's menu and prices.
    private func reconcileCart() {
        var c = cart
        c.lines = c.lines.compactMap { line in
            guard let d = dish(line.itemId) else { return nil }
            var l = line
            l.title = d.title
            l.unitPrice = d.price
            l.halfTrayPrice = d.halfTrayPrice
            if d.qtyStep >= 1 { l.qty = max(d.minQty, l.qty.rounded(.up)) }
            l.qty = min(max(l.qty, d.minQty), d.maxQty)
            return l
        }
        if let l = c.liveDose {
            let info = categories.first(where: { $0.kind == .lds })?.liveDose
            if let price = info?.options.first(where: { $0.total == l.total })?.price {
                c.liveDose?.price = price
            } else {
                c.liveDose = nil // that plate count isn't offered any more
            }
        }
        if c != cart { cart = c }
    }

    /// Saved on this phone right away, and to the customer's account a moment later,
    /// so they can come back to it any time - here or on another phone.
    private func saveCart() {
        if let data = try? JSONEncoder().encode(cart) { UserDefaults.standard.set(data, forKey: "ftr.cart") }
        guard isSignedIn, !applyingSavedCart else { return }
        cartSavedAt = nil // "Saved" only once this version has reached the account
        cartSyncTask?.cancel()
        cartSyncTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            await self?.pushCart()
        }
    }

    /// Save now (the "Save for later" button). True if it reached the account.
    @discardableResult
    func saveCartNow() async -> Bool {
        cartSyncTask?.cancel()
        return await pushCart()
    }

    @discardableResult
    private func pushCart() async -> Bool {
        guard isSignedIn else { return false }
        let dto = SavedCart(
            lines: cart.lines.map { .init(itemId: $0.itemId, qty: $0.qty, note: $0.note) },
            liveDose: cart.liveDose.map { .init(total: $0.total, md: $0.md, note: $0.note) }
        )
        struct Body: Encodable { let cart: SavedCart }
        let ok = (try? await (api.put("me/cart", Body(cart: dto)) as SavedCartResponse)) != nil
        cartSavedAt = ok ? Date() : nil
        return ok
    }

    /// After sign-in: bring back a cart saved earlier (on any phone) if this
    /// phone's cart is empty; otherwise save this phone's cart to the account.
    private func restoreSavedCart() async {
        guard isSignedIn, !categories.isEmpty else { return } // need the menu to rebuild dishes
        if !cart.isEmpty {
            await pushCart()
            return
        }
        guard let saved = try? await (api.get("me/cart") as SavedCartResponse) else { return }
        // They may have added a dish while that was loading - keep what they're doing.
        guard cart.isEmpty else {
            await pushCart()
            return
        }
        var c = Cart()
        if let l = saved.cart.liveDose,
           let price = categories.first(where: { $0.kind == .lds })?.liveDose?.options.first(where: { $0.total == l.total })?.price {
            c.liveDose = .init(total: l.total, md: l.md, note: l.note, price: price)
        } else {
            c.lines = saved.cart.lines.compactMap { l in
                guard let d = dish(l.itemId) else { return nil }
                return .init(itemId: d.id, title: d.title, unitPrice: d.price, halfTrayPrice: d.halfTrayPrice, qty: l.qty, note: l.note)
            }
        }
        applyingSavedCart = true
        cart = c
        reconcileCart()
        applyingSavedCart = false
        if !c.isEmpty { cartSavedAt = saved.updatedAt.flatMap(ISO8601.parse) ?? Date() }
    }

    // MARK: messages

    func markInboxRead() async {
        guard unread > 0 else { return }
        struct R: Decodable { let unread: Int }
        struct B: Encodable {}
        let result = try? await (api.post("inbox/read", B()) as R)
        if let r = result {
            unread = r.unread
            inbox = inbox.map { m in
                InboxMessage(id: m.id, at: m.at, read: true, header: m.header, text: m.text, imageUrl: m.imageUrl, actions: m.actions, orderId: m.orderId, actioned: m.actioned, tag: m.tag, tagLabel: m.tagLabel)
            }
            UNUserNotificationCenter.current().setBadgeCount(unread) { _ in }
        }
    }

    // MARK: push notifications

    /// Asked right after a first order, when it's obvious why.
    func askForNotifications() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    func didRegister(deviceToken: Data) {
        pushToken = deviceToken.map { String(format: "%02x", $0) }.joined()
        sendPushTokenIfNeeded()
    }

    private func sendPushTokenIfNeeded() {
        guard isSignedIn, let pushToken else { return }
        struct B: Encodable { let token: String; let environment: String }
        #if DEBUG
        let env = "sandbox"
        #else
        let env = "production"
        #endif
        Task { _ = try? await api.post("me/push-token", B(token: pushToken, environment: env)) as APIClient.OK }
    }

    func openFromNotification(orderId: String?) {
        if let orderId {
            selectedTab = .orders
            openOrderId = orderId
        } else {
            selectedTab = .messages
        }
        Task { await refreshAccountData() }
    }
}
