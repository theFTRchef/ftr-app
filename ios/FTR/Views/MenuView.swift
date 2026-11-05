import SwiftUI

// MARK: - Welcome

/// The first screen: logo, slogan and one button into FTR.
struct WelcomeView: View {
    @Environment(AppModel.self) private var model
    let enter: () -> Void

    var body: some View {
        VStack(spacing: 22) {
            Spacer()
            FTRLogo(size: 46)
            Text("Bringing back the OG flavor of Masala Dose")
                .font(Typeface.tagline(20))
                .foregroundStyle(Palette.red)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)
            Spacer()
            if let err = model.loadError, model.config == nil {
                Text(err)
                    .font(Typeface.body(15))
                    .foregroundStyle(Palette.muted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                Button("Try again") { Task { await model.loadMenu() } }
                    .buttonStyle(SecondaryButtonStyle())
                    .padding(.horizontal, 40)
            } else {
                Button(action: enter) {
                    if model.config == nil { ProgressView().tint(Palette.leafInk) } else { Text("Enter FTR") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.config == nil)
                .padding(.horizontal, 40)
            }
            Spacer().frame(height: 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .screenBackground()
    }
}

// MARK: - Home

/// The home screen: one tile for each thing a customer can do.
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @State private var showLiveDose = false
    @State private var showCustom = false
    @State private var showCart = false
    @State private var comingSoon: String?
    @State private var showFeedback = false

    enum Route: Hashable { case catering, availability, section(String) }

    private var lds: MenuCategory? { model.categories.first { $0.kind == .lds } }
    /// The second flagship: Dose-in-a-Box (a pre-order section marked flagship).
    private var dib: MenuCategory? { model.categories.first { $0.preorder?.flagship == true && !$0.items.isEmpty } }
    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    VStack(spacing: 6) {
                        FTRLogo(size: 30)
                        Text("Multi Cuisine Personal Chef in Somerset, NJ")
                            .font(Typeface.tagline(15)).foregroundStyle(Palette.ink)
                        VegMark().foregroundStyle(Palette.ink)
                    }
                    .padding(.top, 6)

                    // Flagship first, full width - as on every flyer.
                    Button { showLiveDose = true } label: {
                        HStack(spacing: 14) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Our flagship").font(Typeface.body(13, weight: .bold)).kerning(1.2).foregroundStyle(Palette.red)
                                Text("Live Dose").font(Typeface.display(26, relativeTo: .title2))
                                Text(lds?.open == false ? "No LIVE Dose dates open right now" : "Live on-site Masala Dose at your event")
                                    .font(Typeface.body(14))
                            }
                            Spacer(minLength: 0)
                            DoseGlyph().frame(width: 58, height: 58)
                        }
                        .foregroundStyle(Color(UIColor(hex: 0x1E3A27)))
                        .padding(18)
                        .background(Palette.turmeric, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Palette.goldLine, lineWidth: 2))
                    }
                    .buttonStyle(.plain)
                    .disabled(lds == nil)

                    if let dib {
                        NavigationLink(value: Route.section(dib.id)) {
                            HStack(spacing: 14) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Take-home flagship").font(Typeface.body(13, weight: .bold)).kerning(1.2).foregroundStyle(Palette.turmeric)
                                    Text(dib.title).font(Typeface.display(26, relativeTo: .title2)).foregroundStyle(Palette.cream)
                                    Text(dib.preorder?.next.map { "Order by \($0.orderByLabel) · pickup \($0.pickupLabel)" } ?? "Next pickup day coming soon")
                                        .font(Typeface.body(14)).foregroundStyle(Palette.cream.opacity(0.9))
                                        .multilineTextAlignment(.leading)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "shippingbox.fill").font(.system(size: 36)).foregroundStyle(Palette.turmeric)
                            }
                            .padding(18)
                            .background(Palette.forest, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Palette.goldLine, lineWidth: 2))
                        }
                        .buttonStyle(.plain)
                    }

                    LazyVGrid(columns: columns, spacing: 12) {
                        NavigationLink(value: Route.catering) {
                            HomeTile(title: "Catering Items", subtitle: "Trays for your gathering", icon: "takeoutbag.and.cup.and.straw.fill")
                        }
                        NavigationLink(value: Route.availability) {
                            HomeTile(title: "Chef's Availability", subtitle: "Open dates and times", icon: "calendar")
                        }
                        Button { model.selectedTab = .account } label: {
                            HomeTile(title: "My Account", subtitle: model.isSignedIn ? (model.profile?.firstName ?? "Signed in") : "Sign in with your phone", icon: "person.crop.circle")
                        }
                        Button { showCustom = true } label: {
                            HomeTile(title: "Custom Quote", subtitle: "Tell Chef what you need", icon: "square.and.pencil")
                        }
                        Button { showFeedback = true } label: {
                            HomeTile(title: "Comments & Ideas", subtitle: "Tell us how we did", icon: "text.bubble.fill")
                        }
                        Button { model.selectedTab = .orders } label: {
                            HomeTile(title: "My Orders", subtitle: "Past and upcoming", icon: "list.bullet.rectangle")
                        }
                        Button { comingSoon = "At-Home Chef!" } label: {
                            HomeTile(title: "At-Home Chef!", subtitle: "Coming soon", icon: "house.fill", soon: true)
                        }
                        Button { comingSoon = "Supper Club" } label: {
                            HomeTile(title: "Supper Club", subtitle: "Coming soon", icon: "wineglass.fill", soon: true)
                        }
                    }
                    .buttonStyle(.plain)
                }
                .padding(16)
                .padding(.bottom, model.cart.isEmpty ? 8 : 80)
            }
            .screenBackground()
            .refreshable { await model.loadMenu() }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let dial = model.config?.phoneDial, let url = URL(string: "tel:\(dial)") {
                    ToolbarItem(placement: .topBarTrailing) {
                        Link(destination: url) { Image(systemName: "phone") }.accessibilityLabel("Call Chef")
                    }
                }
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .catering: CateringSectionsView()
                case .availability: AvailabilityView()
                case .section(let id): CategoryDishesView(categoryId: id)
                }
            }
            .safeAreaInset(edge: .bottom) { if !model.cart.isEmpty { CartBar { showCart = true } } }
            .sheet(isPresented: $showLiveDose) { if let cat = lds { LiveDoseView(category: cat) } }
            .sheet(isPresented: $showCustom) { CustomRequestView() }
            .sheet(isPresented: $showFeedback) { FeedbackView() }
            .sheet(isPresented: $showCart) { CartView() }
            .alert(comingSoon ?? "", isPresented: Binding(get: { comingSoon != nil }, set: { if !$0 { comingSoon = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("Coming soon. Ask Chef about it with a custom quote, or call \(model.config?.phoneDisplay ?? "us").")
            }
        }
    }
}

struct HomeTile: View {
    let title: String
    let subtitle: String
    let icon: String
    var soon = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(soon ? Palette.muted : Palette.red)
            Spacer(minLength: 0)
            Text(title)
                .font(Typeface.display(18, relativeTo: .headline))
                .foregroundStyle(soon ? Palette.muted : Palette.ink)
                .multilineTextAlignment(.leading)
            Text(subtitle)
                .font(Typeface.body(13, weight: soon ? .semibold : .regular))
                .foregroundStyle(soon ? Palette.turmericInk : Palette.muted)
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, minHeight: 128, alignment: .topLeading)
        .padding(14)
        .background(soon ? Palette.surface2 : Palette.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Palette.line))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

struct CartBar: View {
    @Environment(AppModel.self) private var model
    let open: () -> Void
    var body: some View {
        Button(action: open) {
            HStack {
                Text(model.cart.isLiveDose ? "LIVE Dose Station" : "\(model.cart.count) dish\(model.cart.count == 1 ? "" : "es")")
                Spacer()
                Text("View order · \(Money.text(model.cart.subtotal))").monospacedDigit()
            }
        }
        .buttonStyle(PrimaryButtonStyle())
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

// MARK: - Catering sections

/// South Indian, Asian Fusion, Chaats & Snacks... - the menu sections from /admin.
struct CateringSectionsView: View {
    @Environment(AppModel.self) private var model
    @State private var showCart = false

    private var sections: [MenuCategory] { model.categories.filter { $0.kind == .catering && !$0.items.isEmpty && $0.preorder?.flagship != true } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Catering Items").font(Typeface.display(30)).foregroundStyle(Palette.red)
                if model.config?.cateringPickupOnly == true {
                    Text("Trays for pickup from our kitchen · \(model.config?.halfTrays == true ? "full or half trays" : "full trays")")
                        .font(Typeface.body(14)).foregroundStyle(Palette.muted)
                }
                if sections.first(where: { $0.preorder == nil })?.open == false {
                    Notice(tone: .warn, icon: "calendar.badge.exclamationmark", text: "Chef has no catering dates open right now. You can still browse, or ask for a custom quote.")
                }
                ForEach(sections) { c in
                    NavigationLink(value: HomeView.Route.section(c.id)) {
                        HStack(alignment: .center, spacing: 12) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(c.title).font(Typeface.display(21, relativeTo: .title3)).foregroundStyle(Palette.ink)
                                if let p = c.preorder {
                                    Text(p.next.map { "Pre-order · pickup \($0.pickupLabel)" } ?? "Pre-order · next pickup coming soon")
                                        .font(Typeface.body(12.5, weight: .bold))
                                        .padding(.horizontal, 8).padding(.vertical, 3)
                                        .foregroundStyle(Palette.turmericInk)
                                        .background(Palette.turmericSoft, in: Capsule())
                                }
                                Text(c.subtitle.isEmpty ? "\(c.items.count) dish\(c.items.count == 1 ? "" : "es")" : c.subtitle)
                                    .font(Typeface.body(14)).foregroundStyle(Palette.muted).lineLimit(2).multilineTextAlignment(.leading)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(Palette.muted)
                        }
                        .padding(16)
                        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.line))
                    }
                    .buttonStyle(.plain)
                }
                if sections.isEmpty {
                    Text("Chef is updating the menu. Please check back soon.").font(Typeface.body(15)).foregroundStyle(Palette.muted)
                }
            }
            .padding(16)
            .padding(.bottom, model.cart.isEmpty ? 8 : 80)
        }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) { if !model.cart.isEmpty { CartBar { showCart = true } } }
        .sheet(isPresented: $showCart) { CartView() }
    }
}

/// One section's dishes, to add to the order (one at a time or several at once).
struct CategoryDishesView: View {
    @Environment(AppModel.self) private var model
    let categoryId: String
    @State private var selectedDish: Dish?
    @State private var showCart = false
    @State private var search = ""
    @State private var selecting = false
    @State private var picked: [String] = []
    @State private var showMultiAdd = false

    private var cat: MenuCategory? { model.categories.first { $0.id == categoryId } }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if let cat {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(cat.title).font(Typeface.display(28, relativeTo: .title)).foregroundStyle(Palette.red)
                        if !cat.subtitle.isEmpty {
                            Text(cat.subtitle).font(Typeface.body(15)).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 12)
                    if let p = cat.preorder {
                        Panel {
                            Label("Pre-order · pickup only", systemImage: "bag").font(Typeface.body(15, weight: .bold))
                            if p.days.isEmpty {
                                Text("Chef hasn't opened the next pickup day yet. Check back soon.").font(Typeface.body(14)).foregroundStyle(Palette.muted)
                            }
                            ForEach(p.days.prefix(3)) { d in
                                Text("Pickup \(d.pickupLabel) · order by \(d.orderByLabel)").font(Typeface.body(14)).foregroundStyle(Palette.muted)
                            }
                        }
                        .padding(.horizontal, 16).padding(.bottom, 10)
                    } else if !cat.open {
                        Notice(tone: .warn, icon: "calendar.badge.exclamationmark", text: "Chef has no catering dates open right now. You can still browse, or ask for a custom quote.")
                            .padding(.horizontal, 20).padding(.bottom, 8)
                    }
                    ForEach(filtered(cat)) { dish in
                        Button {
                            if selecting { toggle(dish) } else { selectedDish = dish }
                        } label: {
                            HStack(spacing: 0) {
                                if selecting {
                                    Image(systemName: picked.contains(dish.id) ? "checkmark.circle.fill" : "circle")
                                        .font(.system(size: 22))
                                        .foregroundStyle(picked.contains(dish.id) ? Palette.leaf : Palette.muted)
                                        .padding(.leading, 18)
                                        .transition(.move(edge: .leading).combined(with: .opacity))
                                }
                                DishRow(dish: dish, inCart: inCart(dish))
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(selecting && !cat.open)
                        .accessibilityAddTraits(selecting && picked.contains(dish.id) ? .isSelected : [])
                        Divider().overlay(Palette.line).padding(.leading, 20)
                    }
                } else {
                    Text("This section isn't on the menu any more.").font(Typeface.body(15)).foregroundStyle(Palette.muted).padding(20)
                }
            }
            .padding(.bottom, model.cart.isEmpty && !selecting ? 24 : 96)
        }
        .screenBackground()
        .searchable(text: $search, prompt: "Search \(cat?.title ?? "dishes")")
        .refreshable { await model.loadMenu() }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(selecting ? "Cancel" : "Select dishes") {
                    withAnimation(.snappy) { selecting.toggle(); picked = [] }
                }
                .font(Typeface.body(16, weight: .semibold))
            }
        }
        .safeAreaInset(edge: .bottom) {
            if selecting { selectBar } else if !model.cart.isEmpty { CartBar { showCart = true } }
        }
        .sheet(isPresented: $showMultiAdd) {
            MultiAddSheet(dishes: picked.compactMap { model.dish($0) }) { selecting = false; picked = [] }
        }
        .sheet(item: $selectedDish) { DishSheet(dish: $0, category: cat) }
        .sheet(isPresented: $showCart) { CartView() }
    }

    private func filtered(_ cat: MenuCategory) -> [Dish] {
        let q = search.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return cat.items }
        return cat.items.filter { $0.title.localizedCaseInsensitiveContains(q) || $0.description.localizedCaseInsensitiveContains(q) }
    }

    private func toggle(_ dish: Dish) {
        if let i = picked.firstIndex(of: dish.id) { picked.remove(at: i) } else { picked.append(dish.id) }
    }

    private func inCart(_ dish: Dish) -> Double {
        model.cart.lines.filter { $0.itemId == dish.id }.reduce(0) { $0 + $1.qty }
    }

    private var selectBar: some View {
        Button { showMultiAdd = true } label: {
            HStack {
                Text(picked.isEmpty ? "Tap dishes to select them" : "\(picked.count) selected")
                Spacer()
                if !picked.isEmpty { Text("Choose quantities") }
            }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(picked.isEmpty)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

// MARK: - Chef's availability

/// Chef's open dates from the admin calendar, with what each day offers.
struct AvailabilityView: View {
    @State private var dates: [OpenDate] = []
    @State private var preDays: [PreorderDay] = []
    @State private var loading = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Chef's Availability").font(Typeface.display(30)).foregroundStyle(Palette.red)
                Text("Open dates for catering pickup and the LIVE Dose Station. Pick your date and time when you check out.")
                    .font(Typeface.body(15)).foregroundStyle(Palette.muted)
                if loading {
                    ProgressView().tint(Palette.leaf).padding(.top, 20)
                } else if dates.isEmpty {
                    Notice(tone: .warn, icon: "calendar", text: "No open dates right now. Ask for a custom quote or call Chef about your event.")
                }
                if !preDays.isEmpty {
                    Text("Dose-in-a-Box & takeout pickups").font(Typeface.display(20, relativeTo: .title3)).foregroundStyle(Palette.ink).padding(.top, 6)
                    ForEach(preDays) { p in
                        HStack(alignment: .top, spacing: 14) {
                            DateBadge(iso: p.date)
                            VStack(alignment: .leading, spacing: 6) {
                                Text(p.label).font(Typeface.body(17, weight: .bold)).foregroundStyle(Palette.ink)
                                Label("Pickup at \(p.pickupTime)", systemImage: "shippingbox").font(Typeface.body(14)).foregroundStyle(Palette.muted)
                                Label("Order by \(p.orderByLabel)", systemImage: "clock").font(Typeface.body(14)).foregroundStyle(Palette.turmericInk)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(14)
                        .background(Palette.turmericSoft, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.line))
                    }
                    Text("Catering & LIVE Dose").font(Typeface.display(20, relativeTo: .title3)).foregroundStyle(Palette.ink).padding(.top, 6)
                }
                ForEach(dates) { d in
                    HStack(alignment: .top, spacing: 14) {
                        DateBadge(iso: d.date)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(d.label).font(Typeface.body(17, weight: .bold)).foregroundStyle(Palette.ink)
                            ForEach(d.summary.components(separatedBy: " · "), id: \.self) { part in
                                Label(part, systemImage: part.contains("LIVE") ? "flame.fill" : "takeoutbag.and.cup.and.straw")
                                    .font(Typeface.body(14)).foregroundStyle(Palette.muted)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(14)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.line))
                }
            }
            .padding(16)
        }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
    }

    private func load() async {
        defer { loading = false }
        if let r = try? await (APIClient.shared.get("availability") as AvailabilityResponse) { dates = r.dates; preDays = r.preorderDays ?? [] }
    }
}

/// Day-of-month tile for a "YYYY-MM-DD" date.
struct DateBadge: View {
    let iso: String
    var body: some View {
        let parts = iso.split(separator: "-")
        let month = parts.count == 3 ? (DateFormatter().shortMonthSymbols[(Int(parts[1]) ?? 1) - 1]).uppercased() : ""
        VStack(spacing: 0) {
            Text(month).font(Typeface.body(12, weight: .bold)).foregroundStyle(Palette.red)
            Text(parts.count == 3 ? String(Int(parts[2]) ?? 0) : "").font(Typeface.display(24)).foregroundStyle(Palette.ink)
        }
        .frame(width: 54, height: 58)
        .background(Palette.surface2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityHidden(true)
    }
}

struct DishRow: View {
    let dish: Dish
    let inCart: Double

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(dish.title)
                    .font(Typeface.display(19, relativeTo: .headline))
                    .foregroundStyle(Palette.ink)
                    .multilineTextAlignment(.leading)
                if !meta.isEmpty {
                    Text(meta).font(Typeface.body(14)).foregroundStyle(Palette.muted)
                }
                Text(dish.description)
                    .font(Typeface.body(14))
                    .foregroundStyle(Palette.muted)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 6) {
                Text(Money.text(dish.price)).font(Typeface.body(17, weight: .bold)).monospacedDigit().foregroundStyle(Palette.ink)
                if inCart > 0 {
                    Text("\(Qty.text(inCart)) in order")
                        .font(Typeface.body(12, weight: .semibold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .foregroundStyle(Palette.leaf)
                        .background(Palette.leafSoft, in: Capsule())
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
        .contentShape(Rectangle())
    }

    private var meta: String {
        [dish.size.isEmpty ? nil : dish.size, dish.servesText].compactMap { $0 }.joined(separator: " · ")
    }
}

/// A simple drawn dose: a golden crêpe folded on a leaf-green plate.
struct DoseGlyph: View {
    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            ctx.fill(Path(ellipseIn: CGRect(x: 0, y: h * 0.18, width: w, height: h * 0.72)), with: .color(Palette.forest))
            var cone = Path()
            cone.move(to: CGPoint(x: w * 0.12, y: h * 0.56))
            cone.addQuadCurve(to: CGPoint(x: w * 0.9, y: h * 0.36), control: CGPoint(x: w * 0.5, y: h * 0.08))
            cone.addLine(to: CGPoint(x: w * 0.84, y: h * 0.62))
            cone.addQuadCurve(to: CGPoint(x: w * 0.12, y: h * 0.56), control: CGPoint(x: w * 0.48, y: h * 0.78))
            ctx.fill(cone, with: .color(Color(UIColor(hex: 0xF7D27A))))
            var fold = Path()
            fold.move(to: CGPoint(x: w * 0.2, y: h * 0.55))
            fold.addQuadCurve(to: CGPoint(x: w * 0.84, y: h * 0.42), control: CGPoint(x: w * 0.5, y: h * 0.3))
            ctx.stroke(fold, with: .color(Color(UIColor(hex: 0xA86F00))), lineWidth: 1.5)
        }
        .accessibilityHidden(true)
    }
}
