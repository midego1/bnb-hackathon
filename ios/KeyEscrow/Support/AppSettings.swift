import SwiftUI

enum Lang: String, CaseIterable { case en, zh
    var locale: Locale { Locale(identifier: self == .zh ? "zh-Hans" : "en") }
}

enum Appearance: String, CaseIterable { case system, light, dark
    var scheme: ColorScheme? { self == .light ? .light : self == .dark ? .dark : nil }
}

/// Language (EN / 中文, switchable in the app) and appearance. Launch arguments `-lang zh`, `-appearance dark` and
/// `-tab 1` set them too (UserDefaults' argument domain), which the screenshot script uses.
@MainActor
final class AppSettings: ObservableObject {
    @Published var lang: Lang { didSet { UserDefaults.standard.set(lang.rawValue, forKey: "lang") } }
    @Published var appearance: Appearance { didSet { UserDefaults.standard.set(appearance.rawValue, forKey: "appearance") } }

    static var initialTab: Int { UserDefaults.standard.integer(forKey: "tab") }

    init() {
        let d = UserDefaults.standard
        let preferred = Locale.preferredLanguages.first?.hasPrefix("zh") == true ? Lang.zh : .en
        lang = d.string(forKey: "lang").flatMap(Lang.init(rawValue:)) ?? preferred
        appearance = d.string(forKey: "appearance").flatMap(Appearance.init(rawValue:)) ?? .system
    }

    /// The string for `key` in the active language, with {0}, {1}, … filled from `args`. Falls back to English, then
    /// to the key itself.
    func t(_ key: String, _ args: String...) -> String { t(key, args) }
    func t(_ key: String, _ args: [String]) -> String { L10n.string(key, lang: lang, args) }
}
