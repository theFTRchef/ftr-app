import Foundation

// MARK: - Public: business config, menu, dates

struct AppConfig: Decodable {
    struct PickupTimes: Decodable { let am: String; let pm: String; let amLabel: String; let pmLabel: String }
    struct Deposit: Decodable { let enabled: Bool; let percent: Double }
    struct Delivery: Decodable {
        let kitchenKnown: Bool
        let maxMiles: Double?
        let ldsMaxMiles: Double?
        let ldsTravelRule: String
    }

    let businessName: String
    let shortName: String
    let tagline: String
    let phoneDisplay: String
    let phoneDial: String?
    let halfTrays: Bool
    let halfTrayPercent: Double
    let orderMinimum: Double
    let maxOrderQtyPerItem: Double
    let cateringPickupOnly: Bool
    let pickupAgreementText: String
    let pickupTimes: PickupTimes
    let paymentSentence: String
    let deposit: Deposit
    let zelleQrUrl: String?
    let delivery: Delivery
    let bookingWindowDays: Int
    let minAppVersion: String
    let supportEmail: String?
    /// From /admin › Setup › Zelle (nil when Zelle deposits are switched off).
    struct Zelle: Decodable { let to: String; let name: String? }
    let zelle: Zelle?
    let instagram: String?
    let signInByWhatsApp: Bool?
    let menuVersion: String?
}

struct MenuResponse: Decodable { let categories: [MenuCategory] }

struct MenuCategory: Decodable, Identifiable, Hashable {
    enum Kind: String, Decodable {
        case catering, lds
        init(from decoder: Decoder) throws {
            self = Kind(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .catering
        }
    }
    let id: String
    let title: String
    let subtitle: String
    let kind: Kind
    let open: Bool
    let items: [Dish]
    /// LIVE Dose Station average stars (other sections rate per dish).
    let rating: ItemRating?
    let liveDose: LiveDoseInfo?
    /// Set for pre-order sections (Dose-in-a-Box, weekly takeout).
    let preorder: PreorderInfo?
    /// Home button Chef put this section under: "festival" or "dry" (nil = Catering Items / Weekly Specials).
    let section: String?
}

struct PreorderDay: Decodable, Hashable, Identifiable {
    let date: String
    let label: String
    let pickupTime: String
    let pickupLabel: String
    let orderByLabel: String
    /// Kitchen minimum / most for the day, all customers together.
    let items: [PreorderItemStatus]?
    var id: String { date }
}

struct PreorderItemStatus: Decodable, Hashable {
    let itemId: String
    let title: String
    let ordered: Int
    let adding: Int?
    let min: Int
    let max: Int?
    let left: Int?
    let needed: Int
    let reached: Bool

    /// "4 of 10 ordered · 6 more needed for the batch · 8 left"
    var summary: String {
        var parts: [String] = []
        if min > 0 { parts.append(ordered >= min ? "\(ordered) ordered · kitchen minimum of \(min) reached" : "\(ordered) of \(min) ordered · \(needed) more needed for the batch") }
        else { parts.append("\(ordered) ordered") }
        if let left { parts.append(left == 0 ? "sold out" : "\(left) left") }
        return parts.joined(separator: " · ")
    }
}

struct PreorderInfo: Decodable, Hashable {
    let flagship: Bool
    let days: [PreorderDay]
    let next: PreorderDay?
}

struct Dish: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let description: String
    let price: Double
    let halfTrayPrice: Double?
    let size: String
    let servesMin: Double?
    let servesMax: Double?
    let minQty: Double
    let maxQty: Double
    let qtyStep: Double
    let requiresNote: Bool
    let notePrompt: String?
    /// Chef's pick (promoted by Chef) and limited availability. Optional: older servers don't send them.
    let promoted: Bool?
    let promoNote: String?
    let limited: Bool?
    let limitedNote: String?
    /// Average stars from customers who ordered it (sent once a few have rated it).
    let rating: ItemRating?

    var isPick: Bool { promoted == true }
    var isLimited: Bool { limited == true }

    var servesText: String? {
        guard let lo = servesMin, lo > 1 else { return nil }
        if let hi = servesMax, hi > lo { return "Serves \(Int(lo))–\(Int(hi))" }
        return "Serves \(Int(lo))"
    }
}

struct LiveDoseInfo: Decodable, Hashable {
    struct Option: Decodable, Hashable { let total: Int; let price: Double }
    let setupFee: Double
    let pricePerHundred: Double
    let minTotal: Int
    let maxTotal: Int
    let increment: Int
    let mdTitle: String
    let mdDescription: String
    let odTitle: String
    let odDescription: String
    let delayFeePerHour: Double
    let options: [Option]
    /// Standard on-site serving sessions (admin › Setup › Standard times).
    struct Session: Decodable, Hashable { let start: String; let end: String; let label: String; let title: String }
    struct Extension: Decodable, Hashable { let minutes: Int; let fee: Double }
    let sessions: [Session]?
    let extraTime: Extension?
    let extraDoseNote: String?
    let setupMinutes: Int?
}

struct AvailabilityResponse: Decodable {
    struct FulfillmentOptions: Decodable { let pickup: Bool; let delivery: Bool }
    let kind: String?
    let fulfillment: String
    let dates: [OpenDate]
    let fulfillmentOptions: FulfillmentOptions?
    let preorderDays: [PreorderDay]?
    /// Days Chef marked Booked (private events) - shown as Booked, not left out.
    let booked: [BookedDate]?
}

struct BookedDate: Decodable, Identifiable, Hashable {
    let date: String
    let label: String
    let lunch: Bool
    let dinner: Bool
    let summary: String
    var id: String { date }
}

struct OpenDate: Decodable, Identifiable, Hashable {
    let date: String
    let label: String
    let catering: Bool
    let cateringPickup: Bool
    let cateringDelivery: Bool
    let liveDose: Bool
    let summary: String
    let slots: [Slot]?
    var id: String { date }
}

struct Slot: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let subtitle: String?
}

// MARK: - Account

struct Profile: Decodable, Equatable {
    let phone: String
    let phoneDisplay: String
    let firstName: String
    let lastName: String
    let savedAddress: String?
    let needsName: Bool
    let unread: Int
    /// The owner's phone (or APP_ADMIN_PHONES): can open Chef's Kitchen.
    let isAdmin: Bool?
    /// Customer's choice: a phone alert for Chef's announcements and new dishes.
    let announcementAlerts: Bool?
}

struct SignInResult: Decodable { let token: String; let profile: Profile }

// MARK: - Checkout

struct AddressCheck: Decodable {
    struct Match: Decodable, Hashable {
        let label: String
        let miles: Double?
        let maxMiles: Double?
        let inRange: Bool
        let travelFee: Double?
    }
    /// "match", "none" (not on the map) or "unavailable" (lookup service down)
    let status: String
    let matches: [Match]
}

struct OrderLine: Decodable, Hashable {
    let kind: String
    let itemId: String?
    let title: String
    let detail: String?
    let qty: Double
    let qtyLabel: String
    let note: String?
    let total: Double
    let mdQty: Int?
    let odQty: Int?
    let setupFee: Double?
    let travelFee: Double?
    let extensionMinutes: Int?
    let extensionFee: Double?
}

struct OrderPreview: Decodable {
    struct Schedule: Decodable {
        let arrival: String
        let servingStart: String
        let servingEnd: String
        let sessionEnd: String?
        let extraMinutes: Int
        let extraTime: LiveDoseInfo.Extension?
        let extraDoseNote: String?
        let delayFeePerHour: Double?
    }
    struct OutOfRange: Decodable { let miles: Double; let max: Double }
    struct Payment: Decodable { let deposit: Bool; let percent: Double?; let amount: Double?; let text: String }

    let lines: [OrderLine]
    let subtotal: Double
    let deliveryFeeNote: String?
    let travelFee: Double?
    let travelFeeUnknown: Bool
    let travelRule: String?
    let fulfillment: String
    let address: String?
    let addressVerified: Bool
    let distanceMiles: Double?
    let outOfRange: OutOfRange?
    let requestedTime: String
    let schedule: Schedule?
    let payment: Payment
    struct Preorder: Decodable { let pickupLabel: String; let orderByLabel: String; let notes: [String]? }
    let preorder: Preorder?
}

// MARK: - Orders

struct Order: Decodable, Identifiable, Hashable {
    enum Stage: String, Decodable {
        case review, quote_requested, quote_ready, deposit_due, deposit_review, confirmed, closed
        case unknown
        init(from decoder: Decoder) throws {
            self = Stage(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
        }
    }
    struct Quote: Decodable, Hashable { let price: Double; let comment: String?; let open: Bool }
    struct Payment: Decodable, Hashable {
        let state: String
        let depositDue: Double
        let balance: Double
        let deadline: String?
        let deadlineLabel: String?
        let zelleTo: String
        let zelleName: String?
        let memo: String
        let qrUrl: String?
        let summary: String
        let screenshotsSent: Int
    }

    let orderId: String
    let type: String
    let status: String
    let stage: Stage
    let createdAt: String?
    let eventDate: String?
    let eventDateLabel: String?
    let requestedTime: String?
    let fulfillment: String?
    let address: String?
    let subtotal: Double
    let lines: [OrderLine]
    let itemsText: String
    let request: String?
    let quote: Quote?
    let payment: Payment?
    let canUploadProof: Bool
    /// The customer's note for the whole order.
    let orderNote: String?
    /// What was ordered, for an order from before the app (added by Chef in admin).
    let pastItems: String?
    /// Can still be cancelled (before the 50% deposit is paid).
    let canCancel: Bool?
    /// Chef changed the time before approving.
    struct TimeChange: Decodable, Hashable { let from: String; let to: String; let at: String? }
    let timeChange: TimeChange?
    /// Messages between Chef and the customer about this order.
    struct ChatLine: Decodable, Hashable { let from: String; let text: String; let at: String? }
    let chat: [ChatLine]?
    /// Chef has a chat open about this order, so the customer can reply.
    let chatOpen: Bool?

    var id: String { orderId }
    var isCustom: Bool { type == "custom" }
    var isPast: Bool { type == "past" }
    var isPreorder: Bool { type == "preorder" }
    var isLiveDose: Bool { type == "lds" }

    var title: String {
        if isCustom { return "Custom request" }
        if isPast { return "Past order" }
        if isLiveDose { return "LIVE Dose Station" }
        let names = lines.map(\.title)
        if names.count <= 2 { return names.joined(separator: " & ") }
        return "\(names[0]), \(names[1]) +\(names.count - 2)"
    }

    var createdDate: Date? { createdAt.flatMap(ISO8601.parse) }
    var needsCustomerAction: Bool { stage == .deposit_due || (quote?.open ?? false) || (chatOpen ?? false) }
}

struct OrdersResponse: Decodable { let orders: [Order] }

// MARK: - Messages

struct InboxMessage: Decodable, Identifiable, Hashable {
    struct Action: Decodable, Hashable { let type: String; let orderId: String; let accept: Bool; let title: String? }
    let id: String
    let at: String
    let read: Bool
    let header: String?
    let text: String
    let imageUrl: String?
    let actions: [Action]?
    let orderId: String?
    let actioned: Bool?
    /// What kind of update this is: approved, declined, deposit_due, reminder, paid,
    /// not_received, released, quote, screenshot, received, update.
    let tag: String?
    let tagLabel: String?

    var date: Date? { ISO8601.parse(at) }
}

struct InboxResponse: Decodable { let messages: [InboxMessage]; let unread: Int }

enum ISO8601 {
    private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let plain = ISO8601DateFormatter()
    static func parse(_ s: String) -> Date? { withFraction.date(from: s) ?? plain.date(from: s) }
}

// MARK: - Formatting

enum Money {
    static func text(_ value: Double, cents: Bool? = nil) -> String {
        let showCents = cents ?? (value.rounded() != value)
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "USD"
        f.locale = Locale(identifier: "en_US")
        f.minimumFractionDigits = showCents ? 2 : 0
        f.maximumFractionDigits = showCents ? 2 : 0
        return f.string(from: NSNumber(value: value)) ?? "$\(value)"
    }
}

enum Qty {
    /// 0.5 -> "½", 1.5 -> "1½", 2 -> "2"
    static func text(_ q: Double) -> String {
        if q.rounded() == q { return String(Int(q)) }
        let whole = Int(q.rounded(.down))
        return (whole > 0 ? String(whole) : "") + "½"
    }
}
