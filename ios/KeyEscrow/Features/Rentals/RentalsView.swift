import SwiftUI

@MainActor
final class RentalsModel: ObservableObject {
    @Published var items: [LeaseList.Item] = []
    @Published var error: String?
    @Published var loaded = false
    @Published var thbPerUsdt = Money.fallbackThbPerUsdt
    let api = APIClient()

    func load(_ party: String) async {
        do {
            async let p = try? api.price()
            items = try await api.listLeases(party: party).leases
            if let q = await p { thbPerUsdt = q.thbPerUsdt }
            error = nil
        } catch { self.error = error.localizedDescription }
        loaded = true
    }
}

struct RentalsView: View {
    @EnvironmentObject var settings: AppSettings
    @EnvironmentObject var wallet: WalletStore
    @StateObject private var model = RentalsModel()
    /// Screenshot deep link: `-lease <escrow address>` opens that rental.
    @State private var linked: String? = UserDefaults.standard.string(forKey: "lease")

    private var open: Int { model.items.filter { $0.status != "Settled" && $0.status != "Cancelled" }.count }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                if let e = model.error { Notice(text: e, tone: .danger) }
                if model.loaded && model.items.isEmpty && model.error == nil { empty }
                if !model.items.isEmpty {
                    Text(settings.t("rentals.summary", "\(model.items.count)", "\(open)"))
                        .font(.subheadline).foregroundStyle(Color.KE.mutedText)
                        .padding(.bottom, 2)
                }
                ForEach(model.items) { item in
                    NavigationLink { RentalDetailView(address: item.address) } label: { row(item) }
                        .buttonStyle(PressStyle())
                }
                if !model.items.isEmpty {
                    Text(settings.t("common.testnetOnly")).font(.footnote).foregroundStyle(Color.KE.subtle).padding(.top, 6)
                }
            }
            .padding(.horizontal, Metrics.page)
            .padding(.top, 8).padding(.bottom, 28)
            .kePage()
        }
        .keScreen()
        .navigationTitle(settings.t("tab.rentals"))
        .overlay { if !model.loaded { ProgressView() } }
        .refreshable { await model.load(wallet.address) }
        .task { await model.load(wallet.address) }
        .navigationDestination(item: $linked) { RentalDetailView(address: $0) }
    }

    private var empty: some View {
        VStack(spacing: 14) {
            NightTile(symbol: "key.horizontal.fill")
                .frame(width: 88, height: 88)
                .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
            Text(settings.t("rentals.empty")).font(Font.KE.title).foregroundStyle(Color.KE.foreground)
            Text(settings.t("rentals.emptyBody")).font(.subheadline).foregroundStyle(Color.KE.mutedText).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 56).padding(.horizontal, 12)
        .accessibilityElement(children: .combine)
    }

    private func row(_ i: LeaseList.Item) -> some View {
        let known = RentalAlbum.listing(forLease: i.address)
        return HStack(alignment: .top, spacing: 14) {
            ListingThumb(listingId: known?.id, side: 72)
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(known?.name ?? settings.t("rentals.unnamed")).font(Font.KE.headline).foregroundStyle(Color.KE.foreground).multilineTextAlignment(.leading)
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.KE.subtle)
                }
                FlowLayout(spacing: 6) {
                    Pill(text: settings.t("status.\(i.status)"), tone: tone(forStatus: i.status), icon: symbol(forStatus: i.status))
                    Pill(text: settings.t("role.\(i.role)"), tone: .neutral)
                }
                Text(settings.t("rentals.deposit", Money.thb(i.deposit.units, rate: model.thbPerUsdt)) + " · " + settings.t("rentals.rentShort", Money.thb(i.rent.units, rate: model.thbPerUsdt)))
                    .font(.subheadline).monospacedDigit().foregroundStyle(Color.KE.mutedText).multilineTextAlignment(.leading)
                Text(EthAddress.short(i.address)).font(Font.KE.monoSmall).foregroundStyle(Color.KE.subtle)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .keSurface()
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
