import SwiftUI
import UIKit

/// One bundled photo and where it comes from. Every picture in the asset catalog (Resources/Assets.xcassets/Photos)
/// has an entry here; the Photo credits screen and ios/CREDITS.md list them. KeyEscrowTests checks the two match.
struct PhotoCredit: Identifiable, Equatable {
    /// Asset catalog name.
    let asset: String
    /// What it illustrates in the app: a listing name as it is, or an L10n key ("credits.use.*", "place.*").
    let use: String
    /// Title of the file on Wikimedia Commons.
    let title: String
    let author: String
    let license: String
    let licenseURL: String
    /// The file's own page (where the licence is stated).
    let source: String
    /// L10n key: what we changed.
    let changes: String
    /// L10n key: an honest note where the picture is a stand-in (another model year, another place).
    let note: String?
    var id: String { asset }
}

/// The app's real photos, bundled, mapped by listing slug (the slugs of GET /api/listings and the website). A listing
/// shows the catalogue's photo from the server; the bundled copy is what shows offline or while that loads.
enum PhotoCatalog {
    static let hero = "photo-hero-street"

    private static let byListing: [String: String] = [
        "mystery-box": "photo-mystery-box",
        "honda-click-125i": "photo-click-125i-cnx",
        "honda-scoopy": "photo-scoopy-i-pai",
        "yamaha-nmax-155": "photo-nmax-155-patong",
        "honda-pcx-160": "photo-pcx-160-bkk",
        "yamaha-fino-125": "photo-fino-125-bkk",
        "vespa-primavera-150": "photo-vespa-primavera-150",
        "yamaha-grand-filano": "photo-grand-filano",
    ]

    /// Listing ids of app builds before the shared catalogue -> its slug (rentals stored on a phone keep the old id).
    static let legacySlugs = [
        "click-125i-cnx": "honda-click-125i", "scoopy-i-pai": "honda-scoopy", "nmax-155-patong": "yamaha-nmax-155",
        "pcx-160-bkk": "honda-pcx-160", "fino-125-bkk": "yamaha-fino-125",
    ]

    static func asset(forListing id: String) -> String? { byListing[legacySlugs[id] ?? id] }
    static func credit(forListing id: String) -> PhotoCredit? { asset(forListing: id).flatMap(credit(asset:)) }
    static func credit(asset: String) -> PhotoCredit? { credits.first { $0.asset == asset } }
    static var listingIds: [String] { Array(byListing.keys) }

    private static let bySA4 = "https://creativecommons.org/licenses/by-sa/4.0/"
    private static let by4 = "https://creativecommons.org/licenses/by/4.0/"

    static let credits: [PhotoCredit] = [
        PhotoCredit(asset: "photo-hero-street", use: "credits.use.hero",
                    title: "DZ6 1692 A row of parked motorbikes lines a quiet well-lit street at night as shops and signs glow under the awnings",
                    author: "PattayaPatrol", license: "CC BY-SA 4.0", licenseURL: bySA4,
                    source: "https://commons.wikimedia.org/wiki/File:DZ6_1692_A_row_of_parked_motorbikes_lines_a_quiet_well-lit_street_at_night_as_shops_and_signs_glow_under_the_awnings.jpg",
                    changes: "credits.changes.hero", note: "credits.note.hero"),
        PhotoCredit(asset: "photo-mystery-box", use: "KeyScrow Mystery Box",
                    title: "Small Cardboard Moving Box Taped Closed (47303024341)",
                    author: "HireAHelper", license: "CC BY 2.0", licenseURL: "https://creativecommons.org/licenses/by/2.0/",
                    source: "https://commons.wikimedia.org/wiki/File:Small_Cardboard_Moving_Box_Taped_Closed_(47303024341).jpg",
                    changes: "credits.changes.cropped", note: "credits.note.box"),
        PhotoCredit(asset: "photo-click-125i-cnx", use: "Honda Click 125i",
                    title: "Honda Click, Trang, Thailand",
                    author: "Vyacheslav Argenberg", license: "CC BY 4.0", licenseURL: by4,
                    source: "https://commons.wikimedia.org/wiki/File:Honda_Click,_Trang,_Thailand.jpg",
                    changes: "credits.changes.cropped", note: "credits.note.click"),
        PhotoCredit(asset: "photo-scoopy-i-pai", use: "Honda Scoopy",
                    title: "2022 Honda Scoopy 110",
                    author: "MoCars", license: "CC0 1.0", licenseURL: "https://creativecommons.org/publicdomain/zero/1.0/",
                    source: "https://commons.wikimedia.org/wiki/File:2022_Honda_Scoopy_110.jpg",
                    changes: "credits.changes.cropped", note: "credits.note.scoopy"),
        PhotoCredit(asset: "photo-nmax-155-patong", use: "Yamaha NMAX 155",
                    title: "2020 Yamaha NMAX 155 ABS (20200810) 01",
                    author: "オーバードライブ83", license: "CC BY-SA 4.0", licenseURL: bySA4,
                    source: "https://commons.wikimedia.org/wiki/File:2020_Yamaha_NMAX_155_ABS_(20200810)_01.jpg",
                    changes: "credits.changes.cropped", note: "credits.note.nmax"),
        PhotoCredit(asset: "photo-pcx-160-bkk", use: "Honda PCX 160",
                    title: "2025 Honda PCX 160 Roadsync Type",
                    author: "Chanokchon", license: "CC BY-SA 4.0", licenseURL: bySA4,
                    source: "https://commons.wikimedia.org/wiki/File:2025_Honda_PCX_160_Roadsync_Type.jpg",
                    changes: "credits.changes.resized", note: "credits.note.pcx"),
        PhotoCredit(asset: "photo-fino-125-bkk", use: "Yamaha Fino 125",
                    title: "Yamaha Fino",
                    author: "Addvisor", license: "CC BY-SA 4.0", licenseURL: bySA4,
                    source: "https://commons.wikimedia.org/wiki/File:Yamaha_Fino.jpg",
                    changes: "credits.changes.cropped", note: "credits.note.fino"),
        PhotoCredit(asset: "photo-vespa-primavera-150", use: "Vespa Primavera 150",
                    title: "2021 Vespa Primavera 75th, rear left",
                    author: "Mr.choppers", license: "CC BY-SA 3.0", licenseURL: "https://creativecommons.org/licenses/by-sa/3.0/",
                    source: "https://commons.wikimedia.org/wiki/File:2021_Vespa_Primavera_75th,_rear_left.jpg",
                    changes: "credits.changes.plate", note: "credits.note.vespa"),
        PhotoCredit(asset: "photo-grand-filano", use: "Yamaha Grand Filano",
                    title: "2022 Yamaha Grand Filano Hybrid Connected",
                    author: "Chanokchon", license: "CC BY-SA 4.0", licenseURL: bySA4,
                    source: "https://commons.wikimedia.org/wiki/File:2022_Yamaha_Grand_Filano_Hybrid_Connected.jpg",
                    changes: "credits.changes.people", note: "credits.note.pcx"),
        PhotoCredit(asset: "place-bangkok", use: "place.bangkok",
                    title: "Bangkok skytrain sunset",
                    author: "Diliff", license: "CC BY-SA 3.0", licenseURL: "https://creativecommons.org/licenses/by-sa/3.0/",
                    source: "https://commons.wikimedia.org/wiki/File:Bangkok_skytrain_sunset.jpg",
                    changes: "credits.changes.cropped", note: nil),
        PhotoCredit(asset: "place-chiang-mai", use: "place.chiangMai",
                    title: "Tha Phae Gate 1",
                    author: "Christophe95", license: "CC BY-SA 4.0", licenseURL: bySA4,
                    source: "https://commons.wikimedia.org/wiki/File:Tha_Phae_Gate_1.jpg",
                    changes: "credits.changes.resized", note: nil),
        PhotoCredit(asset: "place-pai", use: "place.pai",
                    title: "Thailand Pai (111310263)",
                    author: "Andreas Gante", license: "CC BY 3.0", licenseURL: "https://creativecommons.org/licenses/by/3.0/",
                    source: "https://commons.wikimedia.org/wiki/File:Thailand_Pai_(111310263).jpeg",
                    changes: "credits.changes.cropped", note: nil),
        PhotoCredit(asset: "place-phuket", use: "place.phuket",
                    title: "Long-tail boats on Patong Beach Phuket",
                    author: "Arnaud-Victor Monteux", license: "CC BY-SA 4.0", licenseURL: bySA4,
                    source: "https://commons.wikimedia.org/wiki/File:Long-tail_boats_on_Patong_Beach_Phuket.jpg",
                    changes: "credits.changes.cropped", note: nil),
    ]

    /// Small decoded copies for list rows and chips (the bundled files are 1200 px).
    private static let thumbs = NSCache<NSString, UIImage>()
    static func thumbnail(_ asset: String, side: CGFloat) -> UIImage? {
        let key = "\(asset)@\(Int(side))" as NSString
        if let hit = thumbs.object(forKey: key) { return hit }
        guard let full = UIImage(named: asset) else { return nil }
        let scale = side / max(1, min(full.size.width, full.size.height))
        let size = CGSize(width: full.size.width * scale, height: full.size.height * scale)
        let small = full.preparingThumbnail(of: size) ?? full
        thumbs.setObject(small, forKey: key)
        return small
    }
}

/// A destination on the Home filter row. `match` is looked for in the catalogue's own location text.
struct Place: Identifiable, Equatable, Hashable {
    let id: String
    let nameKey: String
    let asset: String
    let match: String

    static let all: [Place] = [
        Place(id: "bangkok", nameKey: "place.bangkok", asset: "place-bangkok", match: "Bangkok"),
        Place(id: "chiang-mai", nameKey: "place.chiangMai", asset: "place-chiang-mai", match: "Chiang Mai"),
        Place(id: "pai", nameKey: "place.pai", asset: "place-pai", match: "Pai"),
        Place(id: "phuket", nameKey: "place.phuket", asset: "place-phuket", match: "Phuket"),
    ]

    func contains(_ l: Listing) -> Bool { l.location.range(of: match, options: [.caseInsensitive]) != nil }
}

/// Which listing an escrow belongs to, so My rentals can show its photo and name. Display only, kept on this phone.
enum RentalAlbum {
    private static let key = "keyescrow.rentalAlbum.v1"
    private static var store: [String: String] { (UserDefaults.standard.dictionary(forKey: key) as? [String: String]) ?? [:] }

    static func remember(lease: String, listing: Listing) {
        var d = store
        let value = listing.id + "|" + listing.name
        guard d[lease.lowercased()] != value else { return }
        d[lease.lowercased()] = value
        UserDefaults.standard.set(d, forKey: key)
    }

    /// The transaction that settled an escrow, when this phone sent it: its receipt holds the payout even when
    /// KeyScrow's chain index is behind.
    private static let settleKey = "keyescrow.settleTx.v1"
    static func rememberSettle(lease: String, hash: String) {
        var d = (UserDefaults.standard.dictionary(forKey: settleKey) as? [String: String]) ?? [:]
        d[lease.lowercased()] = hash
        UserDefaults.standard.set(d, forKey: settleKey)
    }
    static func settleTx(forLease lease: String) -> String? {
        (UserDefaults.standard.dictionary(forKey: settleKey) as? [String: String])?[lease.lowercased()]
    }

    /// (listing id, name) for an escrow this phone rented; falls back to the demo shop's own bookkeeping.
    static func listing(forLease lease: String) -> (id: String, name: String)? {
        if let v = store[lease.lowercased()], let bar = v.firstIndex(of: "|") {
            return (String(v[..<bar]), String(v[v.index(after: bar)...]))
        }
        if let id = ShopRentals.scooter(forLease: lease) { return (id, ShopRentals.name(of: id) ?? id) }
        return nil
    }
}

// MARK: Views

/// A bundled photo that fills whatever frame it is given (the caller sets the size and clips).
struct PhotoFill: View {
    let asset: String
    var body: some View {
        Color.KE.muted
            .overlay {
                if DesignMode.led, let led = DotMatrix.image(asset: asset) {
                    Image(uiImage: led).resizable().scaledToFill()
                } else {
                    Image(asset).resizable().scaledToFill()
                }
            }
            .clipped()
            .accessibilityHidden(true)
    }
}

/// The picture of a listing: the catalogue's photo from the server (GET /api/listings; URLSession's cache keeps it), over
/// the bundled copy of the same photo, which is what shows offline or while it loads; else a night tile.
struct ListingPhoto: View {
    let listingId: String
    var serverPhoto: String?
    var symbol = "scooter"

    init(_ listing: Listing) { listingId = listing.id; serverPhoto = listing.photo; symbol = listing.symbol }
    init(listingId: String, symbol: String = "scooter") { self.listingId = listingId; self.symbol = symbol }

    var body: some View {
        Group {
            if let asset = PhotoCatalog.asset(forListing: listingId) { PhotoFill(asset: asset) } else { NightTile(symbol: symbol) }
        }
        .overlay {
            // The LED design draws the bundled copy as a dot matrix; the server photo would cover it.
            if !DesignMode.led, let url = APIClient().absolute(serverPhoto) {
                AsyncImage(url: url) { phase in
                    if case .success(let img) = phase { img.resizable().scaledToFill() }
                }
            }
        }
        .clipped()
        .accessibilityHidden(true)
    }
}

/// The stand-in when there is no photo: an amber symbol glowing on night indigo.
struct NightTile: View {
    var symbol = "key.horizontal.fill"
    var body: some View {
        GeometryReader { geo in
            ZStack {
                LinearGradient(colors: [Color.KE.night, Color.KE.nightSoft], startPoint: .topLeading, endPoint: .bottomTrailing)
                Image(systemName: symbol)
                    .font(.system(size: min(geo.size.width, geo.size.height) * 0.4, weight: .semibold))
                    .foregroundStyle(Color.KE.sign)
                    .shadow(color: Color.KE.sign.opacity(0.5), radius: 12)
            }
        }
        .accessibilityHidden(true)
    }
}

/// Square thumbnail for rows: the listing's photo when the escrow maps to one, else the night tile.
struct ListingThumb: View {
    let listingId: String?
    var side: CGFloat = 64
    var symbol = "key.horizontal.fill"
    var body: some View {
        Group {
            if DesignMode.led, let id = listingId, let asset = PhotoCatalog.asset(forListing: id), let img = DotMatrix.image(asset: asset, cols: 22) {
                Image(uiImage: img).resizable().scaledToFill()
            } else if let id = listingId, let asset = PhotoCatalog.asset(forListing: id), let img = PhotoCatalog.thumbnail(asset, side: side * 3) {
                Image(uiImage: img).resizable().scaledToFill()
            } else {
                NightTile(symbol: symbol)
            }
        }
        .frame(width: side, height: side)
        .clipShape(RoundedRectangle(cornerRadius: side * 0.26, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: side * 0.26, style: .continuous).strokeBorder(Color.KE.border))
        .accessibilityHidden(true)
    }
}
