import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var settings: AppSettings
    @EnvironmentObject var wallet: WalletStore

    var body: some View {
        Form {
            Section {
                NavigationLink { WalletView() } label: {
                    HStack {
                        Image(systemName: "wallet.bifold.fill").foregroundStyle(Color.KE.amber)
                        VStack(alignment: .leading) {
                            Text(settings.t("wallet.title"))
                            Text(EthAddress.short(wallet.address)).font(.caption.monospaced()).foregroundStyle(Color.KE.subtle)
                        }
                    }
                }
            }
            Section(settings.t("settings.language")) {
                Picker(settings.t("settings.language"), selection: $settings.lang) {
                    Text("English").tag(Lang.en)
                    Text("中文").tag(Lang.zh)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("lang-picker")
            }
            Section(settings.t("settings.appearance")) {
                Picker(settings.t("settings.appearance"), selection: $settings.appearance) {
                    Text(settings.t("settings.system")).tag(Appearance.system)
                    Text(settings.t("settings.light")).tag(Appearance.light)
                    Text(settings.t("settings.dark")).tag(Appearance.dark)
                }
                .pickerStyle(.segmented)
            }
            Section(settings.t("settings.about")) {
                Label(settings.t("settings.testnet"), systemImage: "testtube.2")
                Label(settings.t("settings.noTracking"), systemImage: "eye.slash")
                Label(settings.t("settings.agent"), systemImage: "sparkles")
                Link(destination: APIClient.defaultBase) { Label("keyescrow-web.mdgooijer.workers.dev", systemImage: "globe") }
                Link(destination: Chain.addressURL(TxSender.factory)) { Label(settings.t("settings.factory"), systemImage: "building.columns") }
            }
        }
        .scrollContentBackground(.hidden)
        .keScreen()
        .navigationTitle(settings.t("tab.settings"))
    }
}

struct WalletView: View {
    @EnvironmentObject var settings: AppSettings
    @EnvironmentObject var wallet: WalletStore
    @State private var confirmReset = false
    @State private var busy = false
    @State private var message: String?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Notice(text: settings.t("wallet.warning"), tone: .warn)
                Card {
                    Text(settings.t("wallet.guestLabel")).font(.headline)
                    Text(wallet.address).font(.callout.monospaced()).textSelection(.enabled).accessibilityIdentifier("wallet-address")
                    HStack {
                        CopyButton(text: wallet.address, label: settings.t("wallet.copy"))
                        Spacer()
                        Link(destination: Chain.addressURL(wallet.address)) { Label("BscScan", systemImage: "arrow.up.right.square").frame(minHeight: 44) }
                    }
                    Divider()
                    KVRow(label: "mUSDT", value: wallet.musdt.map { Money.thb($0) } ?? "–", sub: wallet.musdt.map(Money.usdt))
                    KVRow(label: "tBNB", value: wallet.tbnb.map(Money.bnb) ?? "–", sub: settings.t("wallet.gas"))
                    PrimaryButton(title: settings.t("wallet.getMoney"), icon: "drop.fill", busy: busy) { Task { await getMoney() } }
                        .accessibilityIdentifier("wallet-get-money")
                    if let m = message { Notice(text: m, tone: .ok) }
                    if let e = error { Notice(text: e, tone: .danger) }
                }
                Card {
                    Text(settings.t("wallet.shopLabel")).font(.headline)
                    Text(settings.t("wallet.shopBody")).font(.subheadline).foregroundStyle(Color.KE.mutedText)
                    Text(wallet.shop.address).font(.caption.monospaced()).textSelection(.enabled)
                    KVRow(label: "tBNB", value: wallet.shopTbnb.map(Money.bnb) ?? "–")
                }
                Button(role: .destructive) { confirmReset = true } label: {
                    Label(settings.t("wallet.reset"), systemImage: "trash").frame(maxWidth: .infinity, minHeight: 44)
                }
                .confirmationDialog(settings.t("wallet.resetConfirm"), isPresented: $confirmReset, titleVisibility: .visible) {
                    Button(settings.t("wallet.reset"), role: .destructive) { wallet.reset(); Task { await wallet.refresh() } }
                }
            }
            .padding(16)
        }
        .keScreen()
        .navigationTitle(settings.t("wallet.title"))
        .refreshable { await wallet.refresh() }
        .task { await wallet.refresh() }
    }

    /// The stage drip: tBNB for gas + a little mUSDT, once per wallet (the rent flow mints more mUSDT when needed).
    private func getMoney() async {
        busy = true; error = nil; message = nil
        defer { busy = false }
        do {
            let r = try await APIClient().stageDrip("mystery-box", to: wallet.address)
            for h in r.txs { _ = try? await TxSender().waitForReceipt(h, timeout: 60) }
            message = r.`repeat` == true ? settings.t("wallet.alreadyDripped") : settings.t("wallet.dripped", "\(r.txs.count)")
            await wallet.refresh()
        } catch { self.error = error.localizedDescription }
    }
}
