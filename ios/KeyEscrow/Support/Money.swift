import Foundation

/// Amounts, baht first. mUSDT has 6 decimals; tBNB 18. Display only: the contracts always get integer base units.
enum Money {
    static let usdtDecimals = 6
    static let fallbackThbPerUsdt = 33.0

    /// Base units -> Decimal tokens, exactly.
    static func tokens(_ units: BigUInt, decimals: Int = usdtDecimals) -> Decimal {
        var d = Decimal(string: units.description) ?? 0
        var out = Decimal()
        var divisor = Decimal(1)
        for _ in 0..<decimals { divisor *= 10 }
        NSDecimalDivide(&out, &d, &divisor, .plain)
        return out
    }

    private static func formatter(min: Int, max: Int) -> NumberFormatter {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.numberStyle = .decimal
        f.usesGroupingSeparator = true
        f.groupingSeparator = ","
        f.groupingSize = 3
        f.minimumFractionDigits = min
        f.maximumFractionDigits = max
        f.roundingMode = .halfUp
        return f
    }

    /// "฿1,201": whole baht from mUSDT units at `thbPerUsdt` (the big-screen style).
    static func thb(_ units: BigUInt, rate: Double = fallbackThbPerUsdt) -> String {
        let n = NSDecimalNumber(decimal: tokens(units)).doubleValue * rate
        return thb(baht: n)
    }

    static func thb(baht: Double) -> String { "฿" + (formatter(min: 0, max: 0).string(from: NSNumber(value: baht.rounded())) ?? "0") }

    /// "36.38 mUSDT": at least 2 decimals, up to all 6 when they are not zero.
    static func usdt(_ units: BigUInt) -> String {
        (formatter(min: 2, max: usdtDecimals).string(from: NSDecimalNumber(decimal: tokens(units))) ?? "0.00") + " mUSDT"
    }

    /// "0.0020 tBNB"
    static func bnb(_ wei: BigUInt) -> String {
        (formatter(min: 4, max: 4).string(from: NSDecimalNumber(decimal: tokens(wei, decimals: 18))) ?? "0") + " tBNB"
    }

    /// "฿1,000 · 30.31 mUSDT"
    static func both(_ units: BigUInt, rate: Double = fallbackThbPerUsdt) -> String { "\(thb(units, rate: rate)) · \(usdt(units))" }

    /// THB -> mUSDT base units, rounded up to the cent (the renter never pays less than the listed THB). Mirrors
    /// web/lib/server/stage/guards.ts thbToUnits.
    static func unitsFromThb(_ thb: Double, rate: Double) -> BigUInt {
        guard thb > 0, rate > 0, thb.isFinite, rate.isFinite else { return BigUInt() }
        let cents = (thb / rate * 100 - 1e-9).rounded(.up)
        guard cents.isFinite, cents < 1e15 else { return BigUInt() }
        return BigUInt(UInt64(cents)).multiplied(by: 10_000)
    }
}
