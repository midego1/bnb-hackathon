import SwiftUI
import UIKit

/// KeyScrow's colour tokens (web/app/globals.css), light and dark.
extension Color {
    /// `led`: the token's colour in the LED design; by default the LED palette's match for the dark colour.
    init(light: UInt32, dark: UInt32, led: UInt32? = nil) {
        self.init(uiColor: UIColor {
            // The LED design is always the night street.
            if DesignMode.led { return UIColor(hex: led ?? LEDPalette.map[dark] ?? dark) }
            return $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light)
        })
    }

    enum KE {
        static let background = Color(light: 0xF8FAFC, dark: 0x020617)
        static let surface = Color(light: 0xFFFFFF, dark: 0x0F172A)
        static let muted = Color(light: 0xF1F5F9, dark: 0x1E293B)
        static let foreground = Color(light: 0x0F172A, dark: 0xF1F5F9)
        static let mutedText = Color(light: 0x475569, dark: 0xB4C0D0)
        static let subtle = Color(light: 0x556274, dark: 0x93A1B5)
        static let border = Color(light: 0xE2E8F0, dark: 0x1E293B, led: 0x2E2A6E)
        static let borderStrong = Color(light: 0xCBD5E1, dark: 0x334155)
        static let primary = Color(light: 0x0F172A, dark: 0xF8FAFC)
        static let onPrimary = Color(light: 0xFFFFFF, dark: 0x0F172A, led: 0x1C1917)
        /// The amber of the logo, for emphasis only.
        static let amber = Color(light: 0xF59E0B, dark: 0xFBBF24)
        /// Text and icons on an amber fill.
        static let onAmber = Color(light: 0x1C1917, dark: 0x1C1917)
        static let amberSoft = Color(light: 0xFEF3C7, dark: 0x2A1A05)
        /// Night indigo: the same in both themes, it is a picture of night (docs/DESIGN.md).
        static let night = Color(light: 0x0D0B2A, dark: 0x0D0B2A)
        static let nightSoft = Color(light: 0x312E81, dark: 0x1E1B4B)
        /// The logo amber as it glows on night (signs, kickers over the photo).
        static let sign = Color(light: 0xFBBF24, dark: 0xFBBF24)

        static let success = Color(light: 0x047857, dark: 0x34D399)
        static let successSoft = Color(light: 0xECFDF5, dark: 0x022C22)
        static let warning = Color(light: 0xB45309, dark: 0xFBBF24)
        static let warningSoft = Color(light: 0xFFFBEB, dark: 0x2A1A05)
        static let danger = Color(light: 0xBE123C, dark: 0xFB7185)
        static let dangerSoft = Color(light: 0xFFF1F2, dark: 0x2A0A12)
        static let info = Color(light: 0x0369A1, dark: 0x38BDF8)
        static let infoSoft = Color(light: 0xF0F9FF, dark: 0x082F49)

        /// Soft drop shadow under cards (light theme; on the dark background the hairline border carries the edge).
        static let shadow = Color(light: 0x0F172A, dark: 0x000000)
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: 1)
    }
}

/// One type scale for the whole app. Every style is a Dynamic Type text style, so it grows with the user's setting.
/// Rounded for headings and amounts (the sign on the street), the system face for reading, monospaced for hashes.
extension Font {
    enum KE {
        static var hero: Font { DesignMode.led ? Font.system(.largeTitle, weight: .black).width(.expanded) : Font.system(.largeTitle, design: .rounded, weight: .heavy) }
        static var display: Font { DesignMode.led ? Font.system(.largeTitle, weight: .heavy).width(.expanded) : Font.system(.largeTitle, design: .rounded, weight: .bold) }
        static var title: Font { DesignMode.led ? Font.system(.title2, weight: .heavy).width(.expanded) : Font.system(.title2, design: .rounded, weight: .bold) }
        static var section: Font { DesignMode.led ? Font.system(.title3, weight: .heavy).width(.expanded) : Font.system(.title3, design: .rounded, weight: .bold) }
        static var headline: Font { DesignMode.led ? Font.system(.headline, weight: .bold).width(.expanded) : Font.system(.headline, design: .rounded, weight: .semibold) }
        static var amount: Font { DesignMode.led ? Font.system(.title, weight: .heavy).width(.expanded) : Font.system(.title, design: .rounded, weight: .bold) }
        static var amountSmall: Font { DesignMode.led ? Font.system(.title3, weight: .heavy).width(.expanded) : Font.system(.title3, design: .rounded, weight: .bold) }
        static let body = Font.body
        static let callout = Font.callout
        static let sub = Font.subheadline
        static let label = Font.footnote.weight(.semibold)
        static let caption = Font.caption
        static var kicker: Font { DesignMode.led ? Font.system(.caption, weight: .heavy).width(.expanded) : Font.system(.caption, design: .rounded, weight: .bold) }
        static let mono = Font.system(.footnote, design: .monospaced)
        static let monoSmall = Font.system(.caption, design: .monospaced)
    }
}

/// Spacing and corner radii (4-pt grid).
enum Metrics {
    static let page: CGFloat = 20
    static let gap: CGFloat = 16
    static let gapSmall: CGFloat = 8
    static let gapLarge: CGFloat = 28
    static let radius: CGFloat = 22
    static let radiusSmall: CGFloat = 14
    static let radiusPhoto: CGFloat = 20
    /// Reading width on an iPad: the phone layout, centred.
    static let maxWidth: CGFloat = 640
}

enum Tone { case ok, warn, danger, info, neutral
    var fg: Color { switch self { case .ok: .KE.success; case .warn: .KE.warning; case .danger: .KE.danger; case .info: .KE.info; case .neutral: .KE.mutedText } }
    var bg: Color { switch self { case .ok: .KE.successSoft; case .warn: .KE.warningSoft; case .danger: .KE.dangerSoft; case .info: .KE.infoSoft; case .neutral: .KE.muted } }
}

/// Rental status -> tone (pill colour).
func tone(forStatus s: String) -> Tone {
    switch s {
    case "Active": return .ok
    case "MoveOut": return .warn
    case "Disputed": return .danger
    case "Created": return .info
    default: return .neutral
    }
}

/// Rental status -> SF Symbol (so state never rides on colour alone).
func symbol(forStatus s: String) -> String {
    switch s {
    case "Created": return "clock"
    case "Active": return "lock.fill"
    case "MoveOut": return "arrow.left.arrow.right"
    case "Disputed": return "exclamationmark.bubble.fill"
    case "Settled": return "checkmark.seal.fill"
    default: return "xmark.circle"
    }
}
