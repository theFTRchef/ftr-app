import SwiftUI
import VisionKit

// MARK: - Recipe QR codes
//
// Two kinds of codes open a recipe here, and nothing shows without a scan:
//  - gift labels on FTR-BBB Powder packets: https://bot.franklintiffinroom.com/g/T50-017-XXXXXXXX
//    (single use: the first phone to open one keeps it; CHEF-TEST is Chef's reusable test code)
//  - recipe codes made in Chef's Kitchen: https://bot.franklintiffinroom.com/r/<token>

struct Recipe: Decodable, Equatable {
    var title: String
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
            .screenBackground()
            .navigationTitle(opened == nil ? "Scan a recipe QR" : "")
            .navigationBarTitleDisplayMode(.inline)
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

/// The recipe, as Chef wrote it.
struct RecipeView: View {
    @Binding var opened: OpenedRecipe
    @State private var showSurvey = false
    private var recipe: Recipe { opened.recipe }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    if let g = opened.gift {
                        Text(g.test ? "CHEF'S TEST CODE" : "FTR GIFT NO. \(g.label)")
                            .font(Typeface.body(11, weight: .bold, relativeTo: .caption))
                            .kerning(1)
                            .foregroundStyle(Palette.red)
                    } else if let p = recipe.powder, !p.isEmpty {
                        Text(p.uppercased())
                            .font(Typeface.body(11, weight: .bold, relativeTo: .caption))
                            .kerning(1)
                            .foregroundStyle(Palette.red)
                    }
                    Text(recipe.title.uppercased())
                        .font(Typeface.display(30, relativeTo: .largeTitle))
                        .foregroundStyle(Palette.ink)
                    if let intro = recipe.intro, !intro.isEmpty {
                        Text(intro).font(Typeface.tagline(16)).foregroundStyle(Palette.muted)
                    }
                    HStack(spacing: 14) {
                        if let s = recipe.serves, !s.isEmpty { Label("Serves \(s)", systemImage: "person.2") }
                        if let t = recipe.time, !t.isEmpty { Label(t, systemImage: "clock") }
                    }
                    .font(Typeface.body(14, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                    .padding(.top, 4)
                }

                if !recipe.ingredients.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("INGREDIENTS").font(Typeface.display(18, relativeTo: .title3)).foregroundStyle(Palette.ink)
                        ForEach(Array(recipe.ingredients.enumerated()), id: \.offset) { i, line in
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Circle().fill(Palette.goldLine).frame(width: 6, height: 6).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                                Text(line).font(Typeface.body(16)).foregroundStyle(Palette.ink)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 8)
                                if let a = amount(i) {
                                    Text(a).font(Typeface.body(15, weight: .semibold)).foregroundStyle(Palette.ink)
                                        .multilineTextAlignment(.trailing)
                                }
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Palette.line))
                }

                VStack(alignment: .leading, spacing: 14) {
                    Text("METHOD").font(Typeface.display(18, relativeTo: .title3)).foregroundStyle(Palette.ink)
                    ForEach(Array(recipe.steps.enumerated()), id: \.offset) { i, step in
                        HStack(alignment: .top, spacing: 12) {
                            Text("\(i + 1)")
                                .font(Typeface.body(14, weight: .bold))
                                .foregroundStyle(Palette.leafInk)
                                .frame(width: 28, height: 28)
                                .background(Palette.leaf, in: Circle())
                                .accessibilityLabel("Step \(i + 1)")
                            stepText(step)
                                .font(Typeface.body(16)).foregroundStyle(Palette.ink)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }

                if let tip = recipe.tip, !tip.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("CHEF'S TIP").font(Typeface.body(11, weight: .bold, relativeTo: .caption)).kerning(1).foregroundStyle(Palette.turmericInk)
                        Text(tip).font(Typeface.body(15)).foregroundStyle(Palette.ink)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Palette.turmericSoft, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }

                if let survey = opened.survey {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("HOW WAS IT?").font(Typeface.display(18, relativeTo: .title3)).foregroundStyle(Palette.ink)
                        Text(survey.done
                             ? "Thank you for your feedback! You can update it any time."
                             : "Once you've made it, tell Chef what was right and what was wrong. Every answer helps FTR get better.")
                            .font(Typeface.body(15)).foregroundStyle(Palette.muted)
                        Button(survey.done ? "Update my feedback" : "Share my feedback") { showSurvey = true }
                            .buttonStyle(PrimaryButtonStyle())
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
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

    private func amount(_ i: Int) -> String? {
        guard let a = recipe.amounts, i < a.count, !a[i].isEmpty else { return nil }
        return a[i]
    }

    /// "Paste: In a blender…" shows the short title in bold.
    private func stepText(_ step: String) -> Text {
        if let r = step.range(of: ": "), step.distance(from: step.startIndex, to: r.lowerBound) <= 24 {
            return Text(String(step[..<r.lowerBound]) + ": ").bold() + Text(String(step[r.upperBound...]))
        }
        return Text(step)
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
                            Picker(q.label, selection: binding(q.key)) {
                                Text("Choose").tag("")
                                ForEach(opts, id: \.self) { Text($0).tag($0) }
                            }
                            .pickerStyle(opts.count <= 5 && opts.allSatisfy { $0.count <= 2 } ? .segmented : .menu)
                            .labelsHidden()
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
