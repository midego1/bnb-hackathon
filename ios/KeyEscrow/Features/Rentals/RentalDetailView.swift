import SwiftUI

@MainActor
final class RentalDetailModel: ObservableObject {
    @Published var lease: Lease?
    @Published var events: [ChainIndex.Event] = []
    @Published var explain: ExplainStatus?
    @Published var error: String?
    @Published var thbPerUsdt = Money.fallbackThbPerUsdt
    @Published var priceMock = true
    let api = APIClient()

    func load(_ address: String, viewer: String) async {
        do {
            async let l = api.getLease(address)
            async let ix = try? api.chainIndex()
            async let ex = try? api.explainStatus(lease: address, viewer: viewer)
            async let p = try? api.price()
            lease = try await l
            events = (await ix)?.events(of: address) ?? events
            explain = await ex
            if let q = await p { thbPerUsdt = q.thbPerUsdt; priceMock = q.mock ?? true }
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

/// Like the web rental page v2: status banner, money strip, period strip, timeline with BscScan links.
struct RentalDetailView: View {
    let address: String
    @EnvironmentObject var settings: AppSettings
    @EnvironmentObject var wallet: WalletStore
    @StateObject private var model = RentalDetailModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let e = model.error { Notice(text: e, tone: .danger) }
                if let l = model.lease {
                    banner(l)
                    moneyStrip(l)
                    periodStrip(l)
                    if let ex = model.explain {
                        Card {
                            Label(settings.t("detail.plainWords"), systemImage: "text.bubble").font(.headline)
                            Text(ex.text).font(.subheadline).foregroundStyle(Color.KE.mutedText)
                            if settings.lang == .zh { Text(settings.t("detail.serverEnglish")).font(.caption).foregroundStyle(Color.KE.subtle) }
                        }
                    }
                    timeline
                    parties(l)
                    continueLink(l)
                } else if model.error == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(40)
                }
            }
            .padding(16)
        }
        .keScreen()
        .navigationTitle(settings.t("detail.title"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.load(address, viewer: wallet.address) }
        .task { await model.load(address, viewer: wallet.address) }
    }

    private func thb(_ u: BigUInt) -> String { Money.thb(u, rate: model.thbPerUsdt) }

    private func banner(_ l: Lease) -> some View {
        let flow = RentalStory.moneyFlow(model.events)
        let (tone, key, args) = RentalStory.banner(l, me: wallet.address, flow: flow, fmt: thb)
        return VStack(alignment: .leading, spacing: 8) {
            Pill(text: settings.t("status.\(l.status)"), tone: tone)
            Text(settings.t(key, args)).font(.title2.weight(.bold)).foregroundStyle(Color.KE.foreground)
            Text(settings.t("\(key).body")).font(.subheadline).foregroundStyle(Color.KE.mutedText)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tone.bg, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(tone.fg.opacity(0.25)))
        .accessibilityElement(children: .combine)
    }

    private func moneyStrip(_ l: Lease) -> some View {
        let f = RentalStory.moneyFlow(model.events)
        let tiles: [(String, BigUInt, String)] = [
            ("money.paid", f.paidIn, "arrow.down.circle"), ("money.escrow", l.escrowBalance.units, "lock.fill"),
            ("money.owner", f.toOwner, "storefront"), ("money.back", f.backToRenter, "arrow.uturn.backward.circle"),
        ]
        return VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                ForEach(tiles, id: \.0) { t in
                    VStack(alignment: .leading, spacing: 4) {
                        Label(settings.t(t.0), systemImage: t.2).font(.caption.weight(.semibold)).foregroundStyle(Color.KE.mutedText)
                        Text(thb(t.1)).font(.title3.weight(.bold)).monospacedDigit().minimumScaleFactor(0.7).lineLimit(1)
                        Text(Money.usdt(t.1)).font(.caption).monospacedDigit().foregroundStyle(Color.KE.subtle)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.KE.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.KE.border))
                    .accessibilityElement(children: .combine)
                }
            }
            if f.fee > BigUInt() { Text(settings.t("money.fee", thb(f.fee))).font(.caption).foregroundStyle(Color.KE.subtle) }
            if model.priceMock { Text(settings.t("money.demoRate", String(format: "%.2f", model.thbPerUsdt))).font(.caption).foregroundStyle(Color.KE.subtle) }
        }
    }

    private func periodStrip(_ l: Lease) -> some View {
        let cells = RentalStory.periods(l)
        return Card {
            Text(settings.t("detail.periods", "\(l.termPeriods)", "\(Int(l.rentPeriodDays))")).font(.headline)
            if cells.isEmpty {
                Text(settings.t("detail.notStarted")).font(.subheadline).foregroundStyle(Color.KE.mutedText)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: min(6, max(1, cells.count))), spacing: 6) {
                    ForEach(Array(cells.enumerated()), id: \.offset) { i, c in
                        VStack(spacing: 2) {
                            Text("\(i + 1)").font(.caption.weight(.bold))
                            Text(settings.t("period.\(c.rawValue)")).font(.caption2).lineLimit(1).minimumScaleFactor(0.7)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .foregroundStyle(c == .out ? Color.KE.success : c == .held ? Color.KE.info : Color.KE.mutedText)
                        .background(c == .out ? Color.KE.successSoft : c == .held ? Color.KE.infoSoft : Color.KE.muted, in: RoundedRectangle(cornerRadius: 10))
                    }
                }
                KVRow(label: settings.t("detail.rentPer"), value: thb(l.rent.units), sub: l.rent.display)
                KVRow(label: settings.t("listing.deposit"), value: thb(l.deposit.units), sub: l.deposit.display)
            }
        }
    }

    private var timeline: some View {
        Card {
            Text(settings.t("detail.timeline")).font(.headline)
            if model.events.isEmpty { Text(settings.t("detail.noEvents")).font(.subheadline).foregroundStyle(Color.KE.mutedText) }
            ForEach(model.events) { e in
                Link(destination: Chain.txURL(e.txHash)) {
                    HStack(alignment: .top, spacing: 10) {
                        Circle().fill(Color.KE.amber).frame(width: 10, height: 10).padding(.top, 6)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(eventLabel(e)).font(.subheadline.weight(.medium)).foregroundStyle(Color.KE.foreground).multilineTextAlignment(.leading)
                            Text(e.date.formatted(date: .abbreviated, time: .shortened) + " · " + EthAddress.short(e.txHash)).font(.caption.monospaced()).foregroundStyle(Color.KE.subtle)
                        }
                        Spacer()
                        Image(systemName: "arrow.up.right.square").foregroundStyle(Color.KE.mutedText)
                    }
                    .frame(minHeight: 44)
                }
                .accessibilityHint("BscScan")
            }
        }
    }

    private func eventLabel(_ e: ChainIndex.Event) -> String {
        if e.name == "EvidenceAdded" {
            let k = e.args["kind"]?.int
            return settings.t(k == 0 ? "event.pickupPhoto" : k == 1 ? "event.returnPhoto" : "event.evidence")
        }
        let key = "event.\(e.name)"
        let s = settings.t(key)
        return s == key ? e.name : s
    }

    private func parties(_ l: Lease) -> some View {
        Card {
            Text(settings.t("detail.contract")).font(.headline)
            Link(destination: Chain.addressURL(l.address)) { KVRow(label: settings.t("detail.escrow"), value: EthAddress.short(l.address)) }
            KVRow(label: settings.t("role.owner"), value: EthAddress.short(l.owner))
            KVRow(label: settings.t("role.renter"), value: EthAddress.short(l.renter))
            KVRow(label: settings.t("role.arbiter"), value: EthAddress.short(l.arbiter))
        }
    }

    @ViewBuilder private func continueLink(_ l: Lease) -> some View {
        if !l.isFinal, EthAddress.same(l.renter, wallet.address) {
            let listing: Listing? = ShopRentals.scooter(forLease: l.address).map { id in
                Listing(id: id, kind: .demoScooter, name: ShopRentals.name(of: id) ?? id, location: "", description: "", photo: nil, rentThb: 0, depositThb: 0, perDay: false, symbol: "scooter", vault: false)
            } ?? (l.termPeriods == 1 && Int(l.rentPeriodDays) == 30 ? Listing.offline.first : nil)
            if let listing {
                NavigationLink { RentFlowView(listing: listing, wallet: wallet) } label: {
                    Label(settings.t("detail.continue"), systemImage: "arrow.right.circle.fill").font(.headline).frame(maxWidth: .infinity, minHeight: 52)
                        .foregroundStyle(Color.KE.onPrimary).background(Color.KE.primary, in: RoundedRectangle(cornerRadius: 14))
                }
            }
        }
    }
}
