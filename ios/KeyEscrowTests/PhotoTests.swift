import UIKit
import XCTest
@testable import KeyEscrow

/// The bundled photos and their credits: every picture is in the app, every picture is credited, and every listing of
/// the demo catalogue has one.
final class PhotoTests: XCTestCase {
    func testEveryCreditedPhotoIsBundled() {
        XCTAssertFalse(PhotoCatalog.credits.isEmpty)
        for c in PhotoCatalog.credits {
            let image = UIImage(named: c.asset, in: Bundle(for: WalletStore.self), compatibleWith: nil)
            XCTAssertNotNil(image, "missing asset \(c.asset)")
            if let image { XCTAssertGreaterThanOrEqual(min(image.size.width, image.size.height), 400, c.asset) }
        }
        XCTAssertEqual(Set(PhotoCatalog.credits.map(\.asset)).count, PhotoCatalog.credits.count, "one credit per asset")
    }

    func testEveryPhotoInUseHasACredit() {
        XCTAssertNotNil(PhotoCatalog.credit(asset: PhotoCatalog.hero))
        for id in PhotoCatalog.listingIds { XCTAssertNotNil(PhotoCatalog.credit(forListing: id), id) }
        for p in Place.all { XCTAssertNotNil(PhotoCatalog.credit(asset: p.asset), p.id) }
    }

    func testCreditsAreComplete() {
        // Licences we allow: free to use in a public repo and app, no non-commercial or no-derivatives clause.
        let allowed: Set<String> = ["CC0 1.0", "CC BY 2.0", "CC BY 3.0", "CC BY 4.0", "CC BY-SA 3.0", "CC BY-SA 4.0"]
        for c in PhotoCatalog.credits {
            XCTAssertTrue(allowed.contains(c.license), "\(c.asset): \(c.license)")
            XCTAssertFalse(c.title.isEmpty || c.author.isEmpty, c.asset)
            XCTAssertEqual(URL(string: c.licenseURL)?.host, "creativecommons.org", c.asset)
            XCTAssertEqual(URL(string: c.source)?.host, "commons.wikimedia.org", c.asset)
            XCTAssertNotNil(L10n.table[c.changes], "\(c.asset): what changed")
            if let n = c.note { XCTAssertNotNil(L10n.table[n], "\(c.asset): note") }
        }
    }

    func testCatalogueListingsHaveABundledPhoto() throws {
        // The live /api/fleet answer (fixture) and the stage item: each maps to a bundled photo by its id.
        let url = try XCTUnwrap(Bundle(for: PhotoTests.self).url(forResource: "fleet", withExtension: "json"))
        let fleet = try JSONDecoder().decode(Fleet.self, from: Data(contentsOf: url))
        XCTAssertFalse(fleet.scooters.isEmpty)
        for s in fleet.scooters { XCTAssertNotNil(PhotoCatalog.asset(forListing: s.id), s.id) }
        XCTAssertNotNil(PhotoCatalog.asset(forListing: "mystery-box"))
        for l in Listing.offline { XCTAssertNotNil(PhotoCatalog.asset(forListing: l.id), l.id) }
    }

    func testPlacesMatchTheCatalogueLocations() {
        func place(_ location: String) -> [String] {
            let l = Listing(id: "x", kind: .demoScooter, name: "x", location: location, description: "", photo: nil, rentThb: 1, depositThb: 1, perDay: false, symbol: "scooter", vault: false)
            return Place.all.filter { $0.contains(l) }.map(\.id)
        }
        XCTAssertEqual(place("Chiang Mai Old City"), ["chiang-mai"])
        XCTAssertEqual(place("Pai"), ["pai"])
        XCTAssertEqual(place("Patong, Phuket"), ["phuket"])
        XCTAssertEqual(place("Sukhumvit, Bangkok"), ["bangkok"])
        XCTAssertEqual(place("On stage, BNB Bangkok"), ["bangkok"])
        XCTAssertEqual(place("Krabi"), [])
    }

    /// The three lists name the same photos with the same credit: the image sets in the asset folder, the list in code
    /// (PhotoCatalog.credits) and the table in ios/CREDITS.md. This reads the source tree, which the Simulator can do
    /// on the Mac the tests were built on; anywhere else it is skipped.
    func testAssetFolderCodeAndCreditsFileAgree() throws {
        let ios = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        let folder = ios.appendingPathComponent("KeyEscrow/Resources/Assets.xcassets/Photos")
        guard let sets = try? FileManager.default.contentsOfDirectory(atPath: folder.path),
              let text = try? String(contentsOf: ios.appendingPathComponent("CREDITS.md"), encoding: .utf8)
        else { throw XCTSkip("the source tree is not readable from here") }

        let assets = Set(sets.filter { $0.hasSuffix(".imageset") }.map { String($0.dropLast(".imageset".count)) })
        XCTAssertEqual(assets, Set(PhotoCatalog.credits.map(\.asset)), "asset folder and PhotoCatalog.credits")

        let rows = text.split(separator: "\n").map(String.init).filter { $0.hasPrefix("| ") && ($0.contains("`photo-") || $0.contains("`place-")) }
        XCTAssertEqual(rows.count, PhotoCatalog.credits.count, "rows in CREDITS.md")
        for c in PhotoCatalog.credits {
            let row = rows.first { $0.contains("`\(c.asset)`") } ?? ""
            XCTAssertFalse(row.isEmpty, "CREDITS.md has no row for \(c.asset)")
            XCTAssertTrue(row.contains("[\(c.title)](\(c.source))"), "\(c.asset): title or source differs in CREDITS.md")
            XCTAssertTrue(row.contains("| \(c.author)"), "\(c.asset): author differs in CREDITS.md")
            XCTAssertTrue(row.contains("[\(c.license)](\(c.licenseURL))"), "\(c.asset): licence differs in CREDITS.md")
        }
    }
}
