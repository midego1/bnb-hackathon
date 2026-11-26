import SwiftUI

@main
struct KeyEscrowApp: App {
    @StateObject private var settings = AppSettings()
    @StateObject private var wallet = WalletStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .id(settings.design) // a new design resolves every colour and font again
                .environmentObject(settings)
                .environmentObject(wallet)
                .environment(\.locale, settings.lang.locale)
                .preferredColorScheme(settings.scheme)
                .tint(Color.KE.primary)
        }
    }
}

struct RootView: View {
    @EnvironmentObject var settings: AppSettings
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.scenePhase) private var phase

    var body: some View {
        TabView(selection: $settings.tab) {
            NavigationStack { HomeView() }
                .tabItem { Label(settings.t("tab.home"), systemImage: "house.fill") }.tag(0)
            NavigationStack { RentalsView() }
                .tabItem { Label(settings.t("tab.rentals"), systemImage: "key.fill") }.tag(1)
            NavigationStack { AskAIView() }
                .tabItem { Label(settings.t("tab.ask"), systemImage: "sparkles") }.tag(2)
            NavigationStack { SettingsView() }
                .tabItem { Label(settings.t("tab.settings"), systemImage: "gearshape.fill") }.tag(3)
        }
        .task { await wallet.refresh() }
        .onChange(of: phase) { _, p in if p == .active { wallet.reloadIfNeeded() } }
    }
}
