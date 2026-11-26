import SwiftUI

@MainActor
final class HomeModel: ObservableObject {
    @Published var listings: [Listing] = []
    @Published var offline = false
    @Published var thbPerUsdt = Money.fallbackThbPerUsdt
    @Published var priceMock = true
    let api = APIClient()

    func load() async {
        var out: [Listing] = []
        var failed = false
        async let stageF = try? api.stage("mystery-box", renter: nil)
        async let fleetF = try? api.fleet()
        async let priceF = try? api.price()
        if let s = await stageF { out.append(.stage(s.listing)) } else { failed = true }
        if let f = await fleetF { out += f.scooters.map(Listing.scooter) } else { failed = true }
        if let p = await priceF { thbPerUsdt = p.thbPerUsdt; priceMock = p.mock ?? true }
        offline = failed && out.isEmpty
        listings = out.isEmpty ? Listing.offline : out
    }
}

struct HomeView: View {
    @EnvironmentObject var settings: AppSettings
    @EnvironmentObject var wallet: WalletStore
    @StateObject private var model = HomeModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                hero
                if model.offline { Notice(text: settings.t("home.offline"), tone: .warn) }
                ForEach(model.listings) { l in
                    NavigationLink(value: l) { ListingCard(listing: l) }.buttonStyle(.plain)
                }
                Text(settings.t("home.footer")).font(.footnote).foregroundStyle(Color.KE.subtle)
            }
            .padding(16)
        }
        .keScreen()
        .navigationTitle("KeyEscrow")
        .navigationDestination(for: Listing.self) { ListingDetailView(listing: $0, thbPerUsdt: model.thbPerUsdt) }
        .toolbar { ToolbarItem(placement: .topBarTrailing) { WalletChip() } }
        .refreshable { await model.load(); await wallet.refresh() }
        .task { if model.listings.isEmpty { await model.load() } }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "lock.shield.fill").foregroundStyle(Color.KE.amber)
                Text(settings.t("home.kicker")).font(.caption.weight(.bold)).foregroundStyle(Color.KE.amber).textCase(.uppercase)
            }
            Text(settings.t("home.title")).font(.title.weight(.bold)).foregroundStyle(.white)
            Text(settings.t("home.subtitle")).font(.subheadline).foregroundStyle(.white.opacity(0.8))
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LinearGradient(colors: [Color.KE.night, Color(light: 0x312E81, dark: 0x1E1B4B)], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Airbnb-style card: picture, name, place, price per day, the escrow promise.
struct ListingCard: View {
    let listing: Listing
    @EnvironmentObject var settings: AppSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ZStack(alignment: .topLeading) {
                ListingArt(url: APIClient().absolute(listing.photo), symbol: listing.symbol, height: 190)
                Pill(text: listing.kind == .stage ? settings.t("badge.live") : settings.t("badge.demo"), tone: listing.kind == .stage ? .ok : .info,
                     icon: listing.kind == .stage ? "dot.radiowaves.left.and.right" : "testtube.2")
                    .background(Color.KE.surface, in: Capsule())
                    .padding(12)
            }
            HStack(alignment: .firstTextBaseline) {
                Text(listing.name).font(.headline).foregroundStyle(Color.KE.foreground)
                Spacer()
                Text(Money.thb(baht: listing.rentPerDayThb)).font(.headline).monospacedDigit() + Text(settings.t("unit.perDay")).font(.subheadline).foregroundStyle(Color.KE.mutedText)
            }
            HStack {
                Label(listing.location, systemImage: "mappin.and.ellipse").font(.subheadline).foregroundStyle(Color.KE.mutedText)
                Spacer()
                Label(settings.t("listing.protected"), systemImage: "lock.shield").font(.caption.weight(.semibold)).foregroundStyle(Color.KE.success)
            }
        }
        .padding(12)
        .background(Color.KE.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Color.KE.border))
        .accessibilityElement(children: .combine)
    }
}

/// Toolbar chip: the guest wallet's short address and mUSDT balance.
struct WalletChip: View {
    @EnvironmentObject var wallet: WalletStore
    @EnvironmentObject var settings: AppSettings
    var body: some View {
        NavigationLink { WalletView() } label: {
            HStack(spacing: 6) {
                Image(systemName: "wallet.bifold.fill")
                Text(wallet.musdt.map { Money.thb($0) } ?? EthAddress.short(wallet.address)).monospacedDigit()
            }
            .font(.footnote.weight(.semibold))
            .padding(.horizontal, 10).frame(minHeight: 32)
            .background(Color.KE.muted, in: Capsule())
        }
        .accessibilityLabel(settings.t("wallet.title"))
    }
}
