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
        case "Settled": return (.neutral, v == .renter ? "banner.settledRenter" : "banner.settled", [fmt(flow.backToRenter)])
        default: return (.neutral, "banner.cancelled", [])
        }
    }
}
