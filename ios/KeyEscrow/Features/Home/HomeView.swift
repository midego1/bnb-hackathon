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
    /// Screenshot deep links (launch arguments): `-listing <id>` opens a listing, `-flow <id>` its rent flow,
    /// `-scroll listings` (or a listing id) scrolls Home there.
    @State private var linkedListing: Listing?
    @State private var linkedFlow: Listing?
    @State private var scrollTarget: String?
    /// The destination picked on the filter row (nil: everywhere).
    @State private var place: Place?
    @State private var heroUnderStatusBar = true
    /// The window's top inset, read once: on some devices it shrinks while the status bar is hidden, and the layout
    /// should not move with it.
    @State private var topInset: CGFloat = 0

    private static func windowTopInset() -> CGFloat? {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        return (windows.first(where: \.isKeyWindow) ?? windows.first)?.safeAreaInsets.top
    }

    /// Destinations that have at least one listing in the catalogue right now.
    private var places: [Place] { Place.all.filter { p in model.listings.contains(where: p.contains) } }
    private var shown: [Listing] { place.map { p in model.listings.filter(p.contains) } ?? model.listings }

    var body: some View {
        GeometryReader { geo in
            let top = topInset > 0 ? topInset : min(geo.safeAreaInsets.top, 62)
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 0) {
                        HomeHero(topInset: top, minHeight: min(max((geo.size.height + top + geo.safeAreaInsets.bottom) * 0.56, 440), 620))
                        sheet
                    }
                }
                .coordinateSpace(.named(HomeHero.space))
                .onChange(of: scrollTarget) { _, target in if let target { proxy.scrollTo(target, anchor: UnitPoint(x: 0.5, y: 0.09)) } }
            }
            .ignoresSafeArea(edges: .top)
            .overlay(alignment: .top) {
                // Once the photo has scrolled away the page runs under the status bar: give the clock a backdrop.
                Rectangle().fill(.bar).frame(height: top).ignoresSafeArea(edges: .top)
                    .opacity(heroUnderStatusBar ? 0 : 1)
                    .animation(.easeInOut(duration: 0.2), value: heroUnderStatusBar)
                    .allowsHitTesting(false)
            }
            .refreshable { await model.load(); await wallet.refresh() }
            .onPreferenceChange(HeroBottomKey.self) { bottom in
                // The sheet covers the last 28 pt of the photo; past that the page is under the status bar.
                let under = bottom - 28 > top
                if under != heroUnderStatusBar { heroUnderStatusBar = under }
            }
            .onAppear { if topInset == 0, let inset = Self.windowTopInset(), inset > 0 { topInset = inset } }
        }
        .keScreen()
        .toolbar(.hidden, for: .navigationBar)
        .navigationTitle("KeyEscrow")
        // The photo is night in both themes and the status bar's dark text would be lost on it, so the clock steps
        // aside while the photo is up there and comes back with the page.
        .statusBarHidden(heroUnderStatusBar)
        .navigationDestination(for: Listing.self) { ListingDetailView(listing: $0, thbPerUsdt: model.thbPerUsdt) }
        .navigationDestination(item: $linkedListing) { ListingDetailView(listing: $0, thbPerUsdt: model.thbPerUsdt) }
        .navigationDestination(item: $linkedFlow) { RentFlowView(listing: $0, wallet: wallet) }
        .task {
            if model.listings.isEmpty { await model.load() }
            let d = UserDefaults.standard
            if let id = d.string(forKey: "listing") { linkedListing = model.listings.first { $0.id == id } }
            if let id = d.string(forKey: "flow") { linkedFlow = model.listings.first { $0.id == id } }
            if let target = d.string(forKey: "scroll") {
                try? await Task.sleep(nanoseconds: 400_000_000)
                scrollTarget = target
            }
        }
    }

    /// The page under the hero: a sheet that overlaps the photo with rounded top corners.
    private var sheet: some View {
        VStack(alignment: .leading, spacing: Metrics.gapLarge) {
            if model.offline { Notice(text: settings.t("home.offline"), tone: .warn) }
            if places.count > 1 { placesRow }
            VStack(alignment: .leading, spacing: 20) {
                SectionHeader(title: place.map { settings.t($0.nameKey) } ?? settings.t("home.listings"),
                              subtitle: model.listings.isEmpty ? settings.t("common.loading") : settings.t("home.listings.sub", "\(shown.count)"))
                if model.listings.isEmpty {
                    // Before the catalogue answers: two quiet placeholders where the cards will be.
                    ForEach(0..<2, id: \.self) { _ in ListingCardPlaceholder() }
                }
                ForEach(shown) { l in
                    NavigationLink(value: l) { ListingCard(listing: l) }.buttonStyle(PressStyle()).id(l.id)
                }
            }
            .id("listings")
            footer
        }
        .padding(.horizontal, Metrics.page)
        .padding(.top, 26).padding(.bottom, 36)
        .kePage()
        .background(Color.KE.background, in: UnevenRoundedRectangle(topLeadingRadius: 28, topTrailingRadius: 28, style: .continuous))
        .padding(.top, -28)
    }

    private var placesRow: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: settings.t("home.places"))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    PlaceTile(title: settings.t("place.all"), count: settings.t("place.count", "\(model.listings.count)"), asset: PhotoCatalog.hero, selected: place == nil) { place = nil }
                    ForEach(places) { p in
                        PlaceTile(title: settings.t(p.nameKey), count: settings.t("place.count", "\(model.listings.filter(p.contains).count)"), asset: p.asset, selected: place == p) {
                            place = place == p ? nil : p
                        }
                    }
                }
            }
            .contentMargins(.horizontal, Metrics.page, for: .scrollContent)
            .padding(.horizontal, -Metrics.page)
        }
        .sensoryFeedback(.selection, trigger: place)
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label { Text(settings.t("home.footer")) } icon: { Image(systemName: "testtube.2") }
                .font(.footnote).foregroundStyle(Color.KE.subtle)
            NavigationLink { PhotoCreditsView() } label: {
                Label(settings.t("credits.title"), systemImage: "camera.aperture")
                    .font(.footnote.weight(.semibold)).foregroundStyle(Color.KE.mutedText)
                    .frame(minHeight: 44)
            }
        }
    }
}

/// The street the product lives on: a real Thai soi at night with a "motorcycle for rent" sign, the promise over it.
struct HomeHero: View {
    /// Name of the Home scroll view's coordinate space (the hero reads its own offset in it).
    static let space = "home-scroll"
    let topInset: CGFloat
    let minHeight: CGFloat
    @EnvironmentObject var settings: AppSettings

    var body: some View {
        words
            .padding(.top, topInset + 52 + 36) // the brand row sits above the words, never under them
            .padding(.bottom, 28 + 26)
            .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .bottomLeading)
            .overlay(alignment: .top) { brand.padding(.top, topInset + 4) }
            .padding(.horizontal, Metrics.page)
            .background { backdrop }
    }

    private var brand: some View {
        HStack(spacing: 8) {
            Image(systemName: "key.horizontal.fill").foregroundStyle(Color.KE.sign)
            Text("KeyEscrow").foregroundStyle(.white).lineLimit(1).fixedSize()
            Spacer(minLength: 12)
            WalletChip(onPhoto: true)
        }
        .font(.system(.title3, design: .rounded, weight: .bold))
        .shadow(color: .black.opacity(0.45), radius: 6, y: 1)
        // One line whatever the text size: the brand and the balance share the row (the words below grow freely).
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    private var words: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(settings.t("home.kicker"), systemImage: "lock.shield.fill")
                .font(Font.KE.kicker).textCase(.uppercase).tracking(0.6)
                .foregroundStyle(Color.KE.sign)
            Text(settings.t("home.title"))
                .font(Font.KE.hero)
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
            Text(settings.t("home.subtitle"))
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.9))
                .fixedSize(horizontal: false, vertical: true)
            Label(settings.t("home.chip.testnet"), systemImage: "testtube.2")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(.white.opacity(0.14), in: Capsule())
                .overlay(Capsule().strokeBorder(.white.opacity(0.22)))
                .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .background(alignment: .bottom) {
            // Night scrim tied to the words: it starts 110 pt above them, however tall they get.
            LinearGradient(stops: [
                .init(color: Color.KE.night.opacity(0), location: 0),
                .init(color: Color.KE.night.opacity(0.78), location: 0.3),
                .init(color: Color.KE.night.opacity(0.94), location: 1),
            ], startPoint: .top, endPoint: .bottom)
            .padding(.top, -110).padding(.horizontal, -Metrics.page).padding(.bottom, -(28 + 26))
            .allowsHitTesting(false)
        }
    }

    /// The photo, stretching when the page is pulled down, darker at the very top for the brand row.
    private var backdrop: some View {
        GeometryReader { geo in
            let frame = geo.frame(in: .named(HomeHero.space))
            let pull = max(0, frame.minY)
            ZStack {
                PhotoFill(asset: PhotoCatalog.hero)
                LinearGradient(colors: [Color.KE.night.opacity(0.72), Color.KE.night.opacity(0)], startPoint: .top, endPoint: .bottom)
                    .frame(height: 150).frame(maxHeight: .infinity, alignment: .top)
            }
            .frame(width: geo.size.width, height: geo.size.height + pull)
            .offset(y: -pull)
            .preference(key: HeroBottomKey.self, value: frame.maxY)
        }
    }
}

/// Where the bottom of the hero is in the scroll view (to know when the photo has left the status bar).
struct HeroBottomKey: PreferenceKey {
    static var defaultValue: CGFloat = .greatestFiniteMagnitude
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = min(value, nextValue()) }
}

/// A destination on the filter row: a real photo of the place, its name and how many listings are there.
struct PlaceTile: View {
    let title: String
    let count: String
    let asset: String?
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .bottomLeading) {
                Group {
                    if let asset { PhotoFill(asset: asset) } else { NightTile(symbol: "map.fill") }
                }
                LinearGradient(colors: [.clear, Color.KE.night.opacity(0.82)], startPoint: .center, endPoint: .bottom)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.system(.subheadline, design: .rounded, weight: .bold)).lineLimit(1).minimumScaleFactor(0.8)
                    Text(count).font(.caption2.weight(.semibold)).monospacedDigit().opacity(0.88).lineLimit(1).minimumScaleFactor(0.8)
                }
                .foregroundStyle(.white)
                .padding(10)
            }
            .frame(width: 124, height: 92)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(selected ? Color.KE.amber : Color.KE.border, lineWidth: selected ? 3 : 1))
            .overlay(alignment: .topTrailing) {
                if selected {
                    Image(systemName: "checkmark.circle.fill")
                        .symbolRenderingMode(.palette).foregroundStyle(Color.KE.onAmber, Color.KE.amber)
                        .font(.title3).padding(6)
                }
            }
        }
        .buttonStyle(PressStyle())
        .dynamicTypeSize(...DynamicTypeSize.xxLarge) // a fixed-size picture tile: VoiceOver reads the label below
        .accessibilityLabel(title)
        .accessibilityValue(count)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

/// Airbnb-style card: the real photo, name, place, price per day, the escrow promise.
struct ListingCard: View {
    let listing: Listing
    @EnvironmentObject var settings: AppSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Color.clear
                .aspectRatio(1, contentMode: .fit)
                .overlay { ListingPhoto(listing) }
                .overlay(alignment: .top) {
                    LinearGradient(colors: [.black.opacity(0.28), .clear], startPoint: .top, endPoint: .bottom).frame(height: 72)
                }
                .clipShape(RoundedRectangle(cornerRadius: Metrics.radiusPhoto, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Metrics.radiusPhoto, style: .continuous).strokeBorder(Color.KE.border.opacity(0.6)))
                .overlay(alignment: .topLeading) { ListingBadges(listing: listing, onPhoto: true).padding(12) }
            VStack(alignment: .leading, spacing: 5) {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) { name; Spacer(minLength: 8); price }
                    VStack(alignment: .leading, spacing: 4) { name; price }
                }
                Label(listing.location, systemImage: "mappin.and.ellipse")
                    .font(.subheadline).foregroundStyle(Color.KE.mutedText)
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) { promise; Spacer(minLength: 8); deposit }
                    VStack(alignment: .leading, spacing: 4) { promise; deposit }
                }
                .padding(.top, 2)
            }
            .padding(.horizontal, 2)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var name: some View {
        Text(listing.name).font(Font.KE.headline).foregroundStyle(Color.KE.foreground).multilineTextAlignment(.leading)
    }

    private var price: some View {
        (Text(Money.thb(baht: listing.rentPerDayThb)).font(Font.KE.headline).foregroundColor(Color.KE.foreground)
            + Text(settings.t("unit.perDay")).font(.subheadline).foregroundColor(Color.KE.mutedText))
            .monospacedDigit().lineLimit(1)
    }

    private var promise: some View {
        Label(settings.t("listing.protected"), systemImage: "lock.shield.fill")
            .font(.caption.weight(.semibold)).foregroundStyle(Color.KE.success)
    }

    private var deposit: some View {
        Text(settings.t("card.deposit", Money.thb(baht: listing.depositThb)))
            .font(.caption).monospacedDigit().foregroundStyle(Color.KE.subtle).lineLimit(1)
    }
}

/// The shape of a card while the catalogue loads.
struct ListingCardPlaceholder: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            RoundedRectangle(cornerRadius: Metrics.radiusPhoto, style: .continuous).fill(Color.KE.muted).aspectRatio(1, contentMode: .fit)
            VStack(alignment: .leading, spacing: 8) {
                Capsule().fill(Color.KE.muted).frame(width: 180, height: 16)
                Capsule().fill(Color.KE.muted).frame(width: 120, height: 12)
            }
            .padding(.horizontal, 2)
        }
        .accessibilityHidden(true)
    }
}

/// "Live on stage" / "Demo listing" (+ "Fleet Vault"): what kind of listing this is, said plainly.
struct ListingBadges: View {
    let listing: Listing
    var onPhoto = false
    @EnvironmentObject var settings: AppSettings
    var body: some View {
        FlowLayout(spacing: 6) {
            if listing.kind == .stage {
                if onPhoto { LivePill(text: settings.t("badge.live")) } else { Pill(text: settings.t("badge.live"), tone: .ok, icon: "dot.radiowaves.left.and.right") }
            } else {
                Pill(text: settings.t("badge.demo"), tone: .info, icon: "testtube.2", solid: onPhoto)
            }
            if listing.vault { Pill(text: settings.t("badge.vault"), tone: .neutral, icon: "building.columns.fill", solid: onPhoto) }
        }
    }
}

/// The guest wallet's balance (or short address): a chip in a toolbar, or glass over the hero photo.
struct WalletChip: View {
    var onPhoto = false
    @EnvironmentObject var wallet: WalletStore
    @EnvironmentObject var settings: AppSettings
    var body: some View {
        NavigationLink { WalletView() } label: {
            HStack(spacing: 6) {
                Image(systemName: "wallet.bifold.fill")
                Text(wallet.musdt.map { Money.thb($0) } ?? EthAddress.short(wallet.address)).monospacedDigit().lineLimit(1).fixedSize()
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(onPhoto ? Color.white : Color.KE.foreground)
            .padding(.horizontal, 12).frame(minHeight: 36)
            .background {
                if onPhoto { Capsule().fill(.ultraThinMaterial).environment(\.colorScheme, .dark) } else { Capsule().fill(Color.KE.muted) }
            }
            .overlay(Capsule().strokeBorder(onPhoto ? Color.white.opacity(0.25) : Color.clear))
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .accessibilityLabel(settings.t("wallet.title"))
    }
}
