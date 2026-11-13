import SwiftUI

// MARK: - Star ratings
//
// Customers rate dishes they received (order confirmed, date passed): 1-5 stars and
// an optional comment. The menu shows each dish's average once a few people have
// rated it; comments go to Chef only.

struct ItemRating: Decodable, Hashable {
    let avg: Double
    let count: Int
}

/// A dish this customer can rate, with their current rating (stars 0 = not rated yet).
struct RateableItem: Decodable, Identifiable, Hashable {
    let itemId: String
    let title: String
    let orderId: String
    var stars: Int
    var comment: String
    var id: String { itemId }
}

/// "★ 4.7 (12)" under a dish name.
struct RatingBadge: View {
    let rating: ItemRating

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "star.fill").font(.system(size: 12)).foregroundStyle(Palette.turmeric)
            Text(String(format: "%.1f", rating.avg)).font(Typeface.body(13, weight: .bold)).foregroundStyle(Palette.ink)
            Text("(\(rating.count))").font(Typeface.body(13)).foregroundStyle(Palette.muted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(String(format: "Rated %.1f out of 5 by %d customers", rating.avg, rating.count))
    }
}

/// Five tappable stars.
struct StarPicker: View {
    @Binding var stars: Int
    var size: CGFloat = 30

    var body: some View {
        HStack(spacing: 6) {
            ForEach(1...5, id: \.self) { n in
                Button { stars = n } label: {
                    Image(systemName: n <= stars ? "star.fill" : "star")
                        .font(.system(size: size))
                        .foregroundStyle(n <= stars ? Palette.turmeric : Palette.muted.opacity(0.6))
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(n) star\(n == 1 ? "" : "s")")
                .accessibilityAddTraits(n == stars ? .isSelected : [])
            }
        }
    }
}

/// The "How was it?" panel: one row per dish, tap to rate.
struct RateDishesPanel: View {
    @Environment(AppModel.self) private var model
    /// Only these dishes (an order's items); nil = every dish waiting for a rating.
    var only: Set<String>? = nil
    @State private var editing: RateableItem?

    private var items: [RateableItem] {
        model.rateable.filter { only == nil || only!.contains($0.itemId) }
    }

    var body: some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("How was it?").font(Typeface.display(22)).foregroundStyle(Palette.ink)
                Text("Rate the dishes you got. Stars help other customers; your comments go straight to Chef.")
                    .font(Typeface.body(14)).foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(items) { it in
                    Button { editing = it } label: {
                        HStack(spacing: 10) {
                            Text(it.title).font(Typeface.body(16, weight: .semibold)).foregroundStyle(Palette.ink)
                                .multilineTextAlignment(.leading)
                            Spacer(minLength: 8)
                            if it.stars > 0 {
                                HStack(spacing: 2) {
                                    ForEach(1...5, id: \.self) { n in
                                        Image(systemName: n <= it.stars ? "star.fill" : "star").font(.system(size: 13))
                                            .foregroundStyle(n <= it.stars ? Palette.turmeric : Palette.muted.opacity(0.5))
                                    }
                                }
                                .accessibilityLabel("Your rating: \(it.stars) stars. Tap to change.")
                            } else {
                                Text("Rate").font(Typeface.body(15, weight: .bold)).foregroundStyle(Palette.red)
                            }
                            Image(systemName: "chevron.right").font(.system(size: 13)).foregroundStyle(Palette.muted)
                        }
                        .padding(.vertical, 12).padding(.horizontal, 14)
                        .frame(minHeight: 52)
                        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.line))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .sheet(item: $editing) { RateDishSheet(item: $0) }
        }
    }
}

struct RateDishSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let item: RateableItem
    @State private var stars = 0
    @State private var comment = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(item.title).font(Typeface.display(24)).foregroundStyle(Palette.ink)
                        StarPicker(stars: $stars)
                        Text(stars == 0 ? "Tap a star" : ["", "Not for me", "OK", "Good", "Really good", "Loved it!"][stars])
                            .font(Typeface.body(14, weight: .semibold)).foregroundStyle(Palette.muted)
                    }
                    .padding(.vertical, 4)
                }
                Section {
                    TextField("What did you like? What could be better?", text: $comment, axis: .vertical)
                        .lineLimit(3...8)
                } header: {
                    Text("Comment for Chef (optional)")
                } footer: {
                    Text("Only Chef sees your comment. The menu shows just the average stars, never names.")
                }
                if let error { Section { Text(error).foregroundStyle(Palette.bad) } }
            }
            .navigationTitle("Rate this dish")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { Task { await save() } }
                        .disabled(stars == 0 || saving)
                }
            }
            .onAppear { stars = item.stars; comment = item.comment }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() async {
        saving = true
        error = nil
        do {
            try await model.rate(item.itemId, stars: stars, comment: comment)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            dismiss()
        } catch {
            self.error = (error as? APIError)?.message ?? "Couldn't save your rating. Check your connection and try again."
        }
        saving = false
    }
}
