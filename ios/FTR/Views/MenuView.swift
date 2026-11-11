import SwiftUI

// MARK: - Home

/// The home screen: one tile for each thing a customer can do.
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @State private var showLiveDose = false
    @State private var screenshotJumpDone = false
    @State private var showCustom = false
    @State private var showCart = false
    @State private var comingSoon: String?
    @State private var showFeedback = false
    @Environment(\.ftrWide) private var wide

    enum Route: Hashable { case catering, specials, festival, dry, availability, section(String) }

    /// (Screenshot runs pass -ftrOpenCatering to open the catering menu.)
    @State private var path: [Route] = ProcessInfo.processInfo.arguments.contains("-ftrOpenCatering") ? [.catering] : []

    private var lds: MenuCategory? { model.categories.first { $0.kind == .lds } }
    /// The second flagship: Dose-in-a-Box (a pre-order section marked flagship).
    /// Always shown (it's a flagship); says "coming soon" until Chef opens a pickup day.
    /// Chef's Weekly Specials: pre-order sections other than Dose-in-a-Box.
    private var specials: [MenuCategory] { model.categories.filter { $0.preorder != nil && $0.preorder?.flagship != true } }
    private var specialsSubtitle: String {
        guard specials.contains(where: { !$0.items.isEmpty }) else { return "Coming soon" }
        if let d = specials.compactMap({ $0.preorder?.next }).first { return "Order by \(d.orderByLabel) · pickup \(d.label)" }
        return "Single-serve takeout · next pickup soon"
    }
    private var dib: MenuCategory? { model.categories.first { $0.preorder?.flagship == true } }
    private var festival: [MenuCategory] { MenuGroup.festival.sections(in: model.categories) }
    private var dry: [MenuCategory] { MenuGroup.dry.sections(in: model.categories) }
    private func route(_ group: MenuGroup, _ list: [MenuCategory]) -> Route {
        list.count == 1 ? .section(list[0].id) : (group == .festival ? .festival : .dry)
    }
    private func subtitle(_ list: [MenuCategory], filled: String) -> String {
        guard list.contains(where: { !$0.items.isEmpty }) else { return "Coming soon" }
        if let d = list.compactMap({ $0.preorder?.next }).first { return "Order by \(d.orderByLabel) · pickup \(d.label)" }
        return list.count == 1 ? (list[0].subtitle.isEmpty ? filled : list[0].subtitle) : filled
    }
    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                Group {
                    if wide {
                        // Duo open / wide window: flagship photo on the left, everything else on the right.
                        HStack(alignment: .top, spacing: 20) {
                            flagshipCard(tall: true)
                                .frame(maxWidth: .infinity)
                            VStack(spacing: 16) {
                                headerRow
                                ChefPicksCard { path.append(.section($0)) }
                                dibCard
                                tilesGrid
                                ScanRecipeCard()
                            }
                            .frame(maxWidth: .infinity)
                        }
                    } else {
                        VStack(spacing: 18) {
                            headerRow
                            // Flagship first, full width.
                            flagshipCard(tall: false)
                            ChefPicksCard { path.append(.section($0)) }
                            dibCard
                            tilesGrid
                            ScanRecipeCard()
                        }
                    }
                }
                .padding(16)
                .padding(.bottom, model.cart.isEmpty ? 8 : 80)
            }
            .screenBackground()
            .refreshable { await model.loadMenu() }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    ShareFTRButton(compact: true)
                }
                if let dial = model.config?.phoneDial, let url = URL(string: "tel:\(dial)") {
                    ToolbarItem(placement: .topBarTrailing) {
                        Link(destination: url) { Image(systemName: "phone") }.accessibilityLabel("Call Chef")
                    }
                }
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .catering: CateringSectionsView()
                case .specials: CateringSectionsView(group: .specials)
                case .festival: CateringSectionsView(group: .festival)
                case .dry: CateringSectionsView(group: .dry)
                case .availability: AvailabilityView()
                case .section(let id): CategoryDishesView(categoryId: id)
                }
            }
            .safeAreaInset(edge: .bottom) { if !model.cart.isEmpty { CartBar { showCart = true } } }
            .sheet(isPresented: $showLiveDose) { if let cat = lds { LiveDoseView(category: cat) } }
            // (Store-screenshot runs: -ftrOpenSection / -ftrOpenDIB / -ftrOpenLiveDose.)
            .onChange(of: model.categories.count, initial: true) { _, n in
                guard n > 0, !screenshotJumpDone else { return }
                let args = ProcessInfo.processInfo.arguments
                if args.contains("-ftrOpenSection"), let first = MenuGroup.catering.sections(in: model.categories).first {
                    screenshotJumpDone = true; path = [.catering, .section(first.id)]
                } else if args.contains("-ftrOpenDIB"), let d = dib {
                    screenshotJumpDone = true; path = [.section(d.id)]
                } else if args.contains("-ftrOpenLiveDose"), lds != nil {
                    screenshotJumpDone = true; showLiveDose = true
                }
            }
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

    // MARK: Home pieces (shared by the phone and wide layouts)

    private var headerRow: some View {
            HStack {
                FTRHeader()
                Spacer(minLength: 0)
            }
            .padding(.top, 2)
    }

    private func flagshipCard(tall: Bool) -> some View {
            Button { showLiveDose = true } label: {
                VStack(alignment: .leading, spacing: 0) {
                    ZStack(alignment: .topLeading) {
                        Color.clear
                            .aspectRatio(tall ? 1.0 : 4.0 / 3.0, contentMode: .fit)
                            .overlay(
                                Image("FlagshipDose")
                                    .resizable()
                                    .scaledToFill()
                                    .accessibilityLabel("Chef cooking Mysore Masale Dose on the griddle at a party")
                            )
                            .clipped()
                        Text("OUR FLAGSHIP")
                            .font(Typeface.body(11, weight: .bold, relativeTo: .caption))
                            .kerning(0.8)
                            .foregroundStyle(Palette.turmericInk)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(Palette.turmericSoft, in: Capsule())
                            .padding(12)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("THE OG MYSORE MASALE DOSE")
                            .font(Typeface.display(28, relativeTo: .title))
                            .foregroundStyle(Palette.ink)
                            .multilineTextAlignment(.leading)
                        Text(lds?.open == false ? "No LIVE Dose dates open right now" : "Cooked live at your party by Chef's crew. 100% vegetarian.")
                            .font(Typeface.body(14))
                            .foregroundStyle(Palette.muted)
                            .multilineTextAlignment(.leading)
                        Text("Book the LIVE Dose Station")
                            .font(Typeface.body(14, weight: .bold))
                            .foregroundStyle(Palette.leafInk)
                            .padding(.horizontal, 18).padding(.vertical, 12)
                            .background(Palette.leaf, in: Capsule())
                            .padding(.top, 4)
                    }
                    .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 18)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.surface)
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Palette.line))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(lds == nil)
    }

    @ViewBuilder private var dibCard: some View {
            if let dib {
                NavigationLink(value: Route.section(dib.id)) {
                    HStack(spacing: 14) {
                        ZStack {
                            Palette.photo
                            Image(systemName: "shippingbox").font(.system(size: 28, weight: .light)).foregroundStyle(Palette.muted)
                        }
                        .frame(width: 86, height: 86)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        VStack(alignment: .leading, spacing: 4) {
                            Text("TAKE-HOME · SERVES 4").font(Typeface.body(11, weight: .bold, relativeTo: .caption)).kerning(1).foregroundStyle(Palette.red)
                            Text(dib.title.uppercased()).font(Typeface.display(22, relativeTo: .title2)).foregroundStyle(Palette.ink)
                            Text(dib.items.isEmpty ? "Take-home Masale Dose kit · coming soon" : dib.preorder?.next.map { "Order by \($0.orderByLabel) · pickup \($0.pickupLabel)" } ?? "Next pickup day coming soon")
                                .font(Typeface.body(13)).foregroundStyle(Palette.muted)
                                .multilineTextAlignment(.leading)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.ink)
                    }
                    .padding(12)
                    .background(Palette.surface2, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
    }

    private var tilesGrid: some View {
            LazyVGrid(columns: columns, spacing: 12) {
                NavigationLink(value: Route.catering) {
                    HomeTile(title: "Catering Items", subtitle: "Trays for your gathering", icon: "takeoutbag.and.cup.and.straw.fill")
                }
                NavigationLink(value: specials.count == 1 ? Route.section(specials[0].id) : Route.specials) {
                    HomeTile(title: specials.count == 1 ? specials[0].title : "Chef's Weekly Specials", subtitle: specialsSubtitle, icon: "fork.knife")
                }
                NavigationLink(value: route(.festival, festival)) {
                    HomeTile(title: "Festival Specials", subtitle: subtitle(festival, filled: "For the festivals coming up"), icon: "sparkles")
                }
                NavigationLink(value: route(.dry, dry)) {
                    HomeTile(title: "Dry Products", subtitle: subtitle(dry, filled: "Chef's masala powders and more"), icon: "basket.fill")
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
                Button { comingSoon = "At-Home Chef!" } label: {
                    HomeTile(title: "At-Home Chef!", subtitle: "Coming soon", icon: "house.fill", soon: true)
                }
                Button { comingSoon = "Supper Club" } label: {
                    HomeTile(title: "Supper Club", subtitle: "Coming soon", icon: "wineglass.fill", soon: true)
                }
            }
            .buttonStyle(.plain)
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
                .font(.system(size: 21, weight: .regular))
                .foregroundStyle(soon ? Palette.muted : Palette.red)
            Spacer(minLength: 0)
            Text(title.uppercased())
                .font(Typeface.display(16, relativeTo: .headline))
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

/// Which Home button a menu section sits under. Chef picks Festival Specials
/// or Dry Products per section in admin; the rest go by type (trays or pre-order).
enum MenuGroup: Hashable {
    case catering, specials, festival, dry

    func sections(in all: [MenuCategory]) -> [MenuCategory] {
        all.filter { c in
            guard c.kind == .catering, c.preorder?.flagship != true else { return false }
            switch self {
            case .festival: return c.section == "festival"
            case .dry: return c.section == "dry"
            case .specials: return c.section == nil && c.preorder != nil
            case .catering: return c.section == nil && c.preorder == nil && !c.items.isEmpty
            }
        }
    }

    var title: String {
        switch self {
        case .catering: "Catering Items"
        case .specials: "Chef's Weekly Specials"
        case .festival: "Festival Specials"
        case .dry: "Dry Products"
        }
    }

    var empty: String {
        switch self {
        case .catering: "Chef is updating the menu. Please check back soon."
        case .specials: "Chef's Weekly Specials are coming soon."
        case .festival: "No festival specials right now. Chef will announce the next festival menu in Notifications."
        case .dry: "Chef's masala powders and other dry products are coming soon."
        }
    }
}

/// South Indian, Asian Fusion, Chaats & Snacks... - the menu sections from /admin.
struct CateringSectionsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.ftrWide) private var wide
    @State private var showCart = false
    @State private var selectedId: String?
    var group: MenuGroup = .catering
    private var specialsOnly: Bool { group == .specials }

    private var sections: [MenuCategory] { group.sections(in: model.categories) }

    var body: some View {
        Group {
            if wide { wideBody } else { phoneBody }
        }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) { if !model.cart.isEmpty && !wide { CartBar { showCart = true } } }
        .sheet(isPresented: $showCart) { CartView() }
    }

    /// Wide screens: the list of sections on the left, the chosen section's dishes beside it.
    private var wideBody: some View {
        HStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    Text(group.title.uppercased())
                        .font(Typeface.display(24))
                        .foregroundStyle(Palette.ink)
                        .padding(.horizontal, 6).padding(.bottom, 10)
                    ForEach(sections) { c in
                        let on = c.id == (selectedId ?? sections.first?.id)
                        Button { selectedId = c.id } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(c.title).font(Typeface.body(15, weight: on ? .bold : .regular))
                                if let p = c.preorder {
                                    Text(p.next.map { "Pickup \($0.pickupLabel)" } ?? "Next pickup coming soon")
                                        .font(Typeface.body(12)).opacity(0.8)
                                }
                            }
                            .foregroundStyle(on ? Palette.chipOnInk : Palette.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 14).padding(.vertical, 11)
                            .background(on ? Palette.chipOn : .clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                    if sections.isEmpty {
                        Text(group.empty).font(Typeface.body(14)).foregroundStyle(Palette.muted).padding(6)
                    }
                }
                .padding(.horizontal, 10).padding(.vertical, 12)
            }
            .frame(width: 230)
            .overlay(alignment: .trailing) { Rectangle().fill(Palette.line).frame(width: 1) }

            if let id = selectedId ?? sections.first?.id {
                CategoryDishesView(categoryId: id).id(id)
            } else {
                Spacer()
            }
        }
    }

    private var phoneBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(group.title).font(Typeface.display(30)).foregroundStyle(Palette.red)
                if specialsOnly {
                    Text("Single-serve takeout, ordered ahead and picked up on Chef's pickup day.").font(Typeface.body(14)).foregroundStyle(Palette.muted)
                } else if group == .festival {
                    Text("Chef's menus for the festivals coming up.").font(Typeface.body(14)).foregroundStyle(Palette.muted)
                } else if group == .dry {
                    Text("Chef's own masala powders and pantry staples.").font(Typeface.body(14)).foregroundStyle(Palette.muted)
                } else if model.config?.cateringPickupOnly == true {
                    Text("Trays for pickup from our kitchen · \(model.config?.halfTrays == true ? "full or half trays" : "full trays")")
                        .font(Typeface.body(14)).foregroundStyle(Palette.muted)
                }
                if group == .catering, sections.first(where: { $0.preorder == nil })?.open == false {
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
                    Text(group.empty).font(Typeface.body(15)).foregroundStyle(Palette.muted)
                }
            }
            .padding(16)
            .padding(.bottom, model.cart.isEmpty ? 8 : 80)
        }
    }
}

/// One section's dishes, to add to the order (one at a time or several at once).
struct CategoryDishesView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.ftrWide) private var wide
    let categoryId: String
    @State private var selectedDish: Dish?
    @State private var showCart = false
    @State private var search = ""
    @State private var selecting = false
    @State private var picked: [String] = []
    @State private var showMultiAdd = false

    private var cat: MenuCategory? { model.categories.first { $0.id == categoryId } }

    var body: some View {
        HStack(spacing: 0) {
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
                            if p.days.isEmpty || cat.items.isEmpty {
                                Text("Chef hasn't opened the next pickup day yet. Check back soon - or tap Share to tell a friend.").font(Typeface.body(14)).foregroundStyle(Palette.muted)
                            }
                            ForEach(p.days.prefix(3)) { d in
                                Text("Pickup \(d.pickupLabel) · order by \(d.orderByLabel)").font(Typeface.body(14)).foregroundStyle(Palette.muted)
                                ForEach(d.items ?? [], id: \.itemId) { st in
                                    Text("\(st.title): \(st.summary)").font(Typeface.body(13, weight: .semibold))
                                        .foregroundStyle(st.min > 0 && st.ordered < st.min ? Palette.turmericInk : Palette.veg)
                                }
                            }
                        }
                        .padding(.horizontal, 16).padding(.bottom, 10)
                    } else if !cat.open {
                        Notice(tone: .warn, icon: "calendar.badge.exclamationmark", text: "Chef has no catering dates open right now. You can still browse, or ask for a custom quote.")
                            .padding(.horizontal, 20).padding(.bottom, 8)
                    }
                    if wide {
                        // Wide screens: dishes as cards, two across.
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                            ForEach(filtered(cat)) { dish in
                                dishButton(dish, cat)
                                    .frame(maxHeight: .infinity, alignment: .top)
                                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.line))
                            }
                        }
                        .padding(.horizontal, 16)
                    } else {
                        ForEach(filtered(cat)) { dish in
                            dishButton(dish, cat)
                            Divider().overlay(Palette.line).padding(.leading, 20)
                        }
                    }
                } else {
                    Text("This section isn't on the menu any more.").font(Typeface.body(15)).foregroundStyle(Palette.muted).padding(20)
                }
            }
            .padding(.bottom, (model.cart.isEmpty || wide) && !selecting ? 24 : 96)
        }
            if wide && !model.cart.isEmpty && !selecting {
                OrderSidePanel { showCart = true }
            }
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
            if selecting { selectBar } else if !model.cart.isEmpty && !wide { CartBar { showCart = true } }
        }
        .sheet(isPresented: $showMultiAdd) {
            MultiAddSheet(dishes: picked.compactMap { model.dish($0) }) { selecting = false; picked = [] }
        }
        .sheet(item: $selectedDish) { DishSheet(dish: $0, category: cat) }
        .sheet(isPresented: $showCart) { CartView() }
    }

    private func dishButton(_ dish: Dish, _ cat: MenuCategory) -> some View {
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
    @State private var booked: [BookedDate] = []
    @State private var loading = true

    private enum Row: Identifiable {
        case open(OpenDate), booked(BookedDate)
        var id: String { switch self { case .open(let d): "o" + d.date; case .booked(let b): "b" + b.date } }
        var date: String { switch self { case .open(let d): d.date; case .booked(let b): b.date } }
    }
    private var rows: [Row] { (dates.map(Row.open) + booked.map(Row.booked)).sorted { $0.date < $1.date } }

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
                ForEach(rows) { row in
                    switch row {
                    case .open(let d):
                        HStack(alignment: .top, spacing: 14) {
                            DateBadge(iso: d.date)
                            VStack(alignment: .leading, spacing: 6) {
                                Text(d.label).font(Typeface.body(17, weight: .bold)).foregroundStyle(Palette.ink)
                                ForEach(d.summary.components(separatedBy: " · "), id: \.self) { part in
                                    Label(part, systemImage: part.hasSuffix("booked") ? "calendar.badge.checkmark" : part.contains("LIVE") ? "flame.fill" : "takeoutbag.and.cup.and.straw")
                                        .font(Typeface.body(14)).foregroundStyle(part.hasSuffix("booked") ? Palette.red : Palette.muted)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(14)
                        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.line))
                    case .booked(let b):
                        HStack(alignment: .top, spacing: 14) {
                            DateBadge(iso: b.date)
                            VStack(alignment: .leading, spacing: 6) {
                                Text(b.label).font(Typeface.body(17, weight: .bold)).foregroundStyle(Palette.ink)
                                Label(b.lunch && b.dinner ? "Booked for lunch & dinner" : b.lunch ? "Booked for lunch" : "Booked for dinner", systemImage: "calendar.badge.checkmark")
                                    .font(Typeface.body(14, weight: .semibold)).foregroundStyle(Palette.red)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(14)
                        .background(Palette.red.opacity(0.07), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.red.opacity(0.35)))
                        .accessibilityElement(children: .combine)
                    }
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
        if let r = try? await (APIClient.shared.get("availability") as AvailabilityResponse) { dates = r.dates; preDays = r.preorderDays ?? []; booked = r.booked ?? [] }
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
                if dish.isPick || dish.isLimited { DishTags(dish: dish) }
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

/// A simple drawn dose: a golden crêpe folded on a beige plate (stand-in until Chef adds photos).
struct DoseGlyph: View {
    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            ctx.fill(Path(ellipseIn: CGRect(x: 0, y: h * 0.18, width: w, height: h * 0.72)), with: .color(Palette.beige))
            ctx.stroke(Path(ellipseIn: CGRect(x: 1, y: h * 0.18 + 1, width: w - 2, height: h * 0.72 - 2)), with: .color(Palette.goldLine), lineWidth: 1.5)
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


// MARK: - Share FTR

/// Tell a friend: FTR's website, WhatsApp ordering link and phone, through the iPhone share sheet.
struct ShareFTRButton: View {
    @Environment(AppModel.self) private var model
    var compact = false

    private var message: String {
        let phone = model.config?.phoneDisplay ?? "1-234-FTR-DOSE"
        return "Franklin Tiffin Room - Karnataka-style vegetarian home catering in Somerset, NJ. The LIVE Masale Dose Station at your party, Dose-in-a-Box to make at home, and catering trays. Order on WhatsApp: https://wa.me/\(model.config?.phoneDial ?? "12343873673")?text=hi or call \(phone)."
    }

    var body: some View {
        ShareLink(item: URL(string: "https://franklintiffinroom.com")!, subject: Text("Franklin Tiffin Room"), message: Text(message)) {
            if compact {
                Image(systemName: "square.and.arrow.up")
            } else {
                Label("Share FTR with a friend", systemImage: "square.and.arrow.up")
            }
        }
        .accessibilityLabel("Share FTR")
    }
}
