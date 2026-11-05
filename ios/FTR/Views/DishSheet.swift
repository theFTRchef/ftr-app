import SwiftUI

struct DishSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let dish: Dish
    let category: MenuCategory?

    @State private var qty: Double = 1
    @State private var note = ""
    @State private var confirmReplace = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(dish.title).font(Typeface.display(30)).foregroundStyle(Palette.ink)
                        let meta = [dish.size.isEmpty ? nil : dish.size, dish.servesText].compactMap { $0 }.joined(separator: " · ")
                        if !meta.isEmpty { Text(meta).font(Typeface.body(16, weight: .semibold)).foregroundStyle(Palette.muted) }
                    }
                    Text(dish.description)
                        .font(Typeface.body(17))
                        .foregroundStyle(Palette.ink)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)

                    Panel {
                        HStack {
                            Text("Full tray").font(Typeface.body(16))
                            Spacer()
                            Text(Money.text(dish.price)).font(Typeface.body(16, weight: .bold)).monospacedDigit()
                        }
                        if let half = dish.halfTrayPrice {
                            HStack {
                                Text("Half tray").font(Typeface.body(16))
                                Spacer()
                                Text(Money.text(half, cents: half.rounded() != half)).font(Typeface.body(16, weight: .bold)).monospacedDigit()
                            }
                        }
                        Divider()
                        HStack {
                            VStack(alignment: .leading) {
                                Text("How many trays?").font(Typeface.body(16, weight: .semibold))
                                Text(limitsText).font(Typeface.body(13)).foregroundStyle(Palette.muted)
                            }
                            Spacer()
                            QtyStepper(value: $qty, min: dish.minQty, max: dish.maxQty, step: dish.qtyStep)
                        }
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text(dish.requiresNote ? (dish.notePrompt ?? "Your preference") : "Notes for Chef (optional)")
                            .font(Typeface.body(16, weight: .semibold))
                        TextField(dish.requiresNote ? "Required" : "Spice level, customizations…", text: $note, axis: .vertical)
                            .lineLimit(2...4)
                            .font(Typeface.body(16))
                            .fieldStyle()
                    }

                    if qty >= dish.maxQty, let phone = model.config?.phoneDisplay {
                        Notice(tone: .info, icon: "phone", text: "Need more than \(Qty.text(dish.maxQty))? Call Chef at \(phone) so we can plan properly.")
                    }
                    if category?.open == false {
                        Notice(tone: .warn, icon: "calendar", text: "No catering dates are open right now, so this can't be ordered yet.")
                    }
                }
                .padding(20)
            }
            .screenBackground()
            .safeAreaInset(edge: .bottom) {
                Button(action: add) {
                    Text("Add to order · \(Money.text(lineTotal, cents: lineTotal.rounded() != lineTotal))").monospacedDigit()
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canAdd)
                .padding(16)
                .background(.bar)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
            .confirmationDialog(warning?.title ?? "Start a new order?", isPresented: $confirmReplace, titleVisibility: .visible) {
                Button(warning?.action ?? "Start a new order", role: .destructive) { commit() }
            } message: {
                Text(warning?.message ?? "")
            }
            .onAppear { qty = dish.minQty < 1 ? 1 : dish.minQty }
        }
        .presentationDragIndicator(.visible)
    }

    private var limitsText: String {
        var parts: [String] = []
        if dish.qtyStep < 1 { parts.append("Half trays welcome") }
        if dish.minQty > 1 { parts.append("Minimum \(Qty.text(dish.minQty))") }
        parts.append("Up to \(Qty.text(dish.maxQty))")
        return parts.joined(separator: " · ")
    }

    private var lineTotal: Double {
        Cart.Line(itemId: dish.id, title: dish.title, unitPrice: dish.price, halfTrayPrice: dish.halfTrayPrice, qty: qty).total
    }

    private var canAdd: Bool {
        category?.open != false && (!dish.requiresNote || !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    private var warning: AppModel.ReplaceWarning? { model.replaceWarning(for: dish) }

    private func add() {
        if warning != nil { confirmReplace = true } else { commit() }
    }

    private func commit() {
        model.add(dish, qty: qty, note: note)
        dismiss()
    }
}

struct QtyStepper: View {
    @Binding var value: Double
    let min: Double
    let max: Double
    let step: Double

    var body: some View {
        HStack(spacing: 0) {
            button("minus", enabled: value - step >= min - 0.001) { value = Swift.max(min, value - step) }
            Text(Qty.text(value))
                .font(Typeface.body(18, weight: .bold))
                .monospacedDigit()
                .frame(minWidth: 40)
                .contentTransition(.numericText())
            button("plus", enabled: value + step <= max + 0.001) { value = Swift.min(max, value + step) }
        }
        .background(Palette.surface2, in: Capsule())
        .sensoryFeedback(.selection, trigger: value)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Quantity")
        .accessibilityValue(Qty.text(value))
        .accessibilityAdjustableAction { dir in
            switch dir {
            case .increment: if value + step <= max { value += step }
            case .decrement: if value - step >= min { value -= step }
            @unknown default: break
            }
        }
    }

    private func button(_ icon: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: { withAnimation(.snappy) { action() } }) {
            Image(systemName: icon).font(.system(size: 15, weight: .bold)).frame(width: 40, height: 40)
        }
        .disabled(!enabled)
        .foregroundStyle(enabled ? Palette.leaf : Palette.muted.opacity(0.5))
    }
}

/// Several dishes picked from the menu at once: set each quantity (and any
/// required note, like Palya's vegetable), then add them all in one go.
struct MultiAddSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let dishes: [Dish]
    let onAdded: () -> Void

    @State private var qty: [String: Double] = [:]
    @State private var notes: [String: String] = [:]
    @State private var confirmReplace = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Add \(dishes.count) dishes").font(Typeface.display(28))
                    ForEach(dishes) { d in
                        Panel {
                            HStack(alignment: .firstTextBaseline) {
                                Text(d.title).font(Typeface.display(19, relativeTo: .headline))
                                Spacer()
                                Text(Money.text(line(d).total, cents: line(d).total.rounded() != line(d).total))
                                    .font(Typeface.body(16, weight: .bold)).monospacedDigit()
                            }
                            HStack {
                                Text([d.size.isEmpty ? nil : d.size, d.servesText].compactMap { $0 }.joined(separator: " · "))
                                    .font(Typeface.body(14)).foregroundStyle(Palette.muted)
                                Spacer()
                                QtyStepper(value: binding(d), min: d.minQty, max: d.maxQty, step: d.qtyStep)
                            }
                            TextField(d.requiresNote ? (d.notePrompt ?? "Your preference (required)") : "Notes for Chef (optional)",
                                      text: Binding(get: { notes[d.id] ?? "" }, set: { notes[d.id] = $0 }), axis: .vertical)
                                .lineLimit(1...3)
                                .font(Typeface.body(15))
                                .fieldStyle()
                            if d.requiresNote && (notes[d.id] ?? "").trimmingCharacters(in: .whitespaces).isEmpty {
                                Text("Chef needs this to prepare \(d.title).").font(Typeface.body(13)).foregroundStyle(Palette.turmericInk)
                            }
                        }
                    }
                }
                .padding(16)
            }
            .screenBackground()
            .safeAreaInset(edge: .bottom) {
                Button(action: add) {
                    Text("Add all to order · \(Money.text(total, cents: total.rounded() != total))").monospacedDigit()
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!ready)
                .padding(16)
                .background(.bar)
            }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .confirmationDialog(warning?.title ?? "Start a new order?", isPresented: $confirmReplace, titleVisibility: .visible) {
                Button(warning?.action ?? "Start a new order", role: .destructive) { commit() }
            } message: {
                Text(warning?.message ?? "")
            }
        }
    }

    private func binding(_ d: Dish) -> Binding<Double> {
        Binding(get: { qty[d.id] ?? max(1, d.minQty) }, set: { qty[d.id] = $0 })
    }

    private func line(_ d: Dish) -> Cart.Line {
        Cart.Line(itemId: d.id, title: d.title, unitPrice: d.price, halfTrayPrice: d.halfTrayPrice, qty: qty[d.id] ?? max(1, d.minQty))
    }

    private var total: Double { dishes.reduce(0) { $0 + line($1).total } }

    private var ready: Bool {
        !dishes.isEmpty && dishes.allSatisfy { !$0.requiresNote || !(notes[$0.id] ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
    }

    private var warning: AppModel.ReplaceWarning? { dishes.first.flatMap { model.replaceWarning(for: $0) } }

    private func add() {
        if warning != nil { confirmReplace = true } else { commit() }
    }

    private func commit() {
        for d in dishes { model.add(d, qty: qty[d.id] ?? max(1, d.minQty), note: notes[d.id]) }
        onAdded()
        dismiss()
    }
}
