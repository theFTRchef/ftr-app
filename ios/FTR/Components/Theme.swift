import SwiftUI
import UIKit

/// FTR brand palette - "Warm Sand": sand paper, cocoa ink, soft brick buttons,
/// with the charcoal + gold of the FTR kitchen seal.
enum Palette {
    static let bg = dyn(0xF7F1E8, 0x1F1B18)          // warm sand
    static let surface = dyn(0xFFFDF9, 0x2A2521)
    static let surface2 = dyn(0xEEE6D8, 0x35302B)    // soft sand panels
    static let photo = dyn(0xE9DFCF, 0x3A342E)       // where Chef's photos go
    static let line = dyn(0xE4D8C6, 0x433C35)
    static let ink = dyn(0x3E2C28, 0xF3EBDD)         // cocoa text
    static let muted = dyn(0x6E5D55, 0xBFB2A3)
    static let red = dyn(0xA4483F, 0xE08A7E)         // soft brick
    static let forest = dyn(0x2E2A26, 0x2E2A26)      // seal charcoal (same in both themes)
    static let cream = dyn(0xF3EBDD, 0xF3EBDD)       // text on charcoal
    static let beige = dyn(0xEFE3CC, 0xEFE3CC)       // seal center
    // Action color: brick buttons with white text; lighter brick with charcoal text in dark mode.
    static let leaf = dyn(0xA4483F, 0xE08A7E)
    static let leafInk = dyn(0xFFFFFF, 0x2E2A26)
    static let leafSoft = dyn(0xF3DED9, 0x432823)
    static let sage = dyn(0x4F6B57, 0x9CC0A6)        // quiet second color: confirmed, info
    static let sageSoft = dyn(0xE3EADF, 0x26332A)
    static let chipOn = dyn(0x3E2C28, 0xF3EBDD)
    static let chipOnInk = dyn(0xF7F1E8, 0x2E2A26)
    static let turmeric = dyn(0xB9954A, 0xD9B76A)    // seal gold
    static let turmericSoft = dyn(0xF1E2C4, 0x3A2F1A)
    static let turmericInk = dyn(0x6B4A1E, 0xE9C77B)
    static let gold = dyn(0xE9C77B, 0xE9C77B)        // seal lettering
    static let deepGold = dyn(0x9C7220, 0x9C7220)    // FTR in the seal
    static let goldLine = dyn(0xB9954A, 0xB9954A)
    static let chili = dyn(0xA4483F, 0xE08A7E)
    static let chiliSoft = dyn(0xF3DED9, 0x43231D)
    static let bad = dyn(0x9E3A2E, 0xF08A7C)
    static let veg = dyn(0x4F6B57, 0x9CC0A6)         // 100% vegetarian mark

    private static func dyn(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

/// Warm Sand type: Oswald Medium for headlines, Archivo for reading, Fraunces italic
/// for the slogan, Josefin Sans for small brand lettering - bundled (OFL), scaled with Dynamic Type.
enum Typeface {
    static func display(_ size: CGFloat, relativeTo style: Font.TextStyle = .title) -> Font {
        .custom("Oswald-Medium", size: size, relativeTo: style)
    }
    static func tagline(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom("Fraunces-MediumItalic", size: size, relativeTo: style)
    }
    /// Fraunces upright, for Chef's Charcoal & Gold recipe cards.
    static func serif(_ size: CGFloat, bold: Bool = true, relativeTo style: Font.TextStyle = .title) -> Font {
        .custom(bold ? "Fraunces-Bold" : "Fraunces-SemiBold", size: size, relativeTo: style)
    }
    static func logo(_ size: CGFloat, bold: Bool = false, relativeTo style: Font.TextStyle = .title) -> Font {
        .custom(bold ? "JosefinSans-Bold" : "JosefinSans-SemiBold", size: size, relativeTo: style)
    }
    static func body(_ size: CGFloat = 16, weight: Weight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(weight.fontName, size: size, relativeTo: style)
    }
    /// Softer than before: "bold" is Archivo SemiBold, "semibold" is Archivo Medium.
    enum Weight {
        case regular, semibold, bold
        var fontName: String {
            switch self {
            case .regular: "Archivo-Regular"
            case .semibold: "Archivo-Medium"
            case .bold: "Archivo-SemiBold"
            }
        }
    }

    static func configureAppearance() {
        let nav = UINavigationBarAppearance()
        nav.configureWithDefaultBackground()
        nav.backgroundColor = UIColor(Palette.bg)
        nav.shadowColor = .clear
        if let large = UIFont(name: "Oswald-Medium", size: 32) {
            nav.largeTitleTextAttributes = [.font: UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: large), .foregroundColor: UIColor(Palette.ink)]
        }
        if let small = UIFont(name: "Archivo-SemiBold", size: 17) {
            nav.titleTextAttributes = [.font: UIFontMetrics(forTextStyle: .headline).scaledFont(for: small), .foregroundColor: UIColor(Palette.ink)]
        }
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav

        let tab = UITabBarAppearance()
        tab.configureWithDefaultBackground()
        tab.backgroundColor = UIColor(Palette.surface)
        if let f = UIFont(name: "Archivo-Medium", size: 11) {
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
            .font(Typeface.body(16, weight: .bold, relativeTo: .headline))
            .foregroundStyle(ink)
            .frame(maxWidth: .infinity, minHeight: 52)
            .padding(.horizontal, 16)
            .background(tint.opacity(enabled ? 1 : 0.4), in: Capsule())
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Typeface.body(16, weight: .semibold))
            .foregroundStyle(Palette.ink)
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.horizontal, 14)
            .background(Palette.surface.opacity(configuration.isPressed ? 0.7 : 1), in: Capsule())
            .overlay(Capsule().strokeBorder(Palette.line))
    }
}

// MARK: - Small pieces

/// The FTR kitchen seal: charcoal ring, gold lettering, beige center.
/// `size` is kept from the old wordmark (its letter height); the seal is about 3x that wide.
struct FTRLogo: View {
    var size: CGFloat = 32
    var body: some View {
        Image("Seal")
            .resizable()
            .interpolation(.high)
            .frame(width: size * 3.1, height: size * 3.1)
            .accessibilityLabel("Franklin Tiffin Room seal, since 2025, NJ USA")
    }
}

/// Header lockup from the new design: small seal, name, slogan.
struct FTRHeader: View {
    var body: some View {
        HStack(spacing: 10) {
            BrandMark(size: 54)
            VStack(alignment: .leading, spacing: 3) {
                Text("FRANKLIN TIFFIN ROOM")
                    .font(.custom("Oswald-Medium", size: 17, relativeTo: .headline))
                    .kerning(1.2)
                    .foregroundStyle(Palette.ink)
                Text("bringing back the OG flavor of Masale Dose")
                    .font(Typeface.tagline(12.5, relativeTo: .caption))
                    .foregroundStyle(Palette.muted)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Franklin Tiffin Room, bringing back the OG flavor of Masale Dose")
    }
}

/// Small FTR seal for tight spots (toolbar, message avatars).
struct BrandMark: View {
    var size: CGFloat = 34
    var body: some View {
        Image("SealBadge")
            .resizable()
            .interpolation(.high)
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
    private var fg: Color { tone == .info ? Palette.sage : tone == .warn ? Palette.turmericInk : Palette.bad }
    private var bg: Color { tone == .info ? Palette.sageSoft : tone == .warn ? Palette.turmericSoft : Palette.chiliSoft }
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
        case .confirmed: order.isPast ? "Past order" : "Confirmed"
        case .closed: order.status.contains("Released") ? "Released" : order.status.contains("Cancelled") ? "Cancelled" : "Not booked"
        case .quote_requested: "Awaiting quote"
        default: "With Chef"
        }
    }
    private var fg: Color {
        switch order.stage {
        case .deposit_due, .quote_ready: Palette.turmericInk
        case .confirmed: Palette.sage
        case .closed: Palette.bad
        default: Palette.muted
        }
    }
    private var bg: Color {
        switch order.stage {
        case .deposit_due, .quote_ready: Palette.turmericSoft
        case .confirmed: Palette.sageSoft
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
