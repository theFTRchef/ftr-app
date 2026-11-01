import SwiftUI

/// The LIVE Dose Station: pick a combined plate total, split it between
/// Mysore Masale Dose and Onion Dose, add a note. Same rules as the bot.
struct LiveDoseView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let category: MenuCategory

    @State private var total = 0
    @State private var md = 0
    @State private var note = ""
    @State private var confirmReplace = false

    private var lds: LiveDoseInfo { category.liveDose! }
    private var price: Double { lds.options.first { $0.total == total }?.price ?? 0 }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Plan your LIVE Dose Station").font(Typeface.display(28))
                        Text("Our crew sets up at your event and cooks every dose fresh. One setup fee per event.")
                            .font(Typeface.body(16)).foregroundStyle(Palette.muted)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("How many plates in total?").font(Typeface.body(17, weight: .bold))
                        HStack(spacing: 10) {
                            ForEach(lds.options, id: \.total) { o in
                                Button {
                                    withAnimation(.snappy) {
                                        total = o.total
                                        md = min(md, total)
                                    }
                                } label: {
                                    VStack(spacing: 4) {
                                        Text("\(o.total)").font(Typeface.display(24, relativeTo: .title3))
                                        Text(Money.text(o.price)).font(Typeface.body(14, weight: .semibold)).monospacedDigit()
                                    }
                                    .frame(maxWidth: .infinity, minHeight: 74)
                                    .foregroundStyle(total == o.total ? Palette.leafInk : Palette.ink)
                                    .background(total == o.total ? Palette.leaf : Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(total == o.total ? .clear : Palette.line))
                                }
                                .buttonStyle(.plain)
                                .accessibilityAddTraits(total == o.total ? .isSelected : [])
                            }
                        }
                        Text("Prices include the \(Money.text(lds.setupFee)) setup fee.")
                            .font(Typeface.body(13)).foregroundStyle(Palette.muted)
                    }

                    Panel {
                        Text("Your mix").font(Typeface.body(17, weight: .bold))
                        splitRow(title: lds.mdTitle, detail: lds.mdDescription, count: md)
                        Divider()
                        splitRow(title: lds.odTitle, detail: lds.odDescription, count: total - md)
                        HStack {
                            Text("\(lds.mdTitle), in steps of \(lds.increment)").font(Typeface.body(14)).foregroundStyle(Palette.muted)
                            Spacer()
                            QtyStepper(value: Binding(get: { Double(md) }, set: { md = Int($0) }), min: 0, max: Double(total), step: Double(lds.increment))
                        }
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Notes for the crew (optional)").font(Typeface.body(16, weight: .semibold))
                        TextField("Spice level, timing, setup space…", text: $note, axis: .vertical)
                            .lineLimit(2...4).font(Typeface.body(16)).fieldStyle()
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Notice(tone: .info, icon: "car", text: "Travel: \(model.config?.delivery.ldsTravelRule ?? "first miles included"). You'll see the exact fee once you enter the event address.")
                        if lds.delayFeePerHour > 0 {
                            Notice(tone: .warn, icon: "clock", text: "Delays on the event side (late access, space not ready) are charged at \(Money.text(lds.delayFeePerHour))/hr.")
                        }
                    }
                }
                .padding(20)
            }
            .screenBackground()
            .safeAreaInset(edge: .bottom) {
                Button(action: save) { Text("Add station · \(Money.text(price))").monospacedDigit() }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(16)
                    .background(.bar)
            }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .confirmationDialog("Your catering trays will be removed", isPresented: $confirmReplace, titleVisibility: .visible) {
                Button("Book the LIVE Dose Station instead", role: .destructive) { commit() }
            } message: {
                Text("Catering trays and the LIVE Dose Station are booked as separate orders.")
            }
            .onAppear {
                if let existing = model.cart.liveDose {
                    total = existing.total; md = existing.md; note = existing.note ?? ""
                } else {
                    total = lds.options.first?.total ?? lds.minTotal
                    md = total
                }
            }
        }
    }

    private func splitRow(title: String, detail: String, count: Int) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(Typeface.display(18, relativeTo: .headline))
                if !detail.isEmpty {
                    Text(detail).font(Typeface.body(14)).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer()
            Text("\(count)").font(Typeface.display(24, relativeTo: .title3)).monospacedDigit().contentTransition(.numericText())
        }
    }

    private func save() {
        if !model.cart.lines.isEmpty { confirmReplace = true } else { commit() }
    }

    private func commit() {
        let n = note.trimmingCharacters(in: .whitespacesAndNewlines)
        model.setLiveDose(.init(total: total, md: md, note: n.isEmpty ? nil : n, price: price))
        dismiss()
    }
}
