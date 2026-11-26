import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var settings: AppSettings
    @EnvironmentObject var wallet: WalletStore
    /// Screenshot deep link: `-screen wallet` or `-screen credits` opens that page.
    @State private var linked: String? = UserDefaults.standard.string(forKey: "screen")

    private var version: String {
        let i = Bundle.main.infoDictionary
        return "\(i?["CFBundleShortVersionString"] as? String ?? "1.0") (\(i?["CFBundleVersion"] as? String ?? "1"))"
    }

    var body: some View {
        Form {
            Section {
                NavigationLink { WalletView() } label: {
                    HStack(spacing: 14) {
                        NightTile(symbol: "wallet.bifold.fill")
                            .frame(width: 52, height: 52)
                            .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(settings.t("wallet.title")).font(Font.KE.headline).foregroundStyle(Color.KE.foreground)
                            Text(EthAddress.short(wallet.address)).font(Font.KE.monoSmall).foregroundStyle(Color.KE.subtle)
                        }
                        Spacer(minLength: 8)
                        if let m = wallet.musdt {
                            Text(Money.thb(m)).font(Font.KE.headline).monospacedDigit().foregroundStyle(Color.KE.foreground)
                        }
                    }
                    .padding(.vertical, 4)
                }
            } footer: {
                Text(settings.t("common.testnetOnly"))
            }
            .listRowBackground(Color.KE.surface)

            Section(settings.t("settings.language")) {
                Picker(settings.t("settings.language"), selection: $settings.lang) {
                    Text("English").tag(Lang.en)
                    Text("中文").tag(Lang.zh)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("lang-picker")
            }
            .listRowBackground(Color.KE.surface)

            Section {
                HStack(spacing: 12) {
                    designCard(.photos, title: settings.t("design.photos"), id: "design-photos")
                    designCard(.led, title: settings.t("design.led"), id: "design-led")
                }
                .padding(.vertical, 6)
            } header: {
                Text(settings.t("design.title"))
            } footer: {
                Text(settings.t(settings.design == .led ? "design.led.note" : "design.photos.note"))
            }
            .listRowBackground(Color.KE.surface)

            if settings.design == .photos {
            Section(settings.t("settings.appearance")) {
                Picker(settings.t("settings.appearance"), selection: $settings.appearance) {
                    Text(settings.t("settings.system")).tag(Appearance.system)
                    Text(settings.t("settings.light")).tag(Appearance.light)
                    Text(settings.t("settings.dark")).tag(Appearance.dark)
                }
                .pickerStyle(.segmented)
            }
            .listRowBackground(Color.KE.surface)
            }

            Section {
                row("testtube.2", .KE.info, .KE.infoSoft, settings.t("settings.testnet"))
                row("eye.slash.fill", .KE.success, .KE.successSoft, settings.t("settings.noTracking"))
                row("sparkles", .KE.amber, .KE.amberSoft, settings.t("settings.agent"))
                NavigationLink { PhotoCreditsView() } label: {
                    row("camera.aperture", .KE.mutedText, .KE.muted, settings.t("credits.title"), detail: settings.t("credits.count", "\(PhotoCatalog.credits.count)"))
                }
                Link(destination: APIClient.defaultBase) {
                    row("globe", .KE.mutedText, .KE.muted, "keyscrow.mdgooijer.workers.dev", external: true)
                }
                Link(destination: Chain.addressURL(TxSender.factory)) {
                    row("building.columns.fill", .KE.mutedText, .KE.muted, settings.t("settings.factory"), external: true)
                }
            } header: {
                Text(settings.t("settings.about"))
            } footer: {
                Text("KeyScrow \(version) · BSC testnet (97)").frame(maxWidth: .infinity, alignment: .center).padding(.top, 12)
            }
            .listRowBackground(Color.KE.surface)
        }
        .scrollContentBackground(.hidden)
        .keScreen()
        .navigationTitle(settings.t("tab.settings"))
        .navigationDestination(item: $linked) { screen in
            if screen == "credits" { PhotoCreditsView() } else { WalletView() }
        }
    }

    /// One look to pick: a preview of the street on Home (the photo, or the same photo as an LED board) and its name.
    private func designCard(_ d: Design, title: String, id: String) -> some View {
        let on = settings.design == d
        return Button {
            guard !on else { return }
            UISelectionFeedbackGenerator().selectionChanged()
            settings.design = d
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                Group {
                    if d == .led, let led = DotMatrix.image(asset: PhotoCatalog.hero, cols: 60) {
                        Image(uiImage: led).resizable().scaledToFill()
                    } else {
                        Image(PhotoCatalog.hero).resizable().scaledToFill()
                    }
                }
                .frame(height: 96).frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                HStack(spacing: 6) {
                    Image(systemName: on ? "checkmark.circle.fill" : "circle").foregroundStyle(on ? Color.KE.amber : Color.KE.subtle)
                    Text(title).font(Font.KE.label).foregroundStyle(Color.KE.foreground).lineLimit(2).minimumScaleFactor(0.8)
                }
            }
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.KE.muted.opacity(on ? 1 : 0.4)))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(on ? Color.KE.amber : Color.KE.border, lineWidth: on ? 2 : 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityAddTraits(on ? [.isSelected] : [])
        .accessibilityIdentifier(id)
    }

    private func row(_ icon: String, _ tint: Color, _ fill: Color, _ text: String, detail: String? = nil, external: Bool = false) -> some View {
        HStack(spacing: 12) {
            IconBadge(symbol: icon, tint: tint, fill: fill, size: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(text).font(.subheadline).foregroundStyle(Color.KE.foreground).multilineTextAlignment(.leading)
                if let detail { Text(detail).font(.caption).foregroundStyle(Color.KE.subtle) }
            }
            if external {
                Spacer(minLength: 8)
                Image(systemName: "arrow.up.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.KE.subtle)
            }
        }
        .padding(.vertical, 3)
        .frame(minHeight: 36)
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
            VStack(alignment: .leading, spacing: Metrics.gap) {
                balance
                if wallet.keychainUnavailable { Notice(text: settings.t("wallet.keychain"), tone: .danger) }
                PrimaryButton(title: settings.t("wallet.getMoney"), icon: "drop.fill", busy: busy) { Task { await getMoney() } }
                    .accessibilityIdentifier("wallet-get-money")
                if let m = message { Notice(text: m, tone: .ok) }
                if let e = error { Notice(text: e, tone: .danger) }
                Notice(text: settings.t("wallet.warning"), tone: .warn)
                Card {
                    HStack(spacing: 12) {
                        IconBadge(symbol: "storefront.fill", tint: .KE.info, fill: .KE.infoSoft, size: 36)
                        Text(settings.t("wallet.shopLabel")).font(Font.KE.headline).foregroundStyle(Color.KE.foreground)
                    }
                    Text(settings.t("wallet.shopBody")).font(.subheadline).foregroundStyle(Color.KE.mutedText).fixedSize(horizontal: false, vertical: true)
                    Text(wallet.shop.address).font(Font.KE.monoSmall).foregroundStyle(Color.KE.subtle).textSelection(.enabled)
                    DashedRule()
                    KVRow(label: "tBNB", value: wallet.shopTbnb.map(Money.bnb) ?? "–", sub: settings.t("wallet.gas"))
                }
                Button(role: .destructive) { confirmReset = true } label: {
                    Label(settings.t("wallet.reset"), systemImage: "trash").font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 44)
                }
                .confirmationDialog(settings.t("wallet.resetConfirm"), isPresented: $confirmReset, titleVisibility: .visible) {
                    Button(settings.t("wallet.reset"), role: .destructive) { wallet.reset(); Task { await wallet.refresh() } }
                }
            }
            .padding(.horizontal, Metrics.page)
            .padding(.top, 8).padding(.bottom, 28)
            .kePage()
        }
        .keScreen()
        .navigationTitle(settings.t("wallet.title"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await wallet.refresh() }
        .task { await wallet.refresh() }
        .sensoryFeedback(.success, trigger: message) { _, new in new != nil }
        .sensoryFeedback(.error, trigger: error) { _, new in new != nil }
    }

    /// The balance as a card on night indigo: baht first, the token amounts under it, then the address.
    private var balance: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: "wallet.bifold.fill").foregroundStyle(Color.KE.sign)
                Text(settings.t("wallet.guestLabel")).foregroundStyle(.white.opacity(0.9))
                Spacer(minLength: 8)
                Text("BSC testnet").font(Font.KE.kicker).foregroundStyle(Color.KE.sign)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Color.KE.sign.opacity(0.16), in: Capsule())
            }
            .font(.subheadline.weight(.semibold))
            VStack(alignment: .leading, spacing: 4) {
                Text(wallet.musdt.map { Money.thb($0) } ?? "–")
                    .font(.system(.largeTitle, design: .rounded, weight: .heavy)).monospacedDigit()
                    .foregroundStyle(.white).minimumScaleFactor(0.6).lineLimit(1)
                Text((wallet.musdt.map(Money.usdt) ?? "– mUSDT") + " · " + (wallet.tbnb.map(Money.bnb) ?? "– tBNB") + " " + settings.t("wallet.gas"))
                    .font(.footnote).monospacedDigit().foregroundStyle(.white.opacity(0.78))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            Text(wallet.address)
                .font(Font.KE.monoSmall).foregroundStyle(.white.opacity(0.9))
                .textSelection(.enabled)
                .accessibilityIdentifier("wallet-address")
            HStack(spacing: 10) {
                CopyButton(text: wallet.address, label: settings.t("wallet.copy"))
                    .padding(.horizontal, 12)
                    .background(.white.opacity(0.14), in: Capsule())
                Link(destination: Chain.addressURL(wallet.address)) {
                    Label("BscScan", systemImage: "arrow.up.right").font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                        .padding(.horizontal, 12)
                        .background(.white.opacity(0.14), in: Capsule())
                }
            }
            .tint(.white)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: [Color.KE.night, Color.KE.nightSoft], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 26, style: .continuous)
        )
        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).strokeBorder(.white.opacity(0.08)))
        .shadow(color: Color.KE.night.opacity(0.28), radius: 18, x: 0, y: 10)
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
