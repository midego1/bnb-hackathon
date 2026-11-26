import SwiftUI

@MainActor
final class RentalDetailModel: ObservableObject {
    @Published var lease: Lease?
    @Published var events: [ChainIndex.Event] = []
    @Published var explain: ExplainStatus?
    @Published var error: String?
    @Published var thbPerUsdt = Money.fallbackThbPerUsdt
    @Published var priceMock = true
    /// The chain index has answered (or failed) at least once: until then the event-based numbers are unknown, not 0.
    @Published var historyLoaded = false
    /// The payout read from the settling transaction's receipt, when this phone sent it (see RentalStory.settledFlow).
    @Published var settledOutcome: RentalStory.Flow?
    let api = APIClient()

    func load(_ address: String, viewer: String) async {
        loadHistory(address)
        do {
            async let l = api.getLease(address)
            async let ex = try? api.explainStatus(lease: address, viewer: viewer)
            async let p = try? api.price()
            lease = try await l
            if let q = await p { thbPerUsdt = q.thbPerUsdt; priceMock = q.mock ?? true }
            explain = await ex
            error = nil
            if lease?.status == "Settled", settledOutcome == nil, let h = RentalAlbum.settleTx(forLease: address),
               let r = (try? await RPC().receipt(h)) ?? nil {
                settledOutcome = RentalStory.settledFlow(from: r, lease: address)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// The timeline comes from KeyEscrow's chain index, which can take a while: it loads on the side (one request at
    /// a time), so the page and pull-to-refresh never wait for it.
    private var historyTask: Task<Void, Never>?
    private func loadHistory(_ address: String) {
        guard historyTask == nil else { return }
        historyTask = Task { [weak self, api] in
            let ix = try? await api.chainIndex()
            guard let self else { return }
            if let ix { self.events = ix.events(of: address) }
            self.historyLoaded = true
            self.historyTask = nil
        }
    }
}

/// Like the web rental page v2: status banner, money strip, period strip, timeline with BscScan links.
struct RentalDetailView: View {
    let address: String
    @EnvironmentObject var settings: AppSettings
    @EnvironmentObject var wallet: WalletStore
    @StateObject private var model = RentalDetailModel()

    /// Screenshot deep link: `-scroll timeline` (or `contract`) scrolls the page there once it has loaded.
    @State private var scrollTarget: String?

    var body: some View {
        ScrollViewReader { proxy in
            page.onChange(of: scrollTarget) { _, target in if let target { proxy.scrollTo(target, anchor: .top) } }
        }
        .keScreen()
        .navigationTitle(settings.t("detail.title"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.load(address, viewer: wallet.address) }
        .task {
            await model.load(address, viewer: wallet.address)
            if let target = UserDefaults.standard.string(forKey: "scroll") { scrollTarget = target }
        }
    }

    private var page: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Metrics.gap) {
                if let e = model.error { Notice(text: e, tone: .danger) }
                if let l = model.lease {
                    photoStrip
                    banner(l)
                    moneyStrip(l)
                    periodStrip(l)
                    if let ex = model.explain {
                        Card {
                            HStack(spacing: 12) {
                                IconBadge(symbol: "text.bubble.fill", tint: .KE.info, fill: .KE.infoSoft, size: 36)
                                Text(settings.t("detail.plainWords")).font(Font.KE.headline).foregroundStyle(Color.KE.foreground)
                            }
                            Text(ex.text).font(.subheadline).foregroundStyle(Color.KE.mutedText).fixedSize(horizontal: false, vertical: true)
                            if settings.lang == .zh { Text(settings.t("detail.serverEnglish")).font(.caption).foregroundStyle(Color.KE.subtle) }
                        }
                    }
                    timeline.id("timeline")
                    parties(l).id("contract")
                    continueLink(l)
                } else if model.error == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(40)
                }
            }
            .padding(.horizontal, Metrics.page)
            .padding(.top, 8).padding(.bottom, 28)
            .kePage()
        }
    }

    private func thb(_ u: BigUInt) -> String { Money.thb(u, rate: model.thbPerUsdt) }

    /// The index holds only part of this escrow's story: it was paid into but the index has no Funded event, or it is
    /// settled but the index has no Settled event. Numbers that come from events are then unknown, and the page says
    /// so instead of showing zero.
    private var historyIncomplete: Bool {
        guard let l = model.lease, l.startedAt != nil else { return false }
        let names = Set(model.events.map(\.name))
        return !names.contains("Funded") || (l.status == "Settled" && !names.contains("Settled"))
    }

    /// The payout numbers (owner got, back to renter, fee) are known: the events are complete, or the settling
    /// receipt was read.
    private var payoutKnown: Bool { !historyIncomplete || model.settledOutcome != nil }

    /// Money that moved. From the indexed events; where those are missing, from what the chain itself still tells:
    /// the settling receipt for the payout, the escrow's own terms for what was paid in (deposit + rent for every
    /// period paid, exactly what fund() and payRent() take).
    private func flow(_ l: Lease) -> RentalStory.Flow {
        var f = RentalStory.payout(events: model.events, receipt: model.settledOutcome)
        if l.startedAt != nil, !model.events.contains(where: { $0.name == "Funded" }) {
            f.paidIn = l.deposit.units + l.rent.units.multiplied(by: UInt32(clamping: max(1, l.periodsFunded)))
        }
        return f
    }

    // MARK: Photo + banner

    /// The listing's photo and name, when this phone knows which listing the escrow was made for.
    @ViewBuilder private var photoStrip: some View {
        if let known = RentalAlbum.listing(forLease: address), PhotoCatalog.asset(forListing: known.id) != nil {
            ZStack(alignment: .bottomLeading) {
                ListingPhoto(listingId: known.id)
                LinearGradient(colors: [.clear, Color.KE.night.opacity(0.85)], startPoint: .center, endPoint: .bottom)
                VStack(alignment: .leading, spacing: 2) {
                    Text(known.name).font(Font.KE.section).foregroundStyle(.white)
                    Text(EthAddress.short(address)).font(Font.KE.monoSmall).foregroundStyle(.white.opacity(0.8))
                }
                .padding(16)
            }
            .frame(minHeight: 176)
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: Metrics.radius, style: .continuous))
            .accessibilityElement(children: .combine)
        }
    }

    private func banner(_ l: Lease) -> some View {
        let (tone, key, args) = RentalStory.banner(l, me: wallet.address, flow: flow(l), payoutKnown: payoutKnown, fmt: thb)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                IconBadge(symbol: symbol(forStatus: l.status), tint: tone.fg, fill: Color.KE.surface, size: 36)
                Text(settings.t("status.\(l.status)")).font(Font.KE.kicker).textCase(.uppercase).tracking(0.5).foregroundStyle(tone.fg)
            }
            Text(settings.t(key, args)).font(Font.KE.title).monospacedDigit().foregroundStyle(Color.KE.foreground).fixedSize(horizontal: false, vertical: true)
            Text(settings.t("\(key).body")).font(.subheadline).foregroundStyle(Color.KE.mutedText).fixedSize(horizontal: false, vertical: true)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tone.bg, in: RoundedRectangle(cornerRadius: Metrics.radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Metrics.radius, style: .continuous).strokeBorder(tone.fg.opacity(0.22)))
        .accessibilityElement(children: .combine)
    }

    // MARK: Money

    private struct Tile: Identifiable { let id: String; let amount: BigUInt; let icon: String; let tint: Color; let fill: Color; var live = false }

    private func moneyStrip(_ l: Lease) -> some View {
        let f = flow(l)
        let tiles = [
            Tile(id: "money.paid", amount: f.paidIn, icon: "arrow.down.circle.fill", tint: .KE.info, fill: .KE.infoSoft, live: true),
            Tile(id: "money.escrow", amount: l.escrowBalance.units, icon: "lock.fill", tint: .KE.warning, fill: .KE.warningSoft, live: true),
            Tile(id: "money.owner", amount: f.toOwner, icon: "storefront.fill", tint: .KE.mutedText, fill: .KE.muted),
            Tile(id: "money.back", amount: f.backToRenter, icon: "arrow.uturn.backward.circle.fill", tint: .KE.success, fill: .KE.successSoft),
        ]
        let unknown = !payoutKnown
        let paidOut = payoutKnown && f.backToRenter + f.toOwner + f.fee > BigUInt()
        return VStack(alignment: .leading, spacing: 10) {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(tiles) { t in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            IconBadge(symbol: t.icon, tint: t.tint, fill: t.fill, size: 30)
                            Text(settings.t(t.id)).font(.caption.weight(.semibold)).foregroundStyle(Color.KE.mutedText).lineLimit(2).minimumScaleFactor(0.85)
                        }
                        Text(unknown && !t.live ? "–" : thb(t.amount)).font(Font.KE.amountSmall).monospacedDigit().foregroundStyle(Color.KE.foreground).minimumScaleFactor(0.5).lineLimit(1)
                        Text(unknown && !t.live ? " " : Money.usdt(t.amount)).font(.caption).monospacedDigit().foregroundStyle(Color.KE.subtle).lineLimit(1).minimumScaleFactor(0.8)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .keSurface(radius: 18)
                    .accessibilityElement(children: .combine)
                }
            }
            if paidOut {
                Card(padding: 16, spacing: 12) {
                    Text(settings.t("money.split")).font(Font.KE.label).foregroundStyle(Color.KE.mutedText)
                    SplitBar(parts: [
                        SplitPart(id: "back", label: settings.t("money.back"), value: Money.tokens(f.backToRenter).double, color: .KE.success, detail: thb(f.backToRenter)),
                        SplitPart(id: "owner", label: settings.t("money.owner"), value: Money.tokens(f.toOwner).double, color: .KE.info, detail: thb(f.toOwner)),
                        SplitPart(id: "fee", label: settings.t("money.feeShort"), value: Money.tokens(f.fee).double, color: .KE.amber, detail: thb(f.fee)),
                    ])
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                if f.fee > BigUInt(), !paidOut { Text(settings.t("money.fee", thb(f.fee))) }
                if model.priceMock { Text(settings.t("money.demoRate", String(format: "%.2f", model.thbPerUsdt))) }
            }
            .font(.caption).foregroundStyle(Color.KE.subtle)
        }
    }

    // MARK: Periods

    private func periodStrip(_ l: Lease) -> some View {
        let cells = RentalStory.periods(l)
        return Card {
            HStack(spacing: 12) {
                IconBadge(symbol: "calendar", tint: .KE.mutedText, fill: .KE.muted, size: 36)
                Text(settings.t("detail.periods", "\(l.termPeriods)", "\(Int(l.rentPeriodDays))")).font(Font.KE.headline).foregroundStyle(Color.KE.foreground)
            }
            if cells.isEmpty {
                Text(settings.t("detail.notStarted")).font(.subheadline).foregroundStyle(Color.KE.mutedText)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: min(6, max(1, cells.count))), spacing: 6) {
                    ForEach(Array(cells.enumerated()), id: \.offset) { i, c in
                        VStack(spacing: 2) {
                            Text("\(i + 1)").font(.caption.weight(.bold)).monospacedDigit()
                            Text(settings.t("period.\(c.rawValue)")).font(.caption2).lineLimit(1).minimumScaleFactor(0.7)
                        }
                        .frame(maxWidth: .infinity, minHeight: 46)
                        .foregroundStyle(c == .out ? Color.KE.success : c == .held ? Color.KE.info : Color.KE.mutedText)
                        .background(c == .out ? Color.KE.successSoft : c == .held ? Color.KE.infoSoft : Color.KE.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .accessibilityElement(children: .combine)
                    }
                }
                DashedRule()
                KVRow(label: settings.t("detail.rentPer"), value: thb(l.rent.units), sub: l.rent.display)
                KVRow(label: settings.t("listing.deposit"), value: thb(l.deposit.units), sub: l.deposit.display)
            }
        }
    }

    // MARK: Timeline

    /// Every on-chain event of this rental, oldest first, on a rail: an icon per kind, the time, the BscScan link.
    private var timeline: some View {
        Card(spacing: 14) {
            HStack(spacing: 12) {
                IconBadge(symbol: "clock.arrow.circlepath", tint: .KE.amber, fill: .KE.amberSoft, size: 36)
                Text(settings.t("detail.timeline")).font(Font.KE.headline).foregroundStyle(Color.KE.foreground)
            }
            if !model.historyLoaded && model.events.isEmpty {
                HStack(spacing: 10) { ProgressView(); Text(settings.t("detail.loadingHistory")).font(.subheadline).foregroundStyle(Color.KE.mutedText) }
            } else if model.historyLoaded && historyIncomplete {
                Notice(text: settings.t("detail.indexBehind"), tone: .warn)
            } else if model.events.isEmpty {
                Text(settings.t("detail.noEvents")).font(.subheadline).foregroundStyle(Color.KE.mutedText)
            }
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(model.events.enumerated()), id: \.element.id) { i, e in
                    let style = eventStyle(e)
                    let last = i == model.events.count - 1
                    Link(destination: Chain.txURL(e.txHash)) {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: style.icon)
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(style.tone.fg)
                                .frame(width: 32, height: 32)
                                .background(style.tone.bg, in: Circle())
                                .overlay(Circle().strokeBorder(style.tone.fg.opacity(0.25)))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(eventLabel(e)).font(.subheadline.weight(.semibold)).foregroundStyle(Color.KE.foreground).multilineTextAlignment(.leading)
                                Text(e.date.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(Color.KE.mutedText)
                                Text(EthAddress.short(e.txHash)).font(Font.KE.monoSmall).foregroundStyle(Color.KE.subtle)
                            }
                            .padding(.top, 4)
                            Spacer(minLength: 8)
                            Image(systemName: "arrow.up.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.KE.mutedText).padding(.top, 8)
                        }
                        .padding(.bottom, last ? 0 : 16)
                        .frame(minHeight: 44, alignment: .top)
                        .background(alignment: .topLeading) {
                            if !last { Rectangle().fill(Color.KE.border).frame(width: 2).padding(.leading, 15).padding(.top, 36).padding(.bottom, -2) }
                        }
                        .contentShape(Rectangle())
                    }
                    .accessibilityHint("BscScan")
                }
            }
        }
    }

    private func eventStyle(_ e: ChainIndex.Event) -> (icon: String, tone: Tone) {
        switch e.name {
        case "LeaseCreated": return ("doc.badge.plus", .info)
        case "Funded": return ("lock.fill", .warn)
        case "EvidenceAdded": return (e.args["kind"]?.int == 1 ? "camera.rotate.fill" : "camera.fill", .neutral)
        case "SettlementProposed": return ("sparkles", .warn)
        case "Settled": return ("checkmark.seal.fill", .ok)
        case "RentReleased": return ("banknote.fill", .ok)
        case "RentPaid": return ("plus.circle.fill", .info)
        case "ProtocolFeePaid": return ("percent", .neutral)
        case "DisputeRaised": return ("exclamationmark.bubble.fill", .danger)
        case "Cancelled": return ("xmark.circle.fill", .neutral)
        default: return ("circle.fill", .neutral)
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

    // MARK: Contract

    private func parties(_ l: Lease) -> some View {
        Card {
            HStack(spacing: 12) {
                IconBadge(symbol: "doc.text.fill", tint: .KE.mutedText, fill: .KE.muted, size: 36)
                Text(settings.t("detail.contract")).font(Font.KE.headline).foregroundStyle(Color.KE.foreground)
            }
            Link(destination: Chain.addressURL(l.address)) {
                HStack(alignment: .firstTextBaseline) {
                    Text(settings.t("detail.escrow")).foregroundStyle(Color.KE.mutedText)
                    Spacer(minLength: 12)
                    Text(EthAddress.short(l.address)).font(Font.KE.mono).foregroundStyle(Color.KE.foreground)
                    Image(systemName: "arrow.up.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.KE.mutedText)
                }
                .frame(minHeight: 44)
            }
            .accessibilityHint("BscScan")
            party("role.owner", l.owner)
            party("role.renter", l.renter)
            party("role.arbiter", l.arbiter)
            CopyButton(text: l.address, label: settings.t("detail.copyEscrow"))
        }
    }

    private func party(_ key: String, _ address: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(settings.t(key)).foregroundStyle(Color.KE.mutedText)
            if EthAddress.same(address, wallet.address) { Pill(text: settings.t("detail.you"), tone: .ok) }
            Spacer(minLength: 12)
            Text(EthAddress.short(address)).font(Font.KE.mono).foregroundStyle(Color.KE.foreground)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func continueLink(_ l: Lease) -> some View {
        if !l.isFinal, EthAddress.same(l.renter, wallet.address) {
            let listing: Listing? = ShopRentals.scooter(forLease: l.address).map { id in
                Listing(id: id, kind: .demoScooter, name: ShopRentals.name(of: id) ?? id, location: "", description: "", photo: nil, rentThb: 0, depositThb: 0, perDay: false, symbol: "scooter", vault: false)
            } ?? (l.termPeriods == 1 && Int(l.rentPeriodDays) == 30 ? Listing.offline.first : nil)
            if let listing {
                NavigationLink { RentFlowView(listing: listing, wallet: wallet) } label: {
                    PrimaryLabel(title: settings.t("detail.continue"), icon: "arrow.right.circle.fill")
                }
                .buttonStyle(PressStyle())
            }
        }
    }
}

private extension Decimal {
    var double: Double { NSDecimalNumber(decimal: self).doubleValue }
}
