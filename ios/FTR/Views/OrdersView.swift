import SwiftUI
import PhotosUI

struct OrdersView: View {
    @Environment(AppModel.self) private var model
    @State private var path: [String] = []

    var body: some View {
        NavigationStack(path: $path) {
            SignedInGate(reason: "Sign in to see your orders, deposits and Chef's replies.") {
                list
            }
            .navigationTitle("Orders")
            .navigationDestination(for: String.self) { OrderDetailView(orderId: $0) }
        }
        .onChange(of: model.openOrderId) { _, id in
            if let id {
                path = [id]
                model.openOrderId = nil
            }
        }
        .onAppear {
            if let id = model.openOrderId { path = [id]; model.openOrderId = nil }
        }
    }

    private var list: some View {
        ScrollView {
            if model.orders.isEmpty {
                VStack(spacing: 12) {
                    Text("No orders yet").font(Typeface.display(24))
                    Text("When you send an order, you'll follow it here - from Chef's approval to your deposit and pickup.")
                        .font(Typeface.body(16)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                    Button("Browse the menu") { model.selectedTab = .menu }.buttonStyle(SecondaryButtonStyle()).frame(maxWidth: 240)
                }
                .padding(32)
            } else {
                let groups = OrderGroups(model.orders)
                LazyVStack(alignment: .leading, spacing: 12) {
                    if !groups.needsYou.isEmpty {
                        sectionHeader("Needs you", color: Palette.turmericInk)
                        ForEach(groups.needsYou) { row($0) }
                    }
                    if !groups.upcoming.isEmpty {
                        sectionHeader("Upcoming", color: Palette.red)
                        ForEach(groups.upcoming) { row($0) }
                    }
                    if !groups.pastByMonth.isEmpty {
                        sectionHeader("Past orders", color: Palette.red)
                        ForEach(groups.pastByMonth, id: \.month) { group in
                            Text(group.month)
                                .font(Typeface.body(14, weight: .semibold))
                                .foregroundStyle(Palette.muted)
                                .padding(.top, 4)
                            ForEach(group.orders) { row($0) }
                        }
                    }
                }
                .padding(16)
            }
        }
        .screenBackground()
        .refreshable { await model.refreshAccountData() }
        .task { await model.refreshAccountData() }
    }

    private func sectionHeader(_ title: String, color: Color) -> some View {
        Text(title)
            .font(Typeface.display(22, relativeTo: .title3))
            .foregroundStyle(color)
            .padding(.top, 8)
    }

    private func row(_ o: Order) -> some View {
        NavigationLink(value: o.orderId) {
            HStack(alignment: .top, spacing: 14) {
                DateTile(date: o.displayDate)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(o.title).font(Typeface.display(18, relativeTo: .headline)).foregroundStyle(Palette.ink).lineLimit(1)
                        Spacer(minLength: 6)
                        StatusPill(order: o)
                    }
                    Text(o.whenText)
                        .font(Typeface.body(14)).foregroundStyle(Palette.muted).lineLimit(2).multilineTextAlignment(.leading)
                    if o.chatOpen == true {
                        Label("Chef sent you a message", systemImage: "message.fill")
                            .font(Typeface.body(14, weight: .semibold)).foregroundStyle(Palette.turmericInk)
                    }
                    HStack {
                        Text(o.orderId).font(Typeface.body(13)).foregroundStyle(Palette.muted)
                        Spacer()
                        if o.subtotal > 0 { Text(Money.text(o.subtotal, cents: true)).font(Typeface.body(15, weight: .bold)).monospacedDigit().foregroundStyle(Palette.ink) }
                    }
                }
            }
            .padding(14)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(o.needsCustomerAction ? Palette.turmeric : Palette.line))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}

/// Orders sorted by date: what needs the customer, booked events still ahead
/// (soonest first), then everything else grouped by month (newest first).
/// An order's date is its event date; custom requests without one use the day they were sent.
struct OrderGroups {
    struct Month { let month: String; let orders: [Order] }
    let needsYou: [Order]
    let upcoming: [Order]
    let pastByMonth: [Month]

    init(_ orders: [Order]) {
        let today = OrderGroups.todayKey()
        needsYou = orders.filter(\.needsCustomerAction).sorted { $0.dateKey < $1.dateKey }
        let rest = orders.filter { !$0.needsCustomerAction }
        upcoming = rest
            .filter { o in
                guard o.stage != .closed else { return false }
                // A custom request still being worked out has no event date yet: keep it up here.
                if o.eventDate == nil { return o.stage != .confirmed }
                return o.dateKey >= today
            }
            .sorted { $0.dateKey < $1.dateKey }
        let upcomingIds = Set(upcoming.map(\.orderId))
        let past = rest
            .filter { !upcomingIds.contains($0.orderId) }
            .sorted { $0.dateKey > $1.dateKey }
        var months: [Month] = []
        for o in past {
            let label = o.monthLabel
            if let last = months.last, last.month == label {
                months[months.count - 1] = Month(month: label, orders: last.orders + [o])
            } else {
                months.append(Month(month: label, orders: [o]))
            }
        }
        pastByMonth = months
    }

    /// Today in New Jersey as "YYYY-MM-DD".
    static func todayKey() -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "America/New_York")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }
}

extension Order {
    /// Event date if there is one, otherwise the New Jersey day the order was sent -
    /// always as a plain calendar day (UTC midnight) so the tile never shifts a day.
    var displayDate: Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: dateKey)
    }

    /// Sortable "YYYY-MM-DD".
    var dateKey: String {
        if let e = eventDate { return e }
        guard let d = createdDate else { return "0000-00-00" } // sorts last
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "America/New_York")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    var monthLabel: String {
        guard dateKey != "0000-00-00", let d = displayDate else { return "Earlier" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "MMMM yyyy"
        return f.string(from: d)
    }

    var whenText: String {
        if let t = requestedTime, !t.isEmpty { return t }
        if let r = request, !r.isEmpty { return r }
        return ""
    }
}

/// A small calendar page with the order's date: weekday, day number, month.
struct DateTile: View {
    let date: Date?

    var body: some View {
        VStack(spacing: 0) {
            Text(part("MMM"))
                .font(Typeface.body(11, weight: .bold, relativeTo: .caption2))
                .foregroundStyle(Palette.cream)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 3)
                .background(Palette.red)
            Text(part("d"))
                .font(Typeface.display(22, relativeTo: .title3))
                .foregroundStyle(Palette.ink)
                .padding(.top, 2)
            Text(part("EEE"))
                .font(Typeface.body(11, weight: .semibold, relativeTo: .caption2))
                .foregroundStyle(Palette.muted)
                .padding(.bottom, 4)
        }
        .frame(width: 50)
        .background(Palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.line))
        .accessibilityHidden(true)
    }

    private func part(_ format: String) -> String {
        guard let date else { return format == "d" ? "–" : "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        // Event dates arrive as plain calendar days (parsed at UTC midnight).
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = format
        return f.string(from: date)
    }
}

struct OrderDetailView: View {
    @Environment(AppModel.self) private var model
    let orderId: String

    @State private var photo: PhotosPickerItem?
    @State private var uploading = false
    @State private var uploadMessage: String?
    @State private var uploadError: String?
    @State private var answeringQuote = false
    @State private var copied: String?
    @State private var commentOn = false
    @State private var confirmCancel = false
    @State private var cancelling = false
    @State private var cancelError: String?

    private var order: Order? { model.orders.first { $0.orderId == orderId } }

    var body: some View {
        ScrollView {
            if let o = order {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack { StatusPill(order: o); Spacer() }
                        Text(o.title).font(Typeface.display(28)).foregroundStyle(Palette.ink)
                        if let t = o.requestedTime { Text(t).font(Typeface.body(16)).foregroundStyle(Palette.muted) }
                    }
                    if let c = o.timeChange {
                        Notice(tone: .warn, icon: "clock.arrow.circlepath", text: "Chef has set your time to \(c.to). You asked for \(c.from).")
                    }
                    if o.stage == .closed {
                        Notice(tone: .bad, icon: "xmark.circle", text: closedText(o))
                    } else {
                        TiffinProgress(order: o)
                    }
                    if o.chatOpen == true || !(o.chat ?? []).isEmpty { ChefChatPanel(order: o) }
                    if let q = o.quote, q.open { quotePanel(o, q) }
                    if let p = o.payment, o.canUploadProof { depositPanel(o, p) }
                    if let p = o.payment, p.state == "paid" {
                        Notice(tone: .info, icon: "checkmark.seal", text: p.summary)
                    }
                    detailsPanel(o)
                    Button { commentOn = true } label: {
                        Label("Comment on this order", systemImage: "text.bubble")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    if o.canCancel == true {
                        Button(role: .destructive) { confirmCancel = true } label: {
                            Label(cancelling ? "Cancelling…" : "Cancel this order", systemImage: "xmark.circle")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .foregroundStyle(Palette.bad)
                        .disabled(cancelling)
                        Text(o.payment != nil ? "You can cancel until you've paid the deposit." : "You can cancel while Chef is reviewing it, or after approval until you pay the deposit.")
                            .font(Typeface.body(13)).foregroundStyle(Palette.muted)
                    }
                    if let cancelError { Notice(tone: .bad, icon: "exclamationmark.circle", text: cancelError) }
                    callChef
                }
                .padding(16)
            } else {
                ProgressView().padding(40)
            }
        }
        .screenBackground()
        .navigationTitle(orderId)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { _ = await model.refreshOrder(orderId) }
        .task {
            // Keep it current while Chef is working on it.
            while !Task.isCancelled {
                _ = await model.refreshOrder(orderId)
                try? await Task.sleep(for: .seconds(30))
            }
        }
        .sheet(isPresented: $commentOn) { FeedbackView(orderId: orderId) }
        .confirmationDialog("Cancel order \(orderId)?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Cancel order", role: .destructive) { Task { await cancel() } }
            Button("Keep it", role: .cancel) {}
        } message: {
            Text("Chef will be told right away. You can place a new order any time.")
        }
        .onChange(of: photo) { _, item in
            guard let item else { return }
            Task { await upload(item) }
        }
    }

    // MARK: panels

    private func quotePanel(_ o: Order, _ q: Order.Quote) -> some View {
        Panel {
            Text("Chef's quote").font(Typeface.display(20, relativeTo: .title3))
            Text(Money.text(q.price, cents: q.price.rounded() != q.price)).font(Typeface.display(36)).monospacedDigit()
            if let c = q.comment { Text("“\(c)”").font(Typeface.body(16)) }
            if let r = o.request { Text("Your request: \(r)").font(Typeface.body(14)).foregroundStyle(Palette.muted) }
            if let s = model.config?.paymentSentence { Text(s).font(Typeface.body(14)).foregroundStyle(Palette.muted) }
            HStack(spacing: 10) {
                Button("Decline") { Task { await answerQuote(o, accept: false) } }.buttonStyle(SecondaryButtonStyle())
                Button("Accept quote") { Task { await answerQuote(o, accept: true) } }.buttonStyle(PrimaryButtonStyle())
            }
            .disabled(answeringQuote)
        }
    }

    /// Pay the deposit in three clear steps: scan & pay, screenshot, upload here.
    private func depositPanel(_ o: Order, _ p: Order.Payment) -> some View {
        Panel(padding: 16) {
            Text(p.state == "review" ? "Confirmation received" : "Pay your deposit by Zelle").font(Typeface.display(20, relativeTo: .title3))
            if p.state == "review" {
                Notice(tone: .info, icon: "checkmark.circle", text: "Thanks - we have your payment confirmation. Chef will check the payment and confirm your deposit here.")
            }
            HStack(alignment: .firstTextBaseline) {
                Text(Money.text(p.depositDue, cents: true)).font(Typeface.display(36)).monospacedDigit()
                Spacer()
                if let d = p.deadlineLabel {
                    VStack(alignment: .trailing) {
                        Text("Pay by").font(Typeface.body(13)).foregroundStyle(Palette.muted)
                        Text(d).font(Typeface.body(15, weight: .bold)).foregroundStyle(Palette.turmericInk)
                    }
                }
            }

            PayStep(number: 1, title: "Scan this code to pay \(Money.text(p.depositDue, cents: true))") {
                Text("Open your bank app, choose Zelle, and scan the code. Put \(p.memo) in the memo.")
                    .font(Typeface.body(14)).foregroundStyle(Palette.muted)
                if let url = APIClient.shared.absolute(p.qrUrl) {
                    AsyncImage(url: url) { img in
                        img.resizable().interpolation(.none).scaledToFit()
                    } placeholder: { ProgressView().frame(height: 120) }
                    .frame(maxWidth: 210, maxHeight: 280)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 10))
                    .accessibilityLabel("Zelle QR code for Franklin Tiffin Room - scan with your bank app")
                }
                Text("Can't scan? Send it by Zelle to:").font(Typeface.body(14)).foregroundStyle(Palette.muted)
                copyRow("Send to", p.zelleTo + (p.zelleName.map { " (\($0))" } ?? ""), copy: p.zelleTo)
                copyRow("Memo", p.memo, copy: p.memo)
            }

            PayStep(number: 2, title: "Take a screenshot of the confirmation") {
                Text("When your bank shows the payment as sent, take a screenshot of that confirmation screen.")
                    .font(Typeface.body(14)).foregroundStyle(Palette.muted)
            }

            PayStep(number: 3, title: "Upload the screenshot here") {
                Text("Chef checks it against the payment and confirms your deposit\(p.state == "review" ? "" : " - that locks in your date").")
                    .font(Typeface.body(14)).foregroundStyle(Palette.muted)
                PhotosPicker(selection: $photo, matching: .images) {
                    if uploading { ProgressView().tint(Palette.leafInk) } else {
                        Label(p.screenshotsSent > 0 ? "Upload another confirmation" : "Upload payment confirmation", systemImage: "square.and.arrow.up")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(uploading)
                if let uploadMessage { Notice(tone: .info, icon: "checkmark.circle", text: uploadMessage) }
                if let uploadError { Notice(tone: .bad, icon: "exclamationmark.circle", text: uploadError) }
            }

            if p.balance > 0 {
                Text("The balance of \(Money.text(p.balance, cents: true)) is due \(balanceWhere(o)).").font(Typeface.body(14)).foregroundStyle(Palette.muted)
            }
        }
    }

    private func copyRow(_ label: String, _ value: String, copy: String) -> some View {
        Button {
            UIPasteboard.general.string = copy
            copied = label
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).font(Typeface.body(13)).foregroundStyle(Palette.muted)
                    Text(value).font(Typeface.body(16, weight: .semibold)).foregroundStyle(Palette.ink).multilineTextAlignment(.leading)
                }
                Spacer()
                Image(systemName: copied == label ? "checkmark" : "doc.on.doc").foregroundStyle(Palette.leaf)
            }
            .padding(12)
            .background(Palette.surface2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityHint("Copies to the clipboard")
        .sensoryFeedback(.success, trigger: copied)
    }

    private func detailsPanel(_ o: Order) -> some View {
        Panel {
            Text("Details").font(Typeface.display(20, relativeTo: .title3))
            if o.isCustom, let r = o.request {
                Text(r).font(Typeface.body(16))
            }
            if o.isPast, let items = o.pastItems, !items.isEmpty {
                Text(items).font(Typeface.body(16))
                Text("Added by Chef from our records.").font(Typeface.body(13)).foregroundStyle(Palette.muted)
            }
            if let note = o.orderNote, !note.isEmpty {
                Label("“\(note)”", systemImage: "note.text").font(Typeface.body(15)).foregroundStyle(Palette.muted)
            }
            ForEach(Array(o.lines.enumerated()), id: \.offset) { _, l in
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(l.kind == "lds" ? l.title : "\(l.qtyLabel) × \(l.title)").font(Typeface.body(16, weight: .semibold))
                        if l.kind == "lds", let d = l.detail { Text(d).font(Typeface.body(14)).foregroundStyle(Palette.muted) }
                        if let n = l.note { Text("“\(n)”").font(Typeface.body(14)).foregroundStyle(Palette.muted) }
                    }
                    Spacer()
                    Text(Money.text(l.total, cents: l.total.rounded() != l.total)).font(Typeface.body(15)).monospacedDigit()
                }
            }
            if o.subtotal > 0 {
                Divider()
                HStack {
                    Text("Total").font(Typeface.body(16, weight: .bold))
                    Spacer()
                    Text(Money.text(o.subtotal, cents: true)).font(Typeface.body(17, weight: .bold)).monospacedDigit()
                }
            }
            if let f = o.fulfillment, !o.isCustom {
                Label(o.isLiveDose ? "At your event" : f.capitalized, systemImage: f == "pickup" ? "bag" : "car").font(Typeface.body(15))
            }
            if let a = o.address, !a.isEmpty { Label(a, systemImage: "mappin.and.ellipse").font(Typeface.body(15)) }
            if !o.isCustom && !o.isLiveDose && !o.lines.isEmpty {
                Button("Order these again") { reorder(o) }.buttonStyle(SecondaryButtonStyle())
            }
        }
    }

    @ViewBuilder private var callChef: some View {
        if let dial = model.config?.phoneDial, let url = URL(string: "tel:\(dial)"), let display = model.config?.phoneDisplay {
            Link(destination: url) {
                Label("Questions? Call Chef at \(display)", systemImage: "phone")
                    .font(Typeface.body(15, weight: .semibold))
            }
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: helpers

    private func cancel() async {
        cancelling = true
        cancelError = nil
        defer { cancelling = false }
        struct Empty: Encodable {}
        do {
            let o: Order = try await APIClient.shared.post("orders/\(orderId)/cancel", Empty())
            if let i = model.orders.firstIndex(where: { $0.orderId == orderId }) { model.orders[i] = o }
        } catch {
            cancelError = (error as? APIError)?.message ?? error.localizedDescription
            _ = await model.refreshOrder(orderId)
        }
    }

    private func closedText(_ o: Order) -> String {
        if o.status.contains("Released") { return "This order was released because the deposit didn't arrive in time. Call Chef if you'd still like the date." }
        if o.status.contains("Quote Declined") { return "You declined this quote." }
        if o.status.contains("Cancelled by customer") { return "You cancelled this order." }
        if o.status.contains("Cancelled by Chef") { return "Chef cancelled this order. Please call if you have questions." }
        return "Chef isn't able to take this order. Please call to talk it through, or try another date."
    }

    private func balanceWhere(_ o: Order) -> String {
        if o.isCustom { return "on the day of your order" }
        if o.isLiveDose { return "on the day of your event" }
        return o.fulfillment == "delivery" ? "at delivery" : "at pickup"
    }

    private func reorder(_ o: Order) {
        for l in o.lines {
            if let id = l.itemId, let dish = model.dish(id) { model.add(dish, qty: min(l.qty, dish.maxQty), note: l.note) }
        }
        model.selectedTab = .menu
    }

    private func answerQuote(_ o: Order, accept: Bool) async {
        struct B: Encodable { let accept: Bool }
        answeringQuote = true
        defer { answeringQuote = false }
        if (try? await (APIClient.shared.post("orders/\(o.orderId)/quote", B(accept: accept)) as Order)) != nil {
            await model.refreshAccountData()
        }
    }

    private func upload(_ item: PhotosPickerItem) async {
        uploading = true
        uploadError = nil
        uploadMessage = nil
        defer { uploading = false; photo = nil }
        do {
            guard let raw = try await item.loadTransferable(type: Data.self), let image = UIImage(data: raw) else {
                uploadError = "That picture couldn't be opened. Please try a different one."
                return
            }
            let jpeg = image.resizedForUpload().jpegData(compressionQuality: 0.85) ?? raw
            let updated: Order = try await APIClient.shared.upload("orders/\(orderId)/payment-proof", data: jpeg, contentType: "image/jpeg")
            if let i = model.orders.firstIndex(where: { $0.orderId == orderId }) { model.orders[i] = updated }
            uploadMessage = "Got your confirmation - Chef will check the payment and confirm your deposit shortly."
            await model.refreshAccountData()
        } catch {
            uploadError = (error as? APIError)?.message ?? error.localizedDescription
        }
    }
}

/// One numbered step of paying the deposit.
struct PayStep<Content: View>: View {
    let number: Int
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .font(.custom("JosefinSans-Bold", size: 15))
                .foregroundStyle(Palette.cream)
                .frame(width: 28, height: 28)
                .background(Palette.forest, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(Typeface.body(16, weight: .bold)).foregroundStyle(Palette.ink)
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Step \(number): \(title)")
    }
}

extension UIImage {
    /// Screenshots can be huge; 2000px on the long side is plenty to read.
    func resizedForUpload(maxSide: CGFloat = 2000) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxSide else { return self }
        let scale = maxSide / longest
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat.preferred()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
    }
}


// MARK: - Chat with Chef

/// Chef's messages about this order (sent from the approval card) and the
/// customer's replies. The reply box shows while Chef has the chat open.
struct ChefChatPanel: View {
    @Environment(AppModel.self) private var model
    let order: Order
    @State private var text = ""
    @State private var sending = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        Panel(padding: 16) {
            HStack {
                Text("Messages with Chef").font(Typeface.display(20, relativeTo: .title3))
                Spacer()
                if order.chatOpen == true {
                    Text("Chef is waiting").font(Typeface.body(13, weight: .semibold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Palette.turmeric.opacity(0.25), in: Capsule())
                        .foregroundStyle(Palette.turmericInk)
                }
            }
            ForEach(Array((order.chat ?? []).enumerated()), id: \.offset) { _, m in
                bubble(m)
            }
            if order.chatOpen == true {
                HStack(alignment: .bottom, spacing: 8) {
                    TextField("Reply to Chef", text: $text, axis: .vertical)
                        .lineLimit(1...5)
                        .font(Typeface.body(16))
                        .focused($focused)
                        .fieldStyle()
                    Button { Task { await send() } } label: {
                        if sending { ProgressView().tint(Palette.leafInk).frame(width: 44, height: 44) }
                        else { Image(systemName: "arrow.up").font(.system(size: 18, weight: .bold)).frame(width: 44, height: 44) }
                    }
                    .foregroundStyle(Palette.leafInk)
                    .background(Palette.leaf, in: Circle())
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
                    .accessibilityLabel("Send to Chef")
                }
                Text("Chef gets this on WhatsApp right away. Chef will approve your order once you've sorted it out.")
                    .font(Typeface.body(13)).foregroundStyle(Palette.muted)
            } else {
                Text("Chef has closed this chat. Use Ask a question in Account to message Chef.")
                    .font(Typeface.body(13)).foregroundStyle(Palette.muted)
            }
            if let error { Notice(tone: .bad, icon: "exclamationmark.circle", text: error) }
        }
    }

    private func bubble(_ m: Order.ChatLine) -> some View {
        let mine = m.from != "chef"
        return HStack {
            if mine { Spacer(minLength: 40) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
                Text(mine ? "You" : "Chef").font(Typeface.body(12, weight: .semibold)).foregroundStyle(Palette.muted)
                Text(m.text)
                    .font(Typeface.body(16))
                    .foregroundStyle(mine ? Palette.leafInk : Palette.ink)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(mine ? Palette.leaf : Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(mine ? .clear : Palette.line))
            }
            if !mine { Spacer(minLength: 40) }
        }
    }

    private func send() async {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        sending = true
        error = nil
        defer { sending = false }
        do {
            try await model.replyToChef(orderId: order.orderId, text: t)
            text = ""
        } catch {
            self.error = (error as? APIError)?.message ?? error.localizedDescription
            _ = await model.refreshOrder(order.orderId)
        }
    }
}
