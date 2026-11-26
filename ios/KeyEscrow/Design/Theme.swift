import SwiftUI
import UIKit

/// KeyEscrow's colour tokens (web/app/globals.css), light and dark.
extension Color {
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }

    enum KE {
        static let background = Color(light: 0xF8FAFC, dark: 0x020617)
        static let surface = Color(light: 0xFFFFFF, dark: 0x0F172A)
        static let muted = Color(light: 0xF1F5F9, dark: 0x1E293B)
        static let foreground = Color(light: 0x0F172A, dark: 0xF1F5F9)
        static let mutedText = Color(light: 0x475569, dark: 0xB4C0D0)
        static let subtle = Color(light: 0x556274, dark: 0x93A1B5)
        static let border = Color(light: 0xE2E8F0, dark: 0x1E293B)
        static let borderStrong = Color(light: 0xCBD5E1, dark: 0x334155)
        static let primary = Color(light: 0x0F172A, dark: 0xF8FAFC)
        static let onPrimary = Color(light: 0xFFFFFF, dark: 0x0F172A)
        /// The amber of the logo, for emphasis only.
        static let amber = Color(light: 0xF59E0B, dark: 0xFBBF24)
        static let night = Color(light: 0x0D0B2A, dark: 0x0D0B2A)

        static let success = Color(light: 0x047857, dark: 0x34D399)
        static let successSoft = Color(light: 0xECFDF5, dark: 0x022C22)
        static let warning = Color(light: 0xB45309, dark: 0xFBBF24)
        static let warningSoft = Color(light: 0xFFFBEB, dark: 0x2A1A05)
        static let danger = Color(light: 0xBE123C, dark: 0xFB7185)
        static let dangerSoft = Color(light: 0xFFF1F2, dark: 0x2A0A12)
        static let info = Color(light: 0x0369A1, dark: 0x38BDF8)
        static let infoSoft = Color(light: 0xF0F9FF, dark: 0x082F49)
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: 1)
    }
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
