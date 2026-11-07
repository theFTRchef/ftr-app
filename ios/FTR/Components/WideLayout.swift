import SwiftUI

// MARK: - Wide layout (iPhone Duo open, iPad-size windows)
//
// The app picks its layout from the space it actually gets, not from the device:
// a window at least `minWidth` points wide with a regular size class gets the
// two-column layout with a side rail. Every other iPhone (and the Duo when closed)
// keeps the regular phone layout.

enum WideLayout {
    static let minWidth: CGFloat = 700

    static func isWide(width: CGFloat, sizeClass: UserInterfaceSizeClass?) -> Bool {
        sizeClass == .regular && width >= minWidth
    }
}

private struct WideLayoutKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// True when the screen is laid out in columns (see `WideLayout`).
    var ftrWide: Bool {
        get { self[WideLayoutKey.self] }
        set { self[WideLayoutKey.self] = newValue }
    }
}

/// The side navigation used instead of the bottom tab bar on wide screens.
struct SideRail: View {
    @Environment(AppModel.self) private var model

    private struct Item: Identifiable {
        let tab: AppModel.Tab
        let title: String
        let icon: String
        var id: String { title }
    }

    private let items = [
        Item(tab: .menu, title: "Home", icon: "house"),
        Item(tab: .orders, title: "Orders", icon: "takeoutbag.and.cup.and.straw"),
        Item(tab: .messages, title: "Alerts", icon: "bell"),
        Item(tab: .account, title: "Account", icon: "person.crop.circle"),
    ]

    var body: some View {
        VStack(spacing: 6) {
            BrandMark(size: 46)
                .padding(.top, 10)
                .padding(.bottom, 14)
            ForEach(items) { item in
                let on = model.selectedTab == item.tab
                Button {
                    model.selectedTab = item.tab
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: on ? item.icon + ".fill" : item.icon)
                            .font(.system(size: 20, weight: on ? .semibold : .regular))
                            .overlay(alignment: .topTrailing) {
                                if badge(item.tab) > 0 {
                                    Text("\(badge(item.tab))")
                                        .font(Typeface.body(10, weight: .bold, relativeTo: .caption2))
                                        .foregroundStyle(.white)
                                        .padding(.horizontal, 5).padding(.vertical, 1)
                                        .background(Palette.bad, in: Capsule())
                                        .offset(x: 10, y: -6)
                                }
                            }
                        Text(item.title)
                            .font(Typeface.body(11, weight: on ? .bold : .semibold, relativeTo: .caption2))
                    }
                    .foregroundStyle(on ? Palette.red : Palette.muted)
                    .frame(width: 64, height: 58)
                    .background(on ? Palette.leafSoft : .clear, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(item.title)
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityValue(badge(item.tab) > 0 ? "\(badge(item.tab)) new" : "")
            }
            Spacer()
        }
        .frame(width: 80)
        .frame(maxHeight: .infinity)
        .background(Palette.surface)
        .overlay(alignment: .trailing) { Rectangle().fill(Palette.line).frame(width: 1) }
    }

    private func badge(_ tab: AppModel.Tab) -> Int {
        switch tab {
        case .orders: model.orders.filter(\.needsCustomerAction).count
        case .messages: model.unread
        default: 0
        }
    }
}

/// "Your order" column shown beside the dishes on wide screens, in place of the bottom bar.
struct OrderSidePanel: View {
    @Environment(AppModel.self) private var model
    let open: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("YOUR ORDER", systemImage: "cart")
                .font(Typeface.display(18, relativeTo: .headline))
                .foregroundStyle(Palette.ink)
                .padding(.bottom, 4)
            if let ld = model.cart.liveDose {
                row("LIVE Dose Station · \(ld.total) dose", Money.text(ld.price))
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(model.cart.lines) { line in
                            row("\(line.title) × \(Qty.text(line.qty))", Money.text(line.total))
                        }
                    }
                }
            }
            Rectangle().fill(Palette.line).frame(height: 1)
            HStack {
                Text("Total").font(Typeface.body(15, weight: .bold))
                Spacer()
                Text(Money.text(model.cart.subtotal)).font(Typeface.body(15, weight: .bold)).monospacedDigit()
            }
            .foregroundStyle(Palette.ink)
            Spacer(minLength: 8)
            Button("Review order", action: open)
                .buttonStyle(PrimaryButtonStyle())
        }
        .padding(16)
        .frame(width: 250)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Palette.surface)
        .overlay(alignment: .leading) { Rectangle().fill(Palette.line).frame(width: 1) }
    }

    private func row(_ title: String, _ amount: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(Typeface.body(14)).foregroundStyle(Palette.ink)
            Spacer(minLength: 8)
            Text(amount).font(Typeface.body(14)).monospacedDigit().foregroundStyle(Palette.ink)
        }
    }
}
