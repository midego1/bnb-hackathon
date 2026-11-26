import Foundation

/// One thing to rent: the live stage item (Mystery Box, the server plays the owner and the presenter accepts on the
/// big screen) or a demo scooter (the demo shop wallet on this phone plays the owner).
struct Listing: Identifiable, Equatable, Hashable {
    enum Kind: Equatable, Hashable { case stage, demoScooter }

    let id: String
    let kind: Kind
    let name: String
    let location: String
    let description: String
    let photo: String?
    /// THB per `period` (a day for the stage item, a 30-day month for the scooters: as the catalogue lists them).
    let rentThb: Double
    let depositThb: Double
    let perDay: Bool
    let symbol: String
    let vault: Bool
    /// The catalogue's own price per day when the listing rents by the month (the website shows this one).
    var dayThb: Double? = nil

    var rentPerDayThb: Double { dayThb ?? (perDay ? rentThb : rentThb / 30) }

    /// Shown when the server cannot be reached: a few items of the catalogue (web/data/listings.json), labelled demo.
    static let offline: [Listing] = [
        Listing(id: "mystery-box", kind: .stage, name: "KeyScrow Mystery Box", location: "On stage, BNB Bangkok",
                description: "A real box we brought to the stage. Rent it, take it, bring it back: the deposit sits in its own escrow on BNB Chain until both sides agree.",
                photo: nil, rentThb: 200, depositThb: 1000, perDay: true, symbol: "shippingbox.fill", vault: false),
        Listing(id: "honda-click-125i", kind: .demoScooter, name: "Honda Click 125i", location: "Nimman, Chiang Mai", description: "", photo: nil, rentThb: 3400, depositThb: 6800, perDay: false, symbol: "scooter", vault: false),
        Listing(id: "honda-pcx-160", kind: .demoScooter, name: "Honda PCX 160", location: "Old Town, Phuket", description: "", photo: nil, rentThb: 5800, depositThb: 7000, perDay: false, symbol: "scooter", vault: false),
    ]
}

// In an extension, so the memberwise initializer stays.
extension Listing {
    /// A listing of the shared catalogue (GET /api/listings). The scooters rent by the month (their monthly price), the
    /// stage item by the day, as the website's /app/listings/<slug> does.
    init(_ c: Catalogue.Item) {
        self.init(id: c.slug, kind: c.stage ? .stage : .demoScooter, name: c.name, location: c.location, description: c.description,
                  photo: c.photos.first?.url, rentThb: c.monthThb ?? c.rentThb, depositThb: c.depositThb, perDay: c.monthThb == nil,
                  symbol: c.stage ? "shippingbox.fill" : "scooter", vault: false, dayThb: c.monthThb == nil ? nil : c.rentThb)
    }
}
