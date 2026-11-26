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

    var rentPerDayThb: Double { perDay ? rentThb : rentThb / 30 }

    static func stage(_ s: StageStatus.Listing) -> Listing {
        Listing(id: s.slug, kind: .stage, name: s.name, location: s.location ?? "", description: s.description ?? "",
                photo: nil, rentThb: s.rentThb, depositThb: s.depositThb, perDay: true, symbol: "shippingbox.fill", vault: false)
    }

    static func scooter(_ s: Fleet.Scooter) -> Listing {
        Listing(id: s.id, kind: .demoScooter, name: s.name, location: s.location,
                description: "", photo: s.photo, rentThb: s.rentThb, depositThb: s.depositThb, perDay: false, symbol: "scooter", vault: s.vault ?? false)
    }

    /// Shown when the server cannot be reached: the same items, labelled demo.
    static let offline: [Listing] = [
        Listing(id: "mystery-box", kind: .stage, name: "KeyEscrow Mystery Box", location: "On stage, BNB Bangkok",
                description: "A real box we brought to the stage. Rent it, take it, bring it back: the deposit sits in its own escrow on BNB Chain until both sides agree.",
                photo: nil, rentThb: 200, depositThb: 1000, perDay: true, symbol: "shippingbox.fill", vault: false),
        Listing(id: "click-125i-cnx", kind: .demoScooter, name: "Honda Click 125i", location: "Chiang Mai Old City", description: "", photo: nil, rentThb: 3400, depositThb: 6800, perDay: false, symbol: "scooter", vault: false),
        Listing(id: "pcx-160-bkk", kind: .demoScooter, name: "Honda PCX 160", location: "Sukhumvit, Bangkok", description: "", photo: nil, rentThb: 4800, depositThb: 9600, perDay: false, symbol: "scooter", vault: true),
    ]
}
