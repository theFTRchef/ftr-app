import SwiftUI

// MARK: - Chef's picks and limited availability
//
// Chef promotes dishes from Chef's Kitchen (Menu › Promote dishes). They show
// here at the top of Home, and every dish row shows a "Chef's pick" or
// "Limited" tag. Nothing shows when Chef hasn't picked anything.

/// "★ CHEF'S PICK" and "LIMITED · Only 10 trays" tags on a dish.
struct DishTags: View {
    let dish: Dish

    var body: some View {
        HStack(spacing: 6) {
            if dish.isPick {
                tag("★ CHEF'S PICK", fg: Palette.turmericInk, bg: Palette.turmericSoft)
            }
            if dish.isLimited {
                tag(dish.limitedNote.map { "LIMITED · \($0)" } ?? "LIMITED", fg: Palette.bad, bg: Palette.bad.opacity(0.12))
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func tag(_ text: String, fg: Color, bg: Color) -> some View {
        Text(text)
            .font(Typeface.body(11, weight: .bold, relativeTo: .caption))
            .kerning(0.5)
            .foregroundStyle(fg)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(bg, in: Capsule())
            .lineLimit(1)
    }
}

/// Chef's picks on Home: a card per promoted dish; tapping opens its menu section.
struct ChefPicksCard: View {
    @Environment(AppModel.self) private var model
    let open: (String) -> Void

    private struct Pick: Identifiable {
        let dish: Dish
        let categoryId: String
        let section: String
        var id: String { dish.id }
    }

    private var picks: [Pick] {
        model.categories.filter { $0.kind != .lds }.flatMap { c in
            c.items.filter(\.isPick).map { Pick(dish: $0, categoryId: c.id, section: c.title) }
        }
    }

    var body: some View {
        if !picks.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text("CHEF'S PICKS")
                        .font(Typeface.display(20, relativeTo: .title3))
                        .foregroundStyle(Palette.ink)
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                }
                if let note = picks.compactMap({ $0.dish.promoNote }).first, !note.isEmpty {
                    Text(note).font(Typeface.tagline(15)).foregroundStyle(Palette.muted)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(picks) { p in
                            Button { open(p.categoryId) } label: { card(p) }
                                .buttonStyle(.plain)
                                .accessibilityHint("Opens \(p.section)")
                        }
                    }
                    .padding(.vertical, 2)
                }
                .scrollClipDisabled()
            }
        }
    }

    private func card(_ p: Pick) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("★ CHEF'S PICK")
                .font(Typeface.body(11, weight: .bold, relativeTo: .caption)).kerning(0.5)
                .foregroundStyle(Palette.turmericInk)
            Text(p.dish.title.uppercased())
                .font(Typeface.display(17, relativeTo: .headline))
                .foregroundStyle(Palette.ink)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
            Text(p.section).font(Typeface.body(13)).foregroundStyle(Palette.muted).lineLimit(1)
            Spacer(minLength: 0)
            HStack {
                Text(Money.text(p.dish.price)).font(Typeface.body(15, weight: .bold)).monospacedDigit().foregroundStyle(Palette.ink)
                Spacer(minLength: 4)
                if p.dish.isLimited {
                    Text("LIMITED")
                        .font(Typeface.body(10, weight: .bold, relativeTo: .caption2))
                        .foregroundStyle(Palette.bad)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Palette.bad.opacity(0.12), in: Capsule())
                }
            }
            if let ln = p.dish.limitedNote, p.dish.isLimited {
                Text(ln).font(Typeface.body(12, weight: .semibold)).foregroundStyle(Palette.bad).lineLimit(2)
            }
        }
        .padding(14)
        .frame(width: 190, height: 150, alignment: .topLeading)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Palette.goldLine, lineWidth: 1.5))
        .contentShape(Rectangle())
    }
}
