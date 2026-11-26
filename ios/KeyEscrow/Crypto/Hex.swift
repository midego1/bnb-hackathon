import Foundation

/// 0x-hex helpers. Lowercase out, any case in.
extension Data {
    init?(hex: String) {
        var s = hex.hasPrefix("0x") || hex.hasPrefix("0X") ? String(hex.dropFirst(2)) : hex
        if s.count % 2 == 1 { s = "0" + s }
        var out = Data(capacity: s.count / 2)
        var idx = s.startIndex
        while idx < s.endIndex {
            let next = s.index(idx, offsetBy: 2)
            guard let b = UInt8(s[idx..<next], radix: 16) else { return nil }
            out.append(b)
            idx = next
        }
        self = out
    }

    var hex: String { map { String(format: "%02x", $0) }.joined() }
    var hex0x: String { "0x" + hex }
}

enum Hex {
    /// True for "0x" + exactly `bytes` bytes of hex (any case).
    static func isHex(_ s: String, bytes: Int) -> Bool {
        guard s.hasPrefix("0x"), s.count == 2 + bytes * 2 else { return false }
        return s.dropFirst(2).allSatisfy { $0.isHexDigit }
    }
}
