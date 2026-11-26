import XCTest
@testable import KeyEscrow

final class MoneyTests: XCTestCase {
    func testUsdtSixDecimals() {
        XCTAssertEqual(Money.usdt(BigUInt(30_310_000)), "30.31 mUSDT")
        XCTAssertEqual(Money.usdt(BigUInt(1)), "0.000001 mUSDT")
        XCTAssertEqual(Money.usdt(BigUInt(1_234_567)), "1.234567 mUSDT")
        XCTAssertEqual(Money.usdt(BigUInt()), "0.00 mUSDT")
        XCTAssertEqual(Money.usdt(BigUInt(10_000_000_000)), "10,000.00 mUSDT")
    }

    func testBahtWhole() {
        XCTAssertEqual(Money.thb(BigUInt(30_310_000)), "฿1,000")     // 30.31 * 33 = 1000.23
        XCTAssertEqual(Money.thb(BigUInt(6_070_000), rate: 33), "฿200")
        XCTAssertEqual(Money.thb(baht: 113.33), "฿113")
        XCTAssertEqual(Money.thb(baht: 6800), "฿6,800")
        XCTAssertEqual(Money.both(BigUInt(100_000_000)), "฿3,300 · 100.00 mUSDT")
    }

    func testThbToUnitsMatchesServer() {
        // web/lib/server/stage/guards.ts thbToUnits: rounded up to the cent. The stage fixture says 6070000 / 30310000.
        XCTAssertEqual(Money.unitsFromThb(200, rate: 33), BigUInt(6_070_000))
        XCTAssertEqual(Money.unitsFromThb(1000, rate: 33), BigUInt(30_310_000))
        XCTAssertEqual(Money.unitsFromThb(3300, rate: 33), BigUInt(100_000_000))
        XCTAssertEqual(Money.unitsFromThb(0, rate: 33), BigUInt())
    }

    func testBnb() {
        XCTAssertEqual(Money.bnb(BigUInt(2_000_000_000_000_000)), "0.0020 tBNB")
    }

    func testEveryStringHasChinese() {
        let missing = L10n.table.filter { $0.value.1.isEmpty }.map(\.key)
        XCTAssertEqual(missing, [])
        XCTAssertEqual(L10n.string("flow.terms", lang: .zh, ["฿200", "฿1,000"]), "租金 ฿200 · 押金 ฿1,000")
        XCTAssertEqual(L10n.string("no.such.key", lang: .en), "no.such.key")
    }
}
