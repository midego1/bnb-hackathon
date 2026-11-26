import Foundation
import SwiftUI

/// The guest wallet (a testnet-only key made on this phone, kept in the Keychain) and the demo shop's wallet (a second
/// local test key that plays the scooter shop owner for the demo scooters). Neither holds real money.
@MainActor
final class WalletStore: ObservableObject {
    static let guestAccount = "guest-key-v1"
    static let shopAccount = "demo-shop-key-v1"

    @Published private(set) var guest: EthKey
    @Published private(set) var shop: EthKey
    @Published var tbnb: BigUInt?
    @Published var musdt: BigUInt?
    @Published var shopTbnb: BigUInt?
    @Published var refreshing = false
    @Published var lastError: String?
    /// The Keychain could not be read (e.g. the app was launched before the first unlock): a throwaway in-memory key
    /// stands in until `reloadIfNeeded()` finds the real one. It is never saved, so the stored key is never replaced.
    @Published private(set) var keychainUnavailable = false

    let rpc = RPC()

    init() {
        let g = WalletStore.loadOrCreate(WalletStore.guestAccount)
        let s = WalletStore.loadOrCreate(WalletStore.shopAccount)
        guest = g.key
        shop = s.key
        keychainUnavailable = !g.stored || !s.stored
    }

    /// The stored key, or a new one when there is none. On a Keychain error: a throwaway key, `stored == false`.
    private static func loadOrCreate(_ account: String) -> (key: EthKey, stored: Bool) {
        switch Keychain.read(account) {
        case .found(let d):
            if let k = try? EthKey(privateKey: d) { return (k, true) }
            return ((try? EthKey.generate())!, false) // unreadable bytes: keep them, do not overwrite
        case .notFound:
            let k = (try? EthKey.generate())!
            return (k, Keychain.add(k.privateKey, account))
        case .failed:
            return ((try? EthKey.generate())!, false)
        }
    }

    func reloadIfNeeded() {
        guard keychainUnavailable else { return }
        let g = WalletStore.loadOrCreate(WalletStore.guestAccount)
        let s = WalletStore.loadOrCreate(WalletStore.shopAccount)
        if g.stored { guest = g.key }
        if s.stored { shop = s.key }
        keychainUnavailable = !g.stored || !s.stored
    }

    var address: String { guest.address }

    func refresh() async {
        refreshing = true
        defer { refreshing = false }
        do {
            async let b = rpc.balance(guest.address)
            async let u = rpc.tokenBalance(token: TxSender.token, owner: guest.address)
            async let s = rpc.balance(shop.address)
            (tbnb, musdt, shopTbnb) = try await (b, u, s)
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Forget this phone's test wallets and make fresh ones (testnet only: nothing of value is lost).
    func reset() {
        Keychain.delete(WalletStore.guestAccount)
        Keychain.delete(WalletStore.shopAccount)
        keychainUnavailable = true
        reloadIfNeeded()
        tbnb = nil; musdt = nil; shopTbnb = nil
        ShopRentals.clear()
    }

    /// Enough tBNB for a handful of transactions (lib/stage.ts MIN_GAS_WEI).
    static let minGas = BigUInt(300_000_000_000_000)
}

/// Which escrow belongs to which demo scooter (the shop flow), per guest wallet. Local only.
enum ShopRentals {
    private static let key = "keyescrow.shopRentals.v1"
    static func lease(for scooter: String, renter: String) -> String? {
        let d = (UserDefaults.standard.dictionary(forKey: key) as? [String: String]) ?? [:]
        // An older build stored the rental under the listing's old id (PhotoCatalog.legacySlugs).
        let old = PhotoCatalog.legacySlugs.first { $0.value == scooter }?.key
        return d["\(renter.lowercased()):\(scooter)"] ?? old.flatMap { d["\(renter.lowercased()):\($0)"] }
    }
    static func set(_ lease: String?, for scooter: String, renter: String) {
        var d = (UserDefaults.standard.dictionary(forKey: key) as? [String: String]) ?? [:]
        d["\(renter.lowercased()):\(scooter)"] = lease
        // The new rental (or "start over") replaces one an older build stored under the old id.
        for (old, slug) in PhotoCatalog.legacySlugs where slug == scooter { d["\(renter.lowercased()):\(old)"] = nil }
        UserDefaults.standard.set(d, forKey: key)
    }
    /// Escrow -> scooter id, to continue a rental from My rentals.
    static func scooter(forLease lease: String) -> String? {
        let d = (UserDefaults.standard.dictionary(forKey: key) as? [String: String]) ?? [:]
        return d.first { $0.value.lowercased() == lease.lowercased() }.map { String($0.key.split(separator: ":").last ?? "") }
    }
    static func clear() { UserDefaults.standard.removeObject(forKey: key); UserDefaults.standard.removeObject(forKey: pending) }

    /// A createLease the shop sent but whose receipt we have not seen yet.
    private static let pending = "keyescrow.shopPendingOffers.v1"
    static func pendingOffer(for scooter: String, renter: String) -> String? {
        (UserDefaults.standard.dictionary(forKey: pending) as? [String: String])?["\(renter.lowercased()):\(scooter)"]
    }
    static func setPendingOffer(_ hash: String?, for scooter: String, renter: String) {
        var d = (UserDefaults.standard.dictionary(forKey: pending) as? [String: String]) ?? [:]
        d["\(renter.lowercased()):\(scooter)"] = hash
        UserDefaults.standard.set(d, forKey: pending)
    }

    private static let names = "keyescrow.shopNames.v1"
    static func remember(name: String, of scooter: String) {
        var d = (UserDefaults.standard.dictionary(forKey: names) as? [String: String]) ?? [:]
        d[scooter] = name
        UserDefaults.standard.set(d, forKey: names)
    }
    static func name(of scooter: String) -> String? { (UserDefaults.standard.dictionary(forKey: names) as? [String: String])?[scooter] }
}
