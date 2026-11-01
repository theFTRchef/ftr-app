import SwiftUI

/// Notifications: everything Chef's kitchen has sent this customer - the same
/// messages a WhatsApp customer would get - each labelled (Approved, Declined,
/// Deposit due, Payment confirmed...), newest first.
struct InboxView: View {
    @Environment(AppModel.self) private var model
    @State private var acting: String?
    @State private var filter: Filter = .all

    enum Filter: String, CaseIterable, Identifiable {
        case all = "All", decisions = "Approvals & declines", payments = "Payments"
        var id: String { rawValue }
        func includes(_ tag: String?) -> Bool {
            switch self {
            case .all: return true
            case .decisions: return ["approved", "declined", "quote", "released"].contains(tag ?? "")
            case .payments: return ["deposit_due", "reminder", "paid", "not_received", "screenshot", "released"].contains(tag ?? "")
            }
        }
    }

    var body: some View {
        NavigationStack {
            SignedInGate(reason: "Sign in to get Chef's approvals, deposit requests and updates about your orders.") {
                ScrollView {
                    if model.inbox.isEmpty {
                        VStack(spacing: 10) {
                            Text("No messages yet").font(Typeface.display(24))
                            Text("Updates from Chef about your orders will show up here.")
                                .font(Typeface.body(16)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                        }
                        .padding(32)
                    } else {
                        LazyVStack(alignment: .leading, spacing: 14) {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    ForEach(Filter.allCases) { f in
                                        Button(f.rawValue) { withAnimation(.snappy) { filter = f } }
                                            .font(Typeface.body(14, weight: .semibold))
                                            .padding(.horizontal, 12).padding(.vertical, 7)
                                            .foregroundStyle(filter == f ? Palette.leafInk : Palette.ink)
                                            .background(filter == f ? Palette.leaf : Palette.surface, in: Capsule())
                                            .overlay(Capsule().strokeBorder(filter == f ? .clear : Palette.line))
                                            .accessibilityAddTraits(filter == f ? .isSelected : [])
                                    }
                                }
                            }
                            let shown = model.inbox.filter { filter.includes($0.tag) }
                            if shown.isEmpty {
                                Text("Nothing here yet.").font(Typeface.body(15)).foregroundStyle(Palette.muted).padding(.top, 20)
                            }
                            ForEach(shown) { bubble($0) }
                        }
                        .padding(16)
                    }
                }
                .screenBackground()
                .refreshable { await model.refreshAccountData() }
                .task {
                    await model.refreshAccountData()
                    await model.markInboxRead()
                }
            }
            .navigationTitle("Notifications")
        }
    }

    private func bubble(_ m: InboxMessage) -> some View {
        HStack(alignment: .top, spacing: 10) {
            BrandMark(size: 28)
            VStack(alignment: .leading, spacing: 8) {
                if let label = m.tagLabel, m.tag != "update" { TagChip(tag: m.tag ?? "", label: label) }
                if let h = m.header { Text(h).font(Typeface.body(15, weight: .bold)) }
                if !m.text.isEmpty {
                    Text(m.text.replacingOccurrences(of: "*", with: ""))
                        .font(Typeface.body(16))
                        .foregroundStyle(Palette.ink)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let url = APIClient.shared.absolute(m.imageUrl) {
                    AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { ProgressView() }
                        .frame(maxWidth: 220, maxHeight: 220)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                if let actions = m.actions, !actions.isEmpty, m.actioned != true, quoteStillOpen(actions[0].orderId) {
                    HStack(spacing: 10) {
                        ForEach(actions, id: \.accept) { a in
                            Button(a.accept ? "Accept" : "Decline") { Task { await answer(a) } }
                                .buttonStyle(a.accept ? AnyButtonStyle(PrimaryButtonStyle()) : AnyButtonStyle(SecondaryButtonStyle()))
                        }
                    }
                    .disabled(acting != nil)
                }
                HStack {
                    if let d = m.date { Text(d, format: .dateTime.month(.abbreviated).day().hour().minute()) }
                    Spacer()
                    if let id = m.orderId, model.orders.contains(where: { $0.orderId == id }) {
                        Button("View order") {
                            model.openOrderId = id
                            model.selectedTab = .orders
                        }
                        .font(Typeface.body(14, weight: .semibold))
                    }
                }
                .font(Typeface.body(13))
                .foregroundStyle(Palette.muted)
            }
            .padding(14)
            .background(m.read ? Palette.surface : Palette.leafSoft, in: UnevenRoundedRectangle(topLeadingRadius: 4, bottomLeadingRadius: 18, bottomTrailingRadius: 18, topTrailingRadius: 18, style: .continuous))
        }
    }

    private func quoteStillOpen(_ id: String) -> Bool {
        model.orders.first { $0.orderId == id }?.quote?.open ?? false
    }

    private func answer(_ a: InboxMessage.Action) async {
        struct B: Encodable { let accept: Bool }
        acting = a.orderId
        defer { acting = nil }
        _ = try? await (APIClient.shared.post("orders/\(a.orderId)/quote", B(accept: a.accept)) as Order)
        await model.refreshAccountData()
    }
}

/// The label on each notification. Good news in green, problems in red,
/// things the customer needs to do in gold.
struct TagChip: View {
    let tag: String
    let label: String

    var body: some View {
        Label(label, systemImage: icon)
            .font(Typeface.body(12.5, weight: .bold, relativeTo: .caption))
            .padding(.horizontal, 9).padding(.vertical, 4)
            .foregroundStyle(fg)
            .background(bg, in: Capsule())
            .lineLimit(1)
            .fixedSize()
    }

    private var good: Bool { ["approved", "paid"].contains(tag) }
    private var bad: Bool { ["declined", "released", "not_received"].contains(tag) }
    private var todo: Bool { ["deposit_due", "reminder", "quote"].contains(tag) }
    private var icon: String {
        switch tag {
        case "approved": "checkmark.seal.fill"
        case "paid": "checkmark.circle.fill"
        case "declined", "released": "xmark.circle.fill"
        case "not_received": "exclamationmark.circle.fill"
        case "deposit_due", "reminder": "dollarsign.circle.fill"
        case "quote": "text.bubble.fill"
        case "screenshot": "photo.fill"
        default: "bell.fill"
        }
    }
    private var fg: Color { good ? Palette.leaf : bad ? Palette.bad : todo ? Palette.turmericInk : Palette.muted }
    private var bg: Color { good ? Palette.leafSoft : bad ? Palette.chiliSoft : todo ? Palette.turmericSoft : Palette.surface2 }
}

/// Lets one button pick between two styles.
struct AnyButtonStyle: ButtonStyle {
    private let make: (Configuration) -> AnyView
    init<S: ButtonStyle>(_ style: S) { make = { AnyView(style.makeBody(configuration: $0)) } }
    func makeBody(configuration: Configuration) -> some View { make(configuration) }
}
