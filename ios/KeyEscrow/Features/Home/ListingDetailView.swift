import SwiftUI

struct ListingDetailView: View {
    let listing: Listing
    let thbPerUsdt: Double
    @EnvironmentObject var settings: AppSettings
    @EnvironmentObject var wallet: WalletStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ListingArt(url: APIClient().absolute(listing.photo), symbol: listing.symbol, height: 260)
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Pill(text: listing.kind == .stage ? settings.t("badge.live") : settings.t("badge.demo"), tone: listing.kind == .stage ? .ok : .info)
                        if listing.vault { Pill(text: settings.t("badge.vault"), tone: .neutral, icon: "building.columns") }
                    }
                    Text(listing.name).font(.largeTitle.weight(.bold))
                    Label(listing.location, systemImage: "mappin.and.ellipse").foregroundStyle(Color.KE.mutedText)
                }
                if !listing.description.isEmpty { Text(listing.description).foregroundStyle(Color.KE.mutedText) }

                Card {
                    KVRow(label: settings.t("listing.rent"), value: Money.thb(baht: listing.rentPerDayThb) + settings.t("unit.perDay"),
                          sub: listing.perDay ? usdt(listing.rentThb) : settings.t("listing.monthly", Money.thb(baht: listing.rentThb)) + " · " + usdt(listing.rentThb))
                    Divider()
                    KVRow(label: settings.t("listing.deposit"), value: Money.thb(baht: listing.depositThb), sub: usdt(listing.depositThb) + " · " + settings.t("listing.comesBack"))
                }

                Card {
                    Label(settings.t("listing.protected"), systemImage: "lock.shield.fill").font(.headline).foregroundStyle(Color.KE.success)
                    bullet("building.columns.fill", "listing.why.own")
                    bullet("camera.fill", "listing.why.photos")
                    bullet("sparkles", "listing.why.ai")
                    bullet("clock.badge.checkmark", "listing.why.timeout")
                }

                if listing.kind == .demoScooter { Notice(text: settings.t("listing.demoNote"), tone: .info) } else { Notice(text: settings.t("listing.stageNote"), tone: .ok) }

                NavigationLink { RentFlowView(listing: listing, wallet: wallet) } label: {
                    Label(settings.t("listing.rentIt"), systemImage: "key.fill")
                        .font(.headline).frame(maxWidth: .infinity, minHeight: 52)
                        .foregroundStyle(Color.KE.onPrimary)
                        .background(Color.KE.primary, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .accessibilityIdentifier("rent-it")
                Text(settings.t("common.testnetOnly")).font(.footnote).foregroundStyle(Color.KE.subtle)
            }
            .padding(16)
        }
        .keScreen()
        .navigationBarTitleDisplayMode(.inline)
    }

    private func usdt(_ thb: Double) -> String { Money.usdt(Money.unitsFromThb(thb, rate: thbPerUsdt)) }

    private func bullet(_ icon: String, _ key: String) -> some View {
        Label { Text(settings.t(key)).foregroundStyle(Color.KE.foreground) } icon: { Image(systemName: icon).foregroundStyle(Color.KE.amber) }
            .font(.subheadline)
    }
}
