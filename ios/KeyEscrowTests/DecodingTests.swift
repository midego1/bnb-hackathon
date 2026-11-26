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
}
