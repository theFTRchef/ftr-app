import SwiftUI

struct MenuView: View {
    @Environment(AppModel.self) private var model
    @State private var openDates: [OpenDate] = []
    @State private var selectedDish: Dish?
    @State private var showLiveDose = false
    @State private var showCart = false
    @State private var showCustom = false
    @State private var search = ""
    /// Choosing several dishes at once.
    @State private var selecting = false
    @State private var picked: [String] = []
    @State private var showMultiAdd = false

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    header
                    if !openDates.isEmpty && search.isEmpty { datesStrip }
                    // The flagship - Live on-site Masala Dose - always leads, as on every flyer.
                    if search.isEmpty {
                        ForEach(model.categories.filter { $0.kind == .lds }) { liveDoseSection($0) }
                    }
                    ForEach(model.categories.filter { $0.kind == .catering }) { cateringSection($0) }
                    if search.isEmpty { customFooter }
                }
                .padding(.bottom, model.cart.isEmpty && !selecting ? 24 : 96)
            }
            .screenBackground()
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Search dishes")
            .refreshable { await reload() }
            .task { await loadDates() }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(selecting ? "Cancel" : "Select dishes") {
                        withAnimation(.snappy) {
                            selecting.toggle()
                            picked = []
                        }
                    }
                    .font(Typeface.body(16, weight: .semibold))
                }
                if let dial = model.config?.phoneDial, let url = URL(string: "tel:\(dial)") {
                    ToolbarItem(placement: .topBarTrailing) {
                        Link(destination: url) { Image(systemName: "phone") }
                            .accessibilityLabel("Call Chef")
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if selecting { selectBar } else if !model.cart.isEmpty { cartBar }
            }
            .sheet(isPresented: $showMultiAdd) {
                MultiAddSheet(dishes: picked.compactMap { model.dish($0) }) {
                    selecting = false
                    picked = []
                }
            }
            .sheet(item: $selectedDish) { DishSheet(dish: $0, category: category(of: $0)) }
            .sheet(isPresented: $showLiveDose) {
                if let cat = model.categories.first(where: { $0.kind == .lds }) { LiveDoseView(category: cat) }
            }
            .sheet(isPresented: $showCart) { CartView() }
            .sheet(isPresented: $showCustom) { CustomRequestView() }
        }
    }

    // MARK: sections

    private var header: some View {
        VStack(alignment: .center, spacing: 6) {
            FTRLogo(size: 34)
                .padding(.bottom, 4)
            Text("Bringing back the OG flavor of Masala Dose")
                .font(Typeface.tagline(17))
                .foregroundStyle(Palette.red)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text("Multi Cuisine Personal Chef in Somerset, NJ")
                .font(Typeface.tagline(16))
                .foregroundStyle(Palette.ink)
            VegMark()
                .foregroundStyle(Palette.ink)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 20)
    }

    private var datesStrip: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Chef's open dates")
                .font(Typeface.body(15, weight: .semibold))
                .foregroundStyle(Palette.muted)
                .padding(.horizontal, 20)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(openDates) { d in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(d.label).font(Typeface.body(16, weight: .bold)).foregroundStyle(Palette.ink)
                            Text(d.summary)
                                .font(Typeface.body(13))
                                .foregroundStyle(Palette.muted)
                                .lineLimit(3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(width: 172, alignment: .topLeading)
                        .padding(12)
                        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.line))
                    }
                }
                .padding(.horizontal, 20)
            }
        }
        .padding(.bottom, 26)
    }

    private func filtered(_ cat: MenuCategory) -> [Dish] {
        let q = search.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return cat.items }
        return cat.items.filter { $0.title.localizedCaseInsensitiveContains(q) || $0.description.localizedCaseInsensitiveContains(q) }
    }

    @ViewBuilder private func cateringSection(_ cat: MenuCategory) -> some View {
        let dishes = filtered(cat)
        if !dishes.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                sectionTitle(cat.title, cat.subtitle)
                if !cat.open {
                    Notice(tone: .warn, icon: "calendar.badge.exclamationmark", text: "Chef has no catering dates open right now. You can still browse, or ask for a custom quote.")
                        .padding(.horizontal, 20).padding(.bottom, 8)
                } else if model.config?.cateringPickupOnly == true {
                    Text("Trays for pickup from our kitchen · \(model.config?.halfTrays == true ? "full or half trays" : "full trays")")
                        .font(Typeface.body(14))
                        .foregroundStyle(Palette.muted)
                        .padding(.horizontal, 20).padding(.bottom, 6)
                }
                ForEach(dishes) { dish in
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
            }
            .padding(.bottom, 28)
        }
    }

    /// The flyers' gold "Our flagship" band, as a card.
    private func liveDoseSection(_ cat: MenuCategory) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let l = cat.liveDose {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 8) {
                        Image(systemName: "star.fill").foregroundStyle(Palette.red)
                        Text("Our flagship").font(Typeface.body(14, weight: .bold)).kerning(1.5).foregroundStyle(Palette.red)
                    }
                    HStack(alignment: .top, spacing: 14) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Live on-site Masala Dose")
                                .font(Typeface.display(25, relativeTo: .title2))
                            Text("\(l.mdTitle) and \(l.odTitle), made fresh on the griddle at your event. \(ListFormatter.localizedString(byJoining: l.options.map { String($0.total) }).replacingOccurrences(of: ", and", with: " or").replacingOccurrences(of: " and ", with: " or ")) dose.")
                                .font(Typeface.body(15))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 0)
                        DoseGlyph().frame(width: 60, height: 60)
                    }
                    .foregroundStyle(Color(UIColor(hex: 0x1E3A27)))
                    HStack(alignment: .firstTextBaseline) {
                        Text("From \(Money.text(l.options.first?.price ?? 0))")
                            .font(Typeface.body(18, weight: .bold)).monospacedDigit()
                        Text("incl. \(Money.text(l.setupFee)) setup").font(Typeface.body(14))
                    }
                    .foregroundStyle(Color(UIColor(hex: 0x1E3A27)))
                    Button(model.cart.isLiveDose ? "Change your station" : "Plan your station") { showLiveDose = true }
                        .buttonStyle(PrimaryButtonStyle(tint: Palette.forest, ink: Palette.cream))
                        .disabled(!cat.open)
                    if !cat.open {
                        Text("No LIVE Dose dates open right now.").font(Typeface.body(14)).foregroundStyle(Color(UIColor(hex: 0x1E3A27)))
                    }
                }
                .padding(18)
                .background(Palette.turmeric, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Palette.goldLine, lineWidth: 2))
                .padding(.horizontal, 16)
            }
        }
        .padding(.bottom, 28)
    }

    private var customFooter: some View {
        Panel {
            Text("Something else in mind?").font(Typeface.display(20, relativeTo: .title3))
            Text("North Indian, Asian fusion, Italian or Mexican vegetarian - tell Chef what you need and get a price.")
                .font(Typeface.body(15)).foregroundStyle(Palette.muted)
            Button("Ask for a custom quote") { showCustom = true }.buttonStyle(SecondaryButtonStyle())
        }
        .padding(.horizontal, 16)
    }

    private func sectionTitle(_ title: String, _ subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(Typeface.display(26, relativeTo: .title2)).foregroundStyle(Palette.red)
            if !subtitle.isEmpty {
                Text(subtitle).font(Typeface.body(15)).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 10)
    }

    private func toggle(_ dish: Dish) {
        if let i = picked.firstIndex(of: dish.id) { picked.remove(at: i) } else { picked.append(dish.id) }
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

    private var cartBar: some View {
        Button { showCart = true } label: {
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

    // MARK: data

    private func inCart(_ dish: Dish) -> Double {
        model.cart.lines.filter { $0.itemId == dish.id }.reduce(0) { $0 + $1.qty }
    }

    private func category(of dish: Dish) -> MenuCategory? {
        model.categories.first { $0.items.contains(dish) }
    }

    private func reload() async {
        await model.loadMenu()
        await loadDates()
    }

    private func loadDates() async {
        let r = try? await (APIClient.shared.get("availability") as AvailabilityResponse)
        if let r { openDates = r.dates }
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
