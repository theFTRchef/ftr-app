import SwiftUI
import VisionKit

// MARK: - Recipe QR codes
//
// Two kinds of codes open a recipe here, and nothing shows without a scan:
//  - gift labels on FTR-BBB Powder packets: https://bot.franklintiffinroom.com/g/T50-017-XXXXXXXX
//    (single use: the first phone to open one keeps it; CHEF-TEST is Chef's reusable test code)
//  - recipe codes made in Chef's Kitchen: https://bot.franklintiffinroom.com/r/<token>

struct Recipe: Decodable, Equatable {
    struct Meta: Decodable, Equatable { let label: String; let value: String }
    var title: String
    var subtitle: String?
    var meta: [Meta]?
    var notes: [String]?
    var powder: String?
    var intro: String?
    var serves: String?
    var time: String?
    var ingredients: [String]
    var amounts: [String]?
    var steps: [String]
    var tip: String?
}

struct GiftInfo: Decodable, Equatable {
    let code: String
    let label: Int
    let title: String
    let product: String
    let test: Bool
}

struct SurveyQuestion: Decodable, Equatable, Identifiable {
    let key: String
    let label: String
    let options: [String]?
    var id: String { key }
}

struct GiftSurvey: Decodable, Equatable {
    let questions: [SurveyQuestion]
    var answers: [String: String]
    var done: Bool
}

/// What a scan opened: a recipe, plus the gift and its feedback form for packet labels.
struct OpenedRecipe: Equatable {
    var recipe: Recipe
    var gift: GiftInfo?
    var survey: GiftSurvey?
}

private struct RecipeResponse: Decodable { let recipe: Recipe }
private struct GiftResponse: Decodable { let gift: GiftInfo; let recipe: Recipe; let survey: GiftSurvey }

@MainActor
enum RecipeCode {
    enum Kind: Equatable { case recipe(String), gift(String) }

    static let host = "bot.franklintiffinroom.com"

    /// What a scanned QR code points at, or nil when it isn't an FTR code.
    static func kind(from payload: String) -> Kind? {
        let s = payload.trimmingCharacters(in: .whitespacesAndNewlines)
        if !s.contains("/") { return bare(s) }
        guard let url = URL(string: s), url.host?.lowercased() == host else { return nil }
        let parts = url.path.split(separator: "/").map(String.init)
        guard parts.count == 2 else { return nil }
        switch parts[0] {
        case "g": return isGift(parts[1]) ? .gift(parts[1].uppercased()) : nil
        case "r": return isToken(parts[1].lowercased()) ? .recipe(parts[1].lowercased()) : nil
        default: return nil
        }
    }

    /// A code typed or passed without the link (screenshot runs use this).
    private static func bare(_ s: String) -> Kind? {
        if isGift(s) { return .gift(s.uppercased()) }
        return isToken(s.lowercased()) ? .recipe(s.lowercased()) : nil
    }

    private static func isGift(_ s: String) -> Bool {
        let u = s.uppercased()
        return u == "CHEF-TEST" || u.range(of: "^[A-Z0-9]{2,8}-[0-9]{1,4}-[0-9A-Z]{8}$", options: .regularExpression) != nil
    }

    private static func isToken(_ s: String) -> Bool {
        s.range(of: "^[a-z0-9-]{4,40}$", options: .regularExpression) != nil
    }

    static func open(_ kind: Kind) async throws -> OpenedRecipe {
        switch kind {
        case .recipe(let token):
            let r: RecipeResponse = try await APIClient.shared.get("recipes/scan/\(token)")
            return OpenedRecipe(recipe: r.recipe)
        case .gift(let code):
            let r: GiftResponse = try await APIClient.shared.get("gift/\(code)")
            return OpenedRecipe(recipe: r.recipe, gift: r.gift, survey: r.survey)
        }
    }

    static func sendSurvey(code: String, answers: [String: String]) async throws {
        struct Body: Encodable { let answers: [String: String] }
        let _: APIClient.OK = try await APIClient.shared.post("gift/\(code)/survey", Body(answers: answers))
    }
}

/// The Home-screen card that opens the scanner.
struct ScanRecipeCard: View {
    @State private var showScan = false

    var body: some View {
        Button { showScan = true } label: {
            HStack(spacing: 14) {
                Image(systemName: "qrcode.viewfinder")
                    .font(.system(size: 28, weight: .regular))
                    .foregroundStyle(Palette.red)
                    .frame(width: 52, height: 52)
                    .background(Palette.leafSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text("SCAN A RECIPE QR")
                        .font(Typeface.display(17, relativeTo: .headline))
                        .foregroundStyle(Palette.ink)
                    Text("Got an FTR masala packet? Scan its code for Chef's recipe.")
                        .font(Typeface.body(13))
                        .foregroundStyle(Palette.muted)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .medium)).foregroundStyle(Palette.muted)
            }
            .padding(14)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Palette.line))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the camera to scan the QR code on an FTR masala packet")
        .fullScreenCover(isPresented: $showScan) { RecipeScanFlow() }
        .onAppear {
            // (Screenshot runs: -ftrScanToken <token> opens the recipe without the camera.)
            if ProcessInfo.processInfo.arguments.contains("-ftrScanToken") { showScan = true }
        }
    }
}

/// Camera → recipe. Full screen; Close at the top.
struct RecipeScanFlow: View {
    @Environment(\.dismiss) private var dismiss
    @State private var opened: OpenedRecipe?
    @State private var error: String?
    @State private var loading = false
    @State private var scanning = true

    private var testCode: RecipeCode.Kind? {
        let a = ProcessInfo.processInfo.arguments
        guard let i = a.firstIndex(of: "-ftrScanToken"), i + 1 < a.count else { return nil }
        return RecipeCode.kind(from: a[i + 1])
    }

    var body: some View {
        NavigationStack {
            Group {
                if let opened {
                    RecipeView(opened: Binding(get: { opened }, set: { self.opened = $0 }))
                } else if loading {
                    ProgressView("Opening Chef's recipe…").frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    scanner
                }
            }
            .background { (opened == nil ? Palette.bg : CG.sand).ignoresSafeArea() }
            .navigationTitle(opened == nil ? "Scan a recipe QR" : "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(opened == nil ? Palette.bg : CG.charcoal, for: .navigationBar)
            .toolbarBackground(opened == nil ? .automatic : .visible, for: .navigationBar)
            .toolbarColorScheme(opened == nil ? nil : .dark, for: .navigationBar)
            .tint(opened == nil ? Palette.red : CG.gold)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                if opened != nil {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Scan another") { opened = nil; error = nil; scanning = true }
                    }
                }
            }
        }
        .task {
            if let t = testCode { await open(t) }
        }
    }

    @ViewBuilder private var scanner: some View {
        VStack(spacing: 16) {
            if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                QRScanner(active: scanning) { payload in
                    guard scanning else { return }
                    if let t = RecipeCode.kind(from: payload) {
                        scanning = false
                        Task { await open(t) }
                    } else {
                        error = "That code isn't an FTR recipe. Look for the QR code on your FTR masala packet."
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Palette.goldLine, lineWidth: 2))
                .frame(maxHeight: 420)
                .accessibilityLabel("Camera view. Point it at the QR code on your FTR masala packet.")
            } else {
                Notice(tone: .warn, text: "This iPhone can't scan codes in the app. Check that FTR-DOSE is allowed to use the camera in Settings → Privacy & Security → Camera.")
            }
            Text("Point your camera at the QR code on your FTR masala packet. Each gift code opens on one phone only.")
                .font(Typeface.body(15))
                .foregroundStyle(Palette.muted)
                .multilineTextAlignment(.center)
            if let error {
                Notice(tone: .warn, text: error)
            }
            Spacer(minLength: 0)
        }
        .padding(20)
    }

    private func open(_ kind: RecipeCode.Kind) async {
        loading = true
        error = nil
        do {
            opened = try await RecipeCode.open(kind)
        } catch let e as APIError {
            error = e.message
            scanning = true
        } catch {
            self.error = "Couldn't open the recipe. Check your connection and scan again."
            scanning = true
        }
        loading = false
    }
}

/// VisionKit's live QR scanner.
private struct QRScanner: UIViewControllerRepresentable {
    let active: Bool
    let found: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isHighlightingEnabled: true
        )
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: DataScannerViewController, context: Context) {
        context.coordinator.found = found
        if active, !vc.isScanning { try? vc.startScanning() }
        if !active, vc.isScanning { vc.stopScanning() }
    }

    func makeCoordinator() -> Coordinator { Coordinator(found: found) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var found: (String) -> Void
        init(found: @escaping (String) -> Void) { self.found = found }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            for item in addedItems {
                if case .barcode(let code) = item, let s = code.payloadStringValue {
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    found(s)
                    return
                }
            }
        }
    }
}

// MARK: - Charcoal & Gold
// Chef's standard customer recipe-card template (from the FTR Recipe Cards work):
// charcoal header with the seal and a gold rule, gold-on-sand prep strip, ingredients
// in a cream card, Chef's notes with gold bars, method with charcoal circles and gold
// numbers, charcoal footer with the phone number. Fixed colours, like the printed card.

enum CG {
    static let charcoal = Color(uiColor: UIColor(hex: 0x2E2A26))
    static let gold = Color(uiColor: UIColor(hex: 0xD4A84A))
    static let sand = Color(uiColor: UIColor(hex: 0xF3EAD8))
    static let strip = Color(uiColor: UIColor(hex: 0xE6D3A8))
    static let card = Color(uiColor: UIColor(hex: 0xFFFCF5))
    static let cardLine = Color(uiColor: UIColor(hex: 0xDCCBA6))
    static let dots = Color(uiColor: UIColor(hex: 0xCDBB92))
    static let noteLine = Color(uiColor: UIColor(hex: 0xB9954A))
    static let stripInk = Color(uiColor: UIColor(hex: 0x5A4A2E))
    static let cream = Color(uiColor: UIColor(hex: 0xFBF6EC))
    static let creamSoft = Color(uiColor: UIColor(hex: 0xE8DCC2))
}


/// The recipe, as Chef wrote it, on the Charcoal & Gold card.
struct RecipeView: View {
    @Binding var opened: OpenedRecipe
    @State private var showSurvey = false
    private var recipe: Recipe { opened.recipe }

    private var kicker: String {
        if let g = opened.gift { return g.test ? "CHEF'S TEST CODE · REUSABLE" : "FRANKLIN TIFFIN ROOM · GIFT NO. \(g.label)" }
        return "FRANKLIN TIFFIN ROOM · RECIPE"
    }

    private var meta: [Recipe.Meta] {
        if let m = recipe.meta, !m.isEmpty { return m }
        var out: [Recipe.Meta] = []
        if let t = recipe.time, !t.isEmpty { out.append(.init(label: "Time", value: t)) }
        if let s = recipe.serves, !s.isEmpty { out.append(.init(label: "Serves", value: s)) }
        return out
    }

    private var notes: [String] {
        var n = recipe.notes ?? []
        if let tip = recipe.tip, !tip.isEmpty { n.append(tip) }
        return n
    }

    var body: some View {
        GeometryReader { geo in
            let wide = geo.size.width >= 700
            ScrollView {
                VStack(spacing: 0) {
                    header
                    if !meta.isEmpty { metaStrip }
                    Group {
                        if wide {
                            HStack(alignment: .top, spacing: 28) {
                                VStack(alignment: .leading, spacing: 18) { ingredients; notesBlock }
                                    .frame(width: 300)
                                VStack(alignment: .leading, spacing: 18) { method; feedback }
                            }
                        } else {
                            VStack(alignment: .leading, spacing: 22) { ingredients; notesBlock; method; feedback }
                        }
                    }
                    .padding(.horizontal, wide ? 32 : 18)
                    .padding(.vertical, 22)
                    .frame(maxWidth: 980)
                    footer
                }
                .frame(maxWidth: .infinity)
            }
            .background(CG.sand)
            .environment(\.colorScheme, .light)
        }
        .sheet(isPresented: $showSurvey) {
            if let g = opened.gift, let survey = opened.survey {
                GiftSurveyView(code: g.code, test: g.test, survey: survey) { answers in
                    opened.survey?.answers = answers
                    opened.survey?.done = true
                }
            }
        }
        .onAppear {
            if ProcessInfo.processInfo.arguments.contains("-ftrOpenSurvey"), opened.survey != nil { showSurvey = true }
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            Image("Seal").resizable().scaledToFit().frame(width: 80, height: 80)
                .accessibilityLabel("Franklin Tiffin Room seal")
            VStack(alignment: .leading, spacing: 4) {
                Text(kicker)
                    .font(Typeface.body(11, weight: .semibold, relativeTo: .caption))
                    .kerning(2.5)
                    .foregroundStyle(CG.gold)
                Text(recipe.title)
                    .font(Typeface.serif(32, relativeTo: .largeTitle))
                    .foregroundStyle(CG.cream)
                    .fixedSize(horizontal: false, vertical: true)
                if let sub = recipe.subtitle ?? recipe.intro, !sub.isEmpty {
                    Text(sub).font(Typeface.tagline(16)).foregroundStyle(CG.creamSoft)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 20)
        .frame(maxWidth: .infinity)
        .background(CG.charcoal)
        .overlay(alignment: .bottom) { Rectangle().fill(CG.gold).frame(height: 5) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private var metaStrip: some View {
        HStack(spacing: 8) {
            ForEach(meta, id: \.label) { m in
                VStack(spacing: 2) {
                    Text(m.label.uppercased())
                        .font(Typeface.body(11, relativeTo: .caption2)).kerning(2)
                        .foregroundStyle(CG.stripInk)
                    Text(m.value)
                        .font(Typeface.serif(17, bold: false, relativeTo: .headline))
                        .foregroundStyle(CG.charcoal)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(CG.strip)
    }

    @ViewBuilder private var ingredients: some View {
        if !recipe.ingredients.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text("Ingredients").font(Typeface.serif(20, relativeTo: .title3)).foregroundStyle(CG.charcoal)
                    .padding(.bottom, 8)
                    .accessibilityAddTraits(.isHeader)
                ForEach(Array(recipe.ingredients.enumerated()), id: \.offset) { i, line in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(line).font(Typeface.body(15)).foregroundStyle(CG.charcoal)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 8)
                        if let a = amount(i) {
                            Text(a).font(Typeface.body(15, weight: .bold)).foregroundStyle(CG.charcoal)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                    .padding(.vertical, 6)
                    .overlay(alignment: .bottom) {
                        DottedRule().stroke(CG.dots, style: StrokeStyle(lineWidth: 1, dash: [1.5, 2.5])).frame(height: 1)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(CG.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(CG.cardLine))
        }
    }

    @ViewBuilder private var notesBlock: some View {
        if !notes.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Chef's notes").font(Typeface.serif(18, relativeTo: .headline)).foregroundStyle(CG.charcoal)
                    .accessibilityAddTraits(.isHeader)
                ForEach(Array(notes.enumerated()), id: \.offset) { _, n in
                    Text(n).font(Typeface.body(15)).foregroundStyle(CG.charcoal)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.leading, 12)
                        .overlay(alignment: .leading) { Rectangle().fill(CG.noteLine).frame(width: 3) }
                }
            }
            .padding(.horizontal, 4)
        }
    }

    private var method: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Method").font(Typeface.serif(20, relativeTo: .title3)).foregroundStyle(CG.charcoal)
                .accessibilityAddTraits(.isHeader)
            ForEach(Array(recipe.steps.enumerated()), id: \.offset) { i, step in
                HStack(alignment: .top, spacing: 12) {
                    Text("\(i + 1)")
                        .font(Typeface.body(14, weight: .bold))
                        .foregroundStyle(CG.gold)
                        .frame(width: 28, height: 28)
                        .background(CG.charcoal, in: Circle())
                        .accessibilityLabel("Step \(i + 1)")
                    stepText(step)
                        .font(Typeface.body(16)).foregroundStyle(CG.charcoal)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    @ViewBuilder private var feedback: some View {
        if let survey = opened.survey {
            VStack(alignment: .leading, spacing: 10) {
                Text("How was it?").font(Typeface.serif(20, relativeTo: .title3)).foregroundStyle(CG.charcoal)
                    .accessibilityAddTraits(.isHeader)
                Text(survey.done
                     ? "Thank you for your feedback! You can update it any time."
                     : "Once you've made it, tell Chef what was right and what was wrong. Every answer helps FTR get better.")
                    .font(Typeface.body(15)).foregroundStyle(CG.stripInk)
                    .fixedSize(horizontal: false, vertical: true)
                Button { showSurvey = true } label: {
                    Text(survey.done ? "Update my feedback" : "Share my feedback")
                        .font(Typeface.body(17, weight: .bold))
                        .foregroundStyle(CG.gold)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(CG.charcoal, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            .padding(.top, 4)
        }
    }

    private var footer: some View {
        HStack(alignment: .center) {
            Text("100% vegetarian · Somerset, NJ").font(Typeface.body(13)).foregroundStyle(CG.cream)
            Spacer(minLength: 8)
            Link("1-234-FTR-DOSE", destination: URL(string: "tel:+12343873673")!)
                .font(Typeface.serif(17, relativeTo: .headline))
                .foregroundStyle(CG.gold)
                .accessibilityLabel("Call FTR, 1-234-387-3673")
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity)
        .background(CG.charcoal)
    }

    private func amount(_ i: Int) -> String? {
        guard let a = recipe.amounts, i < a.count, !a[i].isEmpty else { return nil }
        return a[i]
    }

    /// "Paste: In a blender…" shows the step name in bold, like the printed card ("Paste. In a blender…").
    private func stepText(_ step: String) -> Text {
        if let r = step.range(of: ": "), step.distance(from: step.startIndex, to: r.lowerBound) <= 24 {
            return Text(String(step[..<r.lowerBound]) + ". ").bold() + Text(String(step[r.upperBound...]))
        }
        return Text(step)
    }
}

private struct DottedRule: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.midY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return p
    }
}

/// Chef's feedback questions for a gift packet.
struct GiftSurveyView: View {
    @Environment(\.dismiss) private var dismiss
    let code: String
    let test: Bool
    let survey: GiftSurvey
    let saved: ([String: String]) -> Void
    @State private var answers: [String: String] = [:]
    @State private var sending = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if test {
                    Section { Text("Chef's test code: answers aren't saved.").font(Typeface.body(14)).foregroundStyle(Palette.muted) }
                }
                ForEach(survey.questions) { q in
                    Section {
                        if let opts = q.options {
                            if opts.allSatisfy({ $0.count <= 2 }) {
                                Picker(q.label, selection: binding(q.key)) {
                                    ForEach(opts, id: \.self) { o in Text(o).tag(o) }
                                }
                                .pickerStyle(.segmented)
                                .labelsHidden()
                            } else {
                                Picker(q.label, selection: binding(q.key)) {
                                    Text("Choose").tag("")
                                    ForEach(opts, id: \.self) { o in Text(o).tag(o) }
                                }
                                .pickerStyle(.menu)
                                .labelsHidden()
                            }
                        } else {
                            TextField("Your answer", text: binding(q.key), axis: .vertical)
                                .lineLimit(2...6)
                        }
                    } header: {
                        Text(q.label).font(Typeface.body(14, weight: .semibold)).textCase(nil).foregroundStyle(Palette.ink)
                    }
                }
                if let error {
                    Section { Notice(tone: .warn, text: error) }
                }
            }
            .scrollContentBackground(.hidden)
            .screenBackground()
            .navigationTitle("How was your BBB?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if sending { ProgressView() } else { Button("Send") { Task { await send() } }.bold() }
                }
            }
        }
        .onAppear { answers = survey.answers }
    }

    private func binding(_ key: String) -> Binding<String> {
        Binding(get: { answers[key] ?? "" }, set: { answers[key] = $0 })
    }

    private func send() async {
        sending = true
        error = nil
        do {
            try await RecipeCode.sendSurvey(code: code, answers: answers)
            saved(answers)
            dismiss()
        } catch let e as APIError {
            error = e.message
        } catch {
            self.error = "Couldn't send your feedback. Check your connection and try again."
        }
        sending = false
    }
}
