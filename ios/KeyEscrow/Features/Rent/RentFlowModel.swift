import Foundation
import SwiftUI

/// The rent flow on BSC testnet with the guest wallet, step by step. Every step is derived from chain state (read back
/// through the API), so leaving the screen or restarting the app carries on where it was. Mirrors the web's /r judge
/// flow (web/components/stage/JudgeFlow.tsx, lib/stage.ts judgeStep).
@MainActor
final class RentFlowModel: ObservableObject {
    enum Step: String, Equatable { case loading, money, rent, fund, busy, pickup, giveBack, inspect, waiting, settled, cancelled }

    let listing: Listing
    let wallet: WalletStore
    let api = APIClient()
    let sender = TxSender()

    @Published var stage: StageStatus?
    @Published var lease: Lease?
    @Published var events: [ChainIndex.Event] = []
    @Published var inspection: Inspection?
    @Published var photos: [CapturedPhoto] = []
    @Published var busy: String?
    @Published var error: String?
    @Published var note: String?
    @Published var sent: [TxSender.Sent] = []
    @Published var thbPerUsdt = Money.fallbackThbPerUsdt
    @Published var loaded = false

    init(listing: Listing, wallet: WalletStore) {
        self.listing = listing
        self.wallet = wallet
    }

    var me: String { wallet.address }
    var leaseAddress: String? {
        listing.kind == .stage ? (stage.flatMap { s in s.rental.flatMap { EthAddress.same($0.renter, me) ? $0.lease : nil } }) : ShopRentals.lease(for: listing.id, renter: me)
    }

    /// mUSDT the next rental will ask for (rent + deposit).
    var price: (rent: BigUInt, deposit: BigUInt) {
        if let l = lease, !l.isFinal { return (l.rent.units, l.deposit.units) }
        if let s = stage { return (s.price.rent, s.price.deposit) }
        return (Money.unitsFromThb(listing.rentThb, rate: thbPerUsdt), Money.unitsFromThb(listing.depositThb, rate: thbPerUsdt))
    }

    func thb(_ u: BigUInt) -> String { Money.thb(u, rate: thbPerUsdt) }

    // MARK: Step

    var step: Step {
        guard loaded else { return .loading }
        if let l = lease, l.status != "Cancelled", EthAddress.same(l.renter, me) {
            switch l.status {
            case "Created": return .fund
            case "Settled": return .settled
            case "MoveOut", "Disputed": return .waiting
            default: return !l.hasPickupPhotos ? .pickup : !l.hasReturnPhotos ? .giveBack : .inspect
            }
        }
        if listing.kind == .stage, let s = stage {
            if let c = s.creating, !EthAddress.same(c.renter, me) { return .busy }
            if s.rental != nil, let l = s.lease, !replaceable(l, createdAt: s.rental!.createdAt) { return .busy }
        }
        let need = price.rent + price.deposit
        let bnb = stage?.me?.bnb ?? wallet.tbnb ?? BigUInt()
        let usdt = stage?.me?.musdt ?? wallet.musdt ?? BigUInt()
        if bnb < WalletStore.minGas || usdt < need { return .money }
        return .rent
    }

    /// lib/stage.ts replaceable: no rental, a finished one, or an offer left unfunded for 5 minutes.
    private func replaceable(_ l: StageStatus.Snapshot, createdAt: Double) -> Bool {
        if l.status == "Settled" || l.status == "Cancelled" { return true }
        return l.status == "Created" && Date().timeIntervalSince1970 * 1000 - createdAt > 5 * 60_000
    }

    // MARK: Refresh

    func refresh() async {
        do {
            async let p = try? api.price()
            if listing.kind == .stage {
                stage = try await api.stage(listing.id, renter: me)
                if let r = stage?.price.thbPerUsdt { thbPerUsdt = r }
            } else {
                if let q = await p { thbPerUsdt = q.thbPerUsdt }
                await wallet.refresh()
            }
            if let a = leaseAddress {
                lease = try await api.getLease(a)
                if let ix = try? await api.chainIndex() {
                    events = ix.events(of: a)
                }
            } else {
                lease = nil
                events = []
            }
            if listing.kind == .stage { await wallet.refresh() }
            loaded = true
            if busy == nil { error = nil }
        } catch {
            loaded = true
            if busy == nil { self.error = error.localizedDescription }
        }
    }

    /// Runs one user action: shows progress, collects the transactions, refreshes from the chain afterwards.
    func act(_ label: String, _ fn: @escaping () async throws -> Void) {
        guard busy == nil else { return }
        busy = label
        error = nil
        Task {
            do {
                try await fn()
                note = nil
            } catch {
                note = nil
                self.error = error.localizedDescription
            }
            busy = nil
            await refresh()
        }
    }

    private func record(_ s: TxSender.Sent) { sent.append(s) }

    // MARK: Actions

    /// Test money: the stage drip (tBNB + mUSDT from the team's funder) and, for the bigger scooter deposits, the
    /// MockUSDT faucet signed by the guest wallet itself.
    func getTestMoney(t: @escaping (String) -> String) {
        act("money") { [self] in
            await wallet.refresh()
            let need = price.rent + price.deposit
            if (wallet.tbnb ?? BigUInt()) < WalletStore.minGas || (listing.kind == .stage && (wallet.musdt ?? BigUInt()) < need) {
                note = t("flow.money.asking")
                let r = try await api.stageDrip("mystery-box", to: me)
                for h in r.txs { record(.init(description: t("flow.money.dripTx"), hash: h, block: nil)) }
                for h in r.txs { _ = try? await sender.waitForReceipt(h, timeout: 60) }
                await wallet.refresh()
                if (wallet.tbnb ?? BigUInt()) < WalletStore.minGas { throw TxSender.SendError.message(t("flow.money.noGas")) }
            }
            let have = wallet.musdt ?? BigUInt()
            if have < need {
                note = t("flow.money.faucet")
                // Mint the shortfall plus a margin, rounded up to whole tokens (faucet limit: 10,000 per call).
                var amount = (need - have) + need.divided(by: 10).0
                amount = amount.divided(by: 1_000_000).0.adding(1).multiplied(by: 1_000_000)
                if amount > BigUInt(10_000_000_000) { amount = BigUInt(10_000_000_000) }
                let s = try await sender.send(key: wallet.guest, to: TxSender.token, data: try ABI.faucet(to: me, amount: amount), value: BigUInt(), description: t("flow.money.faucetTx"))
                record(s)
            }
        }
    }

    /// Owner's offer, then the renter pays rent + deposit into the new escrow.
    func rent(t: @escaping (String) -> String) {
        act("rent") { [self] in
            var address: String
            if listing.kind == .stage {
                note = t("flow.rent.preparing")
                address = try await api.stageLease(listing.id, renter: me).lease
            } else {
                address = try await createShopOffer(t: t)
            }
            note = t("flow.rent.paying")
            try await fund(address)
        }
    }

    func payExisting() {
        guard let a = leaseAddress else { return }
        act("rent") { [self] in try await fund(a) }
    }

    private func fund(_ lease: String) async throws {
        let p = try await api.prepare("fund", ["lease": lease, "from": me])
        _ = try await sender.run(p, key: wallet.guest, onSent: record)
    }

    /// The demo shop wallet (on this phone) offers the scooter: prepare_create_lease signed by the shop key.
    private func createShopOffer(t: (String) -> String) async throws -> String {
        let shop = wallet.shop
        note = t("flow.rent.shopGas")
        let shopBnb = try await sender.rpc.balance(shop.address)
        if shopBnb < BigUInt(200_000_000_000_000) {
            // The guest lends the shop a little gas (0.0004 tBNB, a plain transfer between this phone's two test wallets).
            let s = try await sender.send(key: wallet.guest, to: shop.address, data: Data(), value: BigUInt(400_000_000_000_000), description: t("flow.rent.shopGasTx"), fixedGas: 21_000)
            record(s)
        }
        note = t("flow.rent.preparing")
        let p = try await api.prepare("create_lease", [
            "from": shop.address, "renter": me, "rent": Self.whole(listing.rentThb), "deposit": Self.whole(listing.depositThb),
            "currency": "THB", "termPeriods": 1, "rentPeriodDays": 30, "responseWindowDays": 1, "arbiterWindowDays": 1,
        ])
        // A step that timed out earlier may still be mined: finish that one instead of creating a second offer.
        var hash: String
        if let pending = ShopRentals.pendingOffer(for: listing.id, renter: me), (try? await sender.rpc.transaction(pending)) != nil {
            hash = pending
        } else {
            guard p.steps.count == 1, let step = p.steps.first, let data = Data(hex: step.data) else { throw TxSender.SendError.message("Unexpected offer steps.") }
            try await sender.checkPolicy(to: step.to, data: data, signer: shop.address)
            guard TxPolicy.address(data, 0).map({ EthAddress.same($0, me) }) == true else { throw EthError.notAllowed("the offer is for another renter") }
            hash = try await sender.signAndSend(key: shop, to: step.to, data: data, description: step.description) { ShopRentals.setPendingOffer($0, for: self.listing.id, renter: self.me) }
        }
        let receipt = try await sender.waitForReceipt(hash)
        ShopRentals.setPendingOffer(nil, for: listing.id, renter: me)
        guard receipt.succeeded else { throw TxSender.SendError.reverted(hash) }
        record(.init(description: p.steps.first?.description ?? "Offer", hash: hash, block: receipt.blockNumber))
        // EscrowFactory LeaseCreated(address indexed escrow, address indexed landlord, address indexed tenant, ...)
        let created = receipt.logs.first { EthAddress.same($0.address, TxSender.factory) && $0.topics.count == 4 && $0.topics[3].lowercased().hasSuffix(String(me.lowercased().dropFirst(2))) }
        guard let topic = created?.topics[1] else { throw TxSender.SendError.message("The offer was sent but its escrow was not found in the receipt.") }
        let escrow = EthAddress.checksum("0x" + String(topic.suffix(40)))
        ShopRentals.set(escrow, for: listing.id, renter: me)
        ShopRentals.remember(name: listing.name, of: listing.id)
        return escrow
    }

    static func whole(_ v: Double) -> String { v.isFinite && v > 0 && v < 1e9 ? String(format: "%.0f", v.rounded()) : "0" }

    /// Hash (SHA-256) the photos, upload them as evidence (best effort), anchor each hash on-chain.
    func savePhotos(kind: String) {
        guard let lease = leaseAddress, !photos.isEmpty else { return }
        let shots = photos
        act("photos") { [self] in
            var hashes = shots.map(\.sha256)
            if let up = try? await api.uploadEvidence(shots.map(\.jpeg)), up.items.count == shots.count { hashes = up.items.map { $0.hash.lowercased() } }
            let anchored = Set(photoHashes(kind: kind == "check_in" ? 0 : 1))
            for h in hashes where !anchored.contains(h) {
                let p = try await api.prepare("add_evidence", ["lease": lease, "from": me, "kind": kind, "contentHash": h])
                _ = try await sender.run(p, key: wallet.guest, onSent: record)
            }
            photos = []
        }
    }

    /// Photo hashes anchored on this rental: from the chain index, plus the escrow's own latest pickup / return hash
    /// (read straight from the contract), so a lagging index never blocks the inspection.
    func photoHashes(kind: Int) -> [String] {
        var out = events.filter { $0.name == "EvidenceAdded" && $0.args["kind"]?.int == kind }.compactMap { $0.args["contentHash"]?.string?.lowercased() }
        if let l = lease {
            let h = (kind == 0 ? l.checkInHash : l.checkOutHash).lowercased()
            if h != Lease.zeroHash, !out.contains(h) { out.append(h) }
        }
        return out
    }

    func runInspection() {
        guard let l = lease else { return }
        act("inspect") { [self] in
            let notes = listing.kind == .stage ? "The item is \"\(listing.name)\", a physical item rented for a day (not a scooter)." : nil
            inspection = try await api.inspect(deposit: l.deposit.units, checkIn: photoHashes(kind: 0), checkOut: photoHashes(kind: 1), scooterId: listing.id, notes: notes, lease: nil)
        }
    }

    func proposeSplit() {
        guard let l = lease, let i = inspection else { return }
        act("propose") { [self] in
            let p = try await api.prepare("propose_settlement", [
                "lease": l.address, "from": me,
                "inspection": ["tenantRefund": i.tenantRefund.description, "reportHash": i.reportHash, "deposit": i.deposit.description],
            ])
            // Sign only the split the inspector proposed: propose(tenantRefund, reportHash) to this rental.
            guard p.steps.count == 1, let step = p.steps.first, EthAddress.same(step.to, l.address), let data = Data(hex: step.data),
                  data.prefix(4) == TxPolicy.propose, TxPolicy.word(data, 0).map(BigUInt.init(bytes:)) == i.tenantRefund,
                  TxPolicy.word(data, 1)?.hex0x.lowercased() == i.reportHash.lowercased()
            else { throw EthError.notAllowed("the prepared proposal does not match the inspection") }
            _ = try await sender.run(p, key: wallet.guest, onSent: record)
        }
    }

    /// Demo scooters only: the demo shop wallet accepts the renter's proposal.
    func shopAccepts() {
        guard let l = lease, listing.kind == .demoScooter else { return }
        act("accept") { [self] in
            let p = try await api.prepare("accept", ["lease": l.address, "from": wallet.shop.address])
            _ = try await sender.run(p, key: wallet.shop, onSent: record)
        }
    }

    /// Start over with a new rental of the same demo scooter (the old escrow stays on-chain).
    func startOver() {
        ShopRentals.set(nil, for: listing.id, renter: me)
        lease = nil
        inspection = nil
        sent = []
        Task { await refresh() }
    }

    var settledBack: BigUInt? {
        guard let e = events.last(where: { $0.name == "Settled" }) else { return nil }
        return (e.args["tenantRefund"]?.big ?? BigUInt()) + (e.args["rentToTenant"]?.big ?? BigUInt())
    }
    var settledTx: String? { events.last(where: { $0.name == "Settled" })?.txHash }
}
