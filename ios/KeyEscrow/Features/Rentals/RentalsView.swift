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

    var body: some View {
        List {
            if let e = model.error { Notice(text: e, tone: .danger).listRowBackground(Color.clear) }
            if model.loaded && model.items.isEmpty && model.error == nil {
                VStack(spacing: 12) {
                    Image(systemName: "key.horizontal").font(.largeTitle).foregroundStyle(Color.KE.amber)
                    Text(settings.t("rentals.empty")).font(.headline)
                    Text(settings.t("rentals.emptyBody")).font(.subheadline).foregroundStyle(Color.KE.mutedText).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 40).listRowBackground(Color.clear)
            }
            ForEach(model.items) { item in
                NavigationLink { RentalDetailView(address: item.address) } label: { row(item) }
            }
        }
        .scrollContentBackground(.hidden)
        .keScreen()
        .navigationTitle(settings.t("tab.rentals"))
        .overlay { if !model.loaded { ProgressView() } }
        .refreshable { await model.load(wallet.address) }
        .task { await model.load(wallet.address) }
        .navigationDestination(item: $linked) { RentalDetailView(address: $0) }
    }

    private func row(_ i: LeaseList.Item) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Pill(text: settings.t("status.\(i.status)"), tone: tone(forStatus: i.status))
                Spacer()
                Text(settings.t("role.\(i.role)")).font(.caption).foregroundStyle(Color.KE.subtle)
            }
            Text(settings.t("rentals.deposit", Money.thb(i.deposit.units, rate: model.thbPerUsdt))).font(.headline).monospacedDigit()
            Text(settings.t("rentals.rent", Money.thb(i.rent.units, rate: model.thbPerUsdt), i.rent.display)).font(.subheadline).foregroundStyle(Color.KE.mutedText)
            Text(EthAddress.short(i.address)).font(.caption.monospaced()).foregroundStyle(Color.KE.subtle)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}
