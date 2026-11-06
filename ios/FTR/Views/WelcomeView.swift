import SwiftUI

// MARK: - Welcome

/// The first screen: the FTR seal draws itself in, a lotus opens under folded
/// hands ("Namaste, welcome to FTR"), then the Enter FTR button rises in.
/// Plays once per launch; tap anywhere to skip. Static with Reduce Motion.
struct WelcomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let enter: () -> Void

    @State private var start = Date()
    @State private var skipped = false
    @State private var done = false

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 60, paused: reduceMotion || skipped || done)) { context in
            let t = (reduceMotion || skipped || done) ? WelcomeTimeline.end : context.date.timeIntervalSince(start)
            content(WelcomeTimeline(t: t))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .screenBackground()
        .contentShape(Rectangle())
        .onTapGesture { skipped = true }
        .task {
            start = Date()
            try? await Task.sleep(for: .seconds(WelcomeTimeline.end + 0.1))
            done = true
        }
    }

    @ViewBuilder
    private func content(_ tl: WelcomeTimeline) -> some View {
        GeometryReader { geo in
            let seal = min(270, geo.size.width - 96, geo.size.height * 0.36)
            VStack(spacing: 0) {
                Spacer(minLength: 12)
                VStack(spacing: 8) {
                    LotusNamaste(tl: tl).frame(width: 170, height: 152)
                    Text("Namaste")
                        .font(.custom("Fraunces-MediumItalic", size: 30, relativeTo: .largeTitle))
                        .foregroundStyle(Palette.ink)
                    Text("WELCOME TO FTR")
                        .font(.custom("JosefinSans-SemiBold", size: 13, relativeTo: .footnote))
                        .kerning(3)
                        .foregroundStyle(Palette.muted)
                }
                .opacity(tl.hello)
                .offset(y: (1 - tl.hello) * 8)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Namaste, welcome to FTR")
                .padding(.bottom, 26)

                AnimatedSeal(tl: tl).frame(width: seal, height: seal)

                Text("Multi-cuisine personal chef in Somerset, NJ")
                    .font(Typeface.tagline(17))
                    .foregroundStyle(Palette.muted)
                    .multilineTextAlignment(.center)
                    .padding(.top, 28)
                    .padding(.horizontal, 28)
                VegMark().foregroundStyle(Palette.sage).padding(.top, 10)
                Spacer(minLength: 16)

                Group {
                    if let err = model.loadError, model.config == nil {
                        VStack(spacing: 12) {
                            Text(err)
                                .font(Typeface.body(15))
                                .foregroundStyle(Palette.muted)
                                .multilineTextAlignment(.center)
                            Button("Try again") { Task { await model.loadMenu() } }
                                .buttonStyle(SecondaryButtonStyle())
                        }
                    } else {
                        Button(action: enter) {
                            if model.config == nil { ProgressView().tint(Palette.leafInk) } else { Text("Enter FTR") }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(model.config == nil)
                    }
                }
                .padding(.horizontal, 28)
                .opacity(tl.button)
                .offset(y: (1 - tl.button) * 10)
                .allowsHitTesting(tl.button > 0.5)
                Spacer().frame(height: 40)
            }
            .frame(width: geo.size.width)
        }
    }
}

/// Where each part of the welcome animation is at time `t` (seconds).
/// Same choreography as the approved design, played once, about 5 seconds.
struct WelcomeTimeline {
    static let end: Double = 5.4
    let t: Double

    private func p(_ a: Double, _ b: Double) -> Double {
        let x = min(max((t - a) / (b - a), 0), 1)
        return 1 - pow(1 - x, 3) // ease out
    }
    private func ease(_ a: Double, _ b: Double) -> Double {
        let x = min(max((t - a) / (b - a), 0), 1)
        return x < 0.5 ? 4 * x * x * x : 1 - pow(-2 * x + 2, 3) / 2 // ease in-out
    }

    var outlineDraw: Double { ease(0, 1.55) }
    var outlineOpacity: Double { 1 - p(1.55, 2.2) }
    var fill: Double { p(1.45, 2.2) }
    var words: Double { p(2.1, 2.85) }
    var ftrOpacity: Double { p(2.75, 3.2) }
    /// FTR rises 14pt, overshoots a little, settles.
    var ftrOffset: Double {
        if t < 2.75 { return 14 }
        if t < 3.25 { return 14 - 16 * p(2.75, 3.25) }
        return -2 + 2 * p(3.25, 3.6)
    }
    var ftrScale: Double {
        if t < 2.75 { return 0.9 }
        if t < 3.25 { return 0.9 + 0.13 * p(2.75, 3.25) }
        return 1.03 - 0.03 * p(3.25, 3.6)
    }
    var since: Double { p(3.6, 4.2) }
    var hello: Double { p(3.3, 3.65) }
    var petalCenter: Double { p(3.4, 3.75) }
    var petalSide: Double { p(3.45, 3.9) }
    var petalOuter: Double { p(3.55, 4.05) }
    var hands: Double { p(3.5, 4.3) }
    var button: Double { p(4.5, 5.1) }
}

/// The seal, built from its layers so each part can arrive on its own.
struct AnimatedSeal: View {
    let tl: WelcomeTimeline

    var body: some View {
        GeometryReader { geo in
            let s = geo.size.width / 300
            ZStack {
                Image("SealRing").resizable().opacity(tl.fill)
                Image("SealWords").resizable().opacity(tl.words)
                Image("SealDisc").resizable().opacity(tl.fill)
                Image("SealFtr").resizable()
                    .opacity(tl.ftrOpacity)
                    .scaleEffect(tl.ftrScale, anchor: UnitPoint(x: 0.5, y: 130.0 / 300))
                    .offset(y: tl.ftrOffset * s)
                Image("SealSince").resizable().opacity(tl.since)
                Circle()
                    .trim(from: 0, to: tl.outlineDraw)
                    .stroke(Palette.forest, style: StrokeStyle(lineWidth: 3 * s, lineCap: .round))
                    .padding(4 * s)
                    .opacity(tl.outlineOpacity)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("FTR seal: Franklin Tiffin Room, since 2025, NJ USA, bringing back the OG flavor of Masale Dose")
    }
}

/// Mehndi namaste hands (licensed from OlyvaDesign, Etsy order 4224628634)
/// rising from a lotus whose petals open in front of the wrists.
struct LotusNamaste: View {
    let tl: WelcomeTimeline
    @Environment(\.colorScheme) private var scheme

    private static let petalC = SVGPath.parse("M55 100 C47 90 47 78 55 68 C63 78 63 90 55 100 Z")
    private static let petalL = SVGPath.parse("M55 100 C40 98 30 88 28 76 C40 78 50 86 55 100 Z")
    private static let petalR = SVGPath.parse("M55 100 C70 98 80 88 82 76 C70 78 60 86 55 100 Z")
    private static let petalLL = SVGPath.parse("M55 100 C36 102 18 96 10 86 C26 84 44 90 55 100 Z")
    private static let petalRR = SVGPath.parse("M55 100 C74 102 92 96 100 86 C84 84 66 90 55 100 Z")

    var body: some View {
        ZStack(alignment: .top) {
            Image("NamasteHands")
                .renderingMode(.template)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(width: 112, height: 131)
                .foregroundStyle(scheme == .dark ? Palette.cream : Color.black)
                .opacity(tl.hands)
                .offset(y: (1 - tl.hands) * 10)

            Canvas { ctx, size in
                // Lotus drawn from its 98 x 40 box (6...104, 64...104).
                let k = size.width / 98
                ctx.scaleBy(x: k, y: k)
                ctx.translateBy(x: -6, y: -64)
                let origin = CGPoint(x: 55, y: 100)
                func petal(_ base: GraphicsContext, _ path: Path, _ color: UInt32, _ amount: Double, rotate: Double, scaleFrom: Double, alpha: Double) {
                    guard amount > 0 else { return }
                    var c = base
                    c.opacity = amount * alpha
                    c.translateBy(x: origin.x, y: origin.y)
                    c.rotate(by: .degrees(rotate * (1 - amount)))
                    let sc = scaleFrom + (1 - scaleFrom) * amount
                    c.scaleBy(x: sc, y: sc)
                    c.translateBy(x: -origin.x, y: -origin.y)
                    c.fill(path, with: .color(Color(UIColor(hex: color))))
                }
                petal(ctx, Self.petalLL, 0xA4483F, tl.petalOuter, rotate: 60, scaleFrom: 0.4, alpha: 0.75)
                petal(ctx, Self.petalRR, 0xA4483F, tl.petalOuter, rotate: -60, scaleFrom: 0.4, alpha: 0.75)
                petal(ctx, Self.petalL, 0xD9A99A, tl.petalSide, rotate: 40, scaleFrom: 0.4, alpha: 1)
                petal(ctx, Self.petalR, 0xD9A99A, tl.petalSide, rotate: -40, scaleFrom: 0.4, alpha: 1)
                petal(ctx, Self.petalC, 0xE7C9BD, tl.petalCenter, rotate: 0, scaleFrom: 0.2, alpha: 1)
            }
            .frame(width: 170, height: 69)
            .offset(y: 83)
        }
        .frame(width: 170, height: 152, alignment: .top)
        .accessibilityHidden(true)
    }
}

/// Just enough SVG path syntax for our drawings: absolute M, L, H, V, C, Z.
enum SVGPath {
    static func parse(_ d: String) -> Path {
        var path = Path()
        var tokens: [String] = []
        var number = ""
        for ch in d {
            if ch.isLetter {
                if !number.isEmpty { tokens.append(number); number = "" }
                tokens.append(String(ch))
            } else if ch == " " || ch == "," {
                if !number.isEmpty { tokens.append(number); number = "" }
            } else if ch == "-" && !number.isEmpty {
                tokens.append(number); number = "-"
            } else {
                number.append(ch)
            }
        }
        if !number.isEmpty { tokens.append(number) }

        var i = 0
        var cmd = "M"
        var current = CGPoint.zero
        func next() -> CGFloat { defer { i += 1 }; return CGFloat(Double(tokens[i]) ?? 0) }
        while i < tokens.count {
            if let c = tokens[i].first, c.isLetter { cmd = tokens[i]; i += 1; if cmd == "Z" || cmd == "z" { path.closeSubpath(); continue } }
            switch cmd {
            case "M":
                current = CGPoint(x: next(), y: next()); path.move(to: current); cmd = "L"
            case "L":
                current = CGPoint(x: next(), y: next()); path.addLine(to: current)
            case "H":
                current.x = next(); path.addLine(to: current)
            case "V":
                current.y = next(); path.addLine(to: current)
            case "C":
                let c1 = CGPoint(x: next(), y: next()), c2 = CGPoint(x: next(), y: next())
                current = CGPoint(x: next(), y: next())
                path.addCurve(to: current, control1: c1, control2: c2)
            default:
                i += 1
            }
        }
        return path
    }
}
