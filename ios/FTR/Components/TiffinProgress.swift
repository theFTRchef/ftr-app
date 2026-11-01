import SwiftUI

/// Order progress drawn as a steel tiffin carrier: one tier per step,
/// stacked bottom-up and filled with turmeric as the order moves along.
/// The real step names sit beside each tier.
struct TiffinProgress: View {
    let order: Order

    struct Step { let title: String; let detail: String? }

    private var steps: [Step] {
        var s: [Step] = []
        if order.isCustom {
            s.append(Step(title: "Request sent", detail: nil))
            s.append(Step(title: "Chef's quote", detail: order.quote.map { Money.text($0.price) }))
        } else {
            s.append(Step(title: "Sent to Chef", detail: nil))
            s.append(Step(title: "Chef approves", detail: nil))
        }
        if order.payment != nil || [.deposit_due, .deposit_review].contains(order.stage) {
            s.append(Step(title: "Zelle deposit", detail: order.payment.map { Money.text($0.depositDue, cents: true) }))
        }
        s.append(Step(title: "Booked", detail: order.eventDateLabel))
        return s
    }

    /// How many tiers are full (the next one is the step in progress).
    private var filled: Int {
        switch order.stage {
        case .review, .quote_requested, .unknown: return 1
        case .quote_ready, .deposit_due, .deposit_review: return 2
        case .confirmed: return steps.count
        case .closed: return 0
        }
    }

    private var inProgress: Bool { order.stage != .confirmed && order.stage != .closed }

    var body: some View {
        HStack(alignment: .bottom, spacing: 18) {
            carrier
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(steps.enumerated().reversed()), id: \.offset) { idx, step in
                    HStack(alignment: .firstTextBaseline) {
                        Text(step.title)
                            .font(Typeface.body(16, weight: idx < filled || (inProgress && idx == filled) ? .bold : .regular))
                            .foregroundStyle(idx < filled ? Palette.ink : inProgress && idx == filled ? Palette.turmericInk : Palette.muted)
                        Spacer(minLength: 8)
                        if let d = step.detail {
                            Text(d).font(Typeface.body(14)).foregroundStyle(Palette.muted).monospacedDigit()
                        }
                    }
                    .frame(height: tierHeight + tierGap)
                }
            }
            .padding(.bottom, baseHeight + tierGap / 2)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private let tierHeight: CGFloat = 34
    private let tierGap: CGFloat = 6
    private let baseHeight: CGFloat = 10

    private var carrier: some View {
        VStack(spacing: tierGap) {
            // handle
            ZStack(alignment: .top) {
                RoundedRectangle(cornerRadius: 12).stroke(Palette.muted.opacity(0.55), lineWidth: 4)
                    .frame(width: 46, height: 26)
                    .offset(y: 4)
            }
            .frame(height: 22, alignment: .bottom)
            .clipped()
            ForEach((0..<steps.count).reversed(), id: \.self) { idx in
                tier(full: idx < filled, current: inProgress && idx == filled)
            }
            Capsule().fill(Palette.muted.opacity(0.35)).frame(width: 84, height: baseHeight)
        }
    }

    private func tier(full: Bool, current: Bool) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(LinearGradient(colors: [Palette.surface2, Palette.line.opacity(0.9), Palette.surface2], startPoint: .leading, endPoint: .trailing))
            if full {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(order.stage == .closed ? Palette.chili : Palette.turmeric)
                    .padding(4)
            }
            Rectangle().fill(Palette.line).frame(height: 2).offset(y: -tierHeight / 2 + 5)
        }
        .frame(width: 72, height: tierHeight)
        .overlay(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .strokeBorder(current ? Palette.turmeric : .clear, style: StrokeStyle(lineWidth: 2, dash: [5, 4]))
        )
        .animation(.spring(duration: 0.5), value: full)
    }

    private var accessibilityText: String {
        let done = steps.prefix(filled).map(\.title).joined(separator: ", ")
        return order.stage == .closed ? "Order not booked: \(order.status)" : "Progress: \(done.isEmpty ? "starting" : done) done of \(steps.count) steps"
    }
}
