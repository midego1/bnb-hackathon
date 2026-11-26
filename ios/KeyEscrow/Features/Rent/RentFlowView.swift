import SwiftUI

/// The judge-phone flow as native screens: a named stepper, one card per step, every transaction signed on this phone
/// with the guest wallet and added to the receipt (with its BscScan link) as soon as it is mined.
struct RentFlowView: View {
    @EnvironmentObject var settings: AppSettings
    @StateObject private var model: RentFlowModel
    @State private var showCamera = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(listing: Listing, wallet: WalletStore) {
        _model = StateObject(wrappedValue: RentFlowModel(listing: listing, wallet: wallet))
    }

    private var t: (String) -> String { { settings.t($0) } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Metrics.gap) {
                header
                stepper
                // Each step arrives as its own card: a short rise and fade (none under Reduce Motion).
                stepCard
                    .id(model.step)
                    .transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: 14)), removal: .opacity))
                if let n = model.note { working(n) }
                if let e = model.error { Notice(text: e, tone: .danger).accessibilityIdentifier("flow-error") }
                receipt
                if let l = model.lease {
                    NavigationLink { RentalDetailView(address: l.address) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "doc.text.magnifyingglass")
                            Text(settings.t("flow.openRental")).multilineTextAlignment(.leading)
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.KE.subtle)
                        }
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Color.KE.foreground)
                        .padding(.horizontal, 16).frame(minHeight: 52)
                        .keSurface(radius: 16)
                    }
                    .buttonStyle(PressStyle())
                }
                footer
            }
            .padding(Metrics.page)
            .kePage()
            .animation(reduceMotion ? nil : .easeOut(duration: 0.28), value: model.step)
        }
        .keScreen()
        .navigationTitle(settings.t("flow.title"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
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
        // Remember which listing this escrow belongs to, so My rentals can show its photo (display only).
        .onChange(of: model.lease?.address, initial: true) { _, a in if let a { RentalAlbum.remember(lease: a, listing: model.listing) } }
        // A tap you can feel when a step lands, a success when the money is back, a warning when something fails.
        .sensoryFeedback(trigger: model.step) { old, new in Self.feedback(from: old, to: new) }
        .sensoryFeedback(.error, trigger: model.error) { _, new in new != nil }
    }

    private static func feedback(from old: RentFlowModel.Step, to new: RentFlowModel.Step) -> SensoryFeedback? {
        if old == .loading { return nil } // opening the screen is not an event
        return new == .settled ? .success : .impact(weight: .light)
    }

    // MARK: Header + stepper

    private var header: some View {
        HStack(spacing: 14) {
            ListingThumb(listingId: model.listing.id, side: 64, symbol: model.listing.symbol)
            VStack(alignment: .leading, spacing: 3) {
                Text(model.listing.name).font(Font.KE.headline).foregroundStyle(Color.KE.foreground)
                Text(settings.t("flow.terms", Money.thb(model.price.rent, rate: model.thbPerUsdt), Money.thb(model.price.deposit, rate: model.thbPerUsdt)))
                    .font(.subheadline).monospacedDigit().foregroundStyle(Color.KE.mutedText)
                if model.listing.kind == .demoScooter { Text(settings.t("badge.demo")).font(.caption.weight(.semibold)).foregroundStyle(Color.KE.info) }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private static let order: [RentFlowModel.Step] = [.money, .rent, .pickup, .giveBack, .inspect, .waiting, .settled]
    private static let names = ["flow.step.money", "flow.step.pay", "flow.step.pickup", "flow.step.return", "flow.step.inspect", "flow.step.accept", "flow.step.done"]

    private var stepper: some View {
        // Loading, "someone else is renting it" and "cancelled" are not steps: then no dot is the current one.
        let idx = Self.order.firstIndex(of: model.step == .fund ? .rent : model.step)
        return FlowStepper(titles: Self.names.map { settings.t($0) }, current: idx ?? -1, finished: model.step == .settled,
                           caption: idx.map { settings.t("flow.progress", "\($0 + 1)", "\(Self.order.count)") } ?? settings.t("flow.title"))
    }

    /// What the app is doing right now, while a step is being signed and mined.
    private func working(_ text: String) -> some View {
        HStack(spacing: 10) {
            ProgressView()
            Text(text).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
        }
        .foregroundStyle(Color.KE.info)
        .padding(14)
        .background(Color.KE.infoSoft, in: RoundedRectangle(cornerRadius: Metrics.radiusSmall, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    // MARK: Step cards

    private func card<C: View>(_ icon: String, _ title: String, tint: Color = .KE.amber, fill: Color = .KE.amberSoft, @ViewBuilder _ content: () -> C) -> some View {
        Card(spacing: 14) {
            HStack(alignment: .center, spacing: 12) {
                IconBadge(symbol: icon, tint: tint, fill: fill, size: 44)
                Text(title).font(Font.KE.title).foregroundStyle(Color.KE.foreground).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            content()
        }
    }

    private func bodyText(_ s: String) -> some View {
        Text(s).font(.subheadline).foregroundStyle(Color.KE.mutedText).fixedSize(horizontal: false, vertical: true)
    }

    private func fine(_ s: String) -> some View {
        Text(s).font(.caption).foregroundStyle(Color.KE.subtle).fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var stepCard: some View {
        switch model.step {
        case .loading:
            Card { HStack(spacing: 10) { ProgressView(); Text(settings.t("common.loading")).foregroundStyle(Color.KE.mutedText) }.frame(minHeight: 44) }
        case .money:
            card("drop.fill", settings.t("flow.money.title"), tint: .KE.info, fill: .KE.infoSoft) {
                bodyText(settings.t("flow.money.body", model.thb(model.price.rent + model.price.deposit)))
                PrimaryButton(title: settings.t("flow.money.button"), icon: "drop.fill", busy: model.busy == "money") { model.getTestMoney(t: t) }
                    .accessibilityIdentifier("flow-money")
            }
        case .rent, .fund:
            card("lock.fill", settings.t("flow.rent.title", model.thb(model.price.rent))) {
                let terms = model.lease.map { ($0.rent.units, $0.deposit.units) } ?? (model.price.rent, model.price.deposit)
                VStack(spacing: 10) {
                    KVRow(label: settings.t(model.listing.perDay ? "flow.rent.rentDay" : "flow.rent.rentMonth"), value: model.thb(terms.0), sub: Money.usdt(terms.0))
                    KVRow(label: settings.t("flow.rent.deposit"), value: model.thb(terms.1), sub: Money.usdt(terms.1))
                    DashedRule()
                    KVRow(label: settings.t("flow.rent.total"), value: model.thb(terms.0 + terms.1), sub: Money.usdt(terms.0 + terms.1), strong: true)
                }
                bodyText(settings.t(model.listing.kind == .stage ? "flow.rent.body" : "flow.rent.bodyShop"))
                PrimaryButton(title: settings.t("flow.rent.button"), icon: "lock.fill", busy: model.busy == "rent") {
                    model.step == .fund ? model.payExisting() : model.rent(t: t)
                }
                .accessibilityIdentifier("flow-rent")
            }
        case .busy:
            card("person.2.fill", settings.t("flow.busy.title"), tint: .KE.warning, fill: .KE.warningSoft) {
                bodyText(settings.t("flow.busy.body"))
            }
        case .pickup, .giveBack:
            photoCard(kind: model.step == .pickup ? "check_in" : "check_out")
        case .inspect:
            inspectCard
        case .waiting:
            waitingCard
        case .settled:
            settledCard
        case .cancelled:
            card("xmark.circle.fill", settings.t("status.Cancelled"), tint: .KE.mutedText, fill: .KE.muted) {
                bodyText(settings.t("banner.cancelled.body"))
            }
        }
    }

    private func photoCard(kind: String) -> some View {
        let pickup = kind == "check_in"
        return card(pickup ? "camera.fill" : "camera.rotate.fill", settings.t(pickup ? "flow.pickup.title" : "flow.return.title")) {
            bodyText(settings.t(pickup ? "flow.pickup.body" : "flow.return.body"))
            // Three slots: the photos taken so far (each with the ends of its SHA-256 fingerprint), the rest waiting.
            HStack(alignment: .top, spacing: 8) {
                ForEach(0..<3, id: \.self) { i in
                    let p = i < model.photos.count ? model.photos[i] : nil
                    VStack(alignment: .leading, spacing: 4) {
                        Color.KE.muted
                            .aspectRatio(1, contentMode: .fit)
                            .overlay {
                                if let p {
                                    Image(uiImage: p.image).resizable().scaledToFill()
                                } else {
                                    Image(systemName: "camera").font(.title3).foregroundStyle(Color.KE.subtle.opacity(0.6))
                                }
                            }
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay {
                                if p == nil {
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .strokeBorder(Color.KE.borderStrong, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                                }
                            }
                            .accessibilityLabel(p == nil ? "" : settings.t("flow.photo.alt"))
                            .accessibilityHidden(p == nil)
                        Text(p.map { EthAddress.short($0.sha256) } ?? " ")
                            .font(.system(.caption2, design: .monospaced)).foregroundStyle(Color.KE.subtle)
                            .lineLimit(1).minimumScaleFactor(0.6)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            if !model.photos.isEmpty { fine(settings.t("flow.photo.hashes")) }
            if CameraPicker.available {
                SecondaryButton(title: settings.t(model.photos.isEmpty ? "flow.photo.open" : "flow.photo.another"), icon: "camera.fill", disabled: model.busy != nil) { showCamera = true }
            } else {
                SecondaryButton(title: settings.t("flow.photo.sample"), icon: "photo.badge.plus", disabled: model.busy != nil) {
                    if let p = CapturedPhoto.sample(title: model.listing.name, kind: pickup ? "PICKUP" : "RETURN") { model.photos = Array((model.photos + [p]).suffix(3)) }
                }
                .accessibilityIdentifier("flow-sample-\(kind)")
                fine(settings.t("flow.photo.noCamera"))
            }
            PrimaryButton(title: settings.t("flow.photo.save", "\(model.photos.count)"), icon: "link", busy: model.busy == "photos", disabled: model.photos.isEmpty) {
                model.savePhotos(kind: kind)
            }
            .accessibilityIdentifier("flow-save-\(kind)")
        }
    }

    private var inspectCard: some View {
        card("sparkles", settings.t("flow.inspect.title")) {
            if let i = model.inspection {
                SplitBar(parts: [
                    SplitPart(id: "back", label: settings.t("flow.inspect.back"), value: Money.tokens(i.tenantRefund).doubleValue, color: .KE.success, detail: model.thb(i.tenantRefund)),
                    SplitPart(id: "owner", label: settings.t("flow.inspect.owner"), value: Money.tokens(i.landlordClaim).doubleValue, color: .KE.info, detail: model.thb(i.landlordClaim)),
                ])
                VStack(spacing: 10) {
                    KVRow(label: settings.t("flow.inspect.back"), value: model.thb(i.tenantRefund), sub: Money.usdt(i.tenantRefund), strong: true)
                    KVRow(label: settings.t("flow.inspect.owner"), value: model.thb(i.landlordClaim), sub: Money.usdt(i.landlordClaim))
                }
                if !i.reasons.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(i.reasons, id: \.self) { r in
                            Label { Text(r).fixedSize(horizontal: false, vertical: true) } icon: { Image(systemName: "wrench.and.screwdriver.fill").foregroundStyle(Color.KE.warning) }
                                .font(.subheadline).foregroundStyle(Color.KE.foreground)
                        }
                    }
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.KE.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                VStack(alignment: .leading, spacing: 4) {
                    fine(settings.t("flow.inspect.confidence", "\(Int((i.confidence * 100).rounded()))"))
                    if let mem = i.memory?.recalled, !mem.isEmpty { fine(settings.t("flow.inspect.memory", "\(mem.count)")) }
                    if i.mock { fine(settings.t("flow.inspect.mock")) }
                    fine(settings.t("flow.inspect.agent"))
                }
                PrimaryButton(title: settings.t("flow.inspect.propose"), icon: "paperplane.fill", busy: model.busy == "propose") { model.proposeSplit() }
                    .accessibilityIdentifier("flow-propose")
            } else {
                bodyText(settings.t("flow.inspect.body"))
                let ready = !model.photoHashes(kind: 0).isEmpty && !model.photoHashes(kind: 1).isEmpty
                PrimaryButton(title: settings.t("flow.inspect.run"), icon: "sparkles", busy: model.busy == "inspect", disabled: !ready) { model.runInspection() }
                    .accessibilityIdentifier("flow-inspect")
                if !ready { fine(settings.t("flow.inspect.waitingPhotos")) }
            }
        }
    }

    private var waitingCard: some View {
        let disputed = model.lease?.status == "Disputed"
        return card(disputed ? "exclamationmark.bubble.fill" : "hourglass", settings.t("flow.waiting.title"),
                    tint: disputed ? .KE.danger : .KE.warning, fill: disputed ? .KE.dangerSoft : .KE.warningSoft) {
            if let p = model.lease?.proposal {
                VStack(spacing: 10) {
                    KVRow(label: settings.t("flow.inspect.back"), value: model.thb(p.toRenter.units), sub: p.toRenter.display, strong: true)
                    KVRow(label: settings.t("flow.inspect.owner"), value: model.thb(p.toOwner.units), sub: p.toOwner.display)
                }
            }
            if disputed {
                bodyText(settings.t("flow.waiting.disputed"))
            } else if model.listing.kind == .stage {
                bodyText(settings.t("flow.waiting.stage"))
                HStack(spacing: 8) { ProgressView(); fine(settings.t("flow.waiting.watching")) }
            } else {
                bodyText(settings.t("flow.waiting.shop"))
                PrimaryButton(title: settings.t("flow.waiting.shopAccept"), icon: "hand.thumbsup.fill", busy: model.busy == "accept") { model.shopAccepts() }
                    .accessibilityIdentifier("flow-shop-accept")
            }
        }
    }

    /// The end of the story: the tick, the amount that came back, and how the escrow paid out.
    private var settledCard: some View {
        let flow = model.settledFlow
        return Card(spacing: 16) {
            VStack(spacing: 12) {
                SuccessCheck()
                if DesignMode.led, let back = model.settledBack {
                    LEDAmount(text: model.thb(back), dot: 4)
                }
                Group {
                    if let back = model.settledBack {
                        Text(settings.t("flow.settled.title", model.thb(back)))
                    } else {
                        Text(settings.t("flow.settled.titlePlain"))
                    }
                }
                .font(Font.KE.display).monospacedDigit()
                .foregroundStyle(Color.KE.foreground)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("flow-settled")
                Text(settings.t("flow.settled.body", model.listing.name))
                    .font(.subheadline).foregroundStyle(Color.KE.mutedText).multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 6)
            if model.settledBack != nil, flow.backToRenter + flow.toOwner + flow.fee > BigUInt() {
                DashedRule()
                SplitBar(parts: [
                    SplitPart(id: "back", label: settings.t("flow.inspect.back"), value: Money.tokens(flow.backToRenter).doubleValue, color: .KE.success, detail: model.thb(flow.backToRenter)),
                    SplitPart(id: "owner", label: settings.t("flow.inspect.owner"), value: Money.tokens(flow.toOwner).doubleValue, color: .KE.info, detail: model.thb(flow.toOwner)),
                    SplitPart(id: "fee", label: settings.t("money.feeShort"), value: Money.tokens(flow.fee).doubleValue, color: .KE.amber, detail: model.thb(flow.fee)),
                ])
            }
            if let h = model.settledTx {
                DashedRule()
                TxLinkRow(label: settings.t("flow.settled.bscscan"), hash: h)
            }
            if model.listing.kind == .demoScooter {
                SecondaryButton(title: settings.t("flow.again"), icon: "arrow.counterclockwise") { model.startOver() }
                    .accessibilityIdentifier("flow-again")
            }
        }
    }

    // MARK: Receipt + footer

    @ViewBuilder private var receipt: some View {
        if !model.sent.isEmpty {
            ReceiptCard {
                HStack(alignment: .firstTextBaseline) {
                    Text(settings.t("flow.txs")).font(Font.KE.headline).foregroundStyle(Color.KE.foreground)
                    Spacer(minLength: 8)
                    Text("BSC testnet").font(Font.KE.kicker).foregroundStyle(Color.KE.subtle)
                }
                DashedRule()
                ForEach(Array(model.sent.enumerated()), id: \.element.hash) { i, s in
                    TxLinkRow(label: s.description, hash: s.hash, index: i + 1)
                }
                DashedRule()
                Text(settings.t("flow.txs.foot", "\(model.sent.count)")).font(.caption).foregroundStyle(Color.KE.subtle)
            }
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 6) {
            wallet("person.fill", settings.t("wallet.guestLabel"), model.me)
            if model.listing.kind == .demoScooter { wallet("storefront.fill", settings.t("wallet.shopLabel"), model.wallet.shop.address) }
            Text(settings.t("common.testnetOnly")).font(.caption).foregroundStyle(Color.KE.subtle).padding(.top, 2)
        }
        .padding(.top, 4)
    }

    private func wallet(_ icon: String, _ label: String, _ address: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.caption).frame(width: 18)
            Text(label).font(.caption)
            Text(EthAddress.short(address)).font(Font.KE.monoSmall)
        }
        .foregroundStyle(Color.KE.subtle)
        .accessibilityElement(children: .combine)
    }
}

/// Named steps on one line: done steps are ticked, the current one is the amber one, the rest wait.
/// At the larger text sizes the names would not fit under the dots, so the current step is named below instead.
struct FlowStepper: View {
    let titles: [String]
    let current: Int
    let finished: Bool
    let caption: String
    @Environment(\.dynamicTypeSize) private var typeSize

    private var showNames: Bool { typeSize <= .xLarge }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 0) {
                ForEach(titles.indices, id: \.self) { i in
                    VStack(spacing: 6) {
                        ZStack {
                            HStack(spacing: 0) {
                                Rectangle().fill(i == 0 ? Color.clear : line(done: i <= current))
                                Rectangle().fill(i == titles.count - 1 ? Color.clear : line(done: i < current || finished))
                            }
                            .frame(height: 3)
                            dot(i)
                        }
                        .frame(height: 34)
                        if showNames {
                            Text(titles[i])
                                .font(.caption2.weight(isCurrent(i) ? .bold : .medium))
                                .foregroundStyle(isCurrent(i) ? Color.KE.foreground : isDone(i) ? Color.KE.mutedText : Color.KE.subtle)
                                .lineLimit(1).minimumScaleFactor(0.6)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            if !showNames, let name = currentName {
                Text(caption + " · " + name)
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Color.KE.foreground)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement()
        .accessibilityLabel(currentName.map { caption + ", " + $0 } ?? caption)
    }

    /// The name of the step in progress (none while the flow is loading or cannot start).
    private var currentName: String? { titles.indices.contains(current) ? titles[current] : nil }

    private func isDone(_ i: Int) -> Bool { i < current || finished }
    private func isCurrent(_ i: Int) -> Bool { i == current }
    private func line(done: Bool) -> Color { done ? Color.KE.success : Color.KE.borderStrong }

    @ViewBuilder private func dot(_ i: Int) -> some View {
        if isDone(i) {
            Circle().fill(Color.KE.success).frame(width: 26, height: 26)
                .overlay(Image(systemName: "checkmark").font(.system(size: 12, weight: .heavy)).foregroundStyle(Color.KE.onPrimary))
                .background(Circle().fill(Color.KE.background).frame(width: 32, height: 32))
        } else if isCurrent(i) {
            Circle().fill(Color.KE.amber).frame(width: 30, height: 30)
                .overlay(Text("\(i + 1)").font(.system(size: 14, weight: .heavy, design: .rounded)).foregroundStyle(Color.KE.onAmber))
                .background(Circle().fill(Color.KE.amber.opacity(0.25)).frame(width: 40, height: 40))
                .background(Circle().fill(Color.KE.background).frame(width: 40, height: 40))
        } else {
            Circle().fill(Color.KE.muted).frame(width: 26, height: 26)
                .overlay(Circle().strokeBorder(Color.KE.borderStrong))
                .overlay(Text("\(i + 1)").font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(Color.KE.subtle))
                .background(Circle().fill(Color.KE.background).frame(width: 32, height: 32))
        }
    }
}

private extension Decimal {
    var doubleValue: Double { NSDecimalNumber(decimal: self).doubleValue }
}
