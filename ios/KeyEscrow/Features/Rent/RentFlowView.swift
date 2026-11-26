import SwiftUI

/// The judge-phone flow as native screens: one big card per step, every transaction signed on this phone with the
/// guest wallet and linked to BscScan as soon as it is mined.
struct RentFlowView: View {
    @EnvironmentObject var settings: AppSettings
    @StateObject private var model: RentFlowModel
    @State private var showCamera = false

    init(listing: Listing, wallet: WalletStore) {
        _model = StateObject(wrappedValue: RentFlowModel(listing: listing, wallet: wallet))
    }

    private var t: (String) -> String { { settings.t($0) } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                progress
                stepCard.accessibilityIdentifier("flow-step-\(model.step.rawValue)")
                if let n = model.note { Notice(text: n, tone: .info) }
                if let e = model.error { Notice(text: e, tone: .danger).accessibilityIdentifier("flow-error") }
                if !model.sent.isEmpty {
                    Card {
                        Text(settings.t("flow.txs")).font(.headline)
                        ForEach(model.sent, id: \.hash) { TxLinkRow(label: $0.description, hash: $0.hash) }
                    }
                }
                if let l = model.lease {
                    NavigationLink { RentalDetailView(address: l.address) } label: {
                        Label(settings.t("flow.openRental"), systemImage: "doc.text.magnifyingglass").frame(minHeight: 44)
                    }
                }
                footer
            }
            .padding(16)
        }
        .keScreen()
        .navigationTitle(settings.t("flow.title"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.refresh() }
        .task {
            await model.refresh()
            // Follow the chain while the screen is open: fast while someone else has to act, slower otherwise.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: model.step == .waiting || model.step == .busy ? 3_000_000_000 : 8_000_000_000)
                if model.busy == nil { await model.refresh() }
            }
        }
        .sheet(isPresented: $showCamera) {
            CameraPicker { img in if let p = CapturedPhoto(image: img) { model.photos = Array((model.photos + [p]).suffix(3)) } }.ignoresSafeArea()
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: model.listing.symbol).font(.title2).foregroundStyle(Color.KE.amber)
                .frame(width: 56, height: 56).background(Color.KE.night, in: RoundedRectangle(cornerRadius: 14))
            VStack(alignment: .leading, spacing: 2) {
                Text(model.listing.name).font(.headline)
                Text(settings.t("flow.terms", Money.thb(model.price.rent, rate: model.thbPerUsdt), Money.thb(model.price.deposit, rate: model.thbPerUsdt)))
                    .font(.subheadline).foregroundStyle(Color.KE.mutedText)
            }
        }
    }

    private static let order: [RentFlowModel.Step] = [.money, .rent, .pickup, .giveBack, .inspect, .waiting, .settled]
    private var progress: some View {
        let idx = Self.order.firstIndex(of: model.step == .fund ? .rent : model.step) ?? 0
        return HStack(spacing: 4) {
            ForEach(0..<Self.order.count, id: \.self) { i in
                Capsule().fill(i <= idx ? Color.KE.amber : Color.KE.muted).frame(height: 6)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(settings.t("flow.progress", "\(idx + 1)", "\(Self.order.count)"))
    }

    @ViewBuilder private var stepCard: some View {
        switch model.step {
        case .loading:
            Card { HStack { ProgressView(); Text(settings.t("common.loading")) } }
        case .money:
            Card {
                Text(settings.t("flow.money.title")).font(.title2.weight(.bold))
                Text(settings.t("flow.money.body", model.thb(model.price.rent + model.price.deposit))).foregroundStyle(Color.KE.mutedText)
                PrimaryButton(title: settings.t("flow.money.button"), icon: "drop.fill", busy: model.busy == "money") { model.getTestMoney(t: t) }
                    .accessibilityIdentifier("flow-money")
            }
        case .rent, .fund:
            Card {
                Text(settings.t("flow.rent.title", model.thb(model.price.rent))).font(.title2.weight(.bold))
                let terms = model.lease.map { ($0.rent.units, $0.deposit.units) } ?? (model.price.rent, model.price.deposit)
                KVRow(label: settings.t(model.listing.perDay ? "flow.rent.rentDay" : "flow.rent.rentMonth"), value: model.thb(terms.0), sub: Money.usdt(terms.0))
                KVRow(label: settings.t("flow.rent.deposit"), value: model.thb(terms.1), sub: Money.usdt(terms.1))
                Text(settings.t(model.listing.kind == .stage ? "flow.rent.body" : "flow.rent.bodyShop")).font(.subheadline).foregroundStyle(Color.KE.mutedText)
                PrimaryButton(title: settings.t("flow.rent.button"), icon: "lock.fill", busy: model.busy == "rent") {
                    model.step == .fund ? model.payExisting() : model.rent(t: t)
                }
                .accessibilityIdentifier("flow-rent")
            }
        case .busy:
            Card {
                Text(settings.t("flow.busy.title")).font(.title2.weight(.bold))
                Text(settings.t("flow.busy.body")).foregroundStyle(Color.KE.mutedText)
            }
        case .pickup, .giveBack:
            photoCard(kind: model.step == .pickup ? "check_in" : "check_out")
        case .inspect:
            inspectCard
        case .waiting:
            Card {
                Text(settings.t("flow.waiting.title")).font(.title2.weight(.bold))
                if let p = model.lease?.proposal {
                    KVRow(label: settings.t("flow.inspect.back"), value: model.thb(p.toRenter.units), sub: p.toRenter.display)
                    KVRow(label: settings.t("flow.inspect.owner"), value: model.thb(p.toOwner.units), sub: p.toOwner.display)
                }
                if model.lease?.status == "Disputed" {
                    Text(settings.t("flow.waiting.disputed")).foregroundStyle(Color.KE.mutedText)
                } else if model.listing.kind == .stage {
                    Text(settings.t("flow.waiting.stage")).foregroundStyle(Color.KE.mutedText)
                    HStack { ProgressView(); Text(settings.t("flow.waiting.watching")).font(.footnote).foregroundStyle(Color.KE.subtle) }
                } else {
                    Text(settings.t("flow.waiting.shop")).font(.subheadline).foregroundStyle(Color.KE.mutedText)
                    PrimaryButton(title: settings.t("flow.waiting.shopAccept"), icon: "hand.thumbsup.fill", busy: model.busy == "accept") { model.shopAccepts() }
                        .accessibilityIdentifier("flow-shop-accept")
                }
            }
        case .settled:
            Card {
                Image(systemName: "checkmark.circle.fill").font(.largeTitle).foregroundStyle(Color.KE.success)
                Text(settings.t("flow.settled.title", model.thb(model.settledBack ?? BigUInt()))).font(.title2.weight(.bold)).accessibilityIdentifier("flow-settled")
                Text(settings.t("flow.settled.body", model.listing.name)).foregroundStyle(Color.KE.mutedText)
                if let h = model.settledTx { TxLinkRow(label: settings.t("flow.settled.bscscan"), hash: h) }
                if model.listing.kind == .demoScooter { SecondaryButton(title: settings.t("flow.again"), icon: "arrow.counterclockwise") { model.startOver() } }
            }
        case .cancelled:
            Card { Text(settings.t("status.Cancelled")) }
        }
    }

    private func photoCard(kind: String) -> some View {
        let pickup = kind == "check_in"
        return Card {
            Text(settings.t(pickup ? "flow.pickup.title" : "flow.return.title")).font(.title2.weight(.bold))
            Text(settings.t(pickup ? "flow.pickup.body" : "flow.return.body")).foregroundStyle(Color.KE.mutedText)
            if !model.photos.isEmpty {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                    ForEach(model.photos) { p in
                        Image(uiImage: p.image).resizable().scaledToFill().frame(height: 96).frame(maxWidth: .infinity).clipped()
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .accessibilityLabel(settings.t("flow.photo.alt"))
                    }
                }
                Text(model.photos.map { "SHA-256 " + EthAddress.short($0.sha256) }.joined(separator: "\n")).font(.caption.monospaced()).foregroundStyle(Color.KE.subtle)
            }
            if CameraPicker.available {
                SecondaryButton(title: settings.t(model.photos.isEmpty ? "flow.photo.open" : "flow.photo.another"), icon: "camera.fill", disabled: model.busy != nil) { showCamera = true }
            } else {
                SecondaryButton(title: settings.t("flow.photo.sample"), icon: "photo.badge.plus", disabled: model.busy != nil) {
                    if let p = CapturedPhoto.sample(title: model.listing.name, kind: pickup ? "PICKUP" : "RETURN") { model.photos = Array((model.photos + [p]).suffix(3)) }
                }
                .accessibilityIdentifier("flow-sample-photo")
                Text(settings.t("flow.photo.noCamera")).font(.caption).foregroundStyle(Color.KE.subtle)
            }
            PrimaryButton(title: settings.t("flow.photo.save", "\(model.photos.count)"), icon: "link", busy: model.busy == "photos", disabled: model.photos.isEmpty) {
                model.savePhotos(kind: kind)
            }
            .accessibilityIdentifier("flow-save-photos")
        }
    }

    private var inspectCard: some View {
        Card {
            Text(settings.t("flow.inspect.title")).font(.title2.weight(.bold))
            if let i = model.inspection {
                KVRow(label: settings.t("flow.inspect.back"), value: model.thb(i.tenantRefund), sub: Money.usdt(i.tenantRefund))
                KVRow(label: settings.t("flow.inspect.owner"), value: model.thb(i.landlordClaim), sub: Money.usdt(i.landlordClaim))
                ForEach(i.reasons, id: \.self) { r in Label(r, systemImage: "wrench.and.screwdriver").font(.subheadline).foregroundStyle(Color.KE.mutedText) }
                Text(settings.t("flow.inspect.confidence", "\(Int((i.confidence * 100).rounded()))")).font(.caption).foregroundStyle(Color.KE.subtle)
                if let mem = i.memory?.recalled, !mem.isEmpty { Text(settings.t("flow.inspect.memory", "\(mem.count)")).font(.caption).foregroundStyle(Color.KE.subtle) }
                if i.mock { Text(settings.t("flow.inspect.mock")).font(.caption).foregroundStyle(Color.KE.subtle) }
                Text(settings.t("flow.inspect.agent")).font(.caption).foregroundStyle(Color.KE.subtle)
                PrimaryButton(title: settings.t("flow.inspect.propose"), icon: "paperplane.fill", busy: model.busy == "propose") { model.proposeSplit() }
                    .accessibilityIdentifier("flow-propose")
            } else {
                Text(settings.t("flow.inspect.body")).foregroundStyle(Color.KE.mutedText)
                let ready = !model.photoHashes(kind: 0).isEmpty && !model.photoHashes(kind: 1).isEmpty
                PrimaryButton(title: settings.t("flow.inspect.run"), icon: "sparkles", busy: model.busy == "inspect", disabled: !ready) { model.runInspection() }
                    .accessibilityIdentifier("flow-inspect")
                if !ready { Text(settings.t("flow.inspect.waitingPhotos")).font(.caption).foregroundStyle(Color.KE.subtle) }
            }
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(settings.t("wallet.guestLabel") + " · " + EthAddress.short(model.me)).font(.footnote.monospaced())
            if model.listing.kind == .demoScooter { Text(settings.t("wallet.shopLabel") + " · " + EthAddress.short(model.wallet.shop.address)).font(.footnote.monospaced()) }
        }
        .foregroundStyle(Color.KE.subtle)
    }
}
