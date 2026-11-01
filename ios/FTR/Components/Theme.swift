import SwiftUI
import UIKit

/// FTR brand palette - taken from the FTR catering flyers:
/// cream paper, forest green, chili red, marigold gold.
enum Palette {
    static let bg = dyn(0xFFFBF3, 0x111A14)          // flyer cream
    static let surface = dyn(0xFFFFFF, 0x18241C)
    static let surface2 = dyn(0xF6EEDD, 0x213027)
    static let line = dyn(0xE8DCC4, 0x2F3F34)        // flyer card border
    static let ink = dyn(0x1E3A27, 0xFFF6E6)         // forest green text
    static let muted = dyn(0x4A5A4E, 0xB3BCAF)
    static let red = dyn(0xC8463F, 0xE8675E)         // FRANKLIN red, flyer headings
    static let forest = dyn(0x1E3A27, 0x1E3A27)      // TIFFIN ROOM pill (same in both themes)
    static let cream = dyn(0xFFF6E6, 0xFFF6E6)
    // Action color: forest green buttons on cream; marigold buttons in dark mode.
    static let leaf = dyn(0x1E3A27, 0xF2C14E)
    static let leafInk = dyn(0xFFF6E6, 0x1E3A27)
    static let leafSoft = dyn(0xE6EDE4, 0x22362A)
    static let turmeric = dyn(0xF2C14E, 0xF2C14E)    // flyer gold
    static let turmericSoft = dyn(0xFBEFD0, 0x3A2F14)
    static let turmericInk = dyn(0x7A5200, 0xF6D38A)
    static let goldLine = dyn(0xE3A72F, 0xE3A72F)
    static let chili = dyn(0xC8463F, 0xE8675E)
    static let chiliSoft = dyn(0xF8DDD6, 0x43231D)
    static let bad = dyn(0xB23A2C, 0xF08A7C)
    static let veg = dyn(0x2E7D3A, 0x6CC196)         // 100% vegetarian mark

    private static func dyn(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

/// The flyer type: Fraunces for headings, Outfit for reading, Josefin Sans for the
/// logo and phone number - bundled (OFL), scaled with Dynamic Type.
enum Typeface {
    static func display(_ size: CGFloat, relativeTo style: Font.TextStyle = .title) -> Font {
        .custom("Fraunces-Bold", size: size, relativeTo: style)
    }
    static func tagline(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom("Fraunces-SemiBoldItalic", size: size, relativeTo: style)
    }
    static func logo(_ size: CGFloat, bold: Bool = false, relativeTo style: Font.TextStyle = .title) -> Font {
        .custom(bold ? "JosefinSans-Bold" : "JosefinSans-SemiBold", size: size, relativeTo: style)
    }
    static func body(_ size: CGFloat = 16, weight: Weight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(weight.fontName, size: size, relativeTo: style)
    }
    enum Weight {
        case regular, semibold, bold
        var fontName: String {
            switch self {
            case .regular: "Outfit-Regular"
            case .semibold: "Outfit-SemiBold"
            case .bold: "Outfit-Bold"
            }
        }
    }

    static func configureAppearance() {
        let nav = UINavigationBarAppearance()
        nav.configureWithDefaultBackground()
        nav.backgroundColor = UIColor(Palette.bg)
        nav.shadowColor = .clear
        if let large = UIFont(name: "Fraunces-Bold", size: 32) {
            nav.largeTitleTextAttributes = [.font: UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: large), .foregroundColor: UIColor(Palette.ink)]
        }
        if let small = UIFont(name: "Outfit-SemiBold", size: 17) {
            nav.titleTextAttributes = [.font: UIFontMetrics(forTextStyle: .headline).scaledFont(for: small), .foregroundColor: UIColor(Palette.ink)]
        }
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav

        let tab = UITabBarAppearance()
        tab.configureWithDefaultBackground()
        tab.backgroundColor = UIColor(Palette.surface)
        if let f = UIFont(name: "Outfit-Medium", size: 11) {
            for layout in [tab.stackedLayoutAppearance, tab.inlineLayoutAppearance, tab.compactInlineLayoutAppearance] {
                layout.normal.titleTextAttributes = [.font: f]
                layout.selected.titleTextAttributes = [.font: f]
            }
        }
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }
}

// MARK: - Buttons

struct PrimaryButtonStyle: ButtonStyle {
    var tint: Color = Palette.leaf
    var ink: Color = Palette.leafInk
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Typeface.body(17, weight: .bold, relativeTo: .headline))
            .foregroundStyle(ink)
            .frame(maxWidth: .infinity, minHeight: 52)
            .padding(.horizontal, 16)
            .background(tint.opacity(enabled ? 1 : 0.4), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Typeface.body(16, weight: .semibold))
            .foregroundStyle(Palette.leaf)
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.horizontal, 14)
            .background(Palette.leafSoft.opacity(configuration.isPressed ? 0.7 : 1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

// MARK: - Small pieces

/// The FTR logo exactly as on the flyers: "FRANKLIN" in red under a red corner
/// bracket, with "TIFFIN ROOM" on a forest-green pill below it.
struct FTRLogo: View {
    /// Height of the FRANKLIN letters; everything else scales from it.
    var size: CGFloat = 32

    var body: some View {
        VStack(spacing: size * 0.13) {
            Text("FRANKLIN")
                .font(.custom("JosefinSans-SemiBold", fixedSize: size))
                .kerning(size * 0.065)
                .foregroundStyle(Palette.red)
                .padding(.top, size * 0.13)
                .padding(.trailing, size * 0.26)
                .overlay(alignment: .topTrailing) {
                    Bracket().stroke(Palette.red, style: StrokeStyle(lineWidth: max(1.5, size * 0.11), lineCap: .square))
                }
            Text("TIFFIN ROOM")
                .font(.custom("JosefinSans-Bold", fixedSize: size * 0.48))
                .kerning(size * 0.045)
                .foregroundStyle(Palette.cream)
                .padding(.horizontal, size * 0.39)
                .padding(.top, size * 0.15)
                .padding(.bottom, size * 0.09)
                .background(Palette.forest, in: RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
        }
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Franklin Tiffin Room")
    }

    /// Top edge and right edge, like the flyer's border-top + border-right.
    private struct Bracket: Shape {
        func path(in r: CGRect) -> Path {
            var p = Path()
            p.move(to: CGPoint(x: r.minX, y: r.minY))
            p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
            p.addLine(to: CGPoint(x: r.maxX, y: r.maxY * 0.92))
            return p
        }
    }
}

/// Small FTR monogram for tight spots (toolbar, message avatars): the app icon in miniature.
struct BrandMark: View {
    var size: CGFloat = 34
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.24, style: .continuous).fill(Palette.forest)
            Text("FTR")
                .font(.custom("JosefinSans-Bold", fixedSize: size * 0.38))
                .kerning(size * 0.02)
                .foregroundStyle(Palette.cream)
                .offset(y: size * 0.1)
            Path { p in
                p.move(to: CGPoint(x: size * 0.56, y: size * 0.16))
                p.addLine(to: CGPoint(x: size * 0.85, y: size * 0.16))
                p.addLine(to: CGPoint(x: size * 0.85, y: size * 0.34))
            }
            .stroke(Color(UIColor(hex: 0xE8675E)), style: StrokeStyle(lineWidth: max(1.5, size * 0.07), lineCap: .square))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The flyers' "100% Vegetarian" mark.
struct VegMark: View {
    var body: some View {
        HStack(spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 3).strokeBorder(Palette.veg, lineWidth: 2).frame(width: 18, height: 18)
                Circle().fill(Palette.veg).frame(width: 8, height: 8)
            }
            Text("100% Vegetarian").font(Typeface.body(13, weight: .semibold, relativeTo: .caption))
        }
        .accessibilityElement(children: .combine)
    }
}

struct Panel<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Palette.line, lineWidth: 1))
    }
}

struct Notice: View {
    enum Tone { case info, warn, bad }
    var tone: Tone = .info
    var icon: String = "info.circle"
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: icon).foregroundStyle(fg)
            Text(text).font(Typeface.body(15)).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(bg, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
    private var fg: Color { tone == .info ? Palette.leaf : tone == .warn ? Palette.turmericInk : Palette.bad }
    private var bg: Color { tone == .info ? Palette.leafSoft : tone == .warn ? Palette.turmericSoft : Palette.chiliSoft }
}

struct StatusPill: View {
    let order: Order
    var body: some View {
        Text(label)
            .font(Typeface.body(13, weight: .semibold, relativeTo: .caption))
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .foregroundStyle(fg)
            .background(bg, in: Capsule())
            .lineLimit(1)
            .fixedSize()
    }
    private var label: String {
        switch order.stage {
        case .deposit_due: "Deposit due"
        case .quote_ready: "Quote ready"
        case .deposit_review: "Checking deposit"
        case .confirmed: "Confirmed"
        case .closed: order.status.contains("Released") ? "Released" : "Not booked"
        case .quote_requested: "Awaiting quote"
        default: "With Chef"
        }
    }
    private var fg: Color {
        switch order.stage {
        case .deposit_due, .quote_ready: Palette.turmericInk
        case .confirmed: Palette.leaf
        case .closed: Palette.bad
        default: Palette.muted
        }
    }
    private var bg: Color {
        switch order.stage {
        case .deposit_due, .quote_ready: Palette.turmericSoft
        case .confirmed: Palette.leafSoft
        case .closed: Palette.chiliSoft
        default: Palette.surface2
        }
    }
}

extension View {
    func screenBackground() -> some View {
        background(Palette.bg.ignoresSafeArea())
    }
}
