import SwiftUI

struct ListingDetailView: View {
    let listing: Listing
    let thbPerUsdt: Double
    @EnvironmentObject var settings: AppSettings
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dynamicTypeSize) private var typeSize

    /// With the floating glass controls of iOS 26 and later the photo runs up under the status bar; before that it
    /// starts below the navigation bar, where the plain back button stays readable.
    private static let immersive: Bool = { if #available(iOS 26.0, *) { return true } else { return false } }()

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header(width: geo.size.width)
                    sheet
                }
            }
            .coordinateSpace(.named("listing-scroll"))
            .ignoresSafeArea(edges: Self.immersive ? .top : [])
        }
        .keScreen()
        .safeAreaInset(edge: .bottom, spacing: 0) { rentBar }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Self.immersive ? .hidden : .automatic, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
    }

    // MARK: Photo

    private func header(width: CGFloat) -> some View {
        let height = min(max(width, 280), 440)
        return GeometryReader { geo in
            let pull = Self.immersive ? max(0, geo.frame(in: .named("listing-scroll")).minY) : 0
            ListingPhoto(listing)
                .frame(width: geo.size.width, height: height + pull)
                .overlay(alignment: .top) {
                    // A haze in the page colour, so the status bar reads on any photo in either theme.
                    if Self.immersive {
                        LinearGradient(colors: [Color.KE.background.opacity(0.72), Color.KE.background.opacity(0)], startPoint: .top, endPoint: .bottom).frame(height: 120)
                    }
                }
                .clipped()
                .offset(y: -pull)
        }
        .frame(height: height)
        .accessibilityElement()
        .accessibilityLabel(PhotoCatalog.credit(forListing: listing.id).map { settings.t("credits.photoOf", $0.title, $0.author) } ?? listing.name)
        .accessibilityAddTraits(.isImage)
    }

    // MARK: Page

    private var sheet: some View {
        VStack(alignment: .leading, spacing: Metrics.gap) {
            VStack(alignment: .leading, spacing: 8) {
                ListingBadges(listing: listing)
                Text(listing.name).font(Font.KE.display).foregroundStyle(Color.KE.foreground).fixedSize(horizontal: false, vertical: true)
                Label(listing.location, systemImage: "mappin.and.ellipse").font(.body).foregroundStyle(Color.KE.mutedText)
                if let c = PhotoCatalog.credit(forListing: listing.id) {
                    NavigationLink { PhotoCreditsView() } label: {
                        Label(settings.t("credits.line", c.author, c.license), systemImage: "camera.aperture")
                            .font(.caption).foregroundStyle(Color.KE.subtle).multilineTextAlignment(.leading)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                }
            }
            if !listing.description.isEmpty { Text(listing.description).foregroundStyle(Color.KE.mutedText) }

            prices

            Card(spacing: 16) {
                HStack(spacing: 12) {
                    IconBadge(symbol: "lock.shield.fill", tint: .KE.success, fill: .KE.successSoft)
                    Text(settings.t("listing.protected")).font(Font.KE.headline).foregroundStyle(Color.KE.foreground)
                }
                why("building.columns.fill", "listing.why.own")
                why("camera.fill", "listing.why.photos")
                why("sparkles", "listing.why.ai")
                why("clock.badge.checkmark.fill", "listing.why.timeout")
            }

            if listing.kind == .demoScooter { Notice(text: settings.t("listing.demoNote"), tone: .info) } else { Notice(text: settings.t("listing.stageNote"), tone: .ok) }
            Text(settings.t("common.testnetOnly")).font(.footnote).foregroundStyle(Color.KE.subtle)
        }
        .padding(.horizontal, Metrics.page)
        .padding(.top, 24).padding(.bottom, 28)
        .kePage()
        .background(Color.KE.background, in: UnevenRoundedRectangle(topLeadingRadius: 28, topTrailingRadius: 28, style: .continuous))
        .padding(.top, -28)
    }

    /// Rent and deposit as two tiles (stacked at the largest text sizes).
    @ViewBuilder private var prices: some View {
        let rent = fact(icon: "calendar", label: settings.t("listing.rent"),
                        value: Money.thb(baht: listing.rentPerDayThb) + settings.t("unit.perDay"),
                        sub: listing.perDay ? usdt(listing.rentThb) : settings.t("listing.monthly", Money.thb(baht: listing.rentThb)) + "\n" + usdt(listing.rentThb))
        let deposit = fact(icon: "arrow.uturn.backward.circle", label: settings.t("listing.deposit"),
                           value: Money.thb(baht: listing.depositThb),
                           sub: settings.t("listing.comesBack") + "\n" + usdt(listing.depositThb), tint: .KE.success)
        if typeSize.isAccessibilitySize {
            VStack(spacing: 12) { rent; deposit }
        } else {
            HStack(alignment: .top, spacing: 12) { rent; deposit }
        }
    }

    private func fact(icon: String, label: String, value: String, sub: String, tint: Color = .KE.mutedText) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(label, systemImage: icon).font(Font.KE.label).foregroundStyle(tint)
            Text(value).font(Font.KE.amountSmall).monospacedDigit().foregroundStyle(Color.KE.foreground).minimumScaleFactor(0.8).lineLimit(1)
            Text(sub).font(.caption).monospacedDigit().foregroundStyle(Color.KE.subtle).fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .keSurface(radius: 20)
        .accessibilityElement(children: .combine)
    }

    private func usdt(_ thb: Double) -> String { Money.usdt(Money.unitsFromThb(thb, rate: thbPerUsdt)) }

    private func why(_ icon: String, _ key: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).font(.subheadline.weight(.semibold)).foregroundStyle(Color.KE.amber).frame(width: 24, alignment: .center).padding(.top, 1)
            Text(settings.t(key)).font(.subheadline).foregroundStyle(Color.KE.foreground).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Sticky bar

    /// Always on screen: the price, the deposit and the way into the rent flow (stacked at the largest text sizes).
    private var rentBar: some View {
        Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 10) { rentBarPrice; rentLink(fullWidth: true) }
            } else {
                HStack(alignment: .center, spacing: 14) { rentBarPrice; rentLink(fullWidth: false) }
            }
        }
        .padding(.horizontal, Metrics.page)
        .padding(.top, 12).padding(.bottom, 10)
        .frame(maxWidth: .infinity)
        .background(.bar)
        .overlay(alignment: .top) { Rectangle().fill(Color.KE.border).frame(height: 1) }
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
    }

    private var rentBarPrice: some View {
        VStack(alignment: .leading, spacing: 2) {
            (Text(Money.thb(baht: listing.rentPerDayThb)).font(Font.KE.amountSmall).foregroundColor(Color.KE.foreground)
                + Text(settings.t("unit.perDay")).font(.subheadline).foregroundColor(Color.KE.mutedText))
                .monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
            Label(settings.t("card.deposit", Money.thb(baht: listing.depositThb)), systemImage: "lock.shield.fill")
                .font(.caption.weight(.medium)).monospacedDigit().foregroundStyle(Color.KE.success)
                .lineLimit(2).minimumScaleFactor(0.85)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func rentLink(fullWidth: Bool) -> some View {
        NavigationLink { RentFlowView(listing: listing, wallet: wallet) } label: {
            PrimaryLabel(title: settings.t("listing.rentIt"), icon: "key.fill", fullWidth: fullWidth)
        }
        .buttonStyle(PressStyle())
        .accessibilityIdentifier("rent-it")
    }
}
