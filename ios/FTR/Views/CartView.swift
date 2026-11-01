import SwiftUI

struct CartView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var goCheckout = false
    @State private var showSignIn = false
    @State private var placed: Order?
    @State private var saving = false
    @State private var savedNote: String?
    @State private var showSignInToSave = false

    var body: some View {
        NavigationStack {
            Group {
                if let placed {
                    OrderPlacedView(order: placed) { dismiss() }
                } else if model.cart.isEmpty {
                    emptyState
                } else {
                    cartList
                }
            }
            .screenBackground()
            .navigationTitle(placed == nil ? "Your order" : "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if placed == nil {
                    ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                }
            }
            .navigationDestination(isPresented: $goCheckout) {
                CheckoutView { order in
                    goCheckout = false
                    placed = order
                }
            }
            .sheet(isPresented: $showSignIn) {
                SignInView { goCheckout = true }
            }
            .sheet(isPresented: $showSignInToSave) {
                SignInView { Task { await saveForLater() } }
            }
            // Chef may have changed a switch (half trays, minimum, pickup only) since the menu loaded.
            .task { await model.loadMenu() }
        }
    }

    /// Keep the cart for later: saved to the account (any phone) when signed in.
    private func saveForLater() async {
        guard model.isSignedIn else { showSignInToSave = true; return }
        saving = true
        let ok = await model.saveCartNow()
        saving = false
        savedNote = ok
            ? "Saved to your account. Come back any time - on this phone or another - and it'll be here."
            : "Saved on this phone. Check your connection to save it to your account too."
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "takeoutbag.and.cup.and.straw").font(.system(size: 40)).foregroundStyle(Palette.leaf)
            Text("Nothing here yet").font(Typeface.display(24))
            Text("Pick dishes from the menu, or plan a LIVE Dose Station.").font(Typeface.body(16)).foregroundStyle(Palette.muted)
            Button("Back to the menu") { dismiss() }.buttonStyle(SecondaryButtonStyle()).frame(maxWidth: 240)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var cartList: some View {
        @Bindable var model = model
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let lds = model.cart.liveDose {
                    Panel {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("LIVE Dose Station").font(Typeface.display(20, relativeTo: .title3))
                                Text([lds.md > 0 ? "\(lds.md) Mysore Masale Dose" : nil, lds.od > 0 ? "\(lds.od) Onion Dose" : nil].compactMap { $0 }.joined(separator: " + "))
                                    .font(Typeface.body(15)).foregroundStyle(Palette.muted)
                                if let n = lds.note { Text("“\(n)”").font(Typeface.body(14)).foregroundStyle(Palette.muted) }
                            }
                            Spacer()
                            Text(Money.text(lds.price)).font(Typeface.body(17, weight: .bold)).monospacedDigit()
                        }
                        Button("Remove", role: .destructive) { model.cart = Cart() }
                            .font(Typeface.body(15, weight: .semibold))
                    }
                } else {
                    VStack(spacing: 0) {
                        ForEach(model.cart.lines) { line in
                            CartLineRow(line: Binding(
                                get: { model.cart.lines.first { $0.id == line.id } ?? line },
                                set: { nv in if let i = model.cart.lines.firstIndex(where: { $0.id == line.id }) { model.cart.lines[i] = nv } }
                            ), dish: model.dish(line.itemId)) {
                                model.cart.lines.removeAll { $0.id == line.id }
                            }
                            Divider().overlay(Palette.line)
                        }
                    }
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Palette.line))
                }

                HStack {
                    Text("Subtotal").font(Typeface.body(17, weight: .semibold))
                    Spacer()
                    Text(Money.text(model.cart.subtotal, cents: true)).font(Typeface.body(19, weight: .bold)).monospacedDigit()
                }
                .padding(.horizontal, 4)

                if let min = model.config?.orderMinimum, min > 0, !model.cart.isLiveDose, model.cart.subtotal < min {
                    Notice(tone: .warn, icon: "cart.badge.plus", text: "Catering orders start at \(Money.text(min)). Add \(Money.text(min - model.cart.subtotal, cents: true)) more to check out.")
                }
                if let sentence = model.config?.paymentSentence {
                    Text(sentence).font(Typeface.body(14)).foregroundStyle(Palette.muted)
                }
                if let savedNote {
                    Notice(tone: .info, icon: "checkmark.circle", text: savedNote)
                } else if model.cartSavedAt != nil {
                    Label("Saved to your account", systemImage: "checkmark.icloud")
                        .font(Typeface.body(14)).foregroundStyle(Palette.muted)
                }
            }
            .padding(16)
        }
        .safeAreaInset(edge: .bottom) {
            HStack(spacing: 10) {
                Button { Task { await saveForLater() } } label: {
                    if saving { ProgressView() } else { Text("Save for later") }
                }
                .buttonStyle(SecondaryButtonStyle())
                .frame(maxWidth: 150)
                .disabled(saving)
                Button("Choose date & time") {
                    if model.isSignedIn { goCheckout = true } else { showSignIn = true }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(belowMinimum)
            }
            .padding(16)
            .background(.bar)
        }
    }

    private var belowMinimum: Bool {
        guard let min = model.config?.orderMinimum, min > 0, !model.cart.isLiveDose else { return false }
        return model.cart.subtotal < min
    }
}

struct CartLineRow: View {
    @Binding var line: Cart.Line
    let dish: Dish?
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(line.title).font(Typeface.display(18, relativeTo: .headline))
                Spacer()
                Text(Money.text(line.total, cents: line.total.rounded() != line.total)).font(Typeface.body(16, weight: .bold)).monospacedDigit()
            }
            if let n = line.note {
                Text("“\(n)”").font(Typeface.body(14)).foregroundStyle(Palette.muted)
            }
            HStack {
                Button("Remove", role: .destructive, action: onRemove).font(Typeface.body(14, weight: .semibold))
                Spacer()
                if let dish {
                    QtyStepper(value: $line.qty, min: dish.minQty, max: dish.maxQty, step: dish.qtyStep)
                }
            }
        }
        .padding(14)
    }
}

// MARK: - Checkout

struct CheckoutView: View {
    @Environment(AppModel.self) private var model
    let onPlaced: (Order) -> Void

    @State private var fulfillment = "pickup"
    @State private var fulfillmentOptions: AvailabilityResponse.FulfillmentOptions?
    @State private var pickupAgreed = false
    @State private var addressText = ""
    @State private var addressResult: AddressCheck?
    @State private var chosenMatch: AddressCheck.Match?
    @State private var useUnverified = false
    @State private var askChef = false
    @State private var checkingAddress = false
    @State private var addressError: String?

    @State private var dates: [OpenDate] = []
    @State private var loadingDates = true
    @State private var date: OpenDate?
    @State private var slot: Slot?

    @State private var preview: OrderPreview?
    @State private var previewError: APIError?
    @State private var placing = false
    @State private var placeError: String?
    @State private var requestId = UUID().uuidString
    @State private var extendTime = false

    private var isLDS: Bool { model.cart.isLiveDose }
    private var ldsInfo: LiveDoseInfo? { model.categories.first(where: { $0.kind == .lds })?.liveDose }
    private var pickupOnly: Bool { model.config?.cateringPickupOnly ?? true }
    private var needsAddress: Bool { isLDS || fulfillment == "delivery" }

    private var addressReady: Bool {
        guard needsAddress else { return true }
        guard let r = addressResult else { return false }
        switch r.status {
        case "match": return chosenMatch.map { $0.inRange || (isLDS && askChef) } ?? false
        case "none": return useUnverified
        default: return true // lookup service down: Chef checks it
        }
    }

    private var readyForPreview: Bool {
        addressReady && date != nil && slot != nil && (isLDS || fulfillment != "pickup" || !pickupOnly || pickupAgreed)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                if !isLDS { fulfillmentSection }
                if needsAddress { addressSection }
                dateSection
                if date != nil { slotSection }
                if isLDS, slot != nil { ldsTimeSection }
                reviewSection
            }
            .padding(16)
            .padding(.bottom, 20)
        }
        .screenBackground()
        .navigationTitle("Checkout")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            Button { Task { await place() } } label: {
                if placing { ProgressView().tint(Palette.leafInk) } else { Text(placeTitle).monospacedDigit() }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(preview == nil || placing || !readyForPreview)
            .padding(16)
            .background(.bar)
        }
        .task {
            addressText = model.profile?.savedAddress ?? ""
            await loadDates()
            if needsAddress && addressText.count >= 8 { await checkAddress() }
        }
        .task(id: previewKey) { await loadPreview() }
    }

    private var placeTitle: String {
        if let p = preview { return "Send to Chef · \(Money.text(p.subtotal, cents: p.subtotal.rounded() != p.subtotal))" }
        return "Send to Chef"
    }

    // MARK: sections

    private var fulfillmentSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            stepTitle("Pickup")
            if pickupOnly {
                Panel {
                    Text("All catering orders are for pickup from our kitchen. Chef shares the pickup details when your order is confirmed.")
                        .font(Typeface.body(16)).fixedSize(horizontal: false, vertical: true)
                    Toggle(isOn: $pickupAgreed) {
                        Text("I'll pick up my order").font(Typeface.body(16, weight: .semibold))
                    }
                    .tint(Palette.leaf)
                }
            } else {
                Picker("How you'll get it", selection: $fulfillment) {
                    if fulfillmentOptions?.pickup ?? true { Text("Pickup").tag("pickup") }
                    if fulfillmentOptions?.delivery ?? false { Text("Delivery").tag("delivery") }
                }
                .pickerStyle(.segmented)
                .onChange(of: fulfillment) { _, _ in
                    date = nil; slot = nil
                    Task { await loadDates() }
                }
                if fulfillment == "delivery" {
                    Text("A delivery fee based on distance is added when Chef confirms.").font(Typeface.body(14)).foregroundStyle(Palette.muted)
                }
            }
        }
    }

    private var addressSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            stepTitle(isLDS ? "Event address" : "Delivery address")
            if isLDS {
                Text("Where should our crew set up?").font(Typeface.body(15)).foregroundStyle(Palette.muted)
            }
            HStack(spacing: 10) {
                TextField("Street, town, ZIP", text: $addressText)
                    .textContentType(.fullStreetAddress)
                    .font(Typeface.body(16))
                    .submitLabel(.search)
                    .onSubmit { Task { await checkAddress() } }
                    .fieldStyle()
                    .onChange(of: addressText) { _, _ in
                        addressResult = nil; chosenMatch = nil; useUnverified = false; askChef = false; addressError = nil
                    }
                Button { Task { await checkAddress() } } label: {
                    if checkingAddress { ProgressView() } else { Text("Check") }
                }
                .font(Typeface.body(16, weight: .semibold))
                .disabled(addressText.trimmingCharacters(in: .whitespaces).count < 8 || checkingAddress)
            }
            if let addressError { Notice(tone: .bad, icon: "exclamationmark.circle", text: addressError) }
            if let r = addressResult {
                switch r.status {
                case "match":
                    ForEach(r.matches, id: \.label) { m in matchRow(m, single: r.matches.count == 1) }
                    if let m = chosenMatch, !m.inRange {
                        if isLDS {
                            Notice(tone: .warn, icon: "map", text: "This is about \(fmtMiles(m.miles)) from our kitchen, past our \(fmtMiles(m.maxMiles)) range for the LIVE Dose Station.")
                            Toggle(isOn: $askChef) { Text("Ask Chef to make an exception").font(Typeface.body(16, weight: .semibold)) }.tint(Palette.leaf)
                        } else {
                            Notice(tone: .bad, icon: "map", text: "We deliver within \(fmtMiles(m.maxMiles)), and this is about \(fmtMiles(m.miles)) away. Try another address\(pickupOnly ? "" : " or switch to pickup").")
                        }
                    }
                case "none":
                    Notice(tone: .warn, icon: "mappin.slash", text: "We couldn't find that on the map. Check the street number, street name and ZIP.")
                    Toggle(isOn: $useUnverified) { Text("Use it as typed - Chef will check it").font(Typeface.body(15, weight: .semibold)) }.tint(Palette.leaf)
                default:
                    Notice(tone: .info, icon: "mappin", text: "We can't check addresses right now. Chef will confirm it when reviewing your order.")
                }
            }
        }
    }

    private func matchRow(_ m: AddressCheck.Match, single: Bool) -> some View {
        Button { chosenMatch = m } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: chosenMatch == m ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(chosenMatch == m ? Palette.leaf : Palette.muted)
                VStack(alignment: .leading, spacing: 3) {
                    Text(m.label).font(Typeface.body(16, weight: .semibold)).foregroundStyle(Palette.ink).multilineTextAlignment(.leading)
                    HStack(spacing: 8) {
                        if let miles = m.miles { Text("About \(fmtMiles(miles)) from our kitchen") }
                        if let fee = m.travelFee, fee > 0 { Text("Travel fee \(Money.text(fee))").foregroundStyle(Palette.turmericInk) }
                    }
                    .font(Typeface.body(14)).foregroundStyle(Palette.muted)
                }
                Spacer()
            }
            .padding(12)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(chosenMatch == m ? Palette.leaf : Palette.line))
        }
        .buttonStyle(.plain)
    }

    private var dateSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            stepTitle("Date")
            if loadingDates {
                ProgressView().tint(Palette.leaf)
            } else if dates.isEmpty {
                Notice(tone: .warn, icon: "calendar", text: "Chef has no open dates for this order in the next \(model.config?.bookingWindowDays ?? 60) days. Call \(model.config?.phoneDisplay ?? "us") to ask about your event.")
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(dates) { d in
                            let parts = d.label.components(separatedBy: ", ")
                            Button {
                                withAnimation(.snappy) { date = d; slot = d.slots?.count == 1 ? d.slots?.first : nil }
                            } label: {
                                VStack(spacing: 2) {
                                    Text(parts.first ?? "").font(Typeface.body(14, weight: .semibold))
                                    Text(parts.dropFirst().joined(separator: ", ")).font(Typeface.display(18, relativeTo: .headline))
                                }
                                .frame(width: 92, height: 66)
                                .foregroundStyle(date == d ? Palette.leafInk : Palette.ink)
                                .background(date == d ? Palette.leaf : Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(date == d ? .clear : Palette.line))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(d.label)
                            .accessibilityAddTraits(date == d ? .isSelected : [])
                        }
                    }
                }
            }
        }
    }

    private var slotSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            stepTitle(isLDS ? "On-site serving time" : fulfillment == "pickup" ? "Pickup time" : "Delivery window")
            ForEach(date?.slots ?? []) { s in
                Button { withAnimation(.snappy) { slot = s } } label: {
                    HStack {
                        Image(systemName: slot == s ? "checkmark.circle.fill" : "circle").foregroundStyle(slot == s ? Palette.leaf : Palette.muted)
                        Text(s.title).font(Typeface.body(16, weight: .semibold)).foregroundStyle(Palette.ink)
                        if let sub = s.subtitle { Text(sub).font(Typeface.body(14)).foregroundStyle(Palette.muted) }
                        Spacer()
                    }
                    .padding(14)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(slot == s ? Palette.leaf : Palette.line))
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// LIVE Dose: the session's schedule, extra doses note and the extra-time offer.
    private var ldsTimeSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            stepTitle("Your LIVE Dose schedule")
            Panel {
                if let s = slot {
                    let parts = s.title.components(separatedBy: " - ")
                    if let start = parts.first, let setup = ldsInfo?.setupMinutes, let arrive = Self.shift(start, by: -setup) {
                        scheduleRow("Crew arrives to set up", "about \(arrive)")
                    }
                    scheduleRow("Serving on site", s.title)
                }
                if let note = ldsInfo?.extraDoseNote {
                    Text(note).font(Typeface.body(14)).foregroundStyle(Palette.muted)
                }
            }
            if let ext = ldsInfo?.extension {
                Text("Need longer? Add \(ext.minutes) extra minutes of serving for \(Money.text(ext.fee)).")
                    .font(Typeface.body(15))
                HStack(spacing: 10) {
                    choiceButton("No, that's fine", selected: !extendTime) { extendTime = false }
                    choiceButton("Add \(ext.minutes) min +\(Money.text(ext.fee))", selected: extendTime) { extendTime = true }
                }
            }
        }
    }

    private func choiceButton(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button { withAnimation(.snappy) { action() } } label: {
            HStack(spacing: 8) {
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                Text(title).font(Typeface.body(15, weight: .semibold)).monospacedDigit()
            }
            .foregroundStyle(selected ? Palette.leafInk : Palette.ink)
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.horizontal, 10)
            .background(selected ? Palette.leaf : Palette.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(selected ? .clear : Palette.line))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    /// "7:00 PM" moved by some minutes, e.g. -30 -> "6:30 PM".
    static func shift(_ label: String, by minutes: Int) -> String? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "h:mm a"
        guard let d = f.date(from: label.trimmingCharacters(in: .whitespaces)) else { return nil }
        return f.string(from: d.addingTimeInterval(TimeInterval(minutes * 60)))
    }

    @ViewBuilder private var reviewSection: some View {
        if let e = previewError, readyForPreview {
            Notice(tone: .bad, icon: "exclamationmark.circle", text: e.message)
        }
        if let p = preview, readyForPreview {
            VStack(alignment: .leading, spacing: 12) {
                stepTitle("Review")
                Panel {
                    ForEach(Array(p.lines.enumerated()), id: \.offset) { _, l in
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(l.kind == "lds" ? l.title : "\(l.qtyLabel) × \(l.title)").font(Typeface.body(16, weight: .semibold))
                                if let d = l.detail, l.kind == "lds" { Text(d).font(Typeface.body(14)).foregroundStyle(Palette.muted) }
                                if let n = l.note { Text("“\(n)”").font(Typeface.body(14)).foregroundStyle(Palette.muted) }
                            }
                            Spacer()
                            Text(Money.text(l.total, cents: l.total.rounded() != l.total)).font(Typeface.body(16)).monospacedDigit()
                        }
                    }
                    if let fee = p.travelFee, fee > 0 {
                        Text("Includes \(Money.text(fee)) travel (\(p.travelRule ?? ""))").font(Typeface.body(14)).foregroundStyle(Palette.muted)
                    }
                    if let l = p.lines.first(where: { ($0.extensionFee ?? 0) > 0 }), let fee = l.extensionFee {
                        Text("Includes \(Money.text(fee)) for \(l.extensionMinutes ?? 30) extra minutes of serving").font(Typeface.body(14)).foregroundStyle(Palette.muted)
                    }
                    if p.travelFeeUnknown {
                        Text("Chef will add any travel fee after checking the address.").font(Typeface.body(14)).foregroundStyle(Palette.muted)
                    }
                    if let note = p.deliveryFeeNote { Text(note).font(Typeface.body(14)).foregroundStyle(Palette.muted) }
                    Divider()
                    HStack {
                        Text("Subtotal").font(Typeface.body(17, weight: .bold))
                        Spacer()
                        Text(Money.text(p.subtotal, cents: true)).font(Typeface.body(18, weight: .bold)).monospacedDigit()
                    }
                }
                Panel {
                    Label(p.requestedTime, systemImage: "calendar").font(Typeface.body(15))
                    if let s = p.schedule {
                        VStack(alignment: .leading, spacing: 4) {
                            scheduleRow("Crew arrives", "about \(s.arrival)")
                            scheduleRow("Serving on site", "\(s.servingStart) - \(s.servingEnd)")
                            if s.extraMinutes > 0 { scheduleRow("Extra time", "\(s.extraMinutes) min") }
                        }
                        .padding(.leading, 30)
                    }
                    if let a = p.address { Label(a, systemImage: "mappin.and.ellipse").font(Typeface.body(15)) }
                    if p.outOfRange != nil {
                        Label("Outside our usual range - Chef will decide", systemImage: "exclamationmark.triangle").font(Typeface.body(15)).foregroundStyle(Palette.turmericInk)
                    }
                    Label(p.payment.text, systemImage: "dollarsign.circle").font(Typeface.body(15))
                }
                Text("Nothing is charged now. Chef reviews every order and you'll get the answer here in the app.")
                    .font(Typeface.body(14)).foregroundStyle(Palette.muted)
                if let placeError { Notice(tone: .bad, icon: "exclamationmark.circle", text: placeError) }
            }
        }
    }

    private func scheduleRow(_ label: String, _ time: String) -> some View {
        HStack { Text(label).foregroundStyle(Palette.muted); Spacer(); Text(time).monospacedDigit() }.font(Typeface.body(14))
    }

    private func stepTitle(_ t: String) -> some View {
        Text(t).font(Typeface.display(22, relativeTo: .title3)).foregroundStyle(Palette.ink)
    }

    private func fmtMiles(_ m: Double?) -> String {
        guard let m else { return "?" }
        return m.rounded() == m ? "\(Int(m)) miles" : String(format: "%.1f miles", m)
    }

    // MARK: data

    private var request: OrderRequest {
        let address: String? = needsAddress ? (chosenMatch?.label ?? addressText.trimmingCharacters(in: .whitespacesAndNewlines)) : nil
        return OrderRequest(
            kind: isLDS ? "lds" : "catering",
            items: isLDS ? nil : model.cart.lines.map { .init(itemId: $0.itemId, qty: $0.qty, note: $0.note) },
            liveDose: model.cart.liveDose.map { .init(total: $0.total, md: $0.md, note: $0.note, extend: extendTime) },
            fulfillment: isLDS ? "delivery" : fulfillment,
            date: date?.date,
            slotId: slot?.id,
            address: address,
            useUnverifiedAddress: useUnverified,
            askChefOutOfRange: askChef,
            pickupAgreed: pickupAgreed,
            clientRequestId: requestId
        )
    }

    private var previewKey: String {
        [date?.date ?? "", slot?.id ?? "", fulfillment, chosenMatch?.label ?? "", "\(useUnverified)\(askChef)\(pickupAgreed)\(addressReady)\(extendTime)", "\(model.cart.subtotal)"].joined(separator: "|")
    }

    private func loadDates() async {
        loadingDates = true
        defer { loadingDates = false }
        var q = ["kind": isLDS ? "lds" : "catering", "fulfillment": fulfillment]
        if let l = model.cart.liveDose { q["plates"] = String(l.total) }
        guard let r = try? await (APIClient.shared.get("availability", query: q) as AvailabilityResponse) else { return }
        dates = r.dates
        if let o = r.fulfillmentOptions, !isLDS {
            fulfillmentOptions = o
            if fulfillment == "pickup" && !o.pickup && o.delivery {
                fulfillment = "delivery"
            }
        }
        if let d = date, !dates.contains(d) { date = nil; slot = nil }
        if dates.count == 1 && date == nil {
            date = dates[0]
            if dates[0].slots?.count == 1 { slot = dates[0].slots?.first }
        }
    }

    private func checkAddress() async {
        struct B: Encodable { let address: String; let kind: String }
        checkingAddress = true
        addressError = nil
        defer { checkingAddress = false }
        do {
            let r: AddressCheck = try await APIClient.shared.post("address/check", B(address: addressText, kind: isLDS ? "lds" : "catering"))
            addressResult = r
            chosenMatch = r.matches.count == 1 ? r.matches[0] : nil
        } catch {
            addressError = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    private func loadPreview() async {
        preview = nil
        previewError = nil
        guard readyForPreview else { return }
        do {
            preview = try await (APIClient.shared.post("orders/preview", request) as OrderPreview)
        } catch is CancellationError {
        } catch let e as APIError {
            previewError = e
        } catch {}
    }

    private func place() async {
        placing = true
        placeError = nil
        defer { placing = false }
        do {
            let order: Order = try await APIClient.shared.post("orders", request)
            model.cart = Cart()
            model.orders.insert(order, at: 0)
            onPlaced(order)
            model.askForNotifications()
        } catch {
            placeError = (error as? APIError)?.message ?? error.localizedDescription
            if let e = error as? APIError, ["date_gone", "slot_gone"].contains(e.code ?? "") {
                slot = nil
                await loadDates()
            }
        }
    }
}

// MARK: - Placed

struct OrderPlacedView: View {
    @Environment(AppModel.self) private var model
    let order: Order
    let close: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text("Sent to Chef").font(Typeface.display(34)).padding(.top, 12)
                Text("Order \(order.orderId) · \(Money.text(order.subtotal, cents: true))")
                    .font(Typeface.body(17, weight: .semibold)).monospacedDigit()
                TiffinProgress(order: order)
                Text(model.config?.deposit.enabled == true
                     ? "Chef reviews every order personally. Once approved, you'll get Zelle details for the \(Int(model.config?.deposit.percent ?? 50))% deposit right here."
                     : "Chef reviews every order personally. You'll get the answer right here in the app.")
                    .font(Typeface.body(16)).foregroundStyle(Palette.muted)
                Button("See my order") {
                    model.selectedTab = .orders
                    model.openOrderId = order.orderId
                    close()
                }
                .buttonStyle(PrimaryButtonStyle())
                Button("Done", action: close).buttonStyle(SecondaryButtonStyle())
            }
            .padding(20)
        }
        .sensoryFeedback(.success, trigger: order.orderId)
    }
}
