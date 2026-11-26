import Foundation

/// A tiny unsigned big integer for token amounts and wei (uint256 range). Only what the app needs: parse decimal and
/// hex, print decimal, add, subtract, multiply/divide by small numbers, compare, and big-endian bytes for RLP / ABI.
struct BigUInt: Hashable, Comparable, CustomStringConvertible, Sendable {
    /// Little-endian 32-bit limbs, no trailing zero limbs (zero = []).
    private(set) var limbs: [UInt32]

    init() { limbs = [] }
    init(_ v: UInt64) {
        limbs = [UInt32(truncatingIfNeeded: v), UInt32(truncatingIfNeeded: v >> 32)]
        normalize()
    }

    init?(_ decimal: String) {
        let s = decimal.trimmingCharacters(in: .whitespaces)
        guard !s.isEmpty, s.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
        var r = BigUInt()
        for ch in s { r = r.multiplied(by: 10).adding(UInt32(ch.wholeNumberValue!)) }
        self = r
    }

    init?(hex: String) {
        guard let d = Data(hex: hex.isEmpty || hex == "0x" ? "0x0" : hex) else { return nil }
        self.init(bytes: d)
    }

    init(bytes: Data) {
        var r = BigUInt()
        for b in bytes { r = r.multiplied(by: 256).adding(UInt32(b)) }
        self = r
    }

    private mutating func normalize() { while let l = limbs.last, l == 0 { limbs.removeLast() } }

    var isZero: Bool { limbs.isEmpty }

    func multiplied(by m: UInt32) -> BigUInt {
        var out = BigUInt()
        var carry: UInt64 = 0
        for l in limbs {
            let p = UInt64(l) * UInt64(m) + carry
            out.limbs.append(UInt32(truncatingIfNeeded: p))
            carry = p >> 32
        }
        if carry > 0 { out.limbs.append(UInt32(carry)) }
        out.normalize()
        return out
    }

    func adding(_ a: UInt32) -> BigUInt { self + BigUInt(UInt64(a)) }

    /// (quotient, remainder) of division by a small number.
    func divided(by d: UInt32) -> (BigUInt, UInt32) {
        precondition(d != 0)
        var out = [UInt32](repeating: 0, count: limbs.count)
        var rem: UInt64 = 0
        for i in stride(from: limbs.count - 1, through: 0, by: -1) {
            let cur = (rem << 32) | UInt64(limbs[i])
            out[i] = UInt32(cur / UInt64(d))
            rem = cur % UInt64(d)
        }
        var q = BigUInt()
        q.limbs = out
        q.normalize()
        return (q, UInt32(rem))
    }

    static func + (a: BigUInt, b: BigUInt) -> BigUInt {
        var out = BigUInt()
        var carry: UInt64 = 0
        for i in 0..<max(a.limbs.count, b.limbs.count) {
            let s = UInt64(i < a.limbs.count ? a.limbs[i] : 0) + UInt64(i < b.limbs.count ? b.limbs[i] : 0) + carry
            out.limbs.append(UInt32(truncatingIfNeeded: s))
            carry = s >> 32
        }
        if carry > 0 { out.limbs.append(UInt32(carry)) }
        out.normalize()
        return out
    }

    /// Saturating subtraction: a - b, or zero when b > a.
    static func - (a: BigUInt, b: BigUInt) -> BigUInt {
        guard a > b else { return BigUInt() }
        var out = BigUInt()
        var borrow: Int64 = 0
        for i in 0..<a.limbs.count {
            var d = Int64(a.limbs[i]) - Int64(i < b.limbs.count ? b.limbs[i] : 0) - borrow
            if d < 0 { d += 1 << 32; borrow = 1 } else { borrow = 0 }
            out.limbs.append(UInt32(d))
        }
        out.normalize()
        return out
    }

    static func < (a: BigUInt, b: BigUInt) -> Bool {
        if a.limbs.count != b.limbs.count { return a.limbs.count < b.limbs.count }
        for i in stride(from: a.limbs.count - 1, through: 0, by: -1) where a.limbs[i] != b.limbs[i] {
            return a.limbs[i] < b.limbs[i]
        }
        return false
    }

    /// Minimal big-endian bytes (zero = empty), the RLP integer form.
    var bytes: Data {
        var out = [UInt8]()
        var v = self
        while !v.isZero {
            let (q, r) = v.divided(by: 256)
            out.append(UInt8(r))
            v = q
        }
        return Data(out.reversed())
    }

    /// 32-byte big-endian word, the ABI form.
    var word: Data {
        let b = bytes
        return Data(repeating: 0, count: max(0, 32 - b.count)) + b
    }

    var description: String {
        if isZero { return "0" }
        var digits = [Character]()
        var v = self
        while !v.isZero {
            let (q, r) = v.divided(by: 10)
            digits.append(Character(String(r)))
            v = q
        }
        return String(digits.reversed())
    }

    var hexQuantity: String { isZero ? "0x0" : "0x" + String(bytes.hex.drop(while: { $0 == "0" })) }

    /// Lossy conversion for display maths (amounts far below 2^53 base units are exact).
    var double: Double { Double(description) ?? .infinity }
}

extension BigUInt: Codable {
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) {
            guard let v = s.hasPrefix("0x") ? BigUInt(hex: s) : BigUInt(s) else {
                throw DecodingError.dataCorruptedError(in: c, debugDescription: "not an integer: \(s)")
            }
            self = v
        } else if let n = try? c.decode(UInt64.self) {
            self = BigUInt(n)
        } else {
            // The web's bigint codec: {"$n": "123"}.
            struct Wrapped: Decodable { let n: String; enum CodingKeys: String, CodingKey { case n = "$n" } }
            let w = try c.decode(Wrapped.self)
            guard let v = BigUInt(w.n) else { throw DecodingError.dataCorruptedError(in: c, debugDescription: "not an integer: \(w.n)") }
            self = v
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(description)
    }
}
