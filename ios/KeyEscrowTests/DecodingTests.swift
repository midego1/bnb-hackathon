import XCTest
@testable import KeyEscrow

/// Decodes fixtures captured from the live endpoints (Fixtures/README.md).
final class DecodingTests: XCTestCase {
    func fixture<T: Decodable>(_ name: String, as: T.Type) throws -> T {
        let url = try XCTUnwrap(Bundle(for: DecodingTests.self).url(forResource: name, withExtension: "json"), name)
        return try JSONDecoder().decode(T.self, from: Data(contentsOf: url))
    }

    func testGetLeaseDisputed() throws {
        let l = try fixture("get_lease_disputed", as: Lease.self)
        XCTAssertEqual(l.status, "Disputed")
        XCTAssertEqual(l.chainId, 97)
        XCTAssertEqual(l.deposit.units, BigUInt(200_000_000))
        XCTAssertEqual(l.escrowBalance.units, BigUInt(300_000_000))
        XCTAssertEqual(l.proposal?.nonce, 1)
        XCTAssertEqual(l.proposal?.toRenter.units, BigUInt(120_000_000))
        XCTAssertFalse(l.hasPickupPhotos)
        XCTAssertFalse(l.isFinal)
    }

    func testGetLeaseSettled() throws {
        let l = try fixture("get_lease_settled", as: Lease.self)
        XCTAssertTrue(l.isFinal)
        XCTAssertEqual(l.periodsReleased, 1)
        XCTAssertEqual(RentalStory.periods(l), Array([RentalStory.Cell.out] + Array(repeating: .due, count: 11)))
    }

    func testListLeases() throws {
        let l = try fixture("list_leases", as: LeaseList.self)
        XCTAssertEqual(l.count, 5)
        XCTAssertEqual(l.leases.first?.role, "renter")
        XCTAssertEqual(Set(l.leases.map(\.status)), ["Disputed", "Active", "Created", "Settled"])
    }

    func testExplainStatus() throws {
        let e = try fixture("explain_status", as: ExplainStatus.self)
        XCTAssertEqual(e.you, "renter")
        XCTAssertTrue(e.headline.hasPrefix("Closed"))
    }

    func testPrepareFund() throws {
        let p = try fixture("prepare_fund", as: Prepared.self)
        XCTAssertEqual(p.chainId, 97)
        XCTAssertEqual(p.steps.count, 2)
        XCTAssertEqual(p.steps[0].function, "approve(address,uint256)")
        XCTAssertTrue(EthAddress.same(p.steps[0].to, TxSender.token))
        XCTAssertEqual(p.steps[1].data, "0xb60d4288") // fund()
        XCTAssertEqual(p.simulation?.ok, true)
    }

    func testStageStatusWithBigintCodec() throws {
        let s = try fixture("stage_mystery_box", as: StageStatus.self)
        XCTAssertEqual(s.listing.slug, "mystery-box")
        XCTAssertEqual(s.price.rent, BigUInt(6_070_000))   // {"$n": "6070000"}
        XCTAssertEqual(s.price.deposit, BigUInt(30_310_000))
        XCTAssertEqual(s.price.thbPerUsdt, 33)
        XCTAssertEqual(s.lease?.terms.depositAmount, BigUInt(30_310_000))
        XCTAssertEqual(Listing.stage(s.listing).rentPerDayThb, 200)
    }

    func testChainIndexAndMoneyFlow() throws {
        let ix = try fixture("chain_index", as: ChainIndex.self)
        let ev = ix.events(of: "0xEE9957DFeEF236e9C0953a01FCA201BC1a9E86D6")
        XCTAssertEqual(ev.first?.name, "LeaseCreated") // the factory's event, matched by its escrow arg
        XCTAssertTrue(ev.contains { $0.name == "Settled" })
        let f = RentalStory.moneyFlow(ev)
        XCTAssertEqual(f.paidIn, BigUInt(300_000_000))         // 200 deposit + 100 first rent
        XCTAssertEqual(f.paidIn, f.toOwner + f.fee + f.backToRenter) // every unit is accounted for
    }

    func testFleetPriceSettlement() throws {
        let fleet = try fixture("fleet", as: Fleet.self)
        XCTAssertFalse(fleet.scooters.isEmpty)
        let scooter = Listing.scooter(fleet.scooters[0])
        XCTAssertEqual(scooter.kind, .demoScooter)
        XCTAssertFalse(scooter.perDay)
        XCTAssertEqual(try fixture("price", as: PriceQuote.self).thbPerUsdt, 33)
        let i = try fixture("settlement", as: Inspection.self)
        XCTAssertEqual(i.tenantRefund + i.landlordClaim, i.deposit)
        XCTAssertTrue(i.mock)
        XCTAssertTrue(Hex.isHex(i.reportHash, bytes: 32))
    }

    func testReceiptDecoding() throws {
        let json = #"{"transactionHash":"0xab","status":"0x1","blockNumber":"0x10","logs":[{"address":"0x04d7","topics":["0x1"],"data":"0x"}]}"#
        let r = try JSONDecoder().decode(TxReceipt.self, from: Data(json.utf8))
        XCTAssertTrue(r.succeeded)
        XCTAssertEqual(r.logs.count, 1)
    }

    /// The settled payout read from a receipt (used when the chain index is behind) equals what the indexed event gives.
    func testSettledFlowFromReceipt() throws {
        let lease = "0x758fda4c2c5C1A121106ce91B15348E2a2b84dEd"
        func word(_ n: UInt64) -> String { String(repeating: "0", count: 64 - String(n, radix: 16).count) + String(n, radix: 16) }
        // Settled(tenantRefund 161.82, landlordClaim 20, rentToLandlord 90.91, rentToTenant 0, fee 9.091, basis)
        let data = "0x" + [161_820_000, 20_000_000, 90_910_000, 0, 9_091_000].map(word).joined() + String(repeating: "ab", count: 32)
        let json = """
        {"transactionHash":"0xb3d492c143c0aa250584952b984cc2aaae1c9f3be841c6c144dac6cc70b5da64","status":"0x1","blockNumber":"0x8a2f3c1",
         "logs":[{"address":"0x7aF0035c254bC760231BCcFF3403A714611c35B1","topics":["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"],"data":"0x\(word(1))"},
                 {"address":"\(lease.lowercased())","topics":["\(RentalStory.settledTopic)"],"data":"\(data)"}]}
        """
        let receipt = try JSONDecoder().decode(TxReceipt.self, from: Data(json.utf8))
        XCTAssertEqual(RentalStory.settledTopic.count, 66)
        let f = try XCTUnwrap(RentalStory.settledFlow(from: receipt, lease: lease))
        XCTAssertEqual(f.backToRenter, BigUInt(161_820_000))
        XCTAssertEqual(f.toOwner, BigUInt(101_819_000)) // claim + rent - fee
        XCTAssertEqual(f.fee, BigUInt(9_091_000))
        XCTAssertNil(RentalStory.settledFlow(from: receipt, lease: "0xEC84093A157192E4A31f0fc31B5edE806a97CCa3"), "another escrow's log is not ours")
        // No events at all: the receipt is the payout. With an indexed Settled event the events win.
        XCTAssertEqual(RentalStory.payout(events: [], receipt: f), f)
        let ix = try fixture("chain_index", as: ChainIndex.self)
        let settled = try XCTUnwrap(ix.events.first { $0.name == "Settled" })
        let events = ix.events(of: settled.address)
        XCTAssertEqual(RentalStory.payout(events: events, receipt: f), RentalStory.moneyFlow(events))
    }
}
