import Foundation

/// The rental page as pure data (port of web/components/lease/story.ts moneyFlow + monthCells, simplified banner).
enum RentalStory {
    struct Flow: Equatable { var paidIn = BigUInt(); var toOwner = BigUInt(); var fee = BigUInt(); var backToRenter = BigUInt() }

    /// Money that moved, from the escrow's events (the escrow balance itself is read live).
    static func moneyFlow(_ events: [ChainIndex.Event]) -> Flow {
        var f = Flow()
        func b(_ e: ChainIndex.Event, _ k: String) -> BigUInt { e.args[k]?.big ?? BigUInt() }
        for e in events {
            switch e.name {
            case "Funded": f.paidIn = f.paidIn + b(e, "deposit") + b(e, "firstRent")
            case "RentPaid": f.paidIn = f.paidIn + b(e, "amount")
            case "RentReleased": f.toOwner = f.toOwner + b(e, "toLandlord")
            case "ProtocolFeePaid": f.fee = f.fee + b(e, "amount")
            case "Settled":
                f.toOwner = f.toOwner + b(e, "landlordClaim") + b(e, "rentToLandlord") - b(e, "fee")
                f.backToRenter = f.backToRenter + b(e, "tenantRefund") + b(e, "rentToTenant")
            default: break
            }
        }
        return f
    }

    /// keccak256 of RentalEscrow's `Settled(uint256,uint256,uint256,uint256,uint256,bytes32)` event.
    static let settledTopic = Keccak256.hash("Settled(uint256,uint256,uint256,uint256,uint256,bytes32)").hex0x.lowercased()

    /// What the escrow paid out, read from the receipt of the transaction that settled it. The chain index can be
    /// behind; the receipt is on the chain itself. Makes the same sums as `moneyFlow` does from the indexed event.
    static func settledFlow(from receipt: TxReceipt, lease: String) -> Flow? {
        guard receipt.succeeded,
              let log = receipt.logs.first(where: { EthAddress.same($0.address, lease) && $0.topics.first?.lowercased() == settledTopic }),
              let data = Data(hex: log.data), data.count >= 5 * 32
        else { return nil }
        func word(_ i: Int) -> BigUInt { BigUInt(bytes: Data(data[data.startIndex + 32 * i ..< data.startIndex + 32 * (i + 1)])) }
        let (refund, claim, rentToOwner, rentToRenter, fee) = (word(0), word(1), word(2), word(3), word(4))
        let gross = claim + rentToOwner
        var f = Flow()
        f.toOwner = gross < fee ? BigUInt() : gross - fee
        f.fee = fee
        f.backToRenter = refund + rentToRenter
        return f
    }

    /// The payout to show: the indexed events when they hold the settlement, else the settling receipt (if known).
    static func payout(events: [ChainIndex.Event], receipt: Flow?) -> Flow {
        let f = moneyFlow(events)
        if events.contains(where: { $0.name == "Settled" }) { return f }
        guard let r = receipt else { return f }
        var out = f
        out.toOwner = f.toOwner + r.toOwner
        out.fee = f.fee + r.fee
        out.backToRenter = f.backToRenter + r.backToRenter
        return out
    }

    enum Cell: String { case out, held, due }

    static func periods(_ l: Lease) -> [Cell] {
        guard l.startedAt != nil else { return [] }
        return (0..<max(0, l.termPeriods)).map { i in i < l.periodsReleased ? .out : i < l.periodsFunded ? .held : .due }
    }

    enum Viewer { case renter, owner, other }

    static func viewer(_ l: Lease, me: String) -> Viewer {
        EthAddress.same(l.renter, me) ? .renter : EthAddress.same(l.owner, me) ? .owner : .other
    }

    /// Banner: (tone, title key, args). Copy lives in L10n ("banner.*").
    static func banner(_ l: Lease, me: String, flow: Flow, fmt: (BigUInt) -> String) -> (Tone, String, [String]) {
        let v = viewer(l, me: me)
        switch l.status {
        case "Created":
            return v == .renter ? (.info, "banner.fund", [fmt(l.deposit.units + l.rent.units)]) : (.info, "banner.waitFund", [])
        case "Active":
            if l.hasReturnPhotos { return (.ok, v == .renter ? "banner.returned" : "banner.returnedOther", []) }
            return (.ok, "banner.locked", [fmt(l.deposit.units)])
        case "MoveOut":
            guard let p = l.proposal else { return (.warn, "banner.proposalWaiting", []) }
            if EthAddress.same(p.proposer, me) { return (.warn, "banner.yourProposal", [fmt(p.toRenter.units), fmt(p.toOwner.units)]) }
            return (.warn, "banner.proposed", [fmt(p.toRenter.units), fmt(p.toOwner.units)])
        case "Disputed": return (.danger, "banner.disputed", [])
        case "Settled":
            // Without the Settled event (the chain index can be behind) the amount is unknown: say "Settled", not "฿0".
            let known = flow.backToRenter + flow.toOwner + flow.fee > BigUInt()
            return (.neutral, v == .renter && known ? "banner.settledRenter" : "banner.settled", [fmt(flow.backToRenter)])
        default: return (.neutral, "banner.cancelled", [])
        }
    }
}
